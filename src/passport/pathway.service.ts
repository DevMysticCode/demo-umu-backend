import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PassportEventsService } from './passport-events.service';
import { PassportEventType } from './passport-event-types';
import { publicUrlFor, storedFilename, isS3Mode } from '../common/storage';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';

interface PathwayStepOption {
  label: string;
  next: string;
  requiresUpload?: boolean;
}

interface PathwayStep {
  id: string;
  kind: string;
  title: string;
  body: string;
  time?: string | null;
  cost?: string | null;
  warning?: string | null;
  options: PathwayStepOption[];
}

const OUTCOME_KEYS = ['RESOLVED', 'CHECK', 'FLAG', 'ESCALATE'];
const SEVERITY_ORDER: Record<string, number> = { ESCALATE: 0, FLAG: 1, CHECK: 2 };

function normaliseAnswer(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

/**
 * Resolution-pathways engine (client handoff, 2026-09-29 — see
 * prisma/content/source/ and src/scripts/import-passport-content.ts for
 * where the content itself comes from). This service is the generic
 * evaluator over that content; it never hard-codes a specific pathway.
 *
 * Two entry points into a pathway:
 *  - checkTriggersForAnswer(): called after a passport question is answered
 *    (see QuestionService.answerQuestion) - opens a journey when the answer
 *    matches a PathwayQuestionLink.triggerAnswer for a question this
 *    passport's answer maps to.
 *  - advanceJourney(): called as the homeowner works through an already-open
 *    journey's steps.
 *
 * All content matching here (trigger-answer text, step option labels) is
 * best-effort exact/case-insensitive string matching against the client's
 * source wording - most passport questions aren't wired to a live
 * QuestionSourceMapping yet (see the import script's coverage numbers), so
 * this quietly no-ops for anything unmapped rather than erroring.
 */
@Injectable()
export class PathwayService {
  constructor(
    private prisma: PrismaService,
    private events: PassportEventsService,
  ) {}

  // ─── Trigger detection (called from QuestionService.answerQuestion) ──────

  async checkTriggersForAnswer(
    passportId: string,
    questionTemplateId: string,
    answerValue: unknown,
    actorId: string,
  ): Promise<void> {
    // One live MULTIPART question's template id can carry several source
    // paragraphs at once (its own parent question plus any child prompts
    // nested inside it, e.g. "building_works" is both source 207 and its
    // glazing child, source 212) - check every mapping onto this template,
    // not just the first one, or a child prompt's trigger is silently
    // shadowed by its parent's.
    const mappings = await this.prisma.questionSourceMapping.findMany({
      where: { liveQuestionTemplateId: questionTemplateId },
    });
    if (!mappings.length) return; // question not yet mapped to source content - nothing to do

    const links = await this.prisma.pathwayQuestionLink.findMany({
      where: {
        OR: mappings.flatMap((mapping) =>
          [
            mapping.sourceQuestionId != null ? { sourceQuestionId: mapping.sourceQuestionId } : undefined,
            { sourceParagraph: mapping.sourceParagraph },
          ].filter(Boolean),
        ) as any,
      },
    });
    if (!links.length) return;

    // A MULTIPART question's answerJson is an object keyed by partKey (e.g.
    // { Are_irregular_boundaries: 'yes', photos: '...' }) - the trigger lives
    // on one specific part, not the whole object, so check every part value
    // as well as the whole answer stringified (for RADIO/simple questions).
    // A DATE part nests further as { value, date } (see the frontend's own
    // auto-save extraction) - unwrap that one extra level too.
    const candidates = [normaliseAnswer(answerValue)];
    if (answerValue && typeof answerValue === 'object' && !Array.isArray(answerValue)) {
      for (const v of Object.values(answerValue as Record<string, unknown>)) {
        candidates.push(normaliseAnswer(v));
        if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as Record<string, unknown>)) {
          candidates.push(normaliseAnswer((v as Record<string, unknown>).value));
        }
      }
    }

    for (const link of links) {
      const matches = candidates.includes(normaliseAnswer(link.triggerAnswer));
      if (matches) {
        await this.startPathwayJourney(passportId, link.pathwayId, questionTemplateId, actorId);
        continue;
      }
      // The homeowner changed this answer away from the value that opened
      // this pathway (e.g. Yes -> No) - the journey it opened no longer
      // applies, so close it rather than leaving a stale, no-longer-relevant
      // flow that a later page visit would otherwise keep resurfacing.
      const stale = await this.prisma.pathwayJourney.findFirst({
        where: { passportId, pathwayId: link.pathwayId, triggerQuestionTemplateId: questionTemplateId, status: 'IN_PROGRESS' },
      });
      if (!stale) continue;
      await this.prisma.pathwayJourney.delete({ where: { id: stale.id } });
      await this.events.logEvent({
        passportId,
        eventType: PassportEventType.PATHWAY_OUTCOME_REACHED,
        actorType: 'OWNER',
        actorId,
        entityType: 'PATHWAY_JOURNEY',
        entityId: stale.id,
        sourceType: 'OWNER_INPUT',
        visibilityClass: 'OWNER_ONLY',
        metadata: { pathwayId: link.pathwayId, closedReason: 'trigger_answer_changed' },
      });
    }
  }

  // ─── Journeys ──────────────────────────────────────────────────────────

  async startPathwayJourney(
    passportId: string,
    pathwayId: string,
    triggerQuestionTemplateId: string | null,
    actorId: string,
  ) {
    const existing = await this.prisma.pathwayJourney.findFirst({
      where: { passportId, pathwayId, status: 'IN_PROGRESS' },
    });
    if (existing) return existing;

    const pathway = await this.prisma.resolutionPathway.findUnique({ where: { id: pathwayId } });
    if (!pathway) throw new NotFoundException(`Pathway ${pathwayId} not found`);

    const journey = await this.prisma.pathwayJourney.create({
      data: {
        passportId,
        pathwayId,
        triggerQuestionTemplateId,
        contentVersion: pathway.contentVersion,
        currentStepId: pathway.startStep,
        stepAnswers: [],
        status: 'IN_PROGRESS',
      },
    });

    await this.events.logEvent({
      passportId,
      eventType: PassportEventType.PATHWAY_STARTED,
      actorType: 'SYSTEM',
      actorId,
      entityType: 'PATHWAY_JOURNEY',
      entityId: journey.id,
      sourceType: 'SYSTEM',
      visibilityClass: 'OWNER_ONLY',
      metadata: { pathwayId, pathwayName: pathway.name },
    });

    return journey;
  }

  async getJourney(passportId: string, journeyId: string, userId: string) {
    await this.assertAccess(passportId, userId);
    const journey = await this.prisma.pathwayJourney.findUnique({ where: { id: journeyId } });
    if (!journey || journey.passportId !== passportId) throw new NotFoundException('Journey not found');
    const pathway = await this.prisma.resolutionPathway.findUnique({ where: { id: journey.pathwayId } });
    return { journey, pathway };
  }

  async listJourneys(passportId: string, userId: string) {
    await this.assertAccess(passportId, userId);
    return this.prisma.pathwayJourney.findMany({ where: { passportId }, orderBy: { startedAt: 'desc' } });
  }

  async advanceJourney(
    passportId: string,
    journeyId: string,
    stepId: string,
    answerLabel: string,
    userId: string,
    evidenceFileUrls?: string[],
  ) {
    await this.assertAccess(passportId, userId);
    const journey = await this.prisma.pathwayJourney.findUnique({ where: { id: journeyId } });
    if (!journey || journey.passportId !== passportId) throw new NotFoundException('Journey not found');

    const pathway = await this.prisma.resolutionPathway.findUnique({ where: { id: journey.pathwayId } });
    if (!pathway) throw new NotFoundException('Pathway not found');
    const steps = pathway.steps as unknown as PathwayStep[];
    const step = steps.find((s) => s.id === stepId);
    if (!step) throw new NotFoundException('Step not found in pathway content');
    const option = step.options.find((o) => o.label === answerLabel);
    if (!option) throw new BadRequestException('That answer is not valid for this step');
    if (option.requiresUpload && !evidenceFileUrls?.length) {
      throw new BadRequestException('This answer requires at least one uploaded file or photo');
    }

    const existingAnswers = Array.isArray(journey.stepAnswers) ? (journey.stepAnswers as any[]) : [];
    const priorIndex = existingAnswers.findIndex((a) => a.stepId === stepId);
    const newAnswer = { stepId, answerLabel, evidenceFileUrls: evidenceFileUrls ?? [], timestamp: new Date().toISOString() };

    let stepAnswers: any[];
    if (journey.status === 'IN_PROGRESS' && journey.currentStepId === stepId) {
      // The ordinary case: answering the one step the journey is waiting on.
      stepAnswers = [...existingAnswers, newAnswer];
    } else if (priorIndex !== -1) {
      // Editing an earlier step, exactly as the source prototype allows -
      // every prior prompt in its flow stays clickable, and picking a
      // different answer there supersedes whatever was answered after it
      // (the guide's own "supersede downstream on upstream change" rule).
      // This also lets a homeowner reopen a journey that already reached an
      // outcome, by changing an earlier answer.
      stepAnswers = [...existingAnswers.slice(0, priorIndex), newAnswer];
    } else {
      throw new BadRequestException('That step has not been reached in this journey yet');
    }

    let update: any = { stepAnswers };

    if (OUTCOME_KEYS.includes(option.next)) {
      update = {
        ...update,
        status: option.next,
        currentStepId: stepId,
        completedAt: new Date(),
      };
    } else if (/^P\d+$/.test(option.next)) {
      // Cross-pathway link (e.g. P33 -> P36): this journey resolves into a
      // new one, per the handoff's "run them one after another" instruction.
      update = { ...update, status: 'RESOLVED', currentStepId: stepId, completedAt: new Date() };
      await this.startPathwayJourney(passportId, option.next, journey.triggerQuestionTemplateId, userId);
    } else {
      const nextStep = steps.find((s) => s.id === option.next);
      if (!nextStep) throw new BadRequestException(`Pathway content error: unknown next step "${option.next}"`);
      update = { ...update, currentStepId: option.next, status: 'IN_PROGRESS', completedAt: null };
    }

    const updated = await this.prisma.pathwayJourney.update({ where: { id: journeyId }, data: update });

    await this.events.logEvent({
      passportId,
      eventType: OUTCOME_KEYS.includes(option.next)
        ? PassportEventType.PATHWAY_OUTCOME_REACHED
        : PassportEventType.PATHWAY_STEP_ANSWERED,
      actorType: 'OWNER',
      actorId: userId,
      entityType: 'PATHWAY_JOURNEY',
      entityId: journeyId,
      sourceType: 'OWNER_INPUT',
      visibilityClass: 'OWNER_ONLY',
      correlationId: journeyId,
      afterRef: { stepId, answerLabel, next: option.next },
    });

    return updated;
  }

  // Stores a piece of pathway-step evidence (private bucket, same pattern
  // as question uploads) and hands back its URL - the caller then includes
  // it in the advanceJourney() call for the step it belongs to.
  async uploadEvidence(passportId: string, userId: string, file: any) {
    if (!file) throw new BadRequestException('No file provided');
    await this.assertAccess(passportId, userId);
    const relative = publicUrlFor('pathway-evidence', storedFilename(file));
    const fileUrl = isS3Mode ? relative : `${BASE_URL}${relative}`;
    return { fileUrl, fileName: file.originalname };
  }

  // "I'll do this later" - saves progress, sets status to CHECK, returns to
  // the same step next time (per the handoff's own wording).
  async deferJourney(passportId: string, journeyId: string, userId: string) {
    await this.assertAccess(passportId, userId);
    const journey = await this.prisma.pathwayJourney.findUnique({ where: { id: journeyId } });
    if (!journey || journey.passportId !== passportId) throw new NotFoundException('Journey not found');
    if (journey.status !== 'IN_PROGRESS') return journey;
    return this.prisma.pathwayJourney.update({ where: { id: journeyId }, data: { status: 'CHECK' } });
  }

  // "My flags" - every journey that reached a non-RESOLVED outcome (CHECK,
  // FLAG or ESCALATE), sorted by severity then section.
  async listFlags(passportId: string, userId: string) {
    await this.assertAccess(passportId, userId);
    const journeys = await this.prisma.pathwayJourney.findMany({
      where: { passportId, status: { in: ['CHECK', 'FLAG', 'ESCALATE'] } },
      orderBy: { updatedAt: 'desc' },
    });
    const pathways = await this.prisma.resolutionPathway.findMany({
      where: { id: { in: journeys.map((j) => j.pathwayId) } },
    });
    const pathwayById = new Map(pathways.map((p) => [p.id, p]));
    return journeys
      .map((j) => ({
        journeyId: j.id,
        pathwayId: j.pathwayId,
        status: j.status,
        issue: pathwayById.get(j.pathwayId)?.issue ?? pathwayById.get(j.pathwayId)?.name,
        section: null as string | null,
        updatedAt: j.updatedAt,
      }))
      .sort((a, b) => (SEVERITY_ORDER[a.status] ?? 9) - (SEVERITY_ORDER[b.status] ?? 9));
  }

  // ─── Content (guidance + pathway lookups) ────────────────────────────────

  async getGuidanceForQuestion(questionTemplateId: string, answerValue: unknown) {
    // Same one-template/several-source-paragraphs case as
    // checkTriggersForAnswer() above - try every mapping onto this template
    // and return the first paragraph whose guidance actually matches this
    // answer, rather than assuming the first mapping row is the right one.
    const mappings = await this.prisma.questionSourceMapping.findMany({
      where: { liveQuestionTemplateId: questionTemplateId },
    });
    if (!mappings.length) return null;
    for (const mapping of mappings) {
      const guidance = await this.prisma.questionAnswerGuidance.findUnique({
        where: {
          sourceParagraph_answerValue: {
            sourceParagraph: mapping.sourceParagraph,
            answerValue: String(answerValue ?? ''),
          },
        },
      });
      if (guidance) return guidance;
    }
    return null;
  }

  async getPathway(pathwayId: string) {
    const pathway = await this.prisma.resolutionPathway.findUnique({ where: { id: pathwayId } });
    if (!pathway) throw new NotFoundException('Pathway not found');
    return pathway;
  }

  // Lets the frontend ask "did saving that answer just open a pathway?" in
  // one call, right after POST /questions/:id/answer - returns the most
  // recently started journey this exact question triggered on THIS
  // passport, with its pathway content inline, or null if this answer
  // didn't trigger one. Scoped by passportId as well as the question
  // template, since a template is shared across every passport that uses
  // it - without that scope this would leak another owner's journey.
  async getJourneyForQuestion(passportId: string, userId: string, questionTemplateId: string) {
    await this.assertAccess(passportId, userId);
    const journey = await this.prisma.pathwayJourney.findFirst({
      where: { passportId, triggerQuestionTemplateId: questionTemplateId },
      orderBy: { startedAt: 'desc' },
    });
    if (!journey) return null;
    const pathway = await this.prisma.resolutionPathway.findUnique({ where: { id: journey.pathwayId } });
    return { journey, pathway };
  }

  private async assertAccess(passportId: string, userId: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      include: { collaborators: { where: { userId }, select: { id: true } } },
    });
    if (!passport) throw new NotFoundException('Passport not found');
    const isOwner = passport.ownerId === userId;
    const isCollab = (passport as any).collaborators?.length > 0;
    if (!isOwner && !isCollab) {
      throw new ForbiddenException('Not authorised to view this passport');
    }
  }
}
