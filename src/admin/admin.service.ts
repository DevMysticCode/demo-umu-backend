import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Deletes accounts by email — everything owned by that user (passports,
  // founder number, OTPs, collaborator links, etc.) cascades via the
  // schema's onDelete: Cascade relations on User.
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
}
