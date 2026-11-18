import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class OperatorRemoveLessonMemberDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  version!: number;
}

export class OperatorAddLessonMemberDto extends OperatorRemoveLessonMemberDto {
  @IsUUID('4')
  studentId!: string;
}
