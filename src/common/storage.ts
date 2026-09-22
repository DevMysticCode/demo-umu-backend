import { existsSync, mkdirSync, createReadStream } from 'fs';
import { join } from 'path';
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

// Every accepted mimetype maps to a fixed, safe on-disk extension. The
// stored filename's extension is ALWAYS derived from this table — from
// the client-declared, allow-listed mimetype — never from the client's
// `originalname`. Taking the extension from the client filename used to
// let an attacker upload `filename="x.svg"` with `Content-Type: image/png`
// (an allow-listed type) and have the file stored — and later served —
// as `.svg`, which browsers render as an SVG *document* with a live
// script context, regardless of the declared Content-Type at upload
// time. `image/svg+xml` is deliberately absent from both mimetype lists
// below and from this table (security review 2026-09-22, findings
// H1/H3).
const MIME_EXT: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
};

/** Photo uploads (avatars, job/property photos) — no document types. */
export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

/** Legal/evidence document uploads — photos plus PDF. */
export const DOCUMENT_MIME_TYPES = [...IMAGE_MIME_TYPES, 'application/pdf'] as const;

export interface UploadStorageOptions {
  /** Conceptual bucket — e.g. 'job-photos', 'documents', 'avatars'. */
  bucket: string;
  /** Per-file size cap in MB. Multer rejects with 413 above this. */
  maxMb: number;
  /**
   * Required allow-list of exact MIME types this bucket accepts. Every
   * entry must have a mapping in MIME_EXT above. There is deliberately no
   * "accept anything" default — a bucket that forgets to pass this now
   * fails closed (multer rejects every file) instead of silently
   * accepting arbitrary content, which is how H1/H3 happened.
   */
  mimeAllowList: readonly string[];
}

function buildFilename(mimetype: string): string {
  const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  // buildFileFilter below only lets an allow-listed mimetype through, and
  // every allow-list this codebase defines (IMAGE_MIME_TYPES /
  // DOCUMENT_MIME_TYPES) is covered in MIME_EXT — but if a future caller
  // passes an ad-hoc list with a type missing from MIME_EXT, fail loudly
  // with a clearly-fake extension rather than silently trusting anything.
  const ext = MIME_EXT[mimetype] ?? '.unknown-mimetype';
  return `${unique}${ext}`;
}

function buildFileFilter(
  opts: UploadStorageOptions,
): NonNullable<MulterOptions['fileFilter']> {
  return (_req, file, cb) => {
    if (!opts.mimeAllowList.includes(file.mimetype)) {
      cb(null, false);
      return;
    }
    if (!(file.mimetype in MIME_EXT)) {
      // Misconfiguration guard: an allow-listed mimetype with no safe
      // extension mapping — reject rather than fall through to
      // buildFilename's '.unknown-mimetype' fallback.
      cb(new Error(`No extension mapping for allow-listed mimetype ${file.mimetype}`), false);
      return;
    }
    cb(null, true);
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
        // NOT multerS3.AUTO_CONTENT_TYPE — that derives the S3 object's
        // stored Content-Type from `file.originalname`'s extension (client-
        // controlled), independent of the mimetype buildFileFilter already
        // validated. A crafted filename could reintroduce the H1/H3 SVG
        // issue purely via the response's Content-Type header, even with a
        // safe stored key extension. Use the already-allow-listed
        // `file.mimetype` directly instead.
        contentType: (_req, file, cb) => cb(null, file.mimetype),
        key: (_req, file, cb) => {
          cb(null, `${opts.bucket}/${buildFilename(file.mimetype)}`);
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
        cb(null, buildFilename(file.mimetype));
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
 * Extract the `/uploads/<bucket>/<file>` relative path from a stored
 * fileUrl, whatever form it's actually in: bare relative, or absolute
 * with ANY host — not just this process's current BASE_URL.
 *
 * Disk-mode uploads bake the BASE_URL env var in at upload time
 * (question.service.ts's uploadQuestionFile). If that var was ever
 * wrong (e.g. left at the http://localhost:3002 dev default, or the
 * env only got corrected later), the stored value permanently carries
 * the wrong host. A strict `startsWith(currentBaseUrl)` check then
 * never recognises those rows again once BASE_URL is fixed — this is
 * exactly the "View certificate" bug reported live: GSR/EICR/EPC
 * links pointing at localhost:3002 in production. Matching by suffix
 * instead of a fixed prefix fixes both existing stale rows and any
 * future host change, with no data migration needed.
 */
export function uploadsPathFrom(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('/uploads/')) return url;
  const m = url.match(/^https?:\/\/[^/]+(\/uploads\/.+)$/);
  return m ? m[1] : null;
}

// Extensions this app has ever stored via buildFilename() (see MIME_EXT
// above) — the only ones safe to serve with Content-Disposition: inline.
// A file with any other extension gets forced to `attachment` at serve
// time (FilesController) regardless of its actual bytes or stored
// Content-Type — a defence-in-depth net for any file that predates the
// H1/H3 fix (uploaded before extensions were derived from a validated
// mimetype) rather than something exploitable by a new upload today.
const SAFE_INLINE_EXTENSIONS = new Set(Object.values(MIME_EXT));

export function isSafeToRenderInline(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return SAFE_INLINE_EXTENSIONS.has(ext);
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
