import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { diskStorage } from 'multer';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/**
 * Single source of truth for file-upload destination + filename rules.
 *
 * Today: writes to ./uploads/<bucket>/<random>.<ext> on container disk
 * (lost on Railway redeploy — DF4 Finding §4.6). The point of this
 * helper is that swapping to S3/R2 later means changing this file and
 * nothing else; every controller goes via createUploadStorage().
 *
 * To swap: replace `diskStorage(...)` with a multer-s3 engine and
 * adjust `publicUrlFor()` to return the S3 URL instead of /uploads/...
 * Controllers don't need to change.
 */

const UPLOAD_ROOT = join(process.cwd(), 'uploads');

export interface UploadStorageOptions {
  /** Subdirectory under /uploads — e.g. 'job-photos', 'documents', 'avatars'. */
  bucket: string;
  /** Per-file size cap in MB. Multer rejects with 413 above this. */
  maxMb: number;
  /** Optional accept-list of exact MIME types (e.g. 'image/jpeg'). */
  mimeAllowList?: readonly string[];
  /** Optional MIME prefixes (e.g. 'image/'). Matches anything starting with. */
  mimePrefix?: readonly string[];
}

/**
 * Returns a MulterOptions block ready to drop into FileInterceptor:
 *
 *   @UseInterceptors(FileInterceptor('file', createUploadStorage({
 *     bucket: 'job-photos', maxMb: 8,
 *     mimeAllowList: ['image/jpeg', 'image/png', 'image/webp'],
 *   })))
 */
export function createUploadStorage(opts: UploadStorageOptions): MulterOptions {
  const dest = join(UPLOAD_ROOT, opts.bucket);

  return {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
        cb(null, dest);
      },
      filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
        cb(null, `${unique}${extname(file.originalname)}`);
      },
    }),
    limits: { fileSize: opts.maxMb * 1024 * 1024 },
    fileFilter:
      opts.mimeAllowList || opts.mimePrefix
        ? (_req, file, cb) => {
            const exact = opts.mimeAllowList?.includes(file.mimetype) ?? false;
            const prefixHit =
              opts.mimePrefix?.some((p) => file.mimetype.startsWith(p)) ?? false;
            cb(null, exact || prefixHit);
          }
        : undefined,
  };
}

/**
 * Build the relative URL the API hands back to clients.
 *
 *   publicUrlFor('job-photos', '1717080000-123456.jpg')
 *   → '/uploads/job-photos/1717080000-123456.jpg'
 *
 * Switching storage backends? Change the body to return an absolute
 * S3/CDN URL and every caller updates automatically.
 */
export function publicUrlFor(bucket: string, filename: string): string {
  return `/uploads/${bucket}/${filename}`;
}
