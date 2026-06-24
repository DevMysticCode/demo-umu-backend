import { existsSync, mkdirSync, createReadStream } from 'fs';
import { extname, join } from 'path';
import { diskStorage } from 'multer';
import multerS3 from 'multer-s3';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'stream';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/**
 * Single source of truth for file-upload storage.
 *
 * Two backends, chosen at boot from env:
 *   - S3 mode  → when S3_UPLOADS_BUCKET is set (production).
 *                Uses multer-s3 to stream uploads straight to S3.
 *                Container disk never touches user files, which is
 *                what fixes the DF4 "uploads disappear on redeploy"
 *                blocker on App Runner.
 *   - Disk mode → fallback for local dev (no AWS creds needed).
 *                Writes to ./uploads/<bucket>/<filename> exactly as
 *                before.
 *
 * The two-tier delivery model (public buckets via direct URL, private
 * via /files/<bucket>/<file>?sig=...) is preserved in both modes:
 *   - Public buckets (avatars, job-photos, property-images): saved
 *     with ACL 'public-read' in S3 mode → publicUrlFor() returns the
 *     S3 https URL. In disk mode, the URL stays /uploads/<bucket>/...
 *   - Private buckets (documents, passport-docs, kyc, etc.): saved
 *     private. The existing FilesController + HMAC-signed URLs still
 *     handle delivery; in S3 mode it streams via GetObjectCommand
 *     instead of fs.sendFile.
 */

const UPLOAD_ROOT = join(process.cwd(), 'uploads');

const PUBLIC_BUCKETS = new Set<string>([
  'avatars',
  'job-photos',
  'property-images',
]);

const s3Bucket = process.env.S3_UPLOADS_BUCKET ?? '';
const s3Region = process.env.AWS_REGION ?? 'eu-west-2';
export const isS3Mode = Boolean(s3Bucket);

// Lazy-init S3 client so dev/test environments without AWS credentials
// don't pay the connection setup cost — and so a missing creds error
// surfaces only when we actually try to read/write S3.
let _s3: S3Client | null = null;
function s3(): S3Client {
  if (!_s3) _s3 = new S3Client({ region: s3Region });
  return _s3;
}

export interface UploadStorageOptions {
  /** Conceptual bucket — e.g. 'job-photos', 'documents', 'avatars'. */
  bucket: string;
  /** Per-file size cap in MB. Multer rejects with 413 above this. */
  maxMb: number;
  /** Optional accept-list of exact MIME types (e.g. 'image/jpeg'). */
  mimeAllowList?: readonly string[];
  /** Optional MIME prefixes (e.g. 'image/'). Matches anything starting with. */
  mimePrefix?: readonly string[];
}

function buildFilename(originalName: string): string {
  const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return `${unique}${extname(originalName)}`;
}

function buildFileFilter(
  opts: UploadStorageOptions,
): MulterOptions['fileFilter'] {
  if (!opts.mimeAllowList && !opts.mimePrefix) return undefined;
  return (_req, file, cb) => {
    const exact = opts.mimeAllowList?.includes(file.mimetype) ?? false;
    const prefixHit =
      opts.mimePrefix?.some((p) => file.mimetype.startsWith(p)) ?? false;
    cb(null, exact || prefixHit);
  };
}

export function createUploadStorage(opts: UploadStorageOptions): MulterOptions {
  const limits = { fileSize: opts.maxMb * 1024 * 1024 };
  const fileFilter = buildFileFilter(opts);

  if (isS3Mode) {
    const isPublic = PUBLIC_BUCKETS.has(opts.bucket);
    return {
      storage: multerS3({
        s3: s3(),
        bucket: s3Bucket,
        // Public buckets get public-read ACL so `<img src>` works
        // without a signed URL. Private buckets default to bucket-owner
        // ACL (no public access) and rely on FilesController's signed
        // delivery. Make sure the bucket itself does NOT have
        // "Block Public Access" enabled when public buckets are in use,
        // or set up CloudFront in front and switch this to 'private'.
        acl: isPublic ? 'public-read' : 'private',
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key: (_req, file, cb) => {
          cb(null, `${opts.bucket}/${buildFilename(file.originalname)}`);
        },
        // Multer-S3 sets file.key (the S3 key) and file.location (the
        // full S3 URL) on the file object after upload. Controllers
        // read file.key (now mirrored onto file.filename below) to
        // build their public URLs via publicUrlFor().
        metadata: (_req, file, cb) => {
          cb(null, { originalName: file.originalname });
        },
      }),
      limits,
      fileFilter,
    };
  }

  // ── Disk mode (local dev) ──────────────────────────────────────────
  const dest = join(UPLOAD_ROOT, opts.bucket);
  return {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
        cb(null, dest);
      },
      filename: (_req, file, cb) => {
        cb(null, buildFilename(file.originalname));
      },
    }),
    limits,
    fileFilter,
  };
}

/**
 * Extract the storage-relative filename from a Multer file object,
 * regardless of which engine produced it.
 *
 *   disk mode → file.filename       ('1717080000-123456.jpg')
 *   s3 mode   → file.key            ('avatars/1717080000-123456.jpg')
 *
 * Controllers that previously did `file.filename` keep working in
 * disk mode but need this in S3 mode where multer-s3 stores the
 * full key under file.key. Returns just the basename so the rest of
 * the codebase doesn't have to know which engine ran.
 */
export function storedFilename(file: any): string {
  if (file.key) {
    const parts = String(file.key).split('/');
    return parts[parts.length - 1] ?? String(file.key);
  }
  return file.filename;
}

/**
 * Build the URL we hand back to clients.
 *
 *   S3 + public bucket  → 'https://<bucket>.s3.<region>.amazonaws.com/<bucket>/<file>'
 *   S3 + private bucket → '/uploads/<bucket>/<file>' (still relative; FilesService
 *                          wraps it in a signed /files/... URL before sending out)
 *   disk mode           → '/uploads/<bucket>/<file>' (legacy behaviour)
 *
 * The relative form for private files is intentional — the existing
 * HMAC layer in FilesService rebuilds the signed URL from this path,
 * and the storage swap shouldn't ripple through that contract.
 */
export function publicUrlFor(bucket: string, filename: string): string {
  if (isS3Mode && PUBLIC_BUCKETS.has(bucket)) {
    return `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${bucket}/${filename}`;
  }
  return `/uploads/${bucket}/${filename}`;
}

/**
 * Resolve a `/uploads/<bucket>/<filename>` URL back to the S3 key
 * (or null when running in disk mode). Used by FilesController to
 * locate private files in S3 when serving signed-URL requests.
 */
export function s3KeyFromRelativeUrl(relativeUrl: string): string | null {
  if (!isS3Mode) return null;
  const m = relativeUrl.match(/^\/?uploads\/(.+)$/);
  return m ? m[1] : null;
}

/**
 * Stream a private file out of S3. Returns the body stream + content
 * type. Caller is responsible for piping into `res`.
 */
export async function getS3Object(key: string): Promise<{
  body: Readable;
  contentType?: string;
  contentLength?: number;
}> {
  const res = await s3().send(
    new GetObjectCommand({ Bucket: s3Bucket, Key: key }),
  );
  return {
    body: res.Body as Readable,
    contentType: res.ContentType,
    contentLength: res.ContentLength,
  };
}

/**
 * Generate a short-lived presigned GET URL — useful when the frontend
 * wants to download a private object without proxying through our API
 * (faster + no bandwidth cost on App Runner). Default 10 min, capped
 * at 1 hr because longer URLs become a liability if they leak.
 */
export async function presignGet(key: string, ttlSec = 600): Promise<string> {
  if (!isS3Mode) throw new Error('presignGet called in disk mode');
  const clamped = Math.min(Math.max(ttlSec, 60), 3600);
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: s3Bucket, Key: key }), {
    expiresIn: clamped,
  });
}

/**
 * Delete an object. Called from the documents-delete + avatar-replace
 * flows so we don't accumulate orphaned files. No-op when running in
 * disk mode (those flows already handle local fs.unlink themselves).
 */
export async function deleteStoredFile(bucket: string, filename: string): Promise<void> {
  if (!isS3Mode) return;
  await s3().send(
    new DeleteObjectCommand({
      Bucket: s3Bucket,
      Key: `${bucket}/${filename}`,
    }),
  );
}

// Re-export PUBLIC_BUCKETS so main.ts can decide which paths to mount
// as static assets in disk mode. In S3 mode nothing is mounted — the
// browser hits S3 directly via the URLs from publicUrlFor().
export { PUBLIC_BUCKETS };
