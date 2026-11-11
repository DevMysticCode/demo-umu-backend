import { IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Documents the shape of POST /property/:id/truevalue/works's body. The
// handler still reads `workTypeCode`/`installDate` via individual
// @Body(...) field extraction (unchanged) — referenced only via
// @ApiBody({ type: ... }) for Swagger.
export class DeclareWorkDto {
  @ApiProperty({ description: 'The type of work being declared (e.g. an extension, a loft conversion).' })
  @IsString()
  workTypeCode: string;

  @ApiPropertyOptional({ description: 'Date the work was installed/completed, ISO date string.' })
  @IsOptional()
  @IsString()
  installDate?: string;
}
