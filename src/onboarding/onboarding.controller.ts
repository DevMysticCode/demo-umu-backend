import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { OnboardingService, SaveQuestionnaireDto } from './onboarding.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('onboarding')
export class OnboardingController {
  constructor(private onboardingService: OnboardingService) {}

  @Post('questionnaire')
  @UseGuards(JwtAuthGuard)
  async saveQuestionnaire(@Body() dto: SaveQuestionnaireDto, @Request() req: any) {
    const userId = req.user.id;
    return this.onboardingService.saveQuestionnaire(userId, dto);
  }

  @Get('questionnaire')
  @UseGuards(JwtAuthGuard)
  async getQuestionnaire(@Request() req: any) {
    const userId = req.user.id;
    return this.onboardingService.getQuestionnaire(userId);
  }
}
