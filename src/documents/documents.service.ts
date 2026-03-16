import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';

function resolveUrl(fileUrl: string): string {
  if (fileUrl?.startsWith('/uploads/')) return `${BASE_URL}${fileUrl}`;
  return fileUrl;
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
  constructor(private prisma: PrismaService) {}

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
        fileUrl: resolveUrl(a.fileUrl!),
        size: '',
        mimeType: 'application/pdf',
        tags,
        passportId: passport.id,
        passportAddress: addressShort,
        createdAt: a.createdAt,
        uploadedAt: formatDate(a.createdAt),
        source: 'passport' as const,
      };
    });

    const mappedUserDocs = userDocs.map((d) => ({
      id: d.id,
      title: d.name,
      fileUrl: resolveUrl(d.fileUrl),
      size: formatSize(d.fileSize ?? null),
      mimeType: d.mimeType ?? '',
      tags: (d.tags as string[]) ?? [],
      expiresAt: d.expiresAt,
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

    const fileUrl = `/uploads/documents/${file.filename}`;

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
      fileUrl: resolveUrl(doc.fileUrl),
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

    const filePath = join(process.cwd(), doc.fileUrl);
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {}
    }

    await this.prisma.userDocument.delete({ where: { id: documentId } });
    return { message: 'Document deleted' };
  }
}
