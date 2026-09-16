import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async clearPexelsImages(): Promise<{ updated: number }> {
    const result = await this.prisma.property.updateMany({
      where: { imageUrl: { contains: 'pexels' } },
      data: { imageUrl: null },
    });
    this.logger.log(`Cleared Pexels imageUrl for ${result.count} properties`);
    return { updated: result.count };
  }

  async deleteAllPassports(): Promise<{ deleted: number }> {
    const result = await this.prisma.passport.deleteMany({});
    this.logger.log(`Deleted ${result.count} Passport records`);
    return { deleted: result.count };
  }

  async deleteAllProperties(): Promise<{ deleted: number }> {
    const result = await this.prisma.property.deleteMany({});
    this.logger.log(`Deleted ${result.count} Property records`);
    return { deleted: result.count };
  }

  // Deletes accounts by email — everything owned by that user (passports,
  // founder number, OTPs, collaborator links, etc.) cascades via the
  // schema's onDelete: Cascade relations on User. Used for cleaning up
  // test/scratch accounts created while testing a live environment
  // directly (RDS/Railway aren't otherwise reachable from a laptop).
  async deleteUsersByEmail(
    emails: string[],
  ): Promise<{ deleted: string[]; notFound: string[] }> {
    const deleted: string[] = [];
    const notFound: string[] = [];
    for (const email of emails) {
      const user = await this.prisma.user.findUnique({ where: { email } });
      if (!user) {
        notFound.push(email);
        continue;
      }
      await this.prisma.user.delete({ where: { id: user.id } });
      deleted.push(email);
    }
    this.logger.log(
      `deleteUsersByEmail: deleted ${deleted.length}, not found ${notFound.length}`,
    );
    return { deleted, notFound };
  }

  async nukeAll(): Promise<{ passportsDeleted: number; propertiesDeleted: number }> {
    // Must delete passports first — Passport has FK to Property with no cascade on property side
    const passports = await this.prisma.passport.deleteMany({});
    this.logger.log(`Deleted ${passports.count} Passport records`);

    const properties = await this.prisma.property.deleteMany({});
    this.logger.log(`Deleted ${properties.count} Property records`);

    return {
      passportsDeleted: passports.count,
      propertiesDeleted: properties.count,
    };
  }
}
