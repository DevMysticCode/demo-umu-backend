import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { publicUrlFor, storedFilename } from '../common/storage';
import {
  computeValuation,
  WorkTypeRef,
  DeclaredWork,
  EpcStatus,
  ValuationResult,
} from './truevalue-engine';

export interface SaveValuationDto {
  epcStatus?: EpcStatus;
  isHomeowner?: boolean;
  isLandlord?: boolean;
  purpose?: string;
  foundNextHome?: string;
}

export interface PreviewWorkInput {
  workTypeCode: string;
  verificationState?: 'self' | 'verified'; // preview only ever needs these two
}

@Injectable()
export class TrueValueService {
  constructor(private prisma: PrismaService) {}

  // WorkType catalogue barely changes — cache the active rows in memory
  // rather than hitting the DB on every quiz screen.
  private workTypeCache: any[] | null = null;

  async getWorkTypes() {
    if (!this.workTypeCache) {
      this.workTypeCache = await this.prisma.workType.findMany({
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
      });
    }
    return this.workTypeCache;
  }

  // Stateless, unauthenticated preview — the quiz's intent + improvement-
  // selection steps must work for guests (only evidence upload is gated
  // behind sign-in), so this computes a live estimate from client-supplied
  // selections without touching PropertyWork/ValuationSnapshot at all.
  async previewValuation(propertyId: string, works: PreviewWorkInput[], epcStatus: EpcStatus) {
    const [property, catalogue] = await Promise.all([
      this.prisma.property.findUnique({ where: { id: propertyId } }),
      this.getWorkTypes(),
    ]);
    if (!property) throw new NotFoundException('Property not found');

    const catalogueByCode = new Map(catalogue.map((w) => [w.code, w]));
    const declared: DeclaredWork[] = [];
    const workTypes: WorkTypeRef[] = [];
    for (const w of works) {
      const row = catalogueByCode.get(w.workTypeCode);
      if (!row || !row.active) continue; // silently skip unknown codes rather than 400 mid-quiz
      declared.push({ workTypeCode: w.workTypeCode, verificationState: w.verificationState ?? 'self' });
      workTypes.push(this.toEngineRef(row));
    }

    const baseline = Number(property.estimatedPrice ?? property.lastSoldPrice ?? 0);
    return computeValuation({ baseline, works: declared, workTypes, epcStatus });
  }

  private toEngineRef(row: any): WorkTypeRef {
    return {
      code: row.code,
      category: row.category,
      tier: row.tier,
      upliftLow: row.upliftLow,
      upliftHigh: row.upliftHigh,
      isMinor: row.isMinor,
      epcAssessed: row.epcAssessed,
    };
  }

  async declareWork(propertyId: string, userId: string, workTypeCode: string, installDate?: string) {
    const workType = await this.prisma.workType.findUnique({ where: { code: workTypeCode } });
    if (!workType || !workType.active) {
      throw new BadRequestException(`Unknown work type: ${workTypeCode}`);
    }
    await this.prisma.propertyWork.upsert({
      where: { propertyId_userId_workTypeCode: { propertyId, userId, workTypeCode } },
      create: {
        propertyId,
        userId,
        workTypeCode,
        installDate: installDate ? new Date(installDate) : null,
      },
      update: {
        installDate: installDate ? new Date(installDate) : undefined,
      },
    });
    return this.getWorksWithLive(propertyId, userId);
  }

  async removeWork(workId: string, userId: string) {
    const work = await this.prisma.propertyWork.findUnique({ where: { id: workId } });
    if (!work) throw new NotFoundException('Work not found');
    if (work.userId !== userId) throw new ForbiddenException();
    await this.prisma.propertyWork.delete({ where: { id: workId } });
    return this.getWorksWithLive(work.propertyId, userId);
  }

  async uploadEvidence(workId: string, userId: string, file: any) {
    const work = await this.prisma.propertyWork.findUnique({ where: { id: workId } });
    if (!work) throw new NotFoundException('Work not found');
    if (work.userId !== userId) throw new ForbiddenException();

    const evidenceUrl = publicUrlFor('truevalue-evidence', storedFilename(file));
    await this.prisma.propertyWork.update({
      where: { id: workId },
      data: { evidenceUrl, verificationState: 'pending' },
    });
    return this.getWorksWithLive(work.propertyId, userId);
  }

  // Live (unsaved) recompute — used by the quiz to show a running estimate
  // as the user toggles works, without writing a ValuationSnapshot on
  // every single interaction. Only the final "finish" step persists one.
  private async getWorksWithLive(propertyId: string, userId: string) {
    const works = await this.prisma.propertyWork.findMany({
      where: { propertyId, userId },
      include: { workType: true },
      orderBy: { createdAt: 'asc' },
    });
    const property = await this.prisma.property.findUnique({ where: { id: propertyId } });
    const epcStatus = this.deriveEpcStatus(works, property);
    const live = this.runEngine(works, property, epcStatus);
    return { works, live, epcStatus };
  }

  // Per umu-truevalue-backend-integration.md §5: derive staleness rather
  // than ask. A declared work that affects the EPC (epcAssessed) with an
  // install date AFTER the EPC's lodgement date means the certificate
  // predates the improvement — the energy uplift can't be trusted from it.
  // Falls back to 'none' when there's no EPC on file at all. When install
  // dates are missing on epc-assessed works, returns null so the caller
  // knows to ask the user directly instead of assuming.
  private deriveEpcStatus(works: any[], property: any): EpcStatus | null {
    if (!property?.epcLmkKey || !property?.lodgementDate) return 'none';
    const epcAssessedWorks = works.filter((w) => w.workType?.epcAssessed);
    if (!epcAssessedWorks.length) return 'current';

    const missingDates = epcAssessedWorks.filter((w) => !w.installDate);
    if (missingDates.length) return null; // ask the user

    const lodgementDate = new Date(property.lodgementDate);
    const isStale = epcAssessedWorks.some(
      (w) => new Date(w.installDate) > lodgementDate,
    );
    return isStale ? 'stale' : 'current';
  }

  private runEngine(works: any[], property: any, epcStatus: EpcStatus | null): ValuationResult {
    const baseline = Number(property?.estimatedPrice ?? property?.lastSoldPrice ?? 0);
    const declared: DeclaredWork[] = works.map((w) => ({
      workTypeCode: w.workTypeCode,
      verificationState: w.verificationState,
    }));
    const workTypes: WorkTypeRef[] = works.map((w) => this.toEngineRef(w.workType));
    return computeValuation({
      baseline,
      works: declared,
      workTypes,
      epcStatus: epcStatus ?? 'current', // caller resolves the null/"ask" case before this point for the persisted save
    });
  }

  async saveValuation(propertyId: string, userId: string, dto: SaveValuationDto) {
    const works = await this.prisma.propertyWork.findMany({
      where: { propertyId, userId },
      include: { workType: true },
    });
    const property = await this.prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) throw new NotFoundException('Property not found');

    const derivedEpc = this.deriveEpcStatus(works, property);
    const epcStatus: EpcStatus = dto.epcStatus ?? derivedEpc ?? 'none';

    const result = this.runEngine(works, property, epcStatus);

    const snapshot = await this.prisma.valuationSnapshot.upsert({
      where: { propertyId_userId: { propertyId, userId } },
      create: {
        propertyId,
        userId,
        baseline: Number(property.estimatedPrice ?? property.lastSoldPrice ?? 0),
        estimateLow: result.estimateLow,
        estimateHigh: result.estimateHigh,
        estimatePoint: result.estimatePoint,
        provedCount: result.provedCount,
        scoringCount: result.scoringCount,
        derisked: result.derisked,
        recorded: result.recorded,
        flagged: result.flagged,
        epcSuppressed: result.epcSuppressed,
        contributions: result.contributions as any,
        engineVersion: result.engineVersion,
        inputsHash: result.inputsHash,
        isHomeowner: dto.isHomeowner ?? null,
        isLandlord: dto.isLandlord ?? null,
        purpose: dto.purpose ?? null,
        foundNextHome: dto.foundNextHome ?? null,
      },
      update: {
        baseline: Number(property.estimatedPrice ?? property.lastSoldPrice ?? 0),
        estimateLow: result.estimateLow,
        estimateHigh: result.estimateHigh,
        estimatePoint: result.estimatePoint,
        provedCount: result.provedCount,
        scoringCount: result.scoringCount,
        derisked: result.derisked,
        recorded: result.recorded,
        flagged: result.flagged,
        epcSuppressed: result.epcSuppressed,
        contributions: result.contributions as any,
        engineVersion: result.engineVersion,
        inputsHash: result.inputsHash,
        ...(dto.isHomeowner !== undefined ? { isHomeowner: dto.isHomeowner } : {}),
        ...(dto.isLandlord !== undefined ? { isLandlord: dto.isLandlord } : {}),
        ...(dto.purpose !== undefined ? { purpose: dto.purpose } : {}),
        ...(dto.foundNextHome !== undefined ? { foundNextHome: dto.foundNextHome } : {}),
      },
    });
    return snapshot;
  }

  async getValuation(propertyId: string, userId: string) {
    const [snapshot, works] = await Promise.all([
      this.prisma.valuationSnapshot.findUnique({ where: { propertyId_userId: { propertyId, userId } } }),
      this.prisma.propertyWork.findMany({
        where: { propertyId, userId },
        include: { workType: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return { snapshot, works };
  }

  // Same "prefer the SELLER passport owner's row" resolution as
  // PropertyService.getPublicHomeScore — the canonical figure for a
  // property page is whoever holds its seller passport, not just
  // whoever most recently ran the quiz.
  async getPublicValuation(propertyId: string) {
    const passport = await this.prisma.passport.findFirst({
      where: { propertyId, type: 'SELLER' },
      select: { ownerId: true },
    });
    if (passport?.ownerId) {
      const ownerSnapshot = await this.prisma.valuationSnapshot.findUnique({
        where: { propertyId_userId: { propertyId, userId: passport.ownerId } },
      });
      if (ownerSnapshot) return ownerSnapshot;
    }
    return null;
  }

  // ── Admin review queue (mirrors buyer-profile's exact pattern) ──────────

  async listPendingWorkEvidence() {
    const rows = await this.prisma.propertyWork.findMany({
      where: { verificationState: 'pending' },
      include: { workType: true },
      orderBy: { updatedAt: 'asc' },
    });
    // PropertyWork keeps propertyId/userId as plain strings (no @relation),
    // matching HomeScoreResult's convention — fetch property/user rows
    // separately for display rather than joining.
    const propertyIds = [...new Set(rows.map((r) => r.propertyId))];
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const [properties, users] = await Promise.all([
      this.prisma.property.findMany({
        where: { id: { in: propertyIds } },
        select: { id: true, addressLine1: true, postcode: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
    ]);
    const propertyById = new Map(properties.map((p) => [p.id, p]));
    const userById = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      workId: r.id,
      propertyId: r.propertyId,
      address: propertyById.get(r.propertyId)?.addressLine1,
      postcode: propertyById.get(r.propertyId)?.postcode,
      workLabel: r.workType.label,
      evidenceUrl: r.evidenceUrl,
      declaredBy: userById.get(r.userId),
      createdAt: r.createdAt,
    }));
  }

  async reviewWorkEvidence(workId: string, decision: string) {
    if (!['approve', 'reject'].includes(decision)) {
      throw new BadRequestException('decision must be "approve" or "reject"');
    }
    const work = await this.prisma.propertyWork.findUnique({ where: { id: workId } });
    if (!work) throw new NotFoundException('Work not found');

    const updated = await this.prisma.propertyWork.update({
      where: { id: workId },
      data: { verificationState: decision === 'approve' ? 'verified' : 'rejected' },
    });

    // Recompute the declarer's snapshot if one already exists, so an
    // admin approval is reflected immediately rather than waiting for
    // the user to revisit the quiz.
    const existing = await this.prisma.valuationSnapshot.findUnique({
      where: { propertyId_userId: { propertyId: work.propertyId, userId: work.userId } },
    });
    if (existing) {
      await this.saveValuation(work.propertyId, work.userId, {
        isHomeowner: existing.isHomeowner ?? undefined,
        isLandlord: existing.isLandlord ?? undefined,
        purpose: existing.purpose ?? undefined,
        foundNextHome: existing.foundNextHome ?? undefined,
      });
    }
    return updated;
  }
}
