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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';

@Controller('onboarding')
export class OnboardingController {
  constructor(private onboardingService: OnboardingService) {}

  @ApiOperation({ summary: 'Save the first-run onboarding questionnaire', description: "Saves (upserts) the signed-in user's answers from the first-run onboarding questionnaire." })
  @ApiBody({ type: SaveQuestionnaireDto })
  @ApiResponse({
    status: 201,
    description: 'Confirmation plus the upserted UserPreference row.',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        preference: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            purpose: { type: 'array', items: { type: 'string' }, nullable: true },
            buyingTimeline: { type: 'string', nullable: true },
            budgetMin: { type: 'number', nullable: true },
            budgetMax: { type: 'number', nullable: true },
            propertyTypes: { type: 'array', items: { type: 'string' }, nullable: true },
            propertyStyles: { type: 'array', items: { type: 'string' }, nullable: true },
            importantFeatures: { type: 'array', items: { type: 'string' }, nullable: true },
            sellingTimeline: { type: 'string', nullable: true },
            propertyValue: { type: 'number', nullable: true },
          },
        },
      },
    },
  })
  @Post('questionnaire')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async saveQuestionnaire(@Body() dto: SaveQuestionnaireDto, @Request() req: any) {
    const userId = req.user.id;
    return this.onboardingService.saveQuestionnaire(userId, dto);
  }

  @ApiOperation({ summary: 'Get the saved onboarding questionnaire', description: "Returns the signed-in user's previously saved onboarding questionnaire answers, if any." })
  @ApiResponse({
    status: 200,
    description: 'The UserPreference row, or null if the questionnaire was never completed.',
    schema: {
      type: 'object',
      nullable: true,
      properties: {
        userId: { type: 'string' },
        purpose: { type: 'array', items: { type: 'string' }, nullable: true },
        buyingTimeline: { type: 'string', nullable: true },
        budgetMin: { type: 'number', nullable: true },
        budgetMax: { type: 'number', nullable: true },
        propertyTypes: { type: 'array', items: { type: 'string' }, nullable: true },
        propertyStyles: { type: 'array', items: { type: 'string' }, nullable: true },
        importantFeatures: { type: 'array', items: { type: 'string' }, nullable: true },
        sellingTimeline: { type: 'string', nullable: true },
        propertyValue: { type: 'number', nullable: true },
      },
    },
  })
  @Get('questionnaire')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async getQuestionnaire(@Request() req: any) {
    const userId = req.user.id;
    return this.onboardingService.getQuestionnaire(userId);
  }
}
