import { existsSync } from 'fs';
import { join, normalize, resolve, sep } from 'path';
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { FilesService } from './files.service';
import { isS3Mode, getS3Object, isSafeToRenderInline } from '../common/storage';

/**
 * Signed-URL file delivery for sensitive buckets.
 *
 * Path shape: GET /files/<bucket>/<filename>?u=...&exp=...&sig=...
 *
 * No JWT guard — the signed query is the auth token. We deliberately
 * @SkipThrottle here because document downloads are bursty (a passport
 * with 10 attachments fires 10 requests in quick succession from the
 * UI), and 60/min could trip up the customer view.
 *
 * Security model:
 *   1. Signature must HMAC-verify (FilesService.verifyAndAuthorise).
 *   2. Expiry must be in the future.
 *   3. The user the URL was issued to must STILL have a DB record
 *      proving ownership of the path. Stale-but-not-expired URLs
 *      lose access immediately if e.g. their document is deleted.
 *   4. Path is normalised and contained to ./uploads — no traversal.
 */
@SkipThrottle()
@Controller('files')
export class FilesController {
  private readonly uploadsRoot = resolve(process.cwd(), 'uploads');

  constructor(private files: FilesService) {}

  @ApiOperation({
    summary: 'Stream a private file via a signed URL',
    description:
      'Not browsable directly - the query string (u/exp/sig) IS the authentication, generated server-side when a document link is built. On every request: (1) the HMAC signature is verified, (2) the expiry must be in the future, (3) a fresh database lookup confirms the user the link was issued to still has a right to this exact file right now - so revoking access or deleting the document invalidates a not-yet-expired link immediately. No JWT guard; this endpoint is deliberately exempt from rate limiting since a single passport page can fire many of these in a burst.',
  })
  @ApiParam({ name: 'bucket', description: 'The storage bucket, e.g. documents, passport-docs.' })
  @ApiParam({ name: 'filename', description: 'The stored filename within that bucket.' })
  @ApiQuery({ name: 'u', description: 'The user id the link was signed for.' })
  @ApiQuery({ name: 'exp', description: 'Unix expiry timestamp.' })
  @ApiQuery({ name: 'sig', description: 'HMAC-SHA256 signature over the path, user id and expiry.' })
  @ApiResponse({ status: 200, description: 'The file content, streamed directly - content-type matches the stored file (e.g. application/pdf, image/jpeg).', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 400, description: 'Malformed bucket/filename (e.g. path traversal attempt).' })
  @ApiResponse({ status: 403, description: 'Signature invalid/expired, or the user no longer has a right to this file - deliberately generic so a failed attempt reveals nothing about which check failed.' })
  @ApiResponse({ status: 404, description: 'File not found on disk/storage.' })
  @Get(':bucket/:filename')
  async serve(
    @Param('bucket') bucket: string,
    @Param('filename') filename: string,
    @Query('u') userId: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    // Reject anything that even smells like a path traversal attempt
    // before we touch the FS. Bucket + filename are individually
    // restricted: no separators, no `..`, no dotfiles.
    if (
      !bucket ||
      !filename ||
      bucket.includes('..') ||
      filename.includes('..') ||
      bucket.includes('/') ||
      bucket.includes('\\') ||
      filename.startsWith('.')
    ) {
      throw new BadRequestException('Invalid file path');
    }

    const relPath = `${bucket}/${filename}`;

    try {
      await this.files.verifyAndAuthorise(relPath, sig, exp, userId);
    } catch (err: any) {
      // Don't echo the specific reason — "expired" vs "bad sig" vs
      // "no longer owned" all collapse into a single 403 so an
      // attacker can't probe which check failed.
      throw new ForbiddenException('Access denied');
    }

    res.set('Cache-Control', 'private, max-age=300');
    // Only ever render inline the extensions this app's own upload
    // pipeline can produce (buildFilename in storage.ts) — anything else
    // (e.g. a file that predates the H1/H3 upload-validation fix) is
    // forced to download instead, so the browser never gets a chance to
    // interpret it as HTML/SVG in the page's own origin.
    res.set(
      'Content-Disposition',
      isSafeToRenderInline(filename) ? 'inline' : 'attachment',
    );

    if (isS3Mode) {
      // S3 mode: stream the object straight from S3 → response. Skips
      // the disk-existence check entirely; if the key doesn't exist S3
      // raises NoSuchKey which we map to 404.
      try {
        const obj = await getS3Object(`${bucket}/${filename}`);
        if (obj.contentType) res.set('Content-Type', obj.contentType);
        if (obj.contentLength) res.set('Content-Length', String(obj.contentLength));
        obj.body.pipe(res);
        return;
      } catch (err: any) {
        if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
          throw new NotFoundException('File not found');
        }
        throw err;
      }
    }

    // Disk mode (local dev) — keep the original path-traversal-safe
    // sendFile flow.
    const absolute = normalize(join(this.uploadsRoot, bucket, filename));
    if (!absolute.startsWith(this.uploadsRoot + sep)) {
      throw new BadRequestException('Invalid file path');
    }
    if (!existsSync(absolute)) {
      throw new NotFoundException('File not found');
    }
    res.sendFile(absolute);
  }
}
