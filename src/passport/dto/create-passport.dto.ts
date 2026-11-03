import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class CreatePassportDto {
  @IsString()
  addressLine1: string;

  @IsString()
  postcode: string;

  @IsOptional()
  @IsString()
  propertyId?: string;

  @IsOptional()
  @IsIn(['seller', 'landlord'])
  type?: 'seller' | 'landlord';

  @IsOptional()
  @IsBoolean()
  isHmo?: boolean;
}
