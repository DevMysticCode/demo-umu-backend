import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { CollectionService } from './collection.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('collection')
export class CollectionController {
  constructor(private collectionService: CollectionService) {}

  @Get('my')
  @UseGuards(JwtAuthGuard)
  async getMyCollections(@Request() req: any) {
    return this.collectionService.getMyCollections(req.user.id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async createCollection(
    @Body('name') name: string,
    @Request() req: any,
  ) {
    return this.collectionService.createCollection(req.user.id, name);
  }

  @Post(':id/add')
  @UseGuards(JwtAuthGuard)
  async addToCollection(
    @Param('id') collectionId: string,
    @Body('passportId') passportId: string,
    @Request() req: any,
  ) {
    return this.collectionService.addToCollection(
      req.user.id,
      collectionId,
      passportId,
    );
  }

  @Post(':id/remove')
  @UseGuards(JwtAuthGuard)
  async removeFromCollection(
    @Param('id') collectionId: string,
    @Body('passportId') passportId: string,
    @Request() req: any,
  ) {
    return this.collectionService.removeFromCollection(
      req.user.id,
      collectionId,
      passportId,
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async deleteCollection(
    @Param('id') collectionId: string,
    @Request() req: any,
  ) {
    return this.collectionService.deleteCollection(req.user.id, collectionId);
  }
}
