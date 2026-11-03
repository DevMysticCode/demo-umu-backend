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
import { ApiBearerAuth } from '@nestjs/swagger';

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
  @SkipThrottle()
  @Get(':taskId/questions')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async getTaskQuestions(@Param('taskId') taskId: string, @Request() req: any) {
    const userId = req.user.id;
    return this.taskService.getTaskQuestions(taskId, userId);
  }

  @Post(':taskId/complete')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async completeTask(@Param('taskId') taskId: string, @Request() req: any) {
    const userId = req.user.id;
    return this.taskService.completeTask(taskId, userId);
  }
}
