import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetPassportTypeDto {
  @ApiProperty({ description: 'Which role this passport is for, once ownership is verified.', enum: ['seller', 'landlord'] })
  @IsIn(['seller', 'landlord'])
  type: 'seller' | 'landlord';

  @ApiPropertyOptional({ description: 'Whether the property is a House in Multiple Occupation (landlord type only).' })
  @IsOptional()
  @IsBoolean()
  isHmo?: boolean;
}
