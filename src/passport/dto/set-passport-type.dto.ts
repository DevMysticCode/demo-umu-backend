import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class SetPassportTypeDto {
  @IsIn(['seller', 'landlord'])
  type: 'seller' | 'landlord';

  @IsOptional()
  @IsBoolean()
  isHmo?: boolean;
}
