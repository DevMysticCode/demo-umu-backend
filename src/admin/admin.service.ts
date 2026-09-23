import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Read-only lookup so a bulk delete can be reviewed before it runs — RDS
  // has no other query access from outside the VPC.
  async findUsersByEmailContains(
    substrings: string[],
  ): Promise<Array<{ id: string; email: string; firstName: string | null; lastName: string | null; isVerified: boolean; createdAt: Date }>> {
    return this.prisma.user.findMany({
      where: {
        OR: substrings.map((s) => ({
          email: { contains: s, mode: 'insensitive' as const },
        })),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isVerified: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

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

  // Read-only: every FounderNumber row, for reviewing before a one-off
  // sequence reset — RDS has no other query access from outside the VPC.
  async listFounderNumbers(): Promise<
    Array<{ number: number; userEmail: string; passportId: string; assignedAt: Date }>
  > {
    const rows = await this.prisma.founderNumber.findMany({
      include: { user: { select: { email: true } } },
      orderBy: { number: 'asc' },
    });
    return rows.map((r) => ({
      number: r.number,
      userEmail: r.user.email,
      passportId: r.passportId,
      assignedAt: r.assignedAt,
    }));
  }

  // One-off: wipes every FounderNumber row and restarts the DB-native serial
  // at `restartAt`, so the next assignment is that number. Used once, right
  // after the FounderNumber model moved from one-per-user to
  // one-per-claimed-property, to reset the launch sequence — not meant to be
  // called again afterwards. `confirm` must literally be 'RESET-FOUNDER-SEQ'
  // so this can't be hit by an empty/misrouted POST.
  async resetFounderNumberSequence(
    restartAt: number,
    confirm: string,
  ): Promise<{ deletedRows: number; sequenceRestartedAt: number }> {
    if (confirm !== 'RESET-FOUNDER-SEQ') {
      throw new Error("confirm must be 'RESET-FOUNDER-SEQ'");
    }
    const { count } = await this.prisma.founderNumber.deleteMany({});
    await this.prisma.$executeRawUnsafe(
      `ALTER SEQUENCE "FounderNumber_number_seq" RESTART WITH ${restartAt}`,
    );
    this.logger.log(
      `resetFounderNumberSequence: deleted ${count} rows, restarted sequence at ${restartAt}`,
    );
    return { deletedRows: count, sequenceRestartedAt: restartAt };
  }

  // The only way any account ever becomes an admin — logged so there's an
  // audit trail of who was granted/revoked and when (security review
  // 2026-09-22, M6).
  async setAdminRole(
    email: string,
    isAdmin: boolean,
  ): Promise<{ email: string; isAdmin: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException(`No account found for ${email}`);
    await this.prisma.user.update({ where: { email }, data: { isAdmin } });
    this.logger.warn(`setAdminRole: ${email} isAdmin=${isAdmin}`);
    return { email, isAdmin };
  }
}
