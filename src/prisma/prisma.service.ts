import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const getPrismaClient = () => {
  let prisma = globalForPrisma.prisma;

  if (!prisma) {
    prisma = new PrismaClient();
  }

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
  }

  return prisma;
};

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrismaClient();
  }

  async onModuleInit() {
    console.log('Connecting to database...');
    await this.prisma.$connect();
    console.log('Database connected successfully!');
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  // Expose prisma client methods
  get user() {
    return this.prisma.user;
  }

  get otpCode() {
    return this.prisma.otpCode;
  }

  get passport() {
    return this.prisma.passport;
  }

  get passportSection() {
    return this.prisma.passportSection;
  }

  get passportSectionTask() {
    return this.prisma.passportSectionTask;
  }

  get questionTemplate() {
    return this.prisma.questionTemplate;
  }

  get sectionTemplate() {
    return this.prisma.sectionTemplate;
  }

  get passportQuestion() {
    return this.prisma.passportQuestion;
  }

  get questionAnswer() {
    return this.prisma.questionAnswer;
  }
}
