import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePassportDto {
  @ApiProperty({ description: "The property's first address line." })
  @IsString()
  addressLine1: string;

  @ApiProperty({ description: "The property's UK postcode." })
  @IsString()
  postcode: string;

  @ApiPropertyOptional({ description: 'ID of an existing Property record to claim. When set, the passport is created in PENDING_PAYMENT with no type until payment/KYC/HMLR verification complete.' })
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiPropertyOptional({ description: 'Passport type for a manual passport or a landlord-to-seller convert. Omitted for a property claim.', enum: ['seller', 'landlord'] })
  @IsOptional()
  @IsIn(['seller', 'landlord'])
  type?: 'seller' | 'landlord';

  @ApiPropertyOptional({ description: 'Whether the property is a House in Multiple Occupation, which changes which section templates are seeded.' })
  @IsOptional()
  @IsBoolean()
  isHmo?: boolean;
}
