import { IsBoolean, IsOptional } from 'class-validator';

export class ConvertToSellerDto {
  // No body fields needed — all info comes from the source passport
  // referenced in the URL.
  @IsOptional()
  @IsBoolean()
  acknowledged?: boolean;
}
