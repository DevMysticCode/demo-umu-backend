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
    // Retry connect with exponential backoff. Transient DNS resolver
    // hiccups on dev machines (and cold Railway proxy warm-ups on prod
    // cold-start) previously crashed the whole app boot on the first
    // failure, leaving the developer looking at "Can't reach database
    // server" for a config that was working seconds earlier. Five
    // attempts spanning ~15 seconds catches every real transient we've
    // seen; a persistent misconfiguration still surfaces the underlying
    // error at the end.
    const MAX_ATTEMPTS = 5;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        console.log(
          `Connecting to database${attempt === 1 ? '' : ` (attempt ${attempt}/${MAX_ATTEMPTS})`}...`,
        );
        await this.prisma.$connect();
        console.log('Database connected successfully!');
        return;
      } catch (err) {
        lastErr = err;
        if (attempt === MAX_ATTEMPTS) break;
        const delayMs = Math.min(1_000 * Math.pow(2, attempt - 1), 8_000);
        console.warn(
          `Database connect failed (${(err as Error)?.message ?? err}). Retrying in ${delayMs}ms…`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw lastErr;
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

  get captureEvent() {
    return this.prisma.captureEvent;
  }

  get llcSearch() {
    return this.prisma.llcSearch;
  }

  get llcCharge() {
    return this.prisma.llcCharge;
  }
}
