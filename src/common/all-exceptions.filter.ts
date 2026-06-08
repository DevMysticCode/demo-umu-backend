import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { captureException } from './sentry';

/**
 * Catch-all exception filter.
 *
 * Goals:
 *   - HttpException (NestJS-thrown): return its status + message verbatim
 *     (these are deliberate — BadRequestException, ForbiddenException, etc.)
 *   - Prisma known errors: translate into a friendly client message but
 *     scrub model/field names from the body. Log the raw error server-side.
 *   - Everything else: return generic 500 to the client; log the full
 *     stack trace internally. Avoids leaking DB internals or filesystem
 *     paths in JSON error responses.
 *
 * Without this filter, an unhandled `throw new Error(...)` returns the
 * full error object — including stack trace and any Prisma metadata —
 * straight to the client. That's an information-disclosure soft-bug.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    // 1) NestJS HttpException — these are intentional. Forward unchanged.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      return res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
    }

    // 2) Prisma known errors — common ones get a friendly message;
    //    everything else gets the generic 500 path below.
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      this.logger.warn(
        `[Prisma ${exception.code}] ${req.method} ${req.url} — ${exception.message.split('\n')[0]}`,
      );
      switch (exception.code) {
        case 'P2002': // unique constraint
          return res.status(HttpStatus.CONFLICT).json({
            statusCode: HttpStatus.CONFLICT,
            message: 'A record with these details already exists.',
          });
        case 'P2025': // record not found
          return res.status(HttpStatus.NOT_FOUND).json({
            statusCode: HttpStatus.NOT_FOUND,
            message: 'The requested record was not found.',
          });
        case 'P2003': // foreign key
          return res.status(HttpStatus.BAD_REQUEST).json({
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Cannot complete the operation due to related records.',
          });
      }
    }
    if (exception instanceof Prisma.PrismaClientValidationError) {
      this.logger.warn(`[Prisma validation] ${req.method} ${req.url}`);
      return res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid data supplied.',
      });
    }

    // 3) Everything else — opaque 500 to the client, full detail server-side.
    const err = exception as Error;
    this.logger.error(
      `Unhandled ${err?.name ?? 'Error'} on ${req.method} ${req.url} — ${err?.message ?? exception}`,
      err?.stack,
    );
    // Forward to Sentry if SENTRY_DSN is configured (no-op otherwise).
    // We deliberately do this only for the unhandled path — HttpException
    // and Prisma known-error responses are intentional, not bugs.
    captureException(err, { route: `${req.method} ${req.url}` });
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error.',
    });
  }
}
