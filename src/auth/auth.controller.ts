import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RequestOtpDto, VerifyOtpDto, RegisterDto, LoginDto } from './dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

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
