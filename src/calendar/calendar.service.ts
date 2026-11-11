import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

export class CreateReminderDto {
  @ApiProperty({ description: 'Title of the reminder.' })
  @IsString()
  title: string;

  @ApiProperty({ description: 'Reminder date, ISO date string.', example: '2025-09-14' })
  @IsString()
  date: string;   // ISO date string e.g. "2025-09-14"

  @ApiPropertyOptional({ description: 'Reminder time, 24-hour "HH:mm".', example: '14:00' })
  @IsOptional()
  @IsString()
  time?: string;  // "14:00"

  @ApiPropertyOptional({ description: 'Recurrence rule for this reminder, if it repeats.' })
  @IsOptional()
  @IsString()
  repeats?: string;

  @ApiPropertyOptional({ description: 'Free-text notes attached to the reminder.' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Category of reminder (e.g. viewing, deadline), used for icon/grouping.' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Reference ID linking this reminder back to the entity that created it (e.g. a viewing request).' })
  @IsOptional()
  @IsString()
  sourceRef?: string;
}

export class UpdateReminderDto {
  @ApiPropertyOptional({ description: 'Title of the reminder.' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Reminder date, ISO date string.' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ description: 'Reminder time, 24-hour "HH:mm".' })
  @IsOptional()
  @IsString()
  time?: string;

  @ApiPropertyOptional({ description: 'Recurrence rule for this reminder, if it repeats.' })
  @IsOptional()
  @IsString()
  repeats?: string;

  @ApiPropertyOptional({ description: 'Free-text notes attached to the reminder.' })
  @IsOptional()
  @IsString()
  notes?: string;
}

@Injectable()
export class CalendarService {
  constructor(private prisma: PrismaService) {}

  async getReminders(userId: string, year: number, month: number) {
    // month is 1-based
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end   = new Date(Date.UTC(year, month, 1)); // exclusive

    // Fetch reminders in range + annually repeating ones
    const [direct, annual] = await Promise.all([
      this.prisma.userReminder.findMany({
        where: { userId, repeats: 'never', date: { gte: start, lt: end } },
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
      }),
      this.prisma.userReminder.findMany({
        where: { userId, repeats: 'annually' },
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
      }),
    ]);

    // Adjust annual reminders to the requested year/month if they match the month
    const annualInMonth = annual
      .map((r) => {
        const orig = new Date(r.date);
        const projected = new Date(Date.UTC(year, orig.getUTCMonth(), orig.getUTCDate()));
        if (projected.getUTCMonth() + 1 !== month) return null;
        return { ...r, date: projected };
      })
      .filter(Boolean);

    const all = [...direct, ...annualInMonth]
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => {
        const da = new Date(a.date).getTime();
        const db = new Date(b.date).getTime();
        if (da !== db) return da - db;
        return (a.time ?? '').localeCompare(b.time ?? '');
      });

    return all;
  }

  async getAllReminders(userId: string) {
    return this.prisma.userReminder.findMany({
      where: { userId },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
    });
  }

  async createReminder(userId: string, dto: CreateReminderDto) {
    const title = dto.title?.trim();
    if (!title) throw new BadRequestException('title is required');
    if (!dto.date) throw new BadRequestException('date is required');

    const d = new Date(dto.date);
    if (isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid date: "${dto.date}"`);
    }
    const utcDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));

    // Reminders auto-created from another feature (sourceRef set) update
    // their existing row on re-save instead of piling up duplicates —
    // e.g. re-entering a compliance certificate's renewal date should
    // move the one calendar entry, not leave a stale one behind.
    if (dto.sourceRef) {
      const existing = await this.prisma.userReminder.findFirst({
        where: { userId, sourceRef: dto.sourceRef },
      });
      if (existing) {
        return this.prisma.userReminder.update({
          where: { id: existing.id },
          data: {
            title,
            date: utcDate,
            time: dto.time ?? null,
            repeats: dto.repeats ?? existing.repeats,
            notes: dto.notes ?? existing.notes,
            type: dto.type ?? existing.type,
          },
        });
      }
    }

    return this.prisma.userReminder.create({
      data: {
        userId,
        title,
        date: utcDate,
        time: dto.time ?? null,
        repeats: dto.repeats ?? 'never',
        notes: dto.notes ?? null,
        type: dto.type ?? 'manual',
        sourceRef: dto.sourceRef ?? null,
      },
    });
  }

  async updateReminder(userId: string, id: string, dto: UpdateReminderDto) {
    const reminder = await this.prisma.userReminder.findUnique({ where: { id } });
    if (!reminder) throw new NotFoundException('Reminder not found');
    if (reminder.userId !== userId) throw new ForbiddenException();

    const data: any = { ...dto };
    if (dto.title !== undefined) {
      const title = dto.title?.trim();
      if (!title) throw new BadRequestException('title cannot be empty');
      data.title = title;
    }
    if (dto.date) {
      const d = new Date(dto.date);
      if (isNaN(d.getTime())) {
        throw new BadRequestException(`Invalid date: "${dto.date}"`);
      }
      data.date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    }

    return this.prisma.userReminder.update({ where: { id }, data });
  }

  async deleteReminder(userId: string, id: string) {
    const reminder = await this.prisma.userReminder.findUnique({ where: { id } });
    if (!reminder) throw new NotFoundException('Reminder not found');
    if (reminder.userId !== userId) throw new ForbiddenException();

    await this.prisma.userReminder.delete({ where: { id } });
    return { message: 'Reminder deleted' };
  }
}
