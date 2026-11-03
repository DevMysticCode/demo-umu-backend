import { IsIn } from 'class-validator';

// Documents the shape of POST /truevalue/admin/review/:workId's body.
// The handler still reads `decision` via individual @Body('decision')
// field extraction (unchanged) — referenced only via
// @ApiBody({ type: ... }) for Swagger.
export class ReviewWorkEvidenceDto {
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';
}
