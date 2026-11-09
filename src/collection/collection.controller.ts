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
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CollectionService } from './collection.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('collection')
export class CollectionController {
  constructor(private collectionService: CollectionService) {}

  @Get('my')
  @ApiOperation({ summary: "List the caller's collections", description: "Returns the authenticated user's named passport collections (each with its member passports) plus a separate list of owned/collaborated passports not yet filed into any collection. Excludes abandoned PENDING_PAYMENT claims." })
  @ApiResponse({ status: 200, description: 'Collections and any uncollected passports. Not paginated - returns everything the caller owns.', schema: { type: 'object', properties: {
    collections: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, name: { type: 'string' }, userId: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' },
      items: { type: 'array', items: { type: 'object', properties: { passportId: { type: 'string' }, passport: { type: 'object', properties: {
        id: { type: 'string' }, addressLine1: { type: 'string' }, postcode: { type: 'string' }, status: { type: 'string' }, type: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' },
        property: { type: 'object', nullable: true, properties: { imageUrl: { type: 'string', nullable: true } } },
      } } } } },
    } } },
    uncollectedPassports: { type: 'array', description: 'Owned/collaborated passports not yet filed into any collection', items: { type: 'object', properties: {
      id: { type: 'string' }, addressLine1: { type: 'string' }, postcode: { type: 'string' }, status: { type: 'string' }, type: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' },
      property: { type: 'object', nullable: true, properties: { imageUrl: { type: 'string', nullable: true } } },
    } } },
  } } })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async getMyCollections(@Request() req: any) {
    return this.collectionService.getMyCollections(req.user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a collection', description: 'Creates a new, empty named passport collection owned by the authenticated user.' })
  @ApiResponse({ status: 201, description: 'The created collection.', schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, userId: { type: 'string' } } } })
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
  @ApiOperation({ summary: 'Add a passport to a collection', description: "Files a passport into a collection the caller owns. The caller must also have access to the passport itself (owner or collaborator) — a passport id alone (e.g. leaked from a link or screenshot) is not enough." })
  @ApiParam({ name: 'id', description: 'PassportCollection id' })
  @ApiResponse({
    status: 201,
    description: 'The created (or already-existing, upserted) collection-item link.',
    schema: { type: 'object', properties: { id: { type: 'string' }, collectionId: { type: 'string' }, passportId: { type: 'string' } } },
  })
  @ApiResponse({ status: 403, description: 'Either the collection is not the caller\'s, or the caller has no access to the given passport.' })
  @ApiResponse({ status: 404, description: 'No collection exists with that id.' })
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
  @ApiOperation({ summary: 'Remove a passport from a collection', description: 'Removes a passport from a collection the caller owns. Does not delete the passport itself.' })
  @ApiParam({ name: 'id', description: 'PassportCollection id' })
  @ApiResponse({ status: 201, description: 'Success confirmation.', schema: { type: 'object', properties: { success: { type: 'boolean' } } } })
  @ApiResponse({ status: 403, description: 'The collection is not the caller\'s.' })
  @ApiResponse({ status: 404, description: 'No collection exists with that id.' })
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
  @ApiOperation({ summary: 'Delete a collection', description: 'Deletes a collection the caller owns. The passports that were in it are not deleted.' })
  @ApiParam({ name: 'id', description: 'PassportCollection id' })
  @ApiResponse({ status: 200, description: 'Success confirmation.', schema: { type: 'object', properties: { success: { type: 'boolean' } } } })
  @ApiResponse({ status: 403, description: 'The collection is not the caller\'s.' })
  @ApiResponse({ status: 404, description: 'No collection exists with that id.' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async deleteCollection(
    @Param('id') collectionId: string,
    @Request() req: any,
  ) {
    return this.collectionService.deleteCollection(req.user.id, collectionId);
  }
}
