import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateOfferDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  price!: number;

  @IsString()
  @Length(20, 4000)
  message!: string;

  @IsOptional()
  @IsString()
  availableDate?: string;
}
