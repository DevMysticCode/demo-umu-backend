import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Documents the shape of POST /truevalue/admin/review/:workId's body.
// The handler still reads `decision` via individual @Body('decision')
// field extraction (unchanged) — referenced only via
// @ApiBody({ type: ... }) for Swagger.
export class ReviewWorkEvidenceDto {
  @ApiProperty({ description: "The admin's decision on this piece of work evidence.", enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';
}
