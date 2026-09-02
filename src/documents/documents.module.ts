import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PrismaModule } from '../prisma/prisma.module';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({ secret: process.env.JWT_SECRET }),
    // FilesModule exports FilesService so resolveUrl() can build the
    // signed /files/... URLs for private buckets (documents/).
    FilesModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  // Reused by QuestionModule for the Landlord Passport's multi-copy
  // certificate retention (client feedback items 1a/3) — the same
  // upload/delete/signed-URL machinery, just tagged and filtered by
  // question id instead of shown in the general /documents vault.
  exports: [DocumentsService],
})
export class DocumentsModule {}
