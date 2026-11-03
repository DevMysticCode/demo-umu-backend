import { Controller, Get, Put, Body, Param, UseGuards, Request } from '@nestjs/common';
import { LearnService, UpdateProgressDto } from './learn.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ApiBearerAuth } from '@nestjs/swagger';

@Controller('learn')
export class LearnController {
  constructor(private readonly learnService: LearnService) {}

  @Get('videos')
  async getVideos() {
    return this.learnService.getVideos();
  }

  @Get('continue-watching')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async getContinueWatching(@Request() req) {
    return this.learnService.getContinueWatching(req.user.id);
  }

  @Put('progress/:videoId')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async updateProgress(
    @Request() req,
    @Param('videoId') videoId: string,
    @Body() dto: UpdateProgressDto,
  ) {
    return this.learnService.updateProgress(req.user.id, videoId, dto);
  }

  @Get('progress/:videoId')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async getProgress(@Request() req, @Param('videoId') videoId: string) {
    return this.learnService.getProgress(req.user.id, videoId);
  }
}
