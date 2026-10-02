import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { Resend } from 'resend';
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
  UpsertInterestDto,
} from './dto/update-profile.dto';

// Kept in sync with the website's INTEREST_OPTIONS
// (umu-website-integration/composables/useInterests.ts) — only used to
// turn the stored ids into readable text for the confirmation email.
const INTEREST_LABELS: Record<string, string> = {
  buying: 'Buying a home',
  renting: 'Renting a home',
  owning: 'Owning a home',
  letting: 'Letting a property',
  understanding: 'Understanding homes and Passports',
  exploring: 'Just exploring',
};

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
      // PENDING_PAYMENT rows have no type and no seeded sections yet (a
      // property claim takes payment before the owner picks seller/
      // landlord - see Passport.type's own schema comment), so they must
      // never be the dashboard's "main passport" pick. Before this filter,
      // an abandoned/incomplete claim being the most-recently-created
      // passport would outrank a user's real, completed passport whenever
      // they had no SELLER-typed one yet (dashboard.vue falls back to
      // "all" passports, index 0, when its own seller-type filter finds
      // none) - landing them on a sectionless passportview page with no
      // explanation. Found via a real user report, 2 Oct 2026.
      where: { ownerId: userId, status: { not: 'PENDING_PAYMENT' } },
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
      // Most-recently-acted-on passport first, so index 0 is the one the
      // seller's dashboard summary card should show. lastVisitedAt is the
      // same field the resume flow already uses to track activity;
      // passports nobody has resumed yet fall back to creation order.
      orderBy: [
        { lastVisitedAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
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
        propertyId: p.propertyId,
        addressLine1: p.addressLine1,
        postcode: p.postcode,
        address: p.property
          ? [p.property.addressLine1, p.property.addressLine2, p.property.city].filter(Boolean).join(', ')
          : p.addressLine1,
        type: p.type,
        status: p.status,
        // Score gauge on the explore summary card. Null when there's
        // no saved HomeScore AND no EPC score on file — the gauge
        // then renders a dash.
        homeScore: savedScore ?? fallbackEpc,
        // "Potential" HomeScore doesn't exist as its own concept yet —
        // reuses the EPC certificate's post-improvement score, same
        // precedent as the homeScore fallback above.
        homeScorePotential: p.property?.epcScorePotential ?? null,
        // Progress on filling out the passport itself. Separate metric
        // from HomeScore; drives the "Complete X%" line below the
        // gauge.
        completionPercentage,
        // Real timestamps (not a fabricated deadline — there isn't one)
        // for the dashboard's "Started/last touched N days ago" staleness
        // nudge on the Next For You card.
        createdAt: p.createdAt,
        lastVisitedAt: p.lastVisitedAt,
      };
    });
  }

  // Get-or-assign the Founding Homeowner number for ONE CLAIMED PROPERTY
  // (not the user overall) - a user who claims a second property earns a
  // second certificate with its own number, not the same one again.
  // `number` is a DB-native serial (prisma/schema.prisma
  // FounderNumber.number @default(autoincrement())), so this is safe
  // under concurrent first requests for the same passport without any
  // app-level lock: the unique constraint on passportId just makes the
  // loser of a create-race re-read the winner's row instead of erroring
  // out to the caller.
  async getOrAssignFounderNumber(userId: string, passportId: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      select: { ownerId: true },
    });
    if (!passport) throw new NotFoundException('Passport not found');
    if (passport.ownerId !== userId) {
      throw new ForbiddenException('You do not own this passport');
    }

    const existing = await this.prisma.founderNumber.findUnique({
      where: { passportId },
    });
    // isNew tells the caller (the website) whether this is the very first
    // time THIS PROPERTY has asked for a number - that's the one moment
    // it should fire the "here's your certificate" email, rather than
    // re-sending it on every subsequent /certificate page view.
    if (existing) return { ...existing, isNew: false };

    try {
      const created = await this.prisma.founderNumber.create({
        data: { userId, passportId },
      });
      return { ...created, isNew: true };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Another concurrent request for the same passport won the race.
        const record = await this.prisma.founderNumber.findUnique({
          where: { passportId },
        });
        if (record) return { ...record, isNew: false };
      }
      throw err;
    }
  }

  private readonly certificateResend = new Resend(process.env.RESEND_API_KEY);
  private readonly certificateFrom =
    process.env.RESEND_FROM ?? 'UMovingU <info@umovingu.io>';

  // Emails the already-rendered certificate JPEG (base64, no data: URL
  // prefix) to the user's own registered address. Rendering itself stays
  // on the website (fonts + template artwork live there) - this only
  // owns "look up the address, send it."
  async emailFounderCertificate(userId: string, imageBase64: string) {
    if (!imageBase64) {
      throw new BadRequestException('imageBase64 is required');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true },
    });
    if (!user?.email) throw new NotFoundException('User not found');

    const firstName = user.firstName?.trim() || 'there';
    const result = await this.certificateResend.emails.send({
      from: this.certificateFrom,
      to: [user.email],
      subject: 'Your Founding Homeowner certificate',
      html: `
        <p>Hi ${firstName},</p>
        <p>You've claimed your property with Umovingu. Welcome to the
        Founding Homeowners Movement.</p>
        <p>Your certificate is attached. It marks your place among the
        homeowners helping us build a better way to understand, manage and
        share information about our homes.</p>
        <p>We started this movement because homeowners should own their
        property information, and nobody should have to buy a home blind.
        Every property claimed helps bring us closer to a network built
        around the people who live in homes, rather than information
        scattered across the moving process.</p>
        <p>As a Founding Homeowner, you'll have free access to Umovingu's
        core platform for life. If you choose a service that carries a
        third party cost, we'll show you that cost before you decide to
        use it. You'll also be invited to share your experience and help
        shape what we build next.</p>
        <p>This is the start of your home's story with Umovingu, and we're
        glad you're part of it.</p>
        <p><em>You own the home. Own its story.</em></p>
        <p>Maxine Wilson<br/>Founder and CEO, Umovingu</p>
      `,
      attachments: [
        {
          filename: 'umovingu-founding-homeowner-certificate.jpg',
          content: imageBase64,
        },
      ],
    });
    // Same rationale as auth.service.ts's OTP email: Resend's SDK returns
    // { data, error } rather than throwing for API-level rejections, so
    // this has to be checked explicitly or a rejected send looks
    // identical to a successful one.
    if (result.error) {
      throw new BadRequestException(
        `Could not send certificate email: ${result.error.message}`,
      );
    }
    return { sent: true };
  }

  async getInterest(userId: string) {
    return this.prisma.userInterest.findUnique({ where: { userId } });
  }

  // "What brings you to Umovingu?" onboarding step (and its "Manage
  // Interests" edit from the member hub) — upserts one row per user and,
  // if they've opted in, emails a confirmation in the same voice as the
  // Founding Homeowner certificate email, on both first registration and
  // later edits (client request, 2026-09-30).
  async upsertInterest(userId: string, dto: UpsertInterestDto) {
    const existing = await this.prisma.userInterest.findUnique({ where: { userId } });

    const record = await this.prisma.userInterest.upsert({
      where: { userId },
      create: {
        userId,
        interestIds: dto.interestIds,
        areas: dto.areas,
        emailOptIn: dto.emailOptIn,
      },
      update: {
        interestIds: dto.interestIds,
        areas: dto.areas,
        emailOptIn: dto.emailOptIn,
      },
    });

    // This confirmation is a one-time "we've got it" acknowledgement, not
    // the ongoing feature-update emails dto.emailOptIn actually controls
    // (its checkbox reads "Email me when features related to my interests
    // become available", defaults unchecked, and almost nobody ticks it) -
    // gating the confirmation behind that opt-in meant registering or
    // updating interests silently sent no email at all for most users.
    // Always send it; the save itself already succeeded at this point, so
    // don't fail the whole request (and mislead the UI into thinking
    // nothing was saved) just because the confirmation email didn't go out.
    try {
      await this.emailInterestConfirmation(userId, dto, existing ? 'updated' : 'registered');
    } catch (err) {
      console.error('[interests] confirmation email failed:', err);
    }

    return record;
  }

  private async emailInterestConfirmation(
    userId: string,
    dto: UpsertInterestDto,
    kind: 'registered' | 'updated',
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true },
    });
    if (!user?.email) return;

    const firstName = user.firstName?.trim() || 'there';
    const interestText =
      dto.interestIds.map((id) => INTEREST_LABELS[id] ?? id).join(', ') || 'exploring Umovingu';
    const areaText = dto.areas.length ? dto.areas.join(', ') : null;
    const subject =
      kind === 'registered' ? "We've got your interest, thanks!" : 'Your interests have been updated';
    const intro =
      kind === 'registered'
        ? "Thanks for registering your interest with Umovingu. We've noted what brings you here so we can keep you posted on the right things."
        : "You've updated your interests with Umovingu — here's what we now have on file for you.";

    const result = await this.certificateResend.emails.send({
      from: this.certificateFrom,
      to: [user.email],
      subject,
      html: `
        <p>Hi ${firstName},</p>
        <p>${intro}</p>
        <p>You told us you're interested in: <strong>${interestText}</strong>.${
          areaText ? ` You're keeping an eye on: <strong>${areaText}</strong>.` : ''
        }</p>
        <p>We started Umovingu because homeowners should own their property
        information, and nobody should have to buy a home blind. Every
        person who joins us helps bring us closer to a network built
        around the people who live in homes, rather than information
        scattered across the moving process.</p>
        <p>We'll be in touch as we build the things that matter most to
        you. You can update your interests at any time from your account.</p>
        <p><em>You own the home. Own its story.</em></p>
        <p>Maxine Wilson<br/>Founder and CEO, Umovingu</p>
      `,
    });
    if (result.error) {
      throw new BadRequestException(
        `Could not send interest confirmation email: ${result.error.message}`,
      );
    }
    return { sent: true };
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
      // Masked, not the full address - enough for the caller to confirm
      // "yes, that's the person I meant to invite" without this search
      // doubling as an email-harvesting tool for every match it returns
      // (security review 2026-09-22, L2).
      email: this.maskEmail(u.email),
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || this.maskEmail(u.email),
      avatarUrl: u.avatarUrl,
    }));
  }

  // "al**@gm**.com" - keeps the first 2 chars of the local part and the
  // domain's TLD/structure recognisable (so a real collaborator search
  // still looks trustworthy) without disclosing the full address.
  private maskEmail(email: string): string {
    const at = email.indexOf('@');
    if (at <= 0) return email;
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    const maskedLocal =
      local.length <= 2 ? local[0] + '*' : local.slice(0, 2) + '*'.repeat(Math.min(local.length - 2, 4));
    const dotIndex = domain.lastIndexOf('.');
    const maskedDomain =
      dotIndex > 0
        ? domain.slice(0, Math.min(2, dotIndex)) + '*'.repeat(Math.max(dotIndex - 2, 1)) + domain.slice(dotIndex)
        : domain;
    return `${maskedLocal}@${maskedDomain}`;
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
