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
} from './dto';
import { JwtAuthGuard } from './jwt.guard';
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
  @Throttle(AUTH_THROTTLE)
  @Post('check-email')
  async checkEmail(@Body('email') email: string) {
    return this.authService.checkEmail(email);
  }

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

  @Throttle(AUTH_THROTTLE)
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('verify-reset-otp')
  @HttpCode(200)
  async verifyResetOtp(@Body() dto: VerifyResetOtpDto) {
    return this.authService.verifyResetOtp(dto);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async changePassword(
    @Request() req: any,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    return this.authService.changePassword(
      req.user.id,
      body?.currentPassword,
      body?.newPassword,
    );
  }

}
