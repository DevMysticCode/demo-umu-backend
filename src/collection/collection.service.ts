import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const PASSPORT_SELECT = {
  id: true,
  addressLine1: true,
  postcode: true,
  status: true,
  createdAt: true,
  property: { select: { imageUrl: true } },
};

@Injectable()
export class CollectionService {
  constructor(private prisma: PrismaService) {}

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
