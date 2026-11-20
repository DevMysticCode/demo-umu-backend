import { existsSync, mkdirSync, createReadStream, unlinkSync } from 'fs';
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
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  ContainerClient,
} from '@azure/storage-blob';
import type { Readable } from 'stream';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import type { StorageEngine } from 'multer';

/**
 * Single source of truth for file-upload storage.
 *
 * Three backends, chosen at boot from env (checked in this order —
 * Azure wins if both AZURE_STORAGE_CONNECTION_STRING and
 * S3_UPLOADS_BUCKET are somehow set, since S3 mode is leftover from an
 * abandoned AWS App Runner plan and AWS isn't used by this project
 * going forward):
 *   - Azure mode → when AZURE_STORAGE_CONNECTION_STRING is set (the
 *                  Azure production target). Streams uploads straight
 *                  to Blob Storage via a custom multer StorageEngine
 *                  below — container disk never touches a user file.
 *   - S3 mode    → when S3_UPLOADS_BUCKET is set. Kept for the
 *                  already-written AWS path; not the active production
 *                  mode for this project.
 *   - Disk mode  → fallback for local dev (no cloud creds needed), and
 *                  what Railway currently runs with a persistent volume
 *                  mounted at ./uploads to survive redeploys. Writes to
 *                  ./uploads/<bucket>/<filename> exactly as before.
 *
 * The two-tier delivery model (public buckets via direct URL, private
 * via /files/<bucket>/<file>?sig=...) is preserved in all three modes:
 *   - Public buckets (property-images, job-photos): saved with ACL
 *     'public-read' in S3 mode, or into a separate public-access Blob
 *     container in Azure mode → publicUrlFor() returns the cloud
 *     provider's https URL. In disk mode, the URL stays
 *     /uploads/<bucket>/... Both need to be visible to anonymous,
 *     logged-out visitors browsing search results (property search) or
 *     open job listings (marketplace) — there is no "owner" to check a
 *     signed URL against for a public listing photo, so these are a
 *     deliberate, permanent exception rather than a gap to close
 *     (security/launch review finding #12, 2026-11-13). job-photos is
 *     ONLY for photos attached to a job listing itself (marketplace
 *     "post a job" wizard) — contract evidence photos between a
 *     specific customer/supplier pair use the separate, private
 *     `job-evidence` bucket below instead, since those have a real
 *     two-party owner and no public-browse need.
 *   - Private buckets (documents, passport-docs, kyc, avatars,
 *     job-evidence, etc.): saved private. The existing FilesController
 *     + HMAC-signed URLs handle delivery; in S3/Azure mode it streams
 *     the object instead of fs.sendFile. avatars moved from public to
 *     private here (finding #12) — see FilesService.userOwnsFilePath
 *     for the relationship checks (any authenticated user for avatars,
 *     payment party for job-evidence).
 */

const UPLOAD_ROOT = join(process.cwd(), 'uploads');

const PUBLIC_BUCKETS = new Set<string>([
  'property-images',
  'job-photos',
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

// ── Azure Blob Storage ───────────────────────────────────────────────
// One storage account, two containers (public/private) rather than one
// container with per-blob ACLs — Azure's anonymous-access setting is
// per-container, not per-blob like S3's object ACL, so a single
// container can't mix public and private objects the way the S3 mode
// does above.
const azureConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING ?? '';
const azurePublicContainerName = process.env.AZURE_UPLOADS_PUBLIC_CONTAINER ?? 'uploads-public';
const azurePrivateContainerName = process.env.AZURE_UPLOADS_PRIVATE_CONTAINER ?? 'uploads-private';
export const isAzureMode = Boolean(azureConnectionString);

// True whenever uploads bypass the container's own local disk entirely
// — the generic "is this a cloud mode" check that most call sites
// actually want (whether a stored URL is already absolute/provider-
// relative, whether to skip local fs.unlink, etc.), as opposed to
// isS3Mode/isAzureMode which are for code that genuinely branches on
// *which* provider it's talking to (presigning, object fetch/delete).
export const isRemoteMode = isAzureMode || isS3Mode;

let _azureBlobService: BlobServiceClient | null = null;
function azureBlobService(): BlobServiceClient {
  if (!_azureBlobService) {
    _azureBlobService = BlobServiceClient.fromConnectionString(azureConnectionString);
  }
  return _azureBlobService;
}

function azureContainer(bucket: string): ContainerClient {
  const name = PUBLIC_BUCKETS.has(bucket) ? azurePublicContainerName : azurePrivateContainerName;
  return azureBlobService().getContainerClient(name);
}

// Azure's SDK wants the account name/key as a SharedKeyCredential to
// sign a SAS, separately from the connection string the BlobServiceClient
// itself parses — pull them back out of the same connection string
// rather than asking for three separate env vars that could drift out
// of sync with each other.
function azureSharedKeyCredential(): StorageSharedKeyCredential {
  const accountNameMatch = azureConnectionString.match(/AccountName=([^;]+)/);
  const accountKeyMatch = azureConnectionString.match(/AccountKey=([^;]+)/);
  if (!accountNameMatch || !accountKeyMatch) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING is missing AccountName/AccountKey');
  }
  return new StorageSharedKeyCredential(accountNameMatch[1], accountKeyMatch[1]);
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

/**
 * Multer storage engine for Azure Blob Storage — there's no actively
 * maintained multer-azure-blob equivalent of multer-s3 in wide use, so
 * this streams the incoming file straight into a block blob the same
 * way multer-s3 streams into an S3 object: no temp file, no buffering
 * the whole upload in memory.
 */
class AzureBlobStorageEngine implements StorageEngine {
  constructor(private bucket: string) {}

  _handleFile(
    _req: any,
    file: Express.Multer.File & { stream: Readable },
    cb: (error?: any, info?: Partial<Express.Multer.File>) => void,
  ) {
    const filename = buildFilename(file.mimetype);
    const key = `${this.bucket}/${filename}`;
    const container = azureContainer(this.bucket);
    const blockBlobClient = container.getBlockBlobClient(key);

    blockBlobClient
      .uploadStream(file.stream, undefined, undefined, {
        // Same reasoning as the S3 branch's `contentType` option: derive
        // the stored Content-Type from the already-allow-listed
        // file.mimetype, never from the client's `originalname`.
        blobHTTPHeaders: { blobContentType: file.mimetype },
      })
      // uploadStream's own response doesn't carry the byte count - fetch
      // it from the blob's properties so callers that read file.size
      // (e.g. documents.service.ts's uploadDocument) still get a real
      // value regardless of which provider handled the upload.
      .then(() => blockBlobClient.getProperties())
      .then((props) => {
        cb(null, {
          // Mirrors multer-s3's file.key/file.filename shape so
          // storedFilename()/publicUrlFor() work unchanged regardless
          // of which cloud provider actually handled the upload.
          key,
          filename,
          size: props.contentLength,
        } as Partial<Express.Multer.File>);
      })
      .catch((err) => cb(err));
  }

  _removeFile(_req: any, file: Express.Multer.File & { key?: string }, cb: (error: Error | null) => void) {
    if (!file.key) return cb(null);
    azureContainer(this.bucket)
      .getBlockBlobClient(file.key)
      .deleteIfExists()
      .then(() => cb(null))
      .catch((err) => cb(err));
  }
}

export function createUploadStorage(opts: UploadStorageOptions): MulterOptions {
  const limits = { fileSize: opts.maxMb * 1024 * 1024 };
  const fileFilter = buildFileFilter(opts);

  if (isAzureMode) {
    return {
      storage: new AzureBlobStorageEngine(opts.bucket),
      limits,
      fileFilter,
    };
  }

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
 *   Azure + public bucket → 'https://<account>.blob.core.windows.net/<container>/<bucket>/<file>'
 *   S3 + public bucket    → 'https://<bucket>.s3.<region>.amazonaws.com/<bucket>/<file>'
 *   Private bucket (any mode) → '/uploads/<bucket>/<file>' (still relative; FilesService
 *                          wraps it in a signed /files/... URL before sending out)
 *   disk mode             → '/uploads/<bucket>/<file>' (legacy behaviour)
 *
 * The relative form for private files is intentional — the existing
 * HMAC layer in FilesService rebuilds the signed URL from this path,
 * and the storage swap shouldn't ripple through that contract.
 */
export function publicUrlFor(bucket: string, filename: string): string {
  if (isAzureMode && PUBLIC_BUCKETS.has(bucket)) {
    return `${azureContainer(bucket).url}/${bucket}/${filename}`;
  }
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
 * Stream a private blob out of Azure. `key` is the `<bucket>/<filename>`
 * form used everywhere else in this file, same shape as getS3Object's.
 */
export async function getAzureObject(key: string): Promise<{
  body: Readable;
  contentType?: string;
  contentLength?: number;
}> {
  const bucket = key.split('/')[0];
  const blockBlobClient = azureContainer(bucket).getBlockBlobClient(key);
  const res = await blockBlobClient.download();
  if (!res.readableStreamBody) throw new Error('Azure blob download returned no body');
  return {
    // Azure's SDK types this as the generic NodeJS.ReadableStream
    // interface rather than the concrete `stream.Readable` class; it's
    // always a real Readable at runtime (Node's http client produces
    // one), and the only thing callers do with it is res.body.pipe(res).
    body: res.readableStreamBody as unknown as Readable,
    contentType: res.contentType,
    contentLength: res.contentLength,
  };
}

/**
 * Provider-agnostic private-object fetch, dispatching on whichever
 * cloud mode is active. FilesController uses this instead of picking
 * getS3Object/getAzureObject itself.
 */
export async function getRemoteObject(key: string): Promise<{
  body: Readable;
  contentType?: string;
  contentLength?: number;
}> {
  if (isAzureMode) return getAzureObject(key);
  if (isS3Mode) return getS3Object(key);
  throw new Error('getRemoteObject called in disk mode');
}

/**
 * Generate a short-lived presigned GET URL — useful when the frontend
 * wants to download a private object without proxying through our API
 * (faster + no bandwidth cost on App Runner/Azure). Default 10 min,
 * capped at 1 hr because longer URLs become a liability if they leak.
 * Dispatches to whichever cloud provider is active; throws in disk mode
 * since there's nothing to presign.
 */
export async function presignGet(key: string, ttlSec = 600): Promise<string> {
  const clamped = Math.min(Math.max(ttlSec, 60), 3600);

  if (isAzureMode) {
    const bucket = key.split('/')[0];
    const container = azureContainer(bucket);
    const blockBlobClient = container.getBlockBlobClient(key);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: container.containerName,
        blobName: key,
        permissions: BlobSASPermissions.parse('r'),
        expiresOn: new Date(Date.now() + clamped * 1000),
      },
      azureSharedKeyCredential(),
    ).toString();
    return `${blockBlobClient.url}?${sas}`;
  }

  if (isS3Mode) {
    return getSignedUrl(s3(), new GetObjectCommand({ Bucket: s3Bucket, Key: key }), {
      expiresIn: clamped,
    });
  }

  throw new Error('presignGet called in disk mode');
}

/**
 * Delete an object. Called from the documents-delete + avatar-replace
 * flows so we don't accumulate orphaned files. No-op when running in
 * disk mode (those flows already handle local fs.unlink themselves).
 */
export async function deleteStoredFile(bucket: string, filename: string): Promise<void> {
  if (isAzureMode) {
    await azureContainer(bucket).getBlockBlobClient(`${bucket}/${filename}`).deleteIfExists();
    return;
  }
  if (!isS3Mode) return;
  await s3().send(
    new DeleteObjectCommand({
      Bucket: s3Bucket,
      Key: `${bucket}/${filename}`,
    }),
  );
}

/**
 * Delete whatever file a stored `/uploads/<bucket>/<file>` (or absolute
 * equivalent) URL points to, in whichever mode is active. Swallows the
 * "file doesn't exist"/"already deleted" case the same way the existing
 * avatar-replace and document-delete call sites do — this is cleanup,
 * not a correctness check, so a missing file is not an error.
 */
export async function deleteFileAtUploadsUrl(url: string | null | undefined): Promise<void> {
  const relative = uploadsPathFrom(url);
  if (!relative) return;
  const m = relative.match(/^\/uploads\/([^/]+)\/(.+)$/);
  if (!m) return;
  const [, bucket, filename] = m;
  if (isRemoteMode) {
    try {
      await deleteStoredFile(bucket, filename);
    } catch {
      /* ignore */
    }
  } else {
    const filePath = join(UPLOAD_ROOT, bucket, filename);
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {
        /* ignore */
      }
    }
  }
}

// Re-export PUBLIC_BUCKETS so main.ts can decide which paths to mount
// as static assets in disk mode. In S3/Azure mode nothing is mounted —
// the browser hits the cloud provider directly via the URLs from
// publicUrlFor().
export { PUBLIC_BUCKETS };
