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
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { createUploadStorage, DOCUMENT_MIME_TYPES } from '../common/storage';
import { DocumentsService } from './documents.service';

@Controller('documents')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @ApiOperation({ summary: "List my documents", description: 'Returns every document the caller can see across both storage paths: files uploaded directly to their vault, and files attached as answers to their own passport questions. Also includes a combined "recently uploaded" slice of the 5 most recent across both.' })
  @ApiResponse({ status: 200, description: 'The combined document lists.', schema: { type: 'object', properties: {
    passportDocuments: { type: 'array', description: 'Files attached as answers to the caller\'s own passport questions', items: { type: 'object', properties: {
      id: { type: 'string' }, title: { type: 'string' }, fileUrl: { type: 'string' }, size: { type: 'string' }, mimeType: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Passport address, section title, task title - trimmed to 20 chars each' },
      passportId: { type: 'string' }, passportAddress: { type: 'string' }, sectionTitle: { type: 'string' },
      visibility: { type: 'string', enum: ['PUBLIC', 'PRIVATE'] }, createdAt: { type: 'string', format: 'date-time' }, uploadedAt: { type: 'string' },
      source: { type: 'string', enum: ['passport'] },
    } } },
    userDocuments: { type: 'array', description: 'Files uploaded directly to the vault', items: { type: 'object', properties: {
      id: { type: 'string' }, title: { type: 'string' }, fileUrl: { type: 'string' }, size: { type: 'string' }, mimeType: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } }, expiresAt: { type: 'string', format: 'date-time', nullable: true },
      visibility: { type: 'string', enum: ['PRIVATE'] }, createdAt: { type: 'string', format: 'date-time' }, uploadedAt: { type: 'string' },
      source: { type: 'string', enum: ['user'] },
    } } },
    recentUploads: { type: 'array', description: 'Latest 5 across both lists above - each item has whichever shape matches its own source field', items: { type: 'object', properties: {
      id: { type: 'string' }, title: { type: 'string' }, fileUrl: { type: 'string' }, size: { type: 'string' }, mimeType: { type: 'string' },
      visibility: { type: 'string', enum: ['PUBLIC', 'PRIVATE'] }, createdAt: { type: 'string', format: 'date-time' }, uploadedAt: { type: 'string' },
      source: { type: 'string', enum: ['passport', 'user'], description: 'Which list this came from - passport-sourced items additionally carry passportId/passportAddress/sectionTitle/tags; user-sourced items carry tags/expiresAt' },
    } } },
  } } })
  @Get()
  getDocuments(@Req() req: any) {
    return this.documentsService.getDocuments(req.user.id);
  }

  @ApiOperation({ summary: 'Upload a document to my vault', description: 'Stores a new document in the private documents bucket. Optionally links it to a specific passport (passportId) - the caller must own or be a collaborator on that passport - and/or files it under a vault category.' })
  @ApiResponse({ status: 201, description: 'The created document.', schema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, fileUrl: { type: 'string' }, size: { type: 'string' }, mimeType: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, category: { type: 'string', nullable: true }, passportId: { type: 'string', nullable: true }, accessLevel: { type: 'string' }, uploadedAt: { type: 'string' } } } })
  @ApiResponse({ status: 400, description: 'No file provided, or category is not a valid vault category.' })
  @ApiResponse({ status: 403, description: 'passportId was given but the caller is not its owner/a collaborator.' })
  @ApiResponse({ status: 404, description: 'passportId was given but no such passport exists.' })
  @Post()
  @UseInterceptors(
    FileInterceptor('file', createUploadStorage({ bucket: 'documents', maxMb: 20, mimeAllowList: DOCUMENT_MIME_TYPES })),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'name'],
      properties: {
        file: { type: 'string', format: 'binary' },
        name: { type: 'string', description: 'Display name for the document' },
        tags: { type: 'string', description: 'Comma-separated list of tags' },
        expiresAt: { type: 'string', format: 'date-time', nullable: true, description: 'Optional reminder date, e.g. for an insurance policy or warranty expiry' },
        category: { type: 'string', nullable: true, description: 'Vault category to file this under (e.g. property_information, ownership_legal) - see the vault-overview endpoint for the full category list' },
        passportId: { type: 'string', nullable: true, description: 'Link this document to a specific passport, making it a "Property document" rather than a general private one. Omit to keep it private and unlinked.' },
      },
    },
  })
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

  @ApiOperation({ summary: 'Delete a document', description: 'Owner-only. Writes a metadata-only history entry (REMOVED action, capturing name/size/type/who/when) before deleting the underlying file from storage - the record of removal survives even though the file itself is gone.' })
  @ApiParam({ name: 'id', description: 'The UserDocument id.' })
  @ApiResponse({ status: 200, description: 'Deletion result.', schema: { type: 'object', properties: { message: { type: 'string' } } } })
  @ApiResponse({ status: 403, description: 'Caller does not own this document.' })
  @ApiResponse({ status: 404, description: 'No such document.' })
  @Delete(':id')
  deleteDocument(@Req() req: any, @Param('id') id: string) {
    return this.documentsService.deleteDocument(req.user.id, id);
  }

  @ApiOperation({ summary: 'Get full document detail', description: "Owner-only (a collaborator's individually-granted access to the same document comes through GET /documents/shared-with-me instead, with a narrower shape). Powers the Details/Sharing/History tabs: who it's shared with, and its version history." })
  @ApiParam({ name: 'id', description: 'The UserDocument id.' })
  @ApiResponse({ status: 200, description: 'Full document detail.', schema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, fileUrl: { type: 'string' }, size: { type: 'string' }, mimeType: { type: 'string' }, category: { type: 'string', nullable: true }, accessLevel: { type: 'string' }, sharedWith: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' } } } }, history: { type: 'array', items: { type: 'object', properties: { version: { type: 'integer' }, action: { type: 'string' }, name: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } } } } } })
  @ApiResponse({ status: 403, description: 'Caller does not own this document.' })
  @ApiResponse({ status: 404, description: 'No such document.' })
  @Get(':id/detail')
  getDocumentDetail(@Req() req: any, @Param('id') id: string) {
    return this.documentsService.getDocumentDetail(req.user.id, id);
  }

  @ApiOperation({ summary: "Update a document's name, category or property link", description: "Owner-only. Any of name/category/passportId may be supplied; passing passportId re-checks the caller's access to that passport before linking." })
  @ApiParam({ name: 'id', description: 'The UserDocument id.' })
  @ApiResponse({ status: 201, description: 'The updated fields.', schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, category: { type: 'string', nullable: true }, passportId: { type: 'string', nullable: true } } } })
  @ApiResponse({ status: 400, description: 'category is not a valid vault category.' })
  @ApiResponse({ status: 403, description: 'Caller does not own this document.' })
  @ApiResponse({ status: 404, description: 'No such document.' })
  @Post(':id/meta')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', nullable: true, description: 'New display name' },
        category: { type: 'string', nullable: true, description: 'New vault category' },
        passportId: { type: 'string', nullable: true, description: 'Pass a passport id to link this document to it, or null to unlink it back to a general private document' },
      },
    },
  })
  updateDocumentMeta(
    @Req() req: any,
    @Param('id') id: string,
    @Body('name') name: string | undefined,
    @Body('category') category: string | null | undefined,
    @Body('passportId') passportId: string | null | undefined,
  ) {
    return this.documentsService.updateDocumentMeta(req.user.id, id, { name, category, passportId });
  }

  @ApiOperation({ summary: 'List documents shared with me', description: 'Every document (vault document or passport-answer file) another owner has individually granted the caller SELECTED-tier access to.' })
  @ApiResponse({ status: 200, description: 'Shared documents.', schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['user', 'answer'] }, title: { type: 'string' }, fileUrl: { type: 'string' }, uploadedAt: { type: 'string' } } } } })
  @Get('shared-with-me')
  getSharedWithMe(@Req() req: any) {
    return this.documentsService.getSharedWithMe(req.user.id);
  }

  // ── Passport Vault: per-document access ──────────────────────────────
  @ApiOperation({ summary: "List a passport's vault documents", description: "Returns two lists: \"home records\" (files attached as answers to this passport's questions, scoped to the caller's collaborator access if not the owner) and the caller's own private documents (not tied to any one property)." })
  @ApiParam({ name: 'passportId', description: 'The Passport id.' })
  @ApiResponse({ status: 200, description: 'Vault contents.', schema: { type: 'object', properties: {
    homeRecords: { type: 'array', description: 'Files attached as passport-question answers, filtered to ELIGIBLE/PUBLISHED', items: { type: 'object', properties: {
      id: { type: 'string' }, kind: { type: 'string', enum: ['answer'] }, title: { type: 'string' }, fileUrl: { type: 'string' }, accessLevel: { type: 'string' },
      sharedWith: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } } },
      createdAt: { type: 'string', format: 'date-time' }, uploadedAt: { type: 'string' },
    } } },
    personalDocuments: { type: 'array', description: 'Vault-uploaded documents, filtered to ELIGIBLE/PUBLISHED', items: { type: 'object', properties: {
      id: { type: 'string' }, kind: { type: 'string', enum: ['user'] }, title: { type: 'string' }, fileUrl: { type: 'string' }, accessLevel: { type: 'string' },
      sharedWith: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } } },
      createdAt: { type: 'string', format: 'date-time' }, uploadedAt: { type: 'string' },
    } } },
  } } })
  @Get('passport/:passportId/vault')
  getPassportVault(@Req() req: any, @Param('passportId') passportId: string) {
    return this.documentsService.getPassportVaultDocuments(passportId, req.user.id);
  }

  @ApiOperation({ summary: 'Get vault category counts', description: "Per-category file counts for the vault's category grid: documents linked to this property, the caller's private documents, how many have been shared with them, and how many home-record files exist (see vault above) for this passport." })
  @ApiParam({ name: 'passportId', description: 'The Passport id.' })
  @ApiResponse({ status: 200, description: 'Category counts.', schema: { type: 'object', properties: {
    propertyDocuments: { type: 'object', properties: { count: { type: 'integer' }, categories: { type: 'array', items: { type: 'object', properties: {
      key: { type: 'string', enum: ['property_information', 'ownership_legal', 'energy_utilities', 'compliance', 'improvements_maintenance', 'appliances_warranties', 'manuals', 'photos'] },
      label: { type: 'string' }, count: { type: 'integer' },
    } } } } },
    privateDocuments: { type: 'object', properties: { count: { type: 'integer' }, categories: { type: 'array', items: { type: 'object', properties: {
      key: { type: 'string', enum: ['property_information', 'ownership_legal', 'energy_utilities', 'compliance', 'improvements_maintenance', 'appliances_warranties', 'manuals', 'photos'] },
      label: { type: 'string' }, count: { type: 'integer' },
    } } } } },
    sharedWithMeCount: { type: 'integer' }, answerDocumentsCount: { type: 'integer' },
  } } })
  @Get('passport/:passportId/vault-overview')
  getVaultOverview(@Req() req: any, @Param('passportId') passportId: string) {
    return this.documentsService.getVaultOverview(passportId, req.user.id);
  }

  @ApiOperation({ summary: 'List documents in one vault category', description: 'The category-detail screen: every document in the given category, either scoped to this property or to the caller\'s private library depending on the scope query param.' })
  @ApiParam({ name: 'passportId', description: 'The Passport id.' })
  @ApiParam({ name: 'category', description: 'Vault category key, e.g. manuals, warranties, compliance.' })
  @ApiQuery({ name: 'scope', required: false, description: "'property' (default) for documents linked to this passport, or 'private' for the caller's own library." })
  @ApiResponse({ status: 200, description: 'Documents in the category.', schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, fileUrl: { type: 'string' }, size: { type: 'string' }, mimeType: { type: 'string' }, category: { type: 'string' }, accessLevel: { type: 'string' }, uploadedAt: { type: 'string' } } } } })
  @Get('passport/:passportId/vault-category/:category')
  getCategoryDocuments(
    @Req() req: any,
    @Param('passportId') passportId: string,
    @Param('category') category: string,
    @Query('scope') scope: 'property' | 'private' = 'property',
  ) {
    return this.documentsService.getCategoryDocuments(passportId, req.user.id, category, scope);
  }

  @ApiOperation({ summary: 'Preview what would be included in a share/publish', description: "For the \"Review your Passport\" screen: the current home-record and personal documents already marked ELIGIBLE or PUBLISHED - i.e. the candidates that would actually go out if the owner shares or publishes right now, before they confirm." })
  @ApiParam({ name: 'passportId', description: 'The Passport id.' })
  @ApiResponse({ status: 200, description: 'Eligible/published documents by list.', schema: { type: 'object', properties: {
    homeRecords: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, kind: { type: 'string', enum: ['answer'] }, title: { type: 'string' }, fileUrl: { type: 'string' }, accessLevel: { type: 'string' },
      sharedWith: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } } },
      createdAt: { type: 'string', format: 'date-time' }, uploadedAt: { type: 'string' },
    } } },
    personalDocuments: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, kind: { type: 'string', enum: ['user'] }, title: { type: 'string' }, fileUrl: { type: 'string' }, accessLevel: { type: 'string' },
      sharedWith: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } } },
      createdAt: { type: 'string', format: 'date-time' }, uploadedAt: { type: 'string' },
    } } },
  } } })
  @Get('passport/:passportId/share-preview')
  getSharePreview(@Req() req: any, @Param('passportId') passportId: string) {
    return this.documentsService.getSharePreview(passportId, req.user.id);
  }

  @ApiOperation({ summary: "Set a document's visibility level", description: "Owner-only. Sets PRIVATE/SELECTED/ELIGIBLE/PUBLISHED on either a vault document ('user') or a passport-answer file ('answer')." })
  @ApiParam({ name: 'kind', description: "Which kind of document this is.", enum: ['answer', 'user'] })
  @ApiParam({ name: 'id', description: 'The UserDocument id (kind=user) or QuestionAnswer id (kind=answer).' })
  @ApiResponse({ status: 201, description: 'The updated access level.', schema: { type: 'object', properties: { id: { type: 'string' }, accessLevel: { type: 'string' } } } })
  @ApiResponse({ status: 403, description: 'Caller does not own this document.' })
  @Post(':kind/:id/access')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['accessLevel'],
      properties: {
        accessLevel: { type: 'string', enum: ['PRIVATE', 'SELECTED', 'ELIGIBLE', 'PUBLISHED'], description: "PRIVATE: owner only. SELECTED: owner + any collaborator individually granted access (see POST :kind/:id/grants). ELIGIBLE: visible to a buyer who has paid to unlock this passport. PUBLISHED: visible to anyone once the passport is published." },
      },
    },
  })
  setDocumentAccess(
    @Req() req: any,
    @Param('kind') kind: 'answer' | 'user',
    @Param('id') id: string,
    @Body('accessLevel') accessLevel: string,
  ) {
    return this.documentsService.setDocumentAccess(kind, id, req.user.id, accessLevel);
  }

  @ApiOperation({ summary: 'Grant a collaborator access to one document', description: "Owner-only. For a passport-linked document, the target must already be an invited collaborator on that passport - this only narrows what an already-invited person can see, it doesn't invite someone new." })
  @ApiParam({ name: 'kind', description: 'Which kind of document this is.', enum: ['answer', 'user'] })
  @ApiParam({ name: 'id', description: 'The UserDocument id (kind=user) or QuestionAnswer id (kind=answer).' })
  @ApiResponse({ status: 201, description: 'Grant created.', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } })
  @ApiResponse({ status: 400, description: 'Target user is not already a collaborator on the linked passport.' })
  @Post(':kind/:id/grants')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['collaboratorUserId'],
      properties: {
        collaboratorUserId: { type: 'string', description: "The user id of an already-invited PassportCollaborator on this document's passport - granting access to someone not already invited is rejected with 400." },
      },
    },
  })
  addDocumentGrant(
    @Req() req: any,
    @Param('kind') kind: 'answer' | 'user',
    @Param('id') id: string,
    @Body('collaboratorUserId') collaboratorUserId: string,
  ) {
    return this.documentsService.addDocumentGrant(kind, id, req.user.id, collaboratorUserId);
  }

  @ApiOperation({ summary: "Revoke a collaborator's grant on one document", description: 'Owner-only. Removes the specific access grant - the collaborator may still see the document via their general scope if applicable, but loses this document-specific grant.' })
  @ApiParam({ name: 'kind', description: 'Which kind of document this is.', enum: ['answer', 'user'] })
  @ApiParam({ name: 'id', description: 'The UserDocument id (kind=user) or QuestionAnswer id (kind=answer).' })
  @ApiParam({ name: 'collaboratorUserId', description: 'The collaborator whose grant is being removed.' })
  @ApiResponse({ status: 200, description: 'Grant removed.', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } })
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
