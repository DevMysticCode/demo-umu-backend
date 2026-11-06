import { Controller, Get, Put, Body, Param, UseGuards, Request } from '@nestjs/common';
import { LearnService, UpdateProgressDto } from './learn.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';

@Controller('learn')
export class LearnController {
  constructor(private readonly learnService: LearnService) {}

  @ApiOperation({ summary: 'List educational videos', description: 'No auth required. Returns the catalogue of Learn-section educational videos.' })
  @ApiResponse({ status: 200, description: 'Video catalogue.', schema: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string', nullable: true }, url: { type: 'string' },
    thumbnail: { type: 'string', nullable: true }, durationSec: { type: 'number' }, points: { type: 'number' },
    category: { type: 'string', nullable: true }, tags: { type: 'array', items: { type: 'string' } },
    order: { type: 'number' }, featured: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' },
  } } } })
  @Get('videos')
  async getVideos() {
    return this.learnService.getVideos();
  }

  @ApiOperation({ summary: "List the caller's in-progress videos", description: "Returns the signed-in user's \"continue watching\" shelf - videos they've started but not finished." })
  @ApiResponse({ status: 200, description: 'In-progress video rows - the Video record spread with the caller\'s own progress fields.', schema: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string', nullable: true }, url: { type: 'string' },
    thumbnail: { type: 'string', nullable: true }, durationSec: { type: 'number' }, points: { type: 'number' },
    category: { type: 'string', nullable: true }, tags: { type: 'array', items: { type: 'string' } },
    positionSecs: { type: 'number' }, progressPercent: { type: 'number' }, remainingSecs: { type: 'number' },
  } } } })
  @Get('continue-watching')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async getContinueWatching(@Request() req) {
    return this.learnService.getContinueWatching(req.user.id);
  }

  @ApiOperation({ summary: 'Update watch progress for a video', description: "Upserts the signed-in user's playback progress for one video." })
  @ApiParam({ name: 'videoId', description: 'Video ID' })
  @ApiResponse({
    status: 200,
    description: 'The upserted progress row.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        userId: { type: 'string' },
        videoId: { type: 'string' },
        positionSecs: { type: 'number' },
        completed: { type: 'boolean' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
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

  @ApiOperation({ summary: 'Get watch progress for a video', description: "Returns the signed-in user's saved progress for one specific video." })
  @ApiParam({ name: 'videoId', description: 'Video ID' })
  @ApiResponse({
    status: 200,
    description: 'The progress row, or null if the caller has never started this video.',
    schema: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string' },
        userId: { type: 'string' },
        videoId: { type: 'string' },
        positionSecs: { type: 'number' },
        completed: { type: 'boolean' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @Get('progress/:videoId')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async getProgress(@Request() req, @Param('videoId') videoId: string) {
    return this.learnService.getProgress(req.user.id, videoId);
  }
}
