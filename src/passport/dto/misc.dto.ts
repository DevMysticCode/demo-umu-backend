import { IsIn, IsString } from 'class-validator';

export class SetLastVisitedDto {
  @IsString()
  taskId: string;
}

export class SetSectionVisibilityDto {
  @IsIn(['PUBLIC', 'PRIVATE'])
  visibility: 'PUBLIC' | 'PRIVATE';
}
