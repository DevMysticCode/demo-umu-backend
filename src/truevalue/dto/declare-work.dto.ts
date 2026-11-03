import { IsOptional, IsString } from 'class-validator';

// Documents the shape of POST /property/:id/truevalue/works's body. The
// handler still reads `workTypeCode`/`installDate` via individual
// @Body(...) field extraction (unchanged) — referenced only via
// @ApiBody({ type: ... }) for Swagger.
export class DeclareWorkDto {
  @IsString()
  workTypeCode: string;

  @IsOptional()
  @IsString()
  installDate?: string;
}
