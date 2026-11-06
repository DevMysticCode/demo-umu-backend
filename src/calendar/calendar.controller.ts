import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, UseGuards, Request,
} from '@nestjs/common';
import { CalendarService, CreateReminderDto, UpdateReminderDto } from './calendar.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';

@Controller('calendar')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class CalendarController {
  constructor(private calendarService: CalendarService) {}

  // GET /calendar?year=2025&month=9
  @ApiOperation({ summary: "List the caller's reminders for a month", description: 'Returns reminders for the signed-in user for the given year/month, defaulting to the current month if omitted.' })
  @ApiQuery({ name: 'year', required: false, description: 'Defaults to the current year.' })
  @ApiQuery({ name: 'month', required: false, description: 'Defaults to the current month (1-12).' })
  @ApiResponse({
    status: 200,
    description: 'Reminder rows for that month.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          userId: { type: 'string' },
          title: { type: 'string' },
          date: { type: 'string', format: 'date-time', description: 'Stored as a UTC date with no time component' },
          time: { type: 'string', nullable: true, description: "HH:mm, e.g. '14:00'" },
          repeats: { type: 'string', description: "'never' | 'annually'" },
          notes: { type: 'string', nullable: true },
          type: { type: 'string', description: "'manual' | 'tradesperson' | 'business' | 'compliance-renewal'" },
          sourceRef: { type: 'string', nullable: true, description: 'Stable key for auto-created reminders, e.g. landlord-compliance:<sectionId>' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
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

  @ApiOperation({ summary: 'Create a reminder', description: "Creates a new reminder on the signed-in user's calendar." })
  @ApiResponse({
    status: 201,
    description: 'The created reminder.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        userId: { type: 'string' },
        title: { type: 'string' },
        date: { type: 'string', format: 'date-time' },
        time: { type: 'string', nullable: true },
        repeats: { type: 'string' },
        notes: { type: 'string', nullable: true },
        type: { type: 'string' },
        sourceRef: { type: 'string', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @Post()
  async createReminder(@Request() req, @Body() dto: CreateReminderDto) {
    return this.calendarService.createReminder(req.user.id, dto);
  }

  @ApiOperation({ summary: 'Update a reminder', description: "Updates one of the caller's own reminders." })
  @ApiParam({ name: 'id', description: 'UserReminder ID' })
  @ApiResponse({
    status: 200,
    description: 'The updated reminder.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        userId: { type: 'string' },
        title: { type: 'string' },
        date: { type: 'string', format: 'date-time' },
        time: { type: 'string', nullable: true },
        repeats: { type: 'string' },
        notes: { type: 'string', nullable: true },
        type: { type: 'string' },
        sourceRef: { type: 'string', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @Put(':id')
  async updateReminder(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpdateReminderDto,
  ) {
    return this.calendarService.updateReminder(req.user.id, id, dto);
  }

  @ApiOperation({ summary: 'Delete a reminder', description: "Deletes one of the caller's own reminders." })
  @ApiParam({ name: 'id', description: 'UserReminder ID' })
  @ApiResponse({ status: 200, description: 'Deletion confirmation.', schema: { type: 'object', properties: { message: { type: 'string' } } } })
  @Delete(':id')
  async deleteReminder(@Request() req, @Param('id') id: string) {
    return this.calendarService.deleteReminder(req.user.id, id);
  }
}
