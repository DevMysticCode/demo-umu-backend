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
import { createUploadStorage } from '../common/storage';
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
    FileInterceptor('file', createUploadStorage({ bucket: 'documents', maxMb: 20 })),
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
}
