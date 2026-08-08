import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import {
  publicUrlFor,
  storedFilename,
  deleteStoredFile,
  isS3Mode,
} from '../common/storage';
import { computePassportCompletion } from '../common/passport-completion';
import {
  UpdateProfileDto,
  CreateAddressDto,
  UpdateAddressDto,
  CreateCompanyDto,
  UpdateCompanyDto,
  CreateSolicitorDto,
  UpdateSolicitorDto,
  AddCollaboratorDto,
} from './dto/update-profile.dto';

@Injectable()
export class ProfileService {
  constructor(private prisma: PrismaService) {}

  async uploadAvatar(userId: string, file: any, host: string) {
    if (!file) throw new BadRequestException('No file provided');

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Only image files are allowed (jpg, png, webp, gif)');
    }

    // Best-effort delete the previous avatar so we don't accumulate
    // orphaned objects. S3 deletes go through deleteStoredFile (no-op
    // in disk mode); disk deletes use fs.unlinkSync.
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.avatarUrl) {
      if (isS3Mode && user.avatarUrl.includes('/avatars/')) {
        const oldKey = user.avatarUrl.split('/avatars/').pop();
        if (oldKey) {
          try { await deleteStoredFile('avatars', oldKey); } catch { /* ignore */ }
        }
      } else if (user.avatarUrl.startsWith('/uploads/')) {
        const oldPath = join(process.cwd(), user.avatarUrl);
        if (existsSync(oldPath)) {
          try { unlinkSync(oldPath); } catch { /* ignore */ }
        }
      }
    }

    const avatarUrl = publicUrlFor('avatars', storedFilename(file));
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });

    const { password, ...safe } = updated;
    return { ...safe, avatarUrl };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        addresses: { orderBy: { createdAt: 'asc' } },
        companies: { orderBy: { createdAt: 'asc' } },
        solicitors: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!user) throw new NotFoundException('User not found');

    const { password, ...safe } = user;
    return safe;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
    });
    const { password, ...safe } = user;
    return safe;
  }

  // ─── Addresses ────────────────────────────────────────────────────────────

  async createAddress(userId: string, dto: CreateAddressDto) {
    return this.prisma.userAddress.create({
      data: { ...dto, userId },
    });
  }

  async updateAddress(userId: string, addressId: string, dto: UpdateAddressDto) {
    const address = await this.prisma.userAddress.findUnique({ where: { id: addressId } });
    if (!address) throw new NotFoundException('Address not found');
    if (address.userId !== userId) throw new ForbiddenException();

    return this.prisma.userAddress.update({
      where: { id: addressId },
      data: dto,
    });
  }

  async deleteAddress(userId: string, addressId: string) {
    const address = await this.prisma.userAddress.findUnique({ where: { id: addressId } });
    if (!address) throw new NotFoundException('Address not found');
    if (address.userId !== userId) throw new ForbiddenException();

    await this.prisma.userAddress.delete({ where: { id: addressId } });
    return { message: 'Address deleted' };
  }

  // ─── Companies ────────────────────────────────────────────────────────────

  async createCompany(userId: string, dto: CreateCompanyDto) {
    const company = await this.prisma.userCompany.create({
      data: { ...dto, userId },
    });
    return this.verifyCompanyWithCompaniesHouse(company.id);
  }

  async updateCompany(userId: string, companyId: string, dto: UpdateCompanyDto) {
    const company = await this.prisma.userCompany.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    if (company.userId !== userId) throw new ForbiddenException();

    const updated = await this.prisma.userCompany.update({
      where: { id: companyId },
      data: dto,
    });
    // Only re-verify when the number actually changed — avoids hitting
    // Companies House on every unrelated field edit (e.g. director name).
    if (dto.companyNumber && dto.companyNumber !== company.companyNumber) {
      return this.verifyCompanyWithCompaniesHouse(companyId);
    }
    return updated;
  }

  async deleteCompany(userId: string, companyId: string) {
    const company = await this.prisma.userCompany.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    if (company.userId !== userId) throw new ForbiddenException();

    await this.prisma.userCompany.delete({ where: { id: companyId } });
    return { message: 'Company deleted' };
  }

  // Re-check a company's live status against Companies House. Callable
  // directly (POST /profile/company/:id/verify) or triggered internally
  // whenever the company number is set/changed.
  async verifyCompany(userId: string, companyId: string) {
    const company = await this.prisma.userCompany.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    if (company.userId !== userId) throw new ForbiddenException();
    return this.verifyCompanyWithCompaniesHouse(companyId);
  }

  private async verifyCompanyWithCompaniesHouse(companyId: string) {
    const company = await this.prisma.userCompany.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');

    const cleanNumber = (company.companyNumber || '').trim();
    if (!cleanNumber) return company; // nothing to verify yet

    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) {
      // No key configured — leave the company record as-is rather than
      // silently marking it unverifiable. See DEPLOYMENT.md "known gaps".
      return company;
    }

    try {
      const res = await fetch(
        `https://api.company-information.service.gov.uk/company/${encodeURIComponent(cleanNumber)}`,
        {
          headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}` },
          signal: AbortSignal.timeout(8000),
        },
      );

      if (res.status === 404) {
        return this.prisma.userCompany.update({
          where: { id: companyId },
          data: {
            chStatus: null,
            chCompanyName: null,
            chVerifiedAt: new Date(),
            chVerifyError: 'No company found with this number at Companies House',
          },
        });
      }
      if (!res.ok) {
        return this.prisma.userCompany.update({
          where: { id: companyId },
          data: { chVerifiedAt: new Date(), chVerifyError: `Companies House lookup failed (${res.status})` },
        });
      }

      const data = await res.json();
      return this.prisma.userCompany.update({
        where: { id: companyId },
        data: {
          chStatus: data.company_status ?? null,
          chCompanyName: data.company_name ?? null,
          chVerifiedAt: new Date(),
          chVerifyError: null,
        },
      });
    } catch (e: any) {
      return this.prisma.userCompany.update({
        where: { id: companyId },
        data: { chVerifiedAt: new Date(), chVerifyError: `Companies House lookup error: ${String(e?.message ?? e).slice(0, 200)}` },
      }).catch(() => company);
    }
  }

  // ─── Solicitors ───────────────────────────────────────────────────────────

  async createSolicitor(userId: string, dto: CreateSolicitorDto) {
    return this.prisma.userSolicitor.create({
      data: { ...dto, userId },
    });
  }

  async updateSolicitor(userId: string, solicitorId: string, dto: UpdateSolicitorDto) {
    const solicitor = await this.prisma.userSolicitor.findUnique({ where: { id: solicitorId } });
    if (!solicitor) throw new NotFoundException('Solicitor not found');
    if (solicitor.userId !== userId) throw new ForbiddenException();

    return this.prisma.userSolicitor.update({
      where: { id: solicitorId },
      data: dto,
    });
  }

  async deleteSolicitor(userId: string, solicitorId: string) {
    const solicitor = await this.prisma.userSolicitor.findUnique({ where: { id: solicitorId } });
    if (!solicitor) throw new NotFoundException('Solicitor not found');
    if (solicitor.userId !== userId) throw new ForbiddenException();

    await this.prisma.userSolicitor.delete({ where: { id: solicitorId } });
    return { message: 'Solicitor deleted' };
  }

  // ─── Collaborators ────────────────────────────────────────────────────────

  async getUserPassports(userId: string) {
    const passports = await this.prisma.passport.findMany({
      where: { ownerId: userId },
      include: {
        property: true,
        // Sections + their tasks + their questions + answers so we can
        // derive completionPercentage per passport without an N+1 call
        // (the explore card renders "Complete X%" alongside the score
        // gauge). Only the answer.id is needed — presence, not content.
        sections: {
          select: {
            tasks: {
              select: {
                passportQuestions: {
                  select: { answer: { select: { id: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Best-available HomeScore per property — owner's own score first,
    // else the latest published score anyone else has produced. Same
    // preference PropertyService.getPublicHomeScore uses, so both
    // surfaces agree on which number to show.
    //
    // Passport.propertyId is nullable (legacy rows exist without a
    // linked property), so we narrow to non-null explicitly before
    // feeding the array to Prisma's `in` operator. Without the type
    // guard tsc complains that `(string | null)[]` can't satisfy
    // `string[]`.
    const propertyIds = passports
      .map((p) => p.propertyId)
      .filter((id): id is string => !!id);
    const homeScoreRows = propertyIds.length
      ? await this.prisma.homeScoreResult.findMany({
          where: { propertyId: { in: propertyIds } },
          select: { propertyId: true, userId: true, total: true, updatedAt: true },
        })
      : [];
    const homeScoreByProperty = new Map<string, number>();
    for (const p of passports) {
      if (!p.propertyId) continue;
      const forProp = homeScoreRows.filter((r) => r.propertyId === p.propertyId);
      if (!forProp.length) continue;
      const ownerScore = forProp.find((r) => r.userId === p.ownerId);
      const chosen =
        ownerScore ??
        [...forProp].sort(
          (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
        )[0];
      if (chosen) homeScoreByProperty.set(p.propertyId, chosen.total);
    }

    return passports.map((p) => {
      // Completion % — shared with PropertyService.buildPassportProgress()
      // via computePassportCompletion() so both surfaces read the same
      // number off the same rule (see src/common/passport-completion.ts).
      const { completionPct: completionPercentage } = computePassportCompletion(
        p.sections,
      );

      // Prefer a saved HomeScore, else fall back to the property's
      // stored epcScore (same precedence PropertyService.searchProperties
      // uses on the search dropdown). Sellers who haven't run the quiz
      // still see a meaningful number based on their EPC certificate
      // rather than a dash — because for most properties the EPC score
      // IS a reasonable proxy for the HomeScore they'd get.
      const savedScore = p.propertyId
        ? (homeScoreByProperty.get(p.propertyId) ?? null)
        : null;
      const fallbackEpc =
        p.property && typeof p.property.epcScore === 'number'
          ? p.property.epcScore
          : null;

      return {
        id: p.id,
        addressLine1: p.addressLine1,
        postcode: p.postcode,
        address: p.property
          ? [p.property.addressLine1, p.property.addressLine2, p.property.city].filter(Boolean).join(', ')
          : p.addressLine1,
        // Score gauge on the explore summary card. Null when there's
        // no saved HomeScore AND no EPC score on file — the gauge
        // then renders a dash.
        homeScore: savedScore ?? fallbackEpc,
        // Progress on filling out the passport itself. Separate metric
        // from HomeScore; drives the "Complete X%" line below the
        // gauge.
        completionPercentage,
      };
    });
  }

  async searchUsers(query: string, currentUserId: string) {
    if (!query || query.trim().length < 2) return [];

    const users = await this.prisma.user.findMany({
      where: {
        AND: [
          { id: { not: currentUserId } },
          {
            OR: [
              { email: { contains: query, mode: 'insensitive' } },
              { firstName: { contains: query, mode: 'insensitive' } },
              { lastName: { contains: query, mode: 'insensitive' } },
            ],
          },
        ],
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
      },
      take: 10,
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
      avatarUrl: u.avatarUrl,
    }));
  }

  async getCollaborators(userId: string) {
    const rows = await this.prisma.userCollaborator.findMany({
      where: { userId },
      include: {
        collaborator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const hasAll = rows.some((r) => r.permission === 'all');
    const ownerPassportCount = hasAll
      ? await this.prisma.passport.count({ where: { ownerId: userId } })
      : 0;

    return rows.map((r) => {
      let propertyCount = 0;
      if (r.permission === 'all') {
        propertyCount = ownerPassportCount;
      } else if (r.permission === 'specific' && Array.isArray(r.propertyIds)) {
        propertyCount = (r.propertyIds as string[]).length;
      }

      return {
        id: r.id,
        collaboratorId: r.collaborator.id,
        name: [r.collaborator.firstName, r.collaborator.lastName].filter(Boolean).join(' ') || r.collaborator.email,
        email: r.collaborator.email,
        avatarUrl: r.collaborator.avatarUrl,
        role: r.role,
        permission: r.permission,
        propertyIds: r.propertyIds ?? [],
        propertyCount,
        accessDuration: r.accessDuration,
        expiresAt: r.expiresAt,
        clientAccess: r.clientAccess,
        allowComms: r.allowComms,
        addedAt: r.createdAt,
      };
    });
  }

  async getCollaborator(userId: string, collaboratorRowId: string) {
    const row = await this.prisma.userCollaborator.findUnique({
      where: { id: collaboratorRowId },
      include: {
        collaborator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true,
            createdAt: true,
          },
        },
      },
    });

    if (!row) throw new NotFoundException('Collaborator not found');
    if (row.userId !== userId) throw new ForbiddenException();

    let sharedPassports: { id: string; addressLine1: string; postcode: string; address: string }[] = [];

    if (row.permission === 'all') {
      const passports = await this.prisma.passport.findMany({
        where: { ownerId: userId },
        include: { property: true },
        orderBy: { createdAt: 'asc' },
      });
      sharedPassports = passports.map((p) => ({
        id: p.id,
        addressLine1: p.addressLine1,
        postcode: p.postcode,
        address: p.property
          ? [p.property.addressLine1, p.property.addressLine2, p.property.city].filter(Boolean).join(', ')
          : p.addressLine1,
      }));
    } else if (row.permission === 'specific' && Array.isArray(row.propertyIds) && (row.propertyIds as string[]).length > 0) {
      const passports = await this.prisma.passport.findMany({
        where: { id: { in: row.propertyIds as string[] }, ownerId: userId },
        include: { property: true },
        orderBy: { createdAt: 'asc' },
      });
      sharedPassports = passports.map((p) => ({
        id: p.id,
        addressLine1: p.addressLine1,
        postcode: p.postcode,
        address: p.property
          ? [p.property.addressLine1, p.property.addressLine2, p.property.city].filter(Boolean).join(', ')
          : p.addressLine1,
      }));
    }

    return {
      id: row.id,
      collaboratorId: row.collaborator.id,
      name: [row.collaborator.firstName, row.collaborator.lastName].filter(Boolean).join(' ') || row.collaborator.email,
      email: row.collaborator.email,
      avatarUrl: row.collaborator.avatarUrl,
      joinedAt: row.collaborator.createdAt,
      role: row.role,
      permission: row.permission,
      propertyIds: row.propertyIds ?? [],
      accessDuration: row.accessDuration,
      expiresAt: row.expiresAt,
      clientAccess: row.clientAccess,
      allowComms: row.allowComms,
      addedAt: row.createdAt,
      sharedPassports,
    };
  }

  async addCollaborator(userId: string, dto: AddCollaboratorDto) {
    if (dto.collaboratorId === userId) {
      throw new ConflictException('Cannot add yourself as a collaborator');
    }

    const target = await this.prisma.user.findUnique({ where: { id: dto.collaboratorId } });
    if (!target) throw new NotFoundException('User not found');

    const existing = await this.prisma.userCollaborator.findUnique({
      where: { userId_collaboratorId: { userId, collaboratorId: dto.collaboratorId } },
    });
    if (existing) throw new ConflictException('User is already a collaborator');

    const row = await this.prisma.userCollaborator.create({
      data: {
        userId,
        collaboratorId: dto.collaboratorId,
        role: dto.role,
        permission: dto.permission ?? 'all',
        propertyIds: dto.propertyIds ?? [],
        accessDuration: dto.accessDuration ?? 'permanent',
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        clientAccess: dto.clientAccess ?? 'shared',
        allowComms: dto.allowComms ?? true,
      },
      include: {
        collaborator: {
          select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true },
        },
      },
    });

    return {
      id: row.id,
      collaboratorId: row.collaborator.id,
      name: [row.collaborator.firstName, row.collaborator.lastName].filter(Boolean).join(' ') || row.collaborator.email,
      email: row.collaborator.email,
      avatarUrl: row.collaborator.avatarUrl,
      role: row.role,
      permission: row.permission,
      propertyIds: row.propertyIds ?? [],
      accessDuration: row.accessDuration,
      expiresAt: row.expiresAt,
      clientAccess: row.clientAccess,
      allowComms: row.allowComms,
      addedAt: row.createdAt,
    };
  }

  async removeCollaborator(userId: string, collaboratorRowId: string) {
    const row = await this.prisma.userCollaborator.findUnique({ where: { id: collaboratorRowId } });
    if (!row) throw new NotFoundException('Collaborator not found');
    if (row.userId !== userId) throw new ForbiddenException();

    await this.prisma.userCollaborator.delete({ where: { id: collaboratorRowId } });
    return { message: 'Collaborator removed' };
  }

  // ─── Preferences ──────────────────────────────────────────────────────────

  async getPreferences(userId: string) {
    const pref = await this.prisma.userPreference.findUnique({ where: { userId } });
    return pref ?? null;
  }

  async upsertPreferences(userId: string, dto: any) {
    return this.prisma.userPreference.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
  }

  async deleteAccount(userId: string) {
    // Deleting the User cascades all related data: passports, sections, tasks,
    // questions, answers, collaborators, documents, preferences, addresses, etc.
    await this.prisma.user.delete({ where: { id: userId } });
    return { message: 'Account deleted' };
  }

  // "Download your data" (Settings → Privacy & data) — was a dead button
  // with no handler at all. Exports the user's own profile + the data
  // they directly own, as one JSON document. Deliberately excludes
  // `password` (hash) and other users' data (e.g. a collaborator's own
  // profile, a buyer who unlocked one of this user's passports).
  async exportData(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        addresses: true,
        companies: true,
        solicitors: true,
        preference: true,
        passports: {
          include: {
            sections: {
              include: {
                tasks: {
                  include: {
                    passportQuestions: {
                      include: { answer: true, questionTemplate: true },
                    },
                  },
                },
              },
            },
          },
        },
        userDocuments: true,
        reminders: true,
        buyerNotes: true,
        buyerPassportAccesses: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const { password: _password, ...safeUser } = user as any;
    const [buyerProfile, homeScores] = await Promise.all([
      this.prisma.buyerProfile.findUnique({ where: { userId } }),
      this.prisma.homeScoreResult.findMany({ where: { userId } }),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      user: safeUser,
      buyerProfile,
      homeScores,
    };
  }
}
