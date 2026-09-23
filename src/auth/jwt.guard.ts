import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Missing authorization header');
    }

    const [bearer, token] = authHeader.split(' ');

    if (bearer !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization header');
    }

    let decoded: { sub: string; email: string; iat: number };
    try {
      decoded = this.jwtService.verify(token);
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // JWTs otherwise have no server-side revocation (7-day expiry, no
    // blacklist) — the guard trusted `sub`/`email` from the payload
    // directly with no re-check against the DB, so a deleted user's
    // token stayed valid until it naturally expired, and changing your
    // password didn't invalidate a token an attacker already had
    // (security review 2026-09-22, M1). A lean, indexed lookup by
    // primary key on every request is the cost of closing that gap.
    const user = await this.prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, email: true, passwordChangedAt: true, isAdmin: true },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (
      user.passwordChangedAt &&
      decoded.iat * 1000 < user.passwordChangedAt.getTime()
    ) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request.user = {
      id: user.id,
      email: user.email,
      // Not a general-purpose authorization signal - every existing route
      // in this app continues to gate on ownership/collaboration, not
      // this flag. Only the admin-secret-gated endpoints that also
      // require a JWT (security review 2026-09-22, M6) read it.
      isAdmin: user.isAdmin,
    };
    return true;
  }
}
