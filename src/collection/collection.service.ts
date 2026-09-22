import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PassportService } from '../passport/passport.service';

const PASSPORT_SELECT = {
  id: true,
  addressLine1: true,
  postcode: true,
  status: true,
  type: true,
  createdAt: true,
  property: { select: { imageUrl: true } },
};

@Injectable()
export class CollectionService {
  constructor(
    private prisma: PrismaService,
    private passportService: PassportService,
  ) {}

  async getMyCollections(userId: string) {
    // All passports the user owns or collaborates on
    const ownedPassports = await this.prisma.passport.findMany({
      where: { ownerId: userId },
      select: PASSPORT_SELECT,
    });

    const collabItems = await this.prisma.passportCollaborator.findMany({
      where: { userId },
      include: { passport: { select: PASSPORT_SELECT } },
    });

    const allPassports = [...ownedPassports];
    for (const c of collabItems) {
      if (!allPassports.find((p) => p.id === c.passport.id)) {
        allPassports.push(c.passport);
      }
    }

    // Collections
    const collections = await this.prisma.passportCollection.findMany({
      where: { userId },
      include: {
        items: {
          include: { passport: { select: PASSPORT_SELECT } },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const collectedIds = new Set(
      collections.flatMap((c) => c.items.map((i) => i.passportId)),
    );

    const uncollectedPassports = allPassports.filter(
      (p) => !collectedIds.has(p.id),
    );

    return { collections, uncollectedPassports };
  }

  async createCollection(userId: string, name: string) {
    return this.prisma.passportCollection.create({
      data: { name, userId },
    });
  }

  async addToCollection(
    userId: string,
    collectionId: string,
    passportId: string,
  ) {
    const collection = await this.prisma.passportCollection.findUnique({
      where: { id: collectionId },
    });
    if (!collection) throw new NotFoundException('Collection not found');
    if (collection.userId !== userId)
      throw new ForbiddenException('Not your collection');

    // The collection ownership check above only proves the CALLER owns
    // the collection — it never checked the caller has any relationship
    // to the PASSPORT being added, unlike every other module that reads/
    // writes a passport by id. Anyone who obtained a passport UUID (a
    // leaked share link, a screenshot, a log line) could otherwise
    // permanently attach it to their own collection and read its address,
    // status, and type (security review 2026-09-22, M2).
    const hasAccess = await this.passportService.checkUserAccess(passportId, userId);
    if (!hasAccess) {
      throw new ForbiddenException('You do not have access to this passport');
    }

    return this.prisma.passportCollectionItem.upsert({
      where: { collectionId_passportId: { collectionId, passportId } },
      create: { collectionId, passportId },
      update: {},
    });
  }

  async removeFromCollection(
    userId: string,
    collectionId: string,
    passportId: string,
  ) {
    const collection = await this.prisma.passportCollection.findUnique({
      where: { id: collectionId },
    });
    if (!collection) throw new NotFoundException('Collection not found');
    if (collection.userId !== userId)
      throw new ForbiddenException('Not your collection');

    await this.prisma.passportCollectionItem.deleteMany({
      where: { collectionId, passportId },
    });
    return { success: true };
  }

  async deleteCollection(userId: string, collectionId: string) {
    const collection = await this.prisma.passportCollection.findUnique({
      where: { id: collectionId },
    });
    if (!collection) throw new NotFoundException('Collection not found');
    if (collection.userId !== userId)
      throw new ForbiddenException('Not your collection');

    await this.prisma.passportCollection.delete({ where: { id: collectionId } });
    return { success: true };
  }
}
