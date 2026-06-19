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
  $transaction = (...args: any[]) => (this.prisma as any).$transaction(...args);

  get user() {
    return this.prisma.user;
  }

  get otpCode() {
    return this.prisma.otpCode;
  }

  get passport() {
    return this.prisma.passport;
  }

  get passportActivity() {
    return this.prisma.passportActivity;
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

  get passportCollaborator() {
    return this.prisma.passportCollaborator;
  }

  get property() {
    return this.prisma.property;
  }

  get userPreference() {
    return this.prisma.userPreference;
  }

  get passportCollection() {
    return this.prisma.passportCollection;
  }

  get passportCollectionItem() {
    return this.prisma.passportCollectionItem;
  }

  get ownershipVerification() {
    return this.prisma.ownershipVerification;
  }

  get buyerPassportAccess() {
    return this.prisma.buyerPassportAccess;
  }

  get userAddress() {
    return this.prisma.userAddress;
  }

  get userCompany() {
    return this.prisma.userCompany;
  }

  get userSolicitor() {
    return this.prisma.userSolicitor;
  }

  get userCollaborator() {
    return this.prisma.userCollaborator;
  }

  get userDocument() {
    return this.prisma.userDocument;
  }

  get userWishlist() {
    return this.prisma.userWishlist;
  }

  get userSavedProperty() {
    return this.prisma.userSavedProperty;
  }

  get userReminder() {
    return this.prisma.userReminder;
  }

  get supportRequest() {
    return this.prisma.supportRequest;
  }

  get video() {
    return this.prisma.video;
  }

  get videoProgress() {
    return this.prisma.videoProgress;
  }

  get homeScoreResult() {
    return this.prisma.homeScoreResult;
  }

  get pricePaidTransaction() {
    return this.prisma.pricePaidTransaction;
  }

  get sharedPassportLink() {
    return this.prisma.sharedPassportLink;
  }

  get buyerNote() {
    return this.prisma.buyerNote;
  }

  get buyerProfile() {
    return this.prisma.buyerProfile;
  }

  get buyerProfileShare() {
    return this.prisma.buyerProfileShare;
  }

  get verifierOrg() {
    return this.prisma.verifierOrg;
  }
  get verifierClient() {
    return this.prisma.verifierClient;
  }
  get accessRequest() {
    return this.prisma.accessRequest;
  }
  get accessGrant() {
    return this.prisma.accessGrant;
  }
  get accessLog() {
    return this.prisma.accessLog;
  }

  get propertySearchLog() {
    return this.prisma.propertySearchLog;
  }

  get marketplaceCategory() {
    return this.prisma.marketplaceCategory;
  }

  get marketplaceJob() {
    return this.prisma.marketplaceJob;
  }

  get marketplaceOffer() {
    return this.prisma.marketplaceOffer;
  }

  get marketplaceThread() {
    return this.prisma.marketplaceThread;
  }

  get marketplaceMessage() {
    return this.prisma.marketplaceMessage;
  }

  get marketplacePayment() {
    return this.prisma.marketplacePayment;
  }

  get marketplaceReview() {
    return this.prisma.marketplaceReview;
  }

  get passportPayment() {
    return this.prisma.passportPayment;
  }

  get pushToken() {
    return this.prisma.pushToken;
  }
}
