import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SendMessageDto } from './dto/send-message.dto';

// Shared DTOs returned by /threads endpoints. The shape is the same
// whether you're looking at your own thread as customer or supplier —
// `otherParty` is always "the person on the other side of the chat".
export interface MarketplaceThreadListItem {
  id: string;
  jobId: string;
  jobTitle: string;
  jobCategoryLabel: string;
  role: 'customer' | 'supplier';
  otherPartyName: string;
  otherPartyInitials: string;
  lastMessageBody: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
}

export interface MarketplaceThreadDetail {
  id: string;
  jobId: string;
  jobTitle: string;
  jobCategoryLabel: string;
  role: 'customer' | 'supplier';
  otherPartyName: string;
  otherPartyInitials: string;
  messages: MarketplaceMessageDto[];
}

export interface MarketplaceMessageDto {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  isMine: boolean;
}

function initialsFor(first?: string | null, last?: string | null): string {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || 'U';
}
function nameFor(first?: string | null, last?: string | null): string {
  return `${first ?? ''} ${last ?? ''}`.trim() || 'A user';
}

@Injectable()
export class MarketplaceMessagesService {
  constructor(private prisma: PrismaService) {}

  // Get-or-create the thread for a job + supplier pair. Called from
  // - customer side: viewing an offer and tapping "Message"
  // - supplier side: opening a job and tapping "Message customer"
  // Customers can't open threads on their own jobs.
  async getOrCreateThread(viewerUserId: string, jobId: string, supplierId: string): Promise<MarketplaceThreadDetail> {
    const job = await this.prisma.marketplaceJob.findUnique({ where: { id: jobId }, include: { category: true } });
    if (!job) throw new NotFoundException('Job not found');
    if (!job.customerId) throw new BadRequestException('This job has no customer');
    if (job.customerId === supplierId) {
      throw new BadRequestException('A customer cannot open a thread with themselves');
    }
    if (viewerUserId !== job.customerId && viewerUserId !== supplierId) {
      throw new ForbiddenException('You are not a party to this thread');
    }

    const existing = await this.prisma.marketplaceThread.findUnique({
      where: { jobId_supplierId: { jobId, supplierId } },
    });
    if (existing) {
      return this.toDetail(viewerUserId, existing.id);
    }

    const created = await this.prisma.marketplaceThread.create({
      data: {
        jobId,
        supplierId,
        customerId: job.customerId,
      },
    });
    return this.toDetail(viewerUserId, created.id);
  }

  async listThreads(viewerUserId: string): Promise<MarketplaceThreadListItem[]> {
    const threads = await this.prisma.marketplaceThread.findMany({
      where: {
        OR: [{ customerId: viewerUserId }, { supplierId: viewerUserId }],
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        job: { include: { category: true } },
        customer: true,
        supplier: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    // Single follow-up query for unread counts to avoid an N+1.
    const threadIds = threads.map((t) => t.id);
    const unreadCounts = threadIds.length
      ? await this.prisma.marketplaceMessage.groupBy({
          by: ['threadId'],
          where: {
            threadId: { in: threadIds },
            senderId: { not: viewerUserId },
            readAt: null,
          },
          _count: { _all: true },
        })
      : [];
    const unreadByThread = new Map<string, number>();
    for (const row of unreadCounts) unreadByThread.set(row.threadId, row._count._all);

    return threads.map((t) => {
      const role: 'customer' | 'supplier' = t.customerId === viewerUserId ? 'customer' : 'supplier';
      const other = role === 'customer' ? t.supplier : t.customer;
      const last = t.messages[0];
      return {
        id: t.id,
        jobId: t.jobId,
        jobTitle: t.job.title,
        jobCategoryLabel: `${t.job.category.emoji} ${t.job.category.name}`,
        role,
        otherPartyName: nameFor(other.firstName, other.lastName),
        otherPartyInitials: initialsFor(other.firstName, other.lastName),
        lastMessageBody: last?.body ?? null,
        lastMessageAt: (t.lastMessageAt ?? last?.createdAt ?? null)?.toISOString() ?? null,
        unreadCount: unreadByThread.get(t.id) ?? 0,
      };
    });
  }

  async getThread(viewerUserId: string, threadId: string): Promise<MarketplaceThreadDetail> {
    return this.toDetail(viewerUserId, threadId);
  }

  async sendMessage(viewerUserId: string, threadId: string, dto: SendMessageDto): Promise<MarketplaceMessageDto> {
    const thread = await this.prisma.marketplaceThread.findUnique({ where: { id: threadId } });
    if (!thread) throw new NotFoundException('Thread not found');
    if (thread.customerId !== viewerUserId && thread.supplierId !== viewerUserId) {
      throw new ForbiddenException('You are not a party to this thread');
    }

    const message = await this.prisma.marketplaceMessage.create({
      data: {
        threadId,
        senderId: viewerUserId,
        body: dto.body.trim(),
      },
    });
    await this.prisma.marketplaceThread.update({
      where: { id: threadId },
      data: { lastMessageAt: message.createdAt },
    });
    return {
      id: message.id,
      senderId: message.senderId,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
      isMine: true,
    };
  }

  // Mark every inbound (not-mine) unread message in the thread as read.
  // Returns the number of rows touched so the inbox can refresh badges.
  async markRead(viewerUserId: string, threadId: string): Promise<{ marked: number }> {
    const thread = await this.prisma.marketplaceThread.findUnique({ where: { id: threadId } });
    if (!thread) throw new NotFoundException('Thread not found');
    if (thread.customerId !== viewerUserId && thread.supplierId !== viewerUserId) {
      throw new ForbiddenException('You are not a party to this thread');
    }

    const result = await this.prisma.marketplaceMessage.updateMany({
      where: {
        threadId,
        senderId: { not: viewerUserId },
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    return { marked: result.count };
  }

  // ─── internal ─────────────────────────────────────────────────────
  private async toDetail(viewerUserId: string, threadId: string): Promise<MarketplaceThreadDetail> {
    const thread = await this.prisma.marketplaceThread.findUnique({
      where: { id: threadId },
      include: {
        job: { include: { category: true } },
        customer: true,
        supplier: true,
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!thread) throw new NotFoundException('Thread not found');
    if (thread.customerId !== viewerUserId && thread.supplierId !== viewerUserId) {
      throw new ForbiddenException('You are not a party to this thread');
    }

    const role: 'customer' | 'supplier' = thread.customerId === viewerUserId ? 'customer' : 'supplier';
    const other = role === 'customer' ? thread.supplier : thread.customer;
    return {
      id: thread.id,
      jobId: thread.jobId,
      jobTitle: thread.job.title,
      jobCategoryLabel: `${thread.job.category.emoji} ${thread.job.category.name}`,
      role,
      otherPartyName: nameFor(other.firstName, other.lastName),
      otherPartyInitials: initialsFor(other.firstName, other.lastName),
      messages: thread.messages.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        isMine: m.senderId === viewerUserId,
      })),
    };
  }
}
