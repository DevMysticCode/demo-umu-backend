import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { createUploadStorage, DOCUMENT_MIME_TYPES } from '../common/storage';
import { DocumentsService } from './documents.service';

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  getDocuments(@Req() req: any) {
    return this.documentsService.getDocuments(req.user.id);
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', createUploadStorage({ bucket: 'documents', maxMb: 20, mimeAllowList: DOCUMENT_MIME_TYPES })),
  )
  uploadDocument(
    @Req() req: any,
    @UploadedFile() file: any,
    @Body('name') name: string,
    @Body('tags') tags: string,
    @Body('expiresAt') expiresAt: string,
  ) {
    const parsedTags = tags
      ? tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];
    return this.documentsService.uploadDocument(
      req.user.id,
      file,
      name,
      parsedTags,
      expiresAt || undefined,
    );
  }

  @Delete(':id')
  deleteDocument(@Req() req: any, @Param('id') id: string) {
    return this.documentsService.deleteDocument(req.user.id, id);
  }

  // ── Passport Vault: per-document access ──────────────────────────────
  @Get('passport/:passportId/vault')
  getPassportVault(@Req() req: any, @Param('passportId') passportId: string) {
    return this.documentsService.getPassportVaultDocuments(passportId, req.user.id);
  }

  @Get('passport/:passportId/share-preview')
  getSharePreview(@Req() req: any, @Param('passportId') passportId: string) {
    return this.documentsService.getSharePreview(passportId, req.user.id);
  }

  @Post(':kind/:id/access')
  setDocumentAccess(
    @Req() req: any,
    @Param('kind') kind: 'answer' | 'user',
    @Param('id') id: string,
    @Body('accessLevel') accessLevel: string,
  ) {
    return this.documentsService.setDocumentAccess(kind, id, req.user.id, accessLevel);
  }

  @Post(':kind/:id/grants')
  addDocumentGrant(
    @Req() req: any,
    @Param('kind') kind: 'answer' | 'user',
    @Param('id') id: string,
    @Body('collaboratorUserId') collaboratorUserId: string,
  ) {
    return this.documentsService.addDocumentGrant(kind, id, req.user.id, collaboratorUserId);
  }

  @Delete(':kind/:id/grants/:collaboratorUserId')
  removeDocumentGrant(
    @Req() req: any,
    @Param('kind') kind: 'answer' | 'user',
    @Param('id') id: string,
    @Param('collaboratorUserId') collaboratorUserId: string,
  ) {
    return this.documentsService.removeDocumentGrant(kind, id, req.user.id, collaboratorUserId);
  }
}
