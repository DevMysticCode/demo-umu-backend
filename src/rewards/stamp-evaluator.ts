import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RewardsService } from './rewards.service';
import { STAMP_CATALOGUE, StampCatalogueEntry, stampActionKey } from './stamp-catalogue';

interface TaskSnapshot {
  status: string;
  questions: {
    status: string;
    order: number;
    answerId: string | null;
    hasEvidence: boolean;
  }[];
}

// MULTIPART questions (the overwhelming majority of the actual upload
// questions in this data model) submit their answer as a single JSON
// object covering every part — including any "upload" part's file URL —
// which QuestionService.answerQuestion stores in `answerJson`, NOT the
// dedicated `fileUrl` column (that column is only ever populated by a
// plain top-level UPLOAD-type question, or a non-multipart answer whose
// entire value is a URL). Checking `fileUrl` alone would essentially
// never detect real evidence on a MULTIPART question, so this also scans
// answerJson for anything that looks like an uploaded file's URL/path.
const FILE_LIKE_PATTERN = /https?:\/\/|\/uploads\//i;
function hasFileEvidence(fileUrl: string | null, answerJson: unknown): boolean {
  if (fileUrl) return true;
  if (!answerJson) return false;
  try {
    return FILE_LIKE_PATTERN.test(JSON.stringify(answerJson));
  } catch {
    return false;
  }
}

interface RequirementCheck {
  satisfied: boolean;
  documentIds: string[];
  triggerParts: string[];
}

@Injectable()
export class StampEvaluatorService {
  constructor(
    private prisma: PrismaService,
    private rewards: RewardsService,
  ) {}

  // Call after any task/question completes on a passport — checks every
  // stamp in STAMP_CATALOGUE against the passport's current state and
  // mints whichever ones just became satisfied. One query pass over the
  // passport's sections/tasks/questions/answers, then everything else is
  // in-memory, so this stays cheap even with 22 stamps to check. Never
  // throws — a stamp-evaluation hiccup should never break the save it's
  // attached to.
  async evaluatePassport(passportId: string, userId: string): Promise<void> {
    try {
      const passport = await this.prisma.passport.findUnique({
        where: { id: passportId },
        select: { id: true, propertyId: true },
      });
      if (!passport) return;

      const sections = await this.prisma.passportSection.findMany({
        where: { passportId },
        select: {
          key: true,
          tasks: {
            select: {
              key: true,
              status: true,
              passportQuestions: {
                select: {
                  status: true,
                  questionTemplate: { select: { order: true } },
                  answer: { select: { id: true, fileUrl: true, answerJson: true } },
                },
              },
            },
          },
        },
      });

      const sectionKeys = new Set(sections.map((s) => s.key));
      const taskByKey = new Map<string, TaskSnapshot>();
      for (const section of sections) {
        for (const task of section.tasks) {
          taskByKey.set(`${section.key}::${task.key}`, {
            status: task.status,
            questions: task.passportQuestions.map((pq) => ({
              status: pq.status,
              order: pq.questionTemplate.order,
              answerId: pq.answer?.id ?? null,
              hasEvidence: hasFileEvidence(pq.answer?.fileUrl ?? null, pq.answer?.answerJson ?? null),
            })),
          });
        }
      }

      const alreadyEarned = await this.prisma.userStamp.findMany({
        where: { userId, passportId },
        select: { stampDefinition: { select: { key: true } } },
      });
      const earnedKeys = new Set(alreadyEarned.map((s) => s.stampDefinition.key));

      for (const entry of STAMP_CATALOGUE) {
        if (earnedKeys.has(entry.key)) continue;
        if (entry.requiresLeasehold && !sectionKeys.has('leasehold')) continue;

        const check = this.checkRequirements(entry, taskByKey);
        if (!check.satisfied) continue;
        if (entry.requireUpload && check.documentIds.length === 0) continue;

        await this.rewards.award(userId, stampActionKey(entry.key), passportId, {
          passportId,
          propertyId: passport.propertyId ?? undefined,
          stampTriggerEvent: `GROUP:${check.triggerParts.join(',')}`,
          stampSupportingDocumentIds: check.documentIds,
        });
      }
    } catch (err: any) {
      console.error(`[StampEvaluator] evaluation failed for passport ${passportId}: ${err?.message}`);
    }
  }

  private checkRequirements(
    entry: StampCatalogueEntry,
    taskByKey: Map<string, TaskSnapshot>,
  ): RequirementCheck {
    const documentIds: string[] = [];
    const triggerParts: string[] = [];

    for (const req of entry.requirements) {
      const task = taskByKey.get(`${req.sectionKey}::${req.taskKey}`);
      if (!task) return { satisfied: false, documentIds: [], triggerParts: [] };

      if (req.order != null) {
        const q = task.questions.find((pq) => pq.order === req.order);
        if (!q || q.status !== 'COMPLETED') {
          return { satisfied: false, documentIds: [], triggerParts: [] };
        }
        if (q.hasEvidence && q.answerId) documentIds.push(q.answerId);
        triggerParts.push(`${req.sectionKey}:${req.taskKey}:order=${req.order}`);
      } else {
        if (task.status !== 'COMPLETED') {
          return { satisfied: false, documentIds: [], triggerParts: [] };
        }
        for (const q of task.questions) {
          if (q.hasEvidence && q.answerId) documentIds.push(q.answerId);
        }
        triggerParts.push(`${req.sectionKey}:${req.taskKey}`);
      }
    }

    return { satisfied: true, documentIds, triggerParts };
  }
}
