import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';

export class AddEvidenceDto {
  // Optional to preserve existing behaviour: a missing `photos` field
  // defaults to an empty array in the controller (body?.photos ?? []).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  photos?: string[];
}
