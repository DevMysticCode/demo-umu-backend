import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetLastVisitedDto {
  @ApiProperty({ description: 'ID of the task the caller just opened or answered, used to resume into on next visit.' })
  @IsString()
  taskId: string;
}

export class SetSectionVisibilityDto {
  @ApiProperty({ description: 'Whether this section should be included when the passport is published.', enum: ['PUBLIC', 'PRIVATE'] })
  @IsIn(['PUBLIC', 'PRIVATE'])
  visibility: 'PUBLIC' | 'PRIVATE';
}
