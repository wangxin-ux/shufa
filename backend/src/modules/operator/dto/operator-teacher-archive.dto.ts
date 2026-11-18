import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { TEACHER_MONTH } from '../../partner/dto/partner-teacher-performance.dto';
import { OperatorStudentsQueryDto } from './operator-student.dto';

export class OperatorTeacherArchivesQueryDto extends OperatorStudentsQueryDto {}

export class OperatorTeacherMonthQueryDto {
  @IsOptional()
  @Matches(TEACHER_MONTH)
  month?: string;
}

export class OperatorTeacherHistoryQueryDto extends OperatorTeacherMonthQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
