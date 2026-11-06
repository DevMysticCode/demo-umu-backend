import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { TaskService } from './task.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';

@Controller('tasks')
export class TaskController {
  constructor(private taskService: TaskService) {}

  // The passport view fans out one task-questions read per task on
  // mount — for a passport with 18 sections × up to 8 tasks each,
  // that's 100+ requests inside a few seconds. On the default 300/min
  // bucket a single navigation between sections could 429. Read-only,
  // JWT-gated, no billing side-effects, so throttle is skipped and
  // JWT auth is the real gate — same pattern used by /property/for-you
  // and the LLC endpoints.
  @ApiOperation({
    summary: 'List a task\'s questions with current answers',
    description:
      'Returns every question in the task, flattened with its template display fields (label, type, options, scale config, etc.) plus the current answer value (text/JSON/file URL) and whether it\'s completed. Not rate-limited (SkipThrottle) since a passport view can fan out 100+ of these calls in a few seconds navigating between sections - JWT auth is the real gate here.',
  })
  @ApiParam({ name: 'taskId', description: 'The PassportSectionTask id' })
  @ApiResponse({ status: 200, description: 'Questions for this task.', schema: { type: 'array', items: { type: 'object' } } })
  @SkipThrottle()
  @Get(':taskId/questions')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async getTaskQuestions(@Param('taskId') taskId: string, @Request() req: any) {
    const userId = req.user.id;
    return this.taskService.getTaskQuestions(taskId, userId);
  }

  @ApiOperation({
    summary: 'Mark a task complete',
    description:
      'Marks the task done and, if every task in its section is now complete, advances the section, awards any section-completion bonus points, and may award the core-passport-complete reward if this was the passport\'s last required section.',
  })
  @ApiParam({ name: 'taskId', description: 'The PassportSectionTask id' })
  @ApiResponse({
    status: 201,
    description: 'Task completed.',
    schema: { type: 'object', properties: { success: { type: 'boolean' }, sectionCompleted: { type: 'boolean' }, nextSectionId: { type: 'string', nullable: true }, sectionBonusPoints: { type: 'number' }, balanceAfterBonus: { type: 'number' } } },
  })
  @Post(':taskId/complete')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async completeTask(@Param('taskId') taskId: string, @Request() req: any) {
    const userId = req.user.id;
    return this.taskService.completeTask(taskId, userId);
  }
}
