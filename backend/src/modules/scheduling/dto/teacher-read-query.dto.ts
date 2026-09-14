import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const LESSON_SESSION_STATUSES = [
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'REVERSED',
  'CANCELLED',
] as const;

export class PaginationQueryDto {
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

export class DateRangeQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export class LessonSessionsQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsIn(LESSON_SESSION_STATUSES)
  status?: (typeof LESSON_SESSION_STATUSES)[number];
}

export class StudentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;
}
