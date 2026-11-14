import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

// Fixed menu of share-link lifetimes — security/launch review finding
// #16 asked for the old hardcoded 3 hours to become configurable, but
// specifically as a closed set of choices the user picks from, not a
// free-typed number (no arbitrary/huge expiry someone fat-fingers or
// deliberately sets to effectively never expire). 72h is the longest
// option since that was the brief's explicit cap. Shared with
// PassportService so the DTO's declared enum and the service's actual
// validation never drift apart.
export const SHARE_LINK_DURATION_HOURS = [1, 3, 6, 24, 48, 72] as const;
export type ShareLinkDurationHours = (typeof SHARE_LINK_DURATION_HOURS)[number];

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

  @ApiPropertyOptional({
    description: 'How long the link stays valid for. Must be one of the listed choices - not an arbitrary number. Defaults to 3 hours if omitted.',
    enum: SHARE_LINK_DURATION_HOURS,
    default: 3,
  })
  @IsOptional()
  @IsIn(SHARE_LINK_DURATION_HOURS)
  durationHours?: ShareLinkDurationHours;
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
