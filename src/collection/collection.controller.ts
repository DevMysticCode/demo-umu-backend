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
import { ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { CollectionService } from './collection.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('collection')
export class CollectionController {
  constructor(private collectionService: CollectionService) {}

  @Get('my')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async getMyCollections(@Request() req: any) {
    return this.collectionService.getMyCollections(req.user.id);
  }

  @Post()
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
      },
    },
  })
  async createCollection(
    @Body('name') name: string,
    @Request() req: any,
  ) {
    return this.collectionService.createCollection(req.user.id, name);
  }

  @Post(':id/add')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['passportId'],
      properties: {
        passportId: { type: 'string' },
      },
    },
  })
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
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['passportId'],
      properties: {
        passportId: { type: 'string' },
      },
    },
  })
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
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async deleteCollection(
    @Param('id') collectionId: string,
    @Request() req: any,
  ) {
    return this.collectionService.deleteCollection(req.user.id, collectionId);
  }
}
