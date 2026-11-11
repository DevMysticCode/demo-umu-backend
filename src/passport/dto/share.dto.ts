import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class CreateShareLinkDto {
  @ApiPropertyOptional({ description: 'Who the share link is intended for, used to filter which sections/documents are visible through it.', enum: ['buyer', 'tenant'] })
  @IsOptional()
  @IsIn(['buyer', 'tenant'])
  scope?: 'buyer' | 'tenant';

  @ApiPropertyOptional({ description: 'IDs of specific documents to include in the link\'s snapshotted manifest. Omit to include all documents visible at the chosen scope.', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentIds?: string[];
}

export class SharePassportWithBuyerDto {
  @ApiProperty({ description: 'User ID of the buyer to nudge toward this passport.' })
  @IsString()
  buyerUserId: string;

  @ApiPropertyOptional({ description: 'Optional note to include alongside the share-passport message card.' })
  @IsOptional()
  @IsString()
  note?: string;
}
