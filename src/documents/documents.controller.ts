import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
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
    @Body('category') category: string,
    @Body('passportId') passportId: string,
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
      category || undefined,
      passportId || undefined,
    );
  }

  @Delete(':id')
  deleteDocument(@Req() req: any, @Param('id') id: string) {
    return this.documentsService.deleteDocument(req.user.id, id);
  }

  @Get(':id/detail')
  getDocumentDetail(@Req() req: any, @Param('id') id: string) {
    return this.documentsService.getDocumentDetail(req.user.id, id);
  }

  @Post(':id/meta')
  updateDocumentMeta(
    @Req() req: any,
    @Param('id') id: string,
    @Body('name') name: string | undefined,
    @Body('category') category: string | null | undefined,
    @Body('passportId') passportId: string | null | undefined,
  ) {
    return this.documentsService.updateDocumentMeta(req.user.id, id, { name, category, passportId });
  }

  @Get('shared-with-me')
  getSharedWithMe(@Req() req: any) {
    return this.documentsService.getSharedWithMe(req.user.id);
  }

  // ── Passport Vault: per-document access ──────────────────────────────
  @Get('passport/:passportId/vault')
  getPassportVault(@Req() req: any, @Param('passportId') passportId: string) {
    return this.documentsService.getPassportVaultDocuments(passportId, req.user.id);
  }

  @Get('passport/:passportId/vault-overview')
  getVaultOverview(@Req() req: any, @Param('passportId') passportId: string) {
    return this.documentsService.getVaultOverview(passportId, req.user.id);
  }

  @Get('passport/:passportId/vault-category/:category')
  getCategoryDocuments(
    @Req() req: any,
    @Param('passportId') passportId: string,
    @Param('category') category: string,
    @Query('scope') scope: 'property' | 'private' = 'property',
  ) {
    return this.documentsService.getCategoryDocuments(passportId, req.user.id, category, scope);
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
