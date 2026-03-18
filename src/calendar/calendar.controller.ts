import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, UseGuards, Request,
} from '@nestjs/common';
import { CalendarService, CreateReminderDto, UpdateReminderDto } from './calendar.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('calendar')
@UseGuards(JwtAuthGuard)
export class CalendarController {
  constructor(private calendarService: CalendarService) {}

  // GET /calendar?year=2025&month=9
  @Get()
  async getReminders(
    @Request() req,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const now = new Date();
    const y = year ? parseInt(year) : now.getFullYear();
    const m = month ? parseInt(month) : now.getMonth() + 1;
    return this.calendarService.getReminders(req.user.id, y, m);
  }

  @Post()
  async createReminder(@Request() req, @Body() dto: CreateReminderDto) {
    return this.calendarService.createReminder(req.user.id, dto);
  }

  @Put(':id')
  async updateReminder(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpdateReminderDto,
  ) {
    return this.calendarService.updateReminder(req.user.id, id, dto);
  }

  @Delete(':id')
  async deleteReminder(@Request() req, @Param('id') id: string) {
    return this.calendarService.deleteReminder(req.user.id, id);
  }
}
