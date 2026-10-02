import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import {
  publicUrlFor,
  storedFilename,
  deleteStoredFile,
  isS3Mode,
  uploadsPathFrom,
} from '../common/storage';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';

// The 8 Vault folder categories (client mockup, 2 Oct 2026). Order here is
// the display order on the category grid.
export const VAULT_CATEGORIES = [
  { key: 'property_information', label: 'Property information' },
  { key: 'ownership_legal', label: 'Ownership & legal' },
  { key: 'energy_utilities', label: 'Energy & utilities' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'improvements_maintenance', label: 'Improvements & maintenance' },
  { key: 'appliances_warranties', label: 'Appliances & warranties' },
  { key: 'manuals', label: 'Manuals' },
  { key: 'photos', label: 'Photos' },
] as const;
const VAULT_CATEGORY_KEYS = new Set(VAULT_CATEGORIES.map((c) => c.key));

// `documents/` is a private bucket — access goes via /files/* signed URLs
// rather than the static /uploads/* mount (which intentionally doesn't
// serve sensitive buckets — see main.ts).
const PRIVATE_BUCKETS = new Set(['documents']);

function bucketOf(fileUrl: string | null | undefined): string | null {
  const uploadsPath = uploadsPathFrom(fileUrl);
  if (!uploadsPath) return null;
  // Path shape: /uploads/<bucket>/<filename>
  const match = uploadsPath.match(/^\/uploads\/([^/]+)\//);
  return match ? match[1] : null;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString('en-GB', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private files: FilesService,
  ) {}

  /**
   * Convert a stored fileUrl into the URL the client should hit:
   *   - public bucket (avatars, job-photos, property-images, …): the
   *     existing /uploads/<bucket>/<file> path → served by the static
   *     middleware in main.ts. No auth attached.
   *   - private bucket (documents/, future kyc/, evidence/): /files/...
   *     with a freshly-minted HMAC signature scoped to this userId.
   *     The signature is valid for 1 hour by default — long enough for
   *     the docs page to render every attachment, short enough that a
   *     pasted URL stops working quickly.
   *
   * Caller MUST pass the requesting user's id so the signed URL is
   * scoped to them (the /files endpoint verifies the URL was issued
   * for the same userId in the query). Passing the wrong userId would
   * leak access to whoever the signed URL was issued for.
   */
  private resolveUrl(fileUrl: string | null | undefined, viewerUserId: string): string {
    if (!fileUrl) return '';
    // Bare /uploads/... or absolute-with-any-host (including a stale
    // BASE_URL baked in at upload time, e.g. a dev localhost URL that
    // shipped to production before BASE_URL was set correctly there —
    // see uploadsPathFrom's own comment).
    const uploadsPath = uploadsPathFrom(fileUrl);
    if (!uploadsPath) return fileUrl; // already a full non-uploads URL - leave as-is

    const bucket = bucketOf(fileUrl);
    if (bucket && PRIVATE_BUCKETS.has(bucket)) {
      // strip the /uploads/ prefix — /files/<bucket>/<filename>
      const relPath = uploadsPath.replace(/^\/uploads\//, '');
      return `${BASE_URL}${this.files.buildSignedUrl(relPath, viewerUserId)}`;
    }
    return `${BASE_URL}${uploadsPath}`;
  }

  async getDocuments(userId: string) {
    // 1. User-uploaded documents
    const userDocs = await this.prisma.userDocument.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    // 2. Passport documents: QuestionAnswers with a fileUrl from user's passports
    const passportAnswers = await this.prisma.questionAnswer.findMany({
      where: {
        fileUrl: { not: null },
        passportQuestion: {
          passportSectionTask: {
            passportSection: {
              passport: { ownerId: userId },
            },
          },
        },
      },
      include: {
        passportQuestion: {
          include: {
            questionTemplate: true,
            passportSectionTask: {
              include: {
                passportSection: {
                  include: {
                    passport: { include: { property: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const mappedPassportDocs = passportAnswers.map((a) => {
      const task = a.passportQuestion.passportSectionTask;
      const section = task.passportSection;
      const passport = section.passport;
      const addressShort =
        passport.property?.addressLine1 ?? passport.addressLine1;

      // Tags: passport short address + section title + task title
      const rawTags = [addressShort, section.title, task.title].filter(Boolean);
      // Trim each tag to max 20 chars
      const tags = rawTags.map((t) => (t.length > 20 ? t.slice(0, 18) + '…' : t));

      return {
        id: a.id,
        title: a.passportQuestion.questionTemplate.title,
        fileUrl: this.resolveUrl(a.fileUrl!, userId),
        size: '',
        mimeType: 'application/pdf',
        tags,
        passportId: passport.id,
        passportAddress: addressShort,
        sectionTitle: section.title,
        // PUBLIC (default) → the doc is included in the published
        // passport that unlocked buyers can see. PRIVATE → owner-only
        // even after publish. The section-level toggle already exists;
        // this field just exposes it to the vault UI so users can see
        // at a glance where each doc is visible.
        visibility: section.visibility,
        createdAt: a.createdAt,
        uploadedAt: formatDate(a.createdAt),
        source: 'passport' as const,
      };
    });

    const mappedUserDocs = userDocs.map((d) => ({
      id: d.id,
      title: d.name,
      fileUrl: this.resolveUrl(d.fileUrl, userId),
      size: formatSize(d.fileSize ?? null),
      mimeType: d.mimeType ?? '',
      tags: (d.tags as string[]) ?? [],
      expiresAt: d.expiresAt,
      // Owner-uploaded vault docs are stored in the private documents/
      // bucket and served via signed URLs — nobody else can see them.
      // Explicit field so the frontend can treat every doc uniformly.
      visibility: 'PRIVATE' as const,
      createdAt: d.createdAt,
      uploadedAt: formatDate(d.createdAt),
      source: 'user' as const,
    }));

    // Recent uploads: latest 5 across both lists
    const allDocs = [...mappedPassportDocs, ...mappedUserDocs].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const recentUploads = allDocs.slice(0, 5);

    return {
      passportDocuments: mappedPassportDocs,
      userDocuments: mappedUserDocs,
      recentUploads,
    };
  }

  // Scoped list for a single tag — used by the Landlord Passport's
  // multi-copy certificate retention (client feedback items 1a/3): each
  // question gets its own `landlord-cert:<questionId>` tag rather than
  // being mixed into the general /documents vault list. Prisma's `has`
  // on a Json array column does a straight equality match per element,
  // which is exactly right here (an exact tag, not a substring search).
  async getDocumentsByTag(userId: string, tag: string) {
    const docs = await this.prisma.userDocument.findMany({
      where: { userId, deletedAt: null, tags: { array_contains: [tag] } as any },
      orderBy: { createdAt: 'desc' },
    });
    return docs.map((doc) => ({
      id: doc.id,
      name: doc.name,
      fileUrl: this.resolveUrl(doc.fileUrl, userId),
      size: formatSize(doc.fileSize ?? null),
      uploadedAt: formatDate(doc.createdAt),
    }));
  }

  async uploadDocument(
    userId: string,
    file: any,
    name: string,
    tags: string[],
    expiresAt?: string,
    category?: string,
    passportId?: string,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    if (category && !VAULT_CATEGORY_KEYS.has(category as any)) {
      throw new BadRequestException('Invalid category');
    }
    if (passportId) {
      // Must be the owner or a collaborator to file a document under this
      // property - same gate as every other passport-scoped write.
      await this.assertPassportAccess(passportId, userId);
    }

    const fileUrl = publicUrlFor('documents', storedFilename(file));

    const doc = await this.prisma.userDocument.create({
      data: {
        userId,
        name: name?.trim() || file.originalname,
        fileUrl,
        fileSize: file.size,
        mimeType: file.mimetype,
        tags: tags ?? [],
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        category: category ?? null,
        passportId: passportId ?? null,
      },
    });

    await this.prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        version: 1,
        fileUrl: doc.fileUrl,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
        name: doc.name,
        action: 'UPLOADED',
        createdBy: userId,
      },
    });

    return {
      id: doc.id,
      title: doc.name,
      fileUrl: this.resolveUrl(doc.fileUrl, userId),
      size: formatSize(doc.fileSize ?? null),
      mimeType: doc.mimeType ?? '',
      tags: (doc.tags as string[]) ?? [],
      expiresAt: doc.expiresAt,
      category: doc.category,
      passportId: doc.passportId,
      accessLevel: doc.accessLevel,
      createdAt: doc.createdAt,
      uploadedAt: formatDate(doc.createdAt),
      source: 'user' as const,
    };
  }

  // ── Passport Vault: per-document access levels ──────────────────────────
  // "Home records" = QuestionAnswers with a file, scoped to THIS passport.
  // "Personal documents" = the user's UserDocuments - these aren't tied to
  // any one property, so the same personal-docs list appears under every
  // passport the user owns (matches the client's brief: "Personal
  // documents provides space for records the owner wants to keep without
  // attaching them to the Passport").
  private async assertPassportAccess(passportId: string, userId: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      select: {
        id: true,
        ownerId: true,
        collaborators: { where: { userId }, select: { id: true } },
      },
    });
    if (!passport) throw new NotFoundException('Passport not found');
    const isOwner = passport.ownerId === userId;
    const isCollaborator = passport.collaborators.length > 0;
    if (!isOwner && !isCollaborator) {
      throw new ForbiddenException('Not authorised for this passport');
    }
    return { isOwner };
  }

  private async mapAnswerDocs(passportId: string, userId: string) {
    const answers = await this.prisma.questionAnswer.findMany({
      where: {
        fileUrl: { not: null },
        passportQuestion: {
          passportSectionTask: { passportSection: { passportId } },
        },
      },
      include: {
        accessGrants: { include: { collaborator: { select: { id: true, firstName: true, lastName: true } } } },
        passportQuestion: { include: { questionTemplate: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return answers.map((a) => ({
      id: a.id,
      kind: 'answer' as const,
      title: a.passportQuestion.questionTemplate.title,
      fileUrl: this.resolveUrl(a.fileUrl!, userId),
      accessLevel: a.accessLevel,
      sharedWith: a.accessGrants.map((g) => ({
        id: g.collaborator.id,
        name: [g.collaborator.firstName, g.collaborator.lastName].filter(Boolean).join(' '),
      })),
      createdAt: a.createdAt,
      uploadedAt: formatDate(a.createdAt),
    }));
  }

  private async mapPersonalDocs(userId: string) {
    const docs = await this.prisma.userDocument.findMany({
      where: { userId, deletedAt: null },
      include: {
        accessGrants: { include: { collaborator: { select: { id: true, firstName: true, lastName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return docs.map((d) => ({
      id: d.id,
      kind: 'user' as const,
      title: d.name,
      fileUrl: this.resolveUrl(d.fileUrl, userId),
      accessLevel: d.accessLevel,
      sharedWith: d.accessGrants.map((g) => ({
        id: g.collaborator.id,
        name: [g.collaborator.firstName, g.collaborator.lastName].filter(Boolean).join(' '),
      })),
      createdAt: d.createdAt,
      uploadedAt: formatDate(d.createdAt),
    }));
  }

  async getPassportVaultDocuments(passportId: string, userId: string) {
    await this.assertPassportAccess(passportId, userId);
    const [homeRecords, personalDocuments] = await Promise.all([
      this.mapAnswerDocs(passportId, userId),
      this.mapPersonalDocs(userId),
    ]);
    return { homeRecords, personalDocuments };
  }

  // Vault landing (client mockup, 2 Oct 2026): the 3-way Property
  // documents / My private documents / Shared with me split, each with
  // per-category file counts for the grid on the next screen.
  async getVaultOverview(passportId: string, userId: string) {
    await this.assertPassportAccess(passportId, userId);

    const [propertyDocs, privateDocs, sharedGrants] = await Promise.all([
      this.prisma.userDocument.findMany({
        where: { passportId, userId, deletedAt: null },
        select: { category: true },
      }),
      this.prisma.userDocument.findMany({
        where: { passportId: null, userId, deletedAt: null },
        select: { category: true },
      }),
      this.prisma.documentAccessGrant.findMany({
        where: { collaboratorUserId: userId },
        select: { id: true },
      }),
    ]);

    const countByCategory = (docs: { category: string | null }[]) =>
      VAULT_CATEGORIES.map((c) => ({
        ...c,
        count: docs.filter((d) => d.category === c.key).length,
      }));

    return {
      propertyDocuments: { count: propertyDocs.length, categories: countByCategory(propertyDocs) },
      privateDocuments: { count: privateDocs.length, categories: countByCategory(privateDocs) },
      sharedWithMeCount: sharedGrants.length,
    };
  }

  // Category detail list (mockup's "Vault > Property documents > Manuals"
  // screen). scope 'property' = this passport's documents; 'private' =
  // the user's own private documents, independent of any passport.
  async getCategoryDocuments(
    passportId: string,
    userId: string,
    category: string,
    scope: 'property' | 'private',
  ) {
    await this.assertPassportAccess(passportId, userId);
    if (!VAULT_CATEGORY_KEYS.has(category as any)) {
      throw new BadRequestException('Invalid category');
    }
    const docs = await this.prisma.userDocument.findMany({
      where: {
        userId,
        category,
        deletedAt: null,
        passportId: scope === 'property' ? passportId : null,
      },
      orderBy: { createdAt: 'desc' },
    });
    return docs.map((d) => ({
      id: d.id,
      title: d.name,
      fileUrl: this.resolveUrl(d.fileUrl, userId),
      size: formatSize(d.fileSize ?? null),
      mimeType: d.mimeType ?? '',
      category: d.category,
      passportId: d.passportId,
      accessLevel: d.accessLevel,
      createdAt: d.createdAt,
      uploadedAt: formatDate(d.createdAt),
    }));
  }

  // Shared-with-me (mockup's "Shared with me" vault row): every document
  // another owner has granted this user SELECTED access to.
  async getSharedWithMe(userId: string) {
    const grants = await this.prisma.documentAccessGrant.findMany({
      where: { collaboratorUserId: userId },
      include: {
        userDocument: true,
        questionAnswer: { include: { passportQuestion: { include: { questionTemplate: true } } } },
      },
    });
    return grants
      .map((g) => {
        if (g.userDocument && !g.userDocument.deletedAt) {
          const d = g.userDocument;
          return {
            id: d.id,
            kind: 'user' as const,
            title: d.name,
            fileUrl: this.resolveUrl(d.fileUrl, userId),
            uploadedAt: formatDate(d.createdAt),
          };
        }
        if (g.questionAnswer) {
          const a = g.questionAnswer;
          return {
            id: a.id,
            kind: 'answer' as const,
            title: a.passportQuestion.questionTemplate.title,
            fileUrl: a.fileUrl ? this.resolveUrl(a.fileUrl, userId) : '',
            uploadedAt: formatDate(a.createdAt),
          };
        }
        return null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  // Document detail (mockup's Details/Sharing/History tabs). Owner only -
  // same documents a collaborator was individually granted come through
  // getSharedWithMe instead, with a narrower read-only shape.
  async getDocumentDetail(userId: string, documentId: string) {
    const doc = await this.prisma.userDocument.findUnique({
      where: { id: documentId },
      include: {
        accessGrants: { include: { collaborator: { select: { id: true, firstName: true, lastName: true, email: true } } } },
        passport: { select: { id: true, addressLine1: true, postcode: true } },
      },
    });
    if (!doc || doc.deletedAt) throw new NotFoundException('Document not found');
    if (doc.userId !== userId) throw new ForbiddenException('You do not own this document');

    const versions = await this.prisma.documentVersion.findMany({
      where: { documentId: doc.id },
      orderBy: { version: 'desc' },
    });

    return {
      id: doc.id,
      title: doc.name,
      fileUrl: this.resolveUrl(doc.fileUrl, userId),
      size: formatSize(doc.fileSize ?? null),
      mimeType: doc.mimeType ?? '',
      category: doc.category,
      accessLevel: doc.accessLevel,
      passport: doc.passport,
      createdAt: doc.createdAt,
      uploadedAt: formatDate(doc.createdAt),
      sharedWith: doc.accessGrants.map((g) => ({
        id: g.collaborator.id,
        name: [g.collaborator.firstName, g.collaborator.lastName].filter(Boolean).join(' '),
        email: g.collaborator.email,
      })),
      history: versions.map((v) => ({
        version: v.version,
        action: v.action,
        name: v.name,
        createdAt: v.createdAt,
      })),
    };
  }

  // Updates a document's name/category/property link (mockup's Document
  // details "Save changes" + "Unlink from property"). Owner only.
  async updateDocumentMeta(
    userId: string,
    documentId: string,
    opts: { name?: string; category?: string | null; passportId?: string | null },
  ) {
    const doc = await this.prisma.userDocument.findUnique({ where: { id: documentId } });
    if (!doc || doc.deletedAt) throw new NotFoundException('Document not found');
    if (doc.userId !== userId) throw new ForbiddenException('You do not own this document');
    if (opts.category && !VAULT_CATEGORY_KEYS.has(opts.category as any)) {
      throw new BadRequestException('Invalid category');
    }
    if (opts.passportId) await this.assertPassportAccess(opts.passportId, userId);

    const updated = await this.prisma.userDocument.update({
      where: { id: documentId },
      data: {
        ...(opts.name !== undefined ? { name: opts.name } : {}),
        ...(opts.category !== undefined ? { category: opts.category } : {}),
        ...(opts.passportId !== undefined ? { passportId: opts.passportId } : {}),
      },
    });
    return { id: updated.id, name: updated.name, category: updated.category, passportId: updated.passportId };
  }

  // For the "Review your Passport" screen — the current candidates for
  // inclusion in a share/publish, before the owner confirms which of them
  // actually go out this time.
  async getSharePreview(passportId: string, userId: string) {
    const { homeRecords, personalDocuments } = await this.getPassportVaultDocuments(
      passportId,
      userId,
    );
    const eligible = (d: { accessLevel: string }) =>
      d.accessLevel === 'ELIGIBLE' || d.accessLevel === 'PUBLISHED';
    return {
      homeRecords: homeRecords.filter(eligible),
      personalDocuments: personalDocuments.filter(eligible),
    };
  }

  private async findDocOwner(
    kind: 'answer' | 'user',
    id: string,
  ): Promise<{ ownerId: string; passportId: string | null } | null> {
    if (kind === 'answer') {
      const answer = await this.prisma.questionAnswer.findUnique({
        where: { id },
        select: {
          passportQuestion: {
            select: {
              passportSectionTask: {
                select: { passportSection: { select: { passportId: true, passport: { select: { ownerId: true } } } } },
              },
            },
          },
        },
      });
      const section = answer?.passportQuestion?.passportSectionTask?.passportSection;
      if (!section) return null;
      return { ownerId: section.passport.ownerId, passportId: section.passportId };
    }
    const doc = await this.prisma.userDocument.findUnique({ where: { id }, select: { userId: true, passportId: true } });
    return doc ? { ownerId: doc.userId, passportId: doc.passportId } : null;
  }

  async setDocumentAccess(
    kind: 'answer' | 'user',
    id: string,
    userId: string,
    accessLevel: string,
  ) {
    const valid = ['PRIVATE', 'SELECTED', 'ELIGIBLE', 'PUBLISHED'];
    if (!valid.includes(accessLevel)) {
      throw new BadRequestException('Invalid access level');
    }
    const owner = await this.findDocOwner(kind, id);
    if (!owner) throw new NotFoundException('Document not found');
    if (owner.ownerId !== userId) throw new ForbiddenException('You do not own this document');

    if (kind === 'answer') {
      await this.prisma.questionAnswer.update({ where: { id }, data: { accessLevel: accessLevel as any } });
    } else {
      await this.prisma.userDocument.update({ where: { id }, data: { accessLevel: accessLevel as any } });
    }
    return { id, accessLevel };
  }

  async addDocumentGrant(
    kind: 'answer' | 'user',
    id: string,
    userId: string,
    collaboratorUserId: string,
  ) {
    const owner = await this.findDocOwner(kind, id);
    if (!owner) throw new NotFoundException('Document not found');
    if (owner.ownerId !== userId) throw new ForbiddenException('You do not own this document');

    // For a passport-linked document, only that passport's existing
    // collaborators can be granted document-level access - "selected
    // people" narrows what an already-invited collaborator can see, it
    // doesn't invite a new person (that's still Add Collaborator).
    if (owner.passportId) {
      const isCollaborator = await this.prisma.passportCollaborator.findFirst({
        where: { passportId: owner.passportId, userId: collaboratorUserId },
      });
      if (!isCollaborator) {
        throw new BadRequestException(
          'That person must be added as a Passport collaborator first.',
        );
      }
    }

    const data =
      kind === 'answer'
        ? { questionAnswerId: id, collaboratorUserId }
        : { userDocumentId: id, collaboratorUserId };
    await this.prisma.documentAccessGrant.upsert({
      where:
        kind === 'answer'
          ? { questionAnswerId_collaboratorUserId: { questionAnswerId: id, collaboratorUserId } }
          : { userDocumentId_collaboratorUserId: { userDocumentId: id, collaboratorUserId } },
      create: data,
      update: {},
    });
    return { ok: true };
  }

  async removeDocumentGrant(
    kind: 'answer' | 'user',
    id: string,
    userId: string,
    collaboratorUserId: string,
  ) {
    const owner = await this.findDocOwner(kind, id);
    if (!owner) throw new NotFoundException('Document not found');
    if (owner.ownerId !== userId) throw new ForbiddenException('You do not own this document');

    await this.prisma.documentAccessGrant.deleteMany({
      where:
        kind === 'answer'
          ? { questionAnswerId: id, collaboratorUserId }
          : { userDocumentId: id, collaboratorUserId },
    });
    return { ok: true };
  }

  async deleteDocument(userId: string, documentId: string) {
    const doc = await this.prisma.userDocument.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.userId !== userId) throw new ForbiddenException();

    // Snapshot before removing the file bytes, so "removed from current
    // view" is a retrievable History/audit entry rather than a silent hard
    // delete (client History spec: "removal from view does not silently
    // erase history"). We still delete the underlying file — only the
    // metadata is retained.
    await this.prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        version: doc.version + 1,
        fileUrl: doc.fileUrl,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
        name: doc.name,
        action: 'REMOVED',
        createdBy: userId,
      },
    });

    if (isS3Mode) {
      // doc.fileUrl shape: '/uploads/documents/<filename>' — strip the
      // leading /uploads/ to get the S3 key bucket/filename form.
      const m = doc.fileUrl.match(/^\/uploads\/([^/]+)\/(.+)$/);
      if (m) {
        try { await deleteStoredFile(m[1], m[2]); } catch { /* ignore */ }
      }
    } else {
      const filePath = join(process.cwd(), doc.fileUrl);
      if (existsSync(filePath)) {
        try { unlinkSync(filePath); } catch { /* ignore */ }
      }
    }

    await this.prisma.userDocument.update({
      where: { id: documentId },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    return { message: 'Document deleted' };
  }
}
