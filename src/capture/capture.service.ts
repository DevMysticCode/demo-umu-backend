import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CaptureEventInput {
  type: 'grant_check' | 'match_request' | 'early_access';
  source: string;
  propertyId?: string | null;
  postcode?: string | null;
  contact?: {
    name?: string | null;
    contact?: string | null;
    consentToContact?: boolean;
  } | null;
  data: Record<string, unknown>;
}

/**
 * Demand-capture stream for Phase 1 — while the marketplace isn't
 * shipped we still collect enough signal from the installer flow to
 * know which postcodes / trades to onboard first.
 *
 * The three producers (grant_check, match_request, early_access) all
 * write into one row shape so the future "marketplace demand"
 * dashboard reads a single stream.
 */
@Injectable()
export class CaptureService {
  private readonly logger = new Logger(CaptureService.name);
  constructor(private prisma: PrismaService) {}

  async record(userId: string | null, input: CaptureEventInput) {
    // Bare-minimum trust: normalise the type so a malformed client
    // can't inject arbitrary strings that later dashboards would trip
    // over. Everything else is a JSON blob that downstream owns.
    if (!['grant_check', 'match_request', 'early_access'].includes(input.type)) {
      throw new Error(`unknown capture type: ${input.type}`);
    }
    const row = await this.prisma.captureEvent.create({
      data: {
        type: input.type,
        source: input.source ?? 'unknown',
        userId,
        propertyId: input.propertyId ?? null,
        postcode: (input.postcode ?? '').toUpperCase().trim() || null,
        contact: input.contact ? (input.contact as any) : undefined,
        data: input.data as any,
      },
      select: { id: true, createdAt: true },
    });
    this.logger.log(
      `[capture] ${input.type} from ${input.source} by ${userId ?? 'anonymous'} — ${row.id}`,
    );
    return row;
  }
}
