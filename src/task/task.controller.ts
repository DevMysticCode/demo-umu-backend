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
  @ApiResponse({ status: 200, description: 'Questions for this task.', schema: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, templateId: { type: 'string' }, question: { type: 'string', description: 'The template title, used as the question label' },
    description: { type: 'string', nullable: true }, instructionText: { type: 'string', nullable: true },
    type: { type: 'string', description: 'e.g. TEXT, RADIO, CHECKBOX, UPLOAD, MULTIPART, NOTE, DATE, ADDRESS, SCALE, CHIPS...' },
    help: { type: 'string', nullable: true }, helpContent: { type: 'object', nullable: true }, helpVideoUrl: { type: 'string', nullable: true },
    options: { type: 'object', nullable: true }, placeholder: { type: 'string', nullable: true }, display: { type: 'string', nullable: true },
    uploadInstruction: { type: 'string', nullable: true }, prewritten: { type: 'object', nullable: true }, dateFields: { type: 'object', nullable: true },
    parts: { type: 'object', nullable: true, description: 'MULTIPART question sub-fields' }, fields: { type: 'object', nullable: true },
    autoSaveOn: { type: 'boolean', nullable: true }, repeatable: { type: 'boolean', nullable: true }, buttonText: { type: 'string', nullable: true },
    scaleType: { type: 'string', nullable: true }, scaleMin: { type: 'number', nullable: true }, scaleMax: { type: 'number', nullable: true },
    scaleStep: { type: 'number', nullable: true }, scaleFormat: { type: 'string', nullable: true }, scaleMaxLabel: { type: 'string', nullable: true },
    externalLink: { type: 'string', nullable: true }, otherPlaceholder: { type: 'string', nullable: true }, points: { type: 'number', nullable: true },
    answer: { nullable: true, description: 'The current answer value - answerText, answerJson, or fileUrl (whichever is set), or null if unanswered' },
    completed: { type: 'boolean' },
  } } } })
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
