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
