import { createHmac, timingSafeEqual } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * HMAC-signed URLs for sensitive file delivery.
 *
 * Goal: keep `<img src>` and `<a href>` working without the frontend
 * needing to attach an Authorization header. The URL itself carries
 * the entitlement.
 *
 * Sign:    /files/<path>?u=<userId>&exp=<unix>&sig=<hex>
 * Verify:  HMAC-SHA256(secret, `${userId}|${path}|${exp}`).digest('hex')
 *
 * Secret is JWT_SECRET — already required at boot by env.validation.ts.
 * Rotating JWT_SECRET invalidates every signed URL, same as it
 * invalidates every JWT (intentional — one knob for both).
 *
 * Ownership check (in verify()): we re-hit the DB to confirm the path
 * actually belongs to userId. Belt + braces: even if the HMAC is
 * somehow valid, the file is only served when the user can show
 * record-level access. Lookup order: UserDocument first (the explicit
 * "I uploaded this" surface), then QuestionAnswer (passport answers
 * the user authored).
 */

const SIG_TTL_SECONDS_DEFAULT = 60 * 60; // 1 hour

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(private prisma: PrismaService) {}

  private secret(): string {
    const s = process.env.JWT_SECRET;
    if (!s) throw new Error('JWT_SECRET is not set');
    return s;
  }

  /**
   * Build the signed query string for `path` (e.g. `documents/abc.pdf`).
   * Returns just the query — callers prepend the route + base URL.
   */
  buildSignedQuery(path: string, userId: string, ttlSec = SIG_TTL_SECONDS_DEFAULT): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const sig = this.computeSig(path, userId, exp);
    const params = new URLSearchParams({ u: userId, exp: String(exp), sig });
    return params.toString();
  }

  /**
   * Build the full relative URL for a /uploads/<path> file. Callers
   * usually prepend the API base URL on top of this (documents.service
   * does that via BASE_URL).
   */
  buildSignedUrl(path: string, userId: string, ttlSec = SIG_TTL_SECONDS_DEFAULT): string {
    const cleanPath = path.replace(/^\/+|\/+$/g, '');
    return `/files/${cleanPath}?${this.buildSignedQuery(cleanPath, userId, ttlSec)}`;
  }

  /**
   * Validate the signature + expiry + DB ownership for a request to
   * /files/<path>. Returns the userId the URL was issued for on success;
   * throws otherwise. Callers use the userId to log access (the route
   * itself is unauth-required by design — JWT-on-img-tags doesn't work).
   */
  async verifyAndAuthorise(
    path: string,
    sig: string,
    exp: string,
    userId: string,
  ): Promise<{ userId: string }> {
    if (!path || !sig || !exp || !userId) {
      throw new Error('Missing signed URL parameters');
    }

    // 1. Expiry — cheap, fail fast.
    const expSec = Number(exp);
    if (!Number.isFinite(expSec) || expSec < Math.floor(Date.now() / 1000)) {
      throw new Error('Signed URL has expired');
    }

    // 2. HMAC — constant-time compare to avoid signature-timing leaks.
    const expected = this.computeSig(path, userId, expSec);
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('Invalid signature');
    }

    // 3. DB ownership — even with a valid sig, refuse if the user
    // doesn't have a record that owns this file. Protects against
    // a stale signed URL being shared after revocation.
    const ownsFile = await this.userOwnsFilePath(userId, path);
    if (!ownsFile) {
      throw new Error('User does not own this file');
    }

    return { userId };
  }

  private computeSig(path: string, userId: string, exp: number): string {
    return createHmac('sha256', this.secret())
      .update(`${userId}|${path}|${exp}`)
      .digest('hex');
  }

  /**
   * Check the DB for a record proving this user owns `path`. The path
   * we receive is the relative form (e.g. `documents/abc.pdf`); rows
   * store the leading-slashed form (`/uploads/documents/abc.pdf`).
   *
   * Looks at the two surfaces that currently produce signed URLs:
   *   - UserDocument — the explicit /documents upload
   *   - QuestionAnswer — passport question file answers (the user
   *     who answered the question owns the file)
   *
   * Extend here when new private-bucket surfaces come online (e.g.
   * KYC, marketplace evidence) so they get the same check for free.
   */
  private async userOwnsFilePath(userId: string, path: string): Promise<boolean> {
    const fileUrl = `/uploads/${path.replace(/^\/+/, '')}`;

    const asDocument = await this.prisma.userDocument.findFirst({
      where: { userId, fileUrl },
      select: { id: true },
    });
    if (asDocument) return true;

    // QuestionAnswer rows don't have a userId of their own — ownership
    // flows up through PassportQuestion → PassportSectionTask →
    // PassportSection → Passport. We allow access if the user owns the
    // passport OR has been added as a collaborator on it.
    const asAnswer = await this.prisma.questionAnswer.findFirst({
      where: {
        fileUrl,
        passportQuestion: {
          passportSectionTask: {
            passportSection: {
              passport: {
                OR: [
                  { ownerId: userId },
                  { collaborators: { some: { userId } } },
                ],
              },
            },
          },
        },
      },
      select: { id: true },
    });
    if (asAnswer) return true;

    return false;
  }
}
