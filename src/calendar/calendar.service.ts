import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export class CreateReminderDto {
  title: string;
  date: string;   // ISO date string e.g. "2025-09-14"
  time?: string;  // "14:00"
  repeats?: string;
  notes?: string;
  type?: string;
}

export class UpdateReminderDto {
  title?: string;
  date?: string;
  time?: string;
  repeats?: string;
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
    const d = new Date(dto.date);
    const utcDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));

    return this.prisma.userReminder.create({
      data: {
        userId,
        title: dto.title,
        date: utcDate,
        time: dto.time ?? null,
        repeats: dto.repeats ?? 'never',
        notes: dto.notes ?? null,
        type: dto.type ?? 'manual',
      },
    });
  }

  async updateReminder(userId: string, id: string, dto: UpdateReminderDto) {
    const reminder = await this.prisma.userReminder.findUnique({ where: { id } });
    if (!reminder) throw new NotFoundException('Reminder not found');
    if (reminder.userId !== userId) throw new ForbiddenException();

    const data: any = { ...dto };
    if (dto.date) {
      const d = new Date(dto.date);
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
