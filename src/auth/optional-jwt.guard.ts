import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * Same shape as JwtAuthGuard but silently allows anonymous requests
 * through. If a valid Bearer token is present, req.user is populated;
 * otherwise req.user is undefined and the handler continues.
 *
 * Used by capture endpoints where anonymous flows are legitimate
 * (e.g. grant-check before contact details are collected) but we
 * still want to link the event to a user when a JWT is attached.
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    if (!authHeader) return true;
    const [bearer, token] = authHeader.split(' ');
    if (bearer !== 'Bearer' || !token) return true;
    try {
      const decoded = this.jwtService.verify(token);
      request.user = { id: decoded.sub, email: decoded.email };
    } catch {
      // Bad token silently ignored — anonymous flow continues.
    }
    return true;
  }
}
