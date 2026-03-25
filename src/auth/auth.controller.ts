import { Controller, Post, Body, UseGuards, Request, HttpCode } from '@nestjs/common';
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

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('check-email')
  async checkEmail(@Body('email') email: string) {
    return this.authService.checkEmail(email);
  }

  @Post('request-otp')
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto);
  }

  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('google')
  async googleLogin(@Body('credential') credential: string) {
    return this.authService.googleLogin(credential);
  }

  @Post('apple')
  async appleLogin(
    @Body('idToken') idToken: string,
    @Body('firstName') firstName?: string,
    @Body('lastName') lastName?: string,
  ) {
    return this.authService.appleLogin(idToken, firstName, lastName);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async logout(@Request() req: any) {
    // JWT is stateless — token is cleared client-side.
    // This endpoint exists so the client can confirm with the server and
    // gives a hook for future token-blacklist / session cleanup.
    return { success: true, message: 'Logged out successfully' };
  }

  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('verify-reset-otp')
  @HttpCode(200)
  async verifyResetOtp(@Body() dto: VerifyResetOtpDto) {
    return this.authService.verifyResetOtp(dto);
  }

  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  /** Dev-only: bypasses Apple token verification for local testing */
  @Post('apple/mock')
  appleMockLogin(
    @Body('email') email: string,
    @Body('firstName') firstName?: string,
    @Body('lastName') lastName?: string,
  ) {
    return this.authService.appleDevMock(
      email || 'apple-test@dev.local',
      firstName,
      lastName,
    );
  }
}
