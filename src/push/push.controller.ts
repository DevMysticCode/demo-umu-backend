import { Body, Controller, Delete, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PushService } from './push.service';

class RegisterPushTokenDto {
  token!: string;
  platform!: string;
  deviceId?: string;
}

class UnregisterPushTokenDto {
  token!: string;
}

@Controller('me/push-token')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post()
  async register(@Req() req: any, @Body() dto: RegisterPushTokenDto) {
    await this.push.registerToken(req.user.id, dto.token, dto.platform, dto.deviceId);
    return { ok: true };
  }

  @Delete()
  async unregister(@Req() req: any, @Body() dto: UnregisterPushTokenDto) {
    await this.push.unregisterToken(req.user.id, dto.token);
    return { ok: true };
  }

  // Dev/QA helper: fires a real push to the authenticated user so you
  // can verify the end-to-end pipeline (token registration + FCM →
  // APNs → device). Safe to leave in prod — only authenticated users
  // can trigger a push to themselves.
  @Post('test')
  async test(@Req() req: any) {
    await this.push.send(req.user.id, {
      title: 'UMU test notification',
      body: 'If you see this, push is working end-to-end.',
      data: { kind: 'test' },
    });
    return { ok: true };
  }
}
