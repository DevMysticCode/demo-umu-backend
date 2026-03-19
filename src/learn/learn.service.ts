import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const SEED_VIDEOS = [
  {
    id: 'vid-001',
    title: 'Overview of the Property Journey',
    description: 'A complete walkthrough of buying your first home from search to completion.',
    url: '/op-icons/temp/house.mp4',
    thumbnail: null,
    durationSec: 195,
    points: 15,
    category: 'Getting Started',
    tags: ['property', 'buying', 'beginner'],
    order: 1,
    featured: true,
  },
  {
    id: 'vid-002',
    title: 'Understanding Property Passports',
    description: 'Learn how Property Passports work and why they matter for buyers and sellers.',
    url: '/op-icons/temp/house.mp4',
    thumbnail: null,
    durationSec: 240,
    points: 12,
    category: 'Passports',
    tags: ['passport', 'documents'],
    order: 2,
    featured: true,
  },
  {
    id: 'vid-003',
    title: 'Becoming Focused as a Buyer',
    description: 'How to narrow your property search and make decisive, confident offers.',
    url: '/op-icons/temp/house.mp4',
    thumbnail: null,
    durationSec: 220,
    points: 15,
    category: 'Buying',
    tags: ['buying', 'strategy'],
    order: 3,
    featured: true,
  },
  {
    id: 'vid-004',
    title: 'The Pros and Cons of Leasehold',
    description: 'Everything you need to know before buying a leasehold property.',
    url: '/op-icons/temp/house.mp4',
    thumbnail: null,
    durationSec: 500,
    points: 12,
    category: 'Legal',
    tags: ['leasehold', 'legal'],
    order: 4,
    featured: false,
  },
];

export class UpdateProgressDto {
  positionSecs: number;
  completed?: boolean;
}

@Injectable()
export class LearnService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedVideos();
  }

  private async seedVideos() {
    for (const v of SEED_VIDEOS) {
      await this.prisma.video.upsert({
        where: { id: v.id },
        update: {},
        create: v,
      });
    }
  }

  async getVideos() {
    return this.prisma.video.findMany({ orderBy: { order: 'asc' } });
  }

  async getContinueWatching(userId: string) {
    const progress = await this.prisma.videoProgress.findMany({
      where: { userId, completed: false, positionSecs: { gt: 0 } },
      include: { video: true },
      orderBy: { updatedAt: 'desc' },
    });
    return progress.map((p) => ({
      ...p.video,
      positionSecs: p.positionSecs,
      progressPercent: Math.round((p.positionSecs / p.video.durationSec) * 100),
      remainingSecs: p.video.durationSec - p.positionSecs,
    }));
  }

  async updateProgress(userId: string, videoId: string, dto: UpdateProgressDto) {
    return this.prisma.videoProgress.upsert({
      where: { userId_videoId: { userId, videoId } },
      update: { positionSecs: dto.positionSecs, completed: dto.completed ?? false },
      create: { userId, videoId, positionSecs: dto.positionSecs, completed: dto.completed ?? false },
    });
  }

  async getProgress(userId: string, videoId: string) {
    return this.prisma.videoProgress.findUnique({
      where: { userId_videoId: { userId, videoId } },
    });
  }
}
