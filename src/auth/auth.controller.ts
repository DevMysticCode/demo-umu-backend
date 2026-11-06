import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Res,
  Param,
  Headers,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  RequestOtpDto,
  VerifyOtpDto,
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  VerifyResetOtpDto,
  ResetPasswordDto,
  ChangePasswordDto,
  CheckEmailDto,
} from './dto';
import { JwtAuthGuard } from './jwt.guard';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiParam, ApiHeader } from '@nestjs/swagger';
import {
  UmuApp,
  isUmuApp,
  REFRESH_COOKIE_NAME,
  refreshCookiePath,
  refreshCookieOptions,
  assertTrustedOrigin,
} from './refresh-cookie';

// Credential-sensitive endpoints override the global 'default' bucket's
// limit down to 5 req/min/IP, scoped to just these routes (there's no
// separate 'auth' bucket registered in app.module.ts — see the note
// there for why a second globally-registered bucket doesn't stay scoped).
// Defined as a constant so we can keep the rule visible at the top of
// the file instead of repeating the literal on every handler.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // Was unthrottled — a bare boolean-existence oracle with the generic
  // 300 req/min/IP default was trivially scriptable into an email-
  // enumeration/phishing-list-building tool (security review 2026-09-22,
  // H7).
  @ApiOperation({
    summary: 'Check whether an email is already registered',
    description:
      'Returns whether a verified account already exists for this email - used by sign-up/sign-in flows to route the user correctly. Throttled to 5 requests/minute/IP to prevent use as an email-enumeration oracle.',
  })
  @ApiResponse({ status: 201, description: 'Existence check result.', schema: { type: 'object', properties: { exists: { type: 'boolean', description: 'True only if an account exists AND has completed verification' } } } })
  @Throttle(AUTH_THROTTLE)
  @Post('check-email')
  async checkEmail(@Body() dto: CheckEmailDto) {
    return this.authService.checkEmail(dto.email);
  }

  @ApiOperation({
    summary: 'Send a sign-up verification code by email',
    description:
      'Creates a placeholder user record if none exists, invalidates any previous unused code for this email, and emails a fresh 6-digit OTP. Enforces a 60-second per-email resend cooldown in addition to the 5 req/min/IP throttle.',
  })
  @ApiResponse({ status: 201, description: 'Code sent (or already covered by an in-flight cooldown).', schema: { type: 'object', properties: { message: { type: 'string' }, email: { type: 'string' } } } })
  @Throttle(AUTH_THROTTLE)
  @Post('request-otp')
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto);
  }

  // X-Umu-App identifies which of the three frontends is calling, so the
  // refresh token can be set as an httpOnly cookie scoped to THAT app's own
  // /auth/refresh/:app path (auth hardening, 12 Oct 2026 — see
  // refresh-cookie.ts). Rejecting an unrecognised/missing value here, not
  // just defaulting, because a wrong value would silently scope the cookie
  // to the wrong path and the frontend would never be able to refresh.
  private requireApp(app: string | undefined): UmuApp {
    if (!isUmuApp(app)) {
      throw new BadRequestException('Missing or unrecognised X-Umu-App header');
    }
    return app;
  }

  @ApiOperation({
    summary: 'Verify a sign-up OTP and complete account creation',
    description:
      'Consumes the 6-digit code sent by request-otp, marks the account verified, awards sign-up points, and issues a fresh access/refresh token pair. The refresh token is set as an httpOnly cookie scoped to the calling app\'s own path (identified by the X-Umu-App header), never returned in the JSON body.',
  })
  @ApiResponse({
    status: 201,
    description: 'Account verified and signed in.',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        token: { type: 'string', description: 'Access token (JWT, 1 hour)' },
        user: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' }, isVerified: { type: 'boolean' } } },
      },
    },
  })
  @ApiHeader({ name: 'x-umu-app', description: "Which frontend is calling ('mobile' | 'website-new' | 'integration') - determines the refresh cookie's path scope." })
  @Throttle(AUTH_THROTTLE)
  @Post('verify-otp')
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Headers('x-umu-app') appHeader: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const app = this.requireApp(appHeader);
    const { refreshToken, ...rest } = await this.authService.verifyOtp(dto);
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(app));
    return rest;
  }

  @ApiOperation({
    summary: 'Complete registration with password and profile details',
    description:
      'Creates a new account, or fills in profile details on an already-OTP-verified placeholder account. Also auto-accepts any passport collaborator invites that were sent to this email before the account existed. Issues a fresh access/refresh token pair (refresh token set as an httpOnly cookie scoped to the calling app, per X-Umu-App).',
  })
  @ApiResponse({
    status: 201,
    description: 'Account registered and signed in.',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        token: { type: 'string', description: 'Access token (JWT, 1 hour)' },
        user: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' }, firstName: { type: 'string' }, lastName: { type: 'string' }, isVerified: { type: 'boolean' } } },
      },
    },
  })
  @ApiHeader({ name: 'x-umu-app', description: "Which frontend is calling ('mobile' | 'website-new' | 'integration') - determines the refresh cookie's path scope." })
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Headers('x-umu-app') appHeader: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const app = this.requireApp(appHeader);
    const { refreshToken, ...rest } = await this.authService.register(dto);
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(app));
    return rest;
  }

  @ApiOperation({
    summary: 'Sign in with email and password',
    description:
      'Verifies the password against the stored bcrypt hash and issues a fresh access/refresh token pair. The refresh token is set as an httpOnly cookie scoped to the calling app\'s own path (X-Umu-App header); the access token (1 hour) is returned in the response body.',
  })
  @ApiResponse({
    status: 201,
    description: 'Signed in.',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        token: { type: 'string', description: 'Access token (JWT, 1 hour)' },
        user: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' }, firstName: { type: 'string' }, lastName: { type: 'string' }, isVerified: { type: 'boolean' } } },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid email or password.' })
  @ApiHeader({ name: 'x-umu-app', description: "Which frontend is calling ('mobile' | 'website-new' | 'integration') - determines the refresh cookie's path scope." })
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Headers('x-umu-app') appHeader: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const app = this.requireApp(appHeader);
    const { refreshToken, ...rest } = await this.authService.login(dto);
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(app));
    return rest;
  }

  // Not JwtAuthGuard-gated: the access token may already be expired by the
  // time a user clicks "log out" (it's only 1h), and the authority to log
  // out comes from the refresh-token cookie itself, same reasoning as the
  // comment below on refresh/:app.
  @ApiOperation({
    summary: 'Sign out of one app',
    description:
      'Revokes the refresh token carried in this app\'s own httpOnly cookie (server-side) and clears that cookie. Not gated by JwtAuthGuard, since the 1-hour access token may already be expired by the time a user clicks "log out" - authority comes from the refresh cookie itself and an Origin check (CSRF defence), not a bearer token.',
  })
  @ApiParam({ name: 'app', description: 'Which frontend is signing out: mobile, website-new, or integration' })
  @ApiResponse({ status: 200, description: 'Always succeeds client-side even if the server-side revoke fails.', schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } } })
  @Post('logout/:app')
  @HttpCode(200)
  async logout(
    @Param('app') appParam: string,
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const app = this.requireApp(appParam);
    assertTrustedOrigin(req.headers?.origin);
    await this.authService.revokeRefreshToken(req.cookies?.[REFRESH_COOKIE_NAME] ?? '');
    res.clearCookie(REFRESH_COOKIE_NAME, { path: refreshCookiePath(app) });
    return { success: true, message: 'Logged out successfully' };
  }

  // Unauthenticated by design — the refresh-token cookie itself IS the
  // credential here, same as password-reset's resetToken. Throttled like
  // the other credential-bearing routes. The Origin check matters more
  // here than almost anywhere else in this API: CORS alone only stops an
  // attacker PAGE from reading the response, not from making the browser
  // send this request (with its httpOnly cookie attached) in the first
  // place — that's what makes this a CSRF-shaped endpoint.
  @ApiOperation({
    summary: 'Exchange the refresh cookie for a new access token',
    description:
      'Unauthenticated by design - the refresh-token httpOnly cookie IS the credential. Rotates the refresh token on every use (the old one becomes permanently unusable); if an already-rotated token is ever replayed, every other active session for that account is revoked immediately as a compromise response. Requires the request Origin to match an allow-list (CSRF defence), since a browser attaches this cookie automatically to any request to the backend.',
  })
  @ApiParam({ name: 'app', description: 'Which frontend is refreshing: mobile, website-new, or integration' })
  @ApiResponse({ status: 200, description: 'New access token issued; new refresh token set as the cookie.', schema: { type: 'object', properties: { token: { type: 'string', description: 'New access token (JWT, 1 hour)' } } } })
  @ApiResponse({ status: 401, description: 'Refresh token missing, invalid, expired, or already used (reuse-detected).' })
  @Throttle(AUTH_THROTTLE)
  @Post('refresh/:app')
  @HttpCode(200)
  async refresh(@Param('app') appParam: string, @Request() req: any, @Res({ passthrough: true }) res: Response) {
    const app = this.requireApp(appParam);
    assertTrustedOrigin(req.headers?.origin);
    const { refreshToken, ...rest } = await this.authService.refresh(
      req.cookies?.[REFRESH_COOKIE_NAME] ?? '',
      { userAgent: req.headers?.['user-agent'], ip: req.ip },
    );
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(app));
    return rest;
  }

  @ApiOperation({
    summary: 'Request a password-reset code by email',
    description:
      'Always returns the same generic message regardless of whether the email exists, is unverified, or is mid-cooldown - deliberately, to avoid leaking account existence. If a verified account is found, emails a 6-digit reset code (60-second per-email cooldown applies).',
  })
  @ApiResponse({ status: 200, description: 'Generic confirmation message, same in every case.', schema: { type: 'object', properties: { message: { type: 'string' } } } })
  @Throttle(AUTH_THROTTLE)
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @ApiOperation({
    summary: 'Verify a password-reset code',
    description:
      'Consumes the reset OTP sent by forgot-password and, if valid, issues a short-lived (15 minute), single-use reset token (JWT, purpose-locked to password_reset) to be presented to reset-password.',
  })
  @ApiResponse({ status: 200, description: 'Reset token issued.', schema: { type: 'object', properties: { resetToken: { type: 'string' } } } })
  @ApiResponse({ status: 401, description: 'Invalid or expired OTP, or too many incorrect attempts.' })
  @Throttle(AUTH_THROTTLE)
  @Post('verify-reset-otp')
  @HttpCode(200)
  async verifyResetOtp(@Body() dto: VerifyResetOtpDto) {
    return this.authService.verifyResetOtp(dto);
  }

  @ApiOperation({
    summary: 'Set a new password using a reset token',
    description:
      'Verifies the resetToken from verify-reset-otp (signature, purpose, and single-use via its jti claim - a reused reset link is rejected), sets the new password, and revokes every outstanding refresh token for the account so any existing session is forced to sign in again.',
  })
  @ApiResponse({ status: 200, description: 'Password updated.', schema: { type: 'object', properties: { message: { type: 'string' } } } })
  @ApiResponse({ status: 401, description: 'Reset token invalid, expired, wrong purpose, or already used.' })
  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @ApiOperation({
    summary: 'Change password while signed in',
    description:
      'Verifies the current password before setting a new one (minimum 8 characters). Rejects accounts that have no password set (Google/Apple/OTP-only accounts). Revokes every outstanding refresh token for the account afterward, same as reset-password.',
  })
  @ApiResponse({ status: 200, description: 'Password updated.', schema: { type: 'object', properties: { message: { type: 'string' } } } })
  @ApiResponse({ status: 400, description: 'Missing fields, password too short, or account has no password to change.' })
  @ApiResponse({ status: 401, description: 'Current password is incorrect.' })
  @Throttle(AUTH_THROTTLE)
  @Post('change-password')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async changePassword(
    @Request() req: any,
    @Body() body: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      req.user.id,
      body?.currentPassword,
      body?.newPassword,
    );
  }

}
