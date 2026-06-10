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
import type { Response } from 'express';
import { FilesService } from './files.service';

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

    const absolute = normalize(join(this.uploadsRoot, bucket, filename));
    if (!absolute.startsWith(this.uploadsRoot + sep)) {
      // Belt-and-braces: if normalise(...) somehow lets the path escape
      // uploads/, refuse. The earlier param check should make this
      // impossible already.
      throw new BadRequestException('Invalid file path');
    }

    if (!existsSync(absolute)) {
      throw new NotFoundException('File not found');
    }

    // Stream the file. Express infers Content-Type from the extension;
    // attach a Content-Disposition: inline so PDFs render in-browser
    // (the docs page renders <iframe src="..." />). Set a short cache
    // because the URL has a 1-hour signature anyway.
    res.set('Cache-Control', 'private, max-age=300');
    res.set('Content-Disposition', 'inline');
    res.sendFile(absolute);
  }
}
