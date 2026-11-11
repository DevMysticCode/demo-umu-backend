import { Body, Controller, Delete, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PushService } from './push.service';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';

class RegisterPushTokenDto {
  token!: string;
  platform!: string;
  deviceId?: string;
}

class UnregisterPushTokenDto {
  token!: string;
}

@Controller('me/push-token')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @ApiOperation({ summary: 'Register a push notification token', description: "Registers (or re-registers) the signed-in user's device push token for the given platform, so push notifications can be delivered to this device." })
  @ApiBody({ schema: { type: 'object', required: ['token', 'platform'], properties: {
    token: { type: 'string', description: 'The device push token (FCM/APNs)' },
    platform: { type: 'string', example: 'ios', description: 'The device platform this token belongs to.' },
    deviceId: { type: 'string', nullable: true, description: 'Optional stable device identifier, used to replace a previous token for the same device.' },
  } } })
  @ApiResponse({ status: 201, description: 'Confirmation.', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } })
  @Post()
  async register(@Req() req: any, @Body() dto: RegisterPushTokenDto) {
    await this.push.registerToken(req.user.id, dto.token, dto.platform, dto.deviceId);
    return { ok: true };
  }

  @ApiOperation({ summary: 'Unregister a push notification token', description: "Removes one of the signed-in user's device push tokens, stopping further push delivery to that device." })
  @ApiBody({ schema: { type: 'object', required: ['token'], properties: { token: { type: 'string', description: 'The device push token to remove.' } } } })
  @ApiResponse({ status: 200, description: 'Confirmation.', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } })
  @Delete()
  async unregister(@Req() req: any, @Body() dto: UnregisterPushTokenDto) {
    await this.push.unregisterToken(req.user.id, dto.token);
    return { ok: true };
  }

  // Dev/QA helper: fires a real push to the authenticated user so you
  // can verify the end-to-end pipeline (token registration + FCM →
  // APNs → device). Safe to leave in prod — only authenticated users
  // can trigger a push to themselves.
  @ApiOperation({ summary: 'Send a test push notification to yourself', description: 'Dev/QA helper - fires a real push notification to the authenticated caller to verify the end-to-end delivery pipeline. Safe for production since it can only target the caller themselves.' })
  @ApiResponse({ status: 201, description: 'Confirmation.', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } })
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
