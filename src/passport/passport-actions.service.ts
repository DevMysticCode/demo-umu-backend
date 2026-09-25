import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PassportEventsService } from './passport-events.service';
import { PassportEventType } from './passport-event-types';

/**
 * Rule engine — infrastructure only. Per the client's own handoff doc, the
 * ~500-question rule catalogue "cannot be mapped accurately until the
 * seller-question document and any current database/export are reconciled"
 * and needs legal/content review before real rule copy ships. This service
 * is the generic evaluator; PassportRule rows are the (currently near-empty)
 * content, seeded separately (see prisma/seed-passport-rules.ts).
 *
 * Condition expressions are intentionally a tiny, explicit DSL rather than
 * an eval()'d string — evaluateCondition() is the only place that
 * interprets them. Supported shape (JSON, stored as a string in
 * PassportRule.conditionExpression):
 *   { "questionId": "<uuid>", "answerEquals": "yes" }
 *   { "questionId": "<uuid>", "answerIn": ["yes", "unsure"] }
 *   { "all": [ <condition>, <condition> ] }
 * This covers the spec's illustrative example (a single yes/no answer) and
 * is deliberately small — extend it once real rules need more than this,
 * rather than guessing at requirements no rule currently has.
 */
@Injectable()
export class PassportActionsService {
  constructor(
    private prisma: PrismaService,
    private events: PassportEventsService,
  ) {}

  private evaluateCondition(condition: any, answersByQuestionId: Map<string, any>): boolean {
    if (!condition) return false;
    if (Array.isArray(condition.all)) {
      return condition.all.every((c: any) => this.evaluateCondition(c, answersByQuestionId));
    }
    if (condition.questionId) {
      const answer = answersByQuestionId.get(condition.questionId);
      // MULTIPART answers are stored as an object keyed by partKey (e.g.
      // { glazed_doors_guarantees: 'no', photos: '...' }) rather than one
      // flat value — condition.partKey picks out the specific part.
      const value = condition.partKey
        ? answer?.[condition.partKey] ?? null
        : typeof answer === 'string'
          ? answer
          : answer?.value ?? answer?.answerText ?? null;
      if (condition.answerEquals !== undefined) {
        return value === condition.answerEquals;
      }
      if (Array.isArray(condition.answerIn)) {
        return condition.answerIn.includes(value);
      }
    }
    return false;
  }

  /**
   * Called after a question answer is saved (see QuestionService.answerQuestion).
   * Evaluates every enabled rule that watches the changed question, using the
   * *current* full set of answers for this passport (per spec step 2: "using
   * the current answers, dates and evidence" — not just the one that just
   * changed, since a rule can depend on other answers too).
   *
   * For each matching rule: finds-or-creates an OPEN action keyed on
   * (passportId, ruleId, questionId) so re-saving the same answer doesn't
   * duplicate it. For a rule that no longer matches but has an OPEN action
   * from a prior answer, supersedes it with a reason.
   */
  async evaluateRulesForQuestion(
    passportId: string,
    changedQuestionTemplateId: string,
    actorId: string | null,
  ): Promise<void> {
    const rules = await this.prisma.passportRule.findMany({
      where: { enabled: true },
    });
    if (rules.length === 0) return;

    const relevantRules = rules.filter((r) => {
      const ids = Array.isArray(r.questionIds) ? (r.questionIds as string[]) : [];
      return ids.includes(changedQuestionTemplateId);
    });
    if (relevantRules.length === 0) return;

    // Current answers for every question any relevant rule might reference —
    // fetched fresh so a rule that also depends on a *different* question's
    // answer sees its current value, not a stale one.
    const allAnswers = await this.prisma.questionAnswer.findMany({
      where: {
        passportQuestion: {
          passportSectionTask: { passportSection: { passportId } },
        },
      },
      include: { passportQuestion: { select: { questionTemplateId: true } } },
    });
    const answersByQuestionId = new Map<string, any>();
    for (const a of allAnswers) {
      answersByQuestionId.set(a.passportQuestion.questionTemplateId, a.answerJson ?? a.answerText);
    }

    for (const rule of relevantRules) {
      let condition: any;
      try {
        condition = JSON.parse(rule.conditionExpression);
      } catch {
        continue; // malformed rule content — skip rather than throw, never block the answer save
      }
      const matches = this.evaluateCondition(condition, answersByQuestionId);
      const subjectEntityId = changedQuestionTemplateId;

      const existingOpen = await this.prisma.passportAction.findFirst({
        where: { passportId, ruleId: rule.id, subjectEntityId, status: { in: ['OPEN', 'REOPENED'] } },
      });

      if (matches && !existingOpen) {
        const action = await this.prisma.passportAction.create({
          data: {
            passportId,
            ruleId: rule.id,
            ruleVersion: rule.version,
            subjectEntityId,
            status: 'OPEN',
            title: rule.userTitle,
            explanation: rule.userExplanation,
            suggestedSteps: rule.suggestedSteps ?? undefined,
            severity: rule.severity,
            linkedQuestionId: changedQuestionTemplateId,
          },
        });
        await this.events.logEvent({
          passportId,
          eventType: PassportEventType.ACTION_CREATED,
          actorType: 'SYSTEM',
          actorId: null,
          entityType: 'ACTION',
          entityId: action.id,
          sectionId: null,
          sourceType: 'SYSTEM',
          visibilityClass: 'OWNER_ONLY',
          correlationId: action.id,
          ruleId: rule.id,
          ruleVersion: rule.version,
          metadata: { reason: 'Created from your answer' },
        });
      } else if (!matches && existingOpen) {
        await this.supersedeAction(existingOpen.id, 'Underlying answer no longer matches this rule');
      } else if (matches && existingOpen && existingOpen.status === 'REOPENED') {
        // Already open/reopened and still matches — nothing to do.
      }
    }
  }

  private async supersedeAction(actionId: string, reason: string): Promise<void> {
    const action = await this.prisma.passportAction.update({
      where: { id: actionId },
      data: { status: 'SUPERSEDED', supersedesReason: reason },
    });
    await this.events.logEvent({
      passportId: action.passportId,
      eventType: PassportEventType.ACTION_SUPERSEDED,
      actorType: 'SYSTEM',
      entityType: 'ACTION',
      entityId: action.id,
      visibilityClass: 'OWNER_ONLY',
      correlationId: action.id,
      ruleId: action.ruleId,
      ruleVersion: action.ruleVersion,
      metadata: { reason },
    });
  }

  async listActions(passportId: string, userId: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      include: { collaborators: { where: { userId }, select: { id: true } } },
    });
    if (!passport) throw new NotFoundException('Passport not found');
    const isOwner = passport.ownerId === userId;
    const isCollab = (passport as any).collaborators?.length > 0;
    if (!isOwner && !isCollab) {
      throw new ForbiddenException('Not authorised to view actions for this passport');
    }
    return this.prisma.passportAction.findMany({
      where: { passportId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markAddressed(passportId: string, actionId: string, userId: string) {
    const passport = await this.prisma.passport.findUnique({ where: { id: passportId } });
    if (!passport) throw new NotFoundException('Passport not found');
    if (passport.ownerId !== userId) {
      throw new ForbiddenException('Only the owner can update actions');
    }
    const action = await this.prisma.passportAction.findUnique({ where: { id: actionId } });
    if (!action || action.passportId !== passportId) {
      throw new NotFoundException('Action not found');
    }
    const updated = await this.prisma.passportAction.update({
      where: { id: actionId },
      data: { status: 'ADDRESSED', addressedAt: new Date(), addressedBy: userId },
    });
    await this.events.logEvent({
      passportId,
      eventType: PassportEventType.ACTION_ADDRESSED,
      actorType: 'OWNER',
      actorId: userId,
      entityType: 'ACTION',
      entityId: actionId,
      visibilityClass: 'OWNER_ONLY',
      correlationId: actionId,
      metadata: { note: 'Owner marked as addressed — this is not a compliance verification.' },
    });
    return updated;
  }

  async reopen(passportId: string, actionId: string, userId: string) {
    const passport = await this.prisma.passport.findUnique({ where: { id: passportId } });
    if (!passport) throw new NotFoundException('Passport not found');
    if (passport.ownerId !== userId) {
      throw new ForbiddenException('Only the owner can update actions');
    }
    const action = await this.prisma.passportAction.findUnique({ where: { id: actionId } });
    if (!action || action.passportId !== passportId) {
      throw new NotFoundException('Action not found');
    }
    const updated = await this.prisma.passportAction.update({
      where: { id: actionId },
      data: { status: 'REOPENED' },
    });
    await this.events.logEvent({
      passportId,
      eventType: PassportEventType.ACTION_REOPENED,
      actorType: 'OWNER',
      actorId: userId,
      entityType: 'ACTION',
      entityId: actionId,
      visibilityClass: 'OWNER_ONLY',
      correlationId: actionId,
    });
    return updated;
  }
}
