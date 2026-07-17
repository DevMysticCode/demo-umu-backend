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
} from '../common/storage';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';

// `documents/` is a private bucket — access goes via /files/* signed URLs
// rather than the static /uploads/* mount (which intentionally doesn't
// serve sensitive buckets — see main.ts).
const PRIVATE_BUCKETS = new Set(['documents']);

function bucketOf(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null;
  // Path shape: /uploads/<bucket>/<filename>
  const match = fileUrl.match(/^\/uploads\/([^/]+)\//);
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
    if (!fileUrl.startsWith('/uploads/')) return fileUrl;

    const bucket = bucketOf(fileUrl);
    if (bucket && PRIVATE_BUCKETS.has(bucket)) {
      // strip the /uploads/ prefix — /files/<bucket>/<filename>
      const relPath = fileUrl.replace(/^\/uploads\//, '');
      return `${BASE_URL}${this.files.buildSignedUrl(relPath, viewerUserId)}`;
    }
    return `${BASE_URL}${fileUrl}`;
  }

  async getDocuments(userId: string) {
    // 1. User-uploaded documents
    const userDocs = await this.prisma.userDocument.findMany({
      where: { userId },
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

  async uploadDocument(
    userId: string,
    file: any,
    name: string,
    tags: string[],
    expiresAt?: string,
  ) {
    if (!file) throw new BadRequestException('No file provided');

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
      createdAt: doc.createdAt,
      uploadedAt: formatDate(doc.createdAt),
      source: 'user' as const,
    };
  }

  async deleteDocument(userId: string, documentId: string) {
    const doc = await this.prisma.userDocument.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.userId !== userId) throw new ForbiddenException();

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

    await this.prisma.userDocument.delete({ where: { id: documentId } });
    return { message: 'Document deleted' };
  }
}
