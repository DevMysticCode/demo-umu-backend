import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

export class CreateShareLinkDto {
  @IsOptional()
  @IsIn(['buyer', 'tenant'])
  scope?: 'buyer' | 'tenant';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentIds?: string[];
}

export class SharePassportWithBuyerDto {
  @IsString()
  buyerUserId: string;

  @IsOptional()
  @IsString()
  note?: string;
}
