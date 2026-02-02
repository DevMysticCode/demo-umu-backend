import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { TaskService } from './task.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('tasks')
export class TaskController {
  constructor(private taskService: TaskService) {}

  @Get(':taskId/questions')
  @UseGuards(JwtAuthGuard)
  async getTaskQuestions(@Param('taskId') taskId: string, @Request() req: any) {
    const userId = req.user.sub;
    return this.taskService.getTaskQuestions(taskId, userId);
  }

  @Post(':taskId/complete')
  @UseGuards(JwtAuthGuard)
  async completeTask(@Param('taskId') taskId: string, @Request() req: any) {
    const userId = req.user.sub;
    return this.taskService.completeTask(taskId, userId);
  }
}
