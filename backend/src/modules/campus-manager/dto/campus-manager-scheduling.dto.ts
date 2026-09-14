import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

const LESSON_KINDS = ['REGULAR', 'MAKEUP', 'TRIAL'] as const;
const LESSON_STATUSES = [
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'REVERSED',
  'CANCELLED',
] as const;

export type CampusManagerLessonKind = (typeof LESSON_KINDS)[number];
export type CampusManagerLessonStatus = (typeof LESSON_STATUSES)[number];

export class CampusManagerLessonSessionsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  @IsOptional()
  @IsEnum(LESSON_STATUSES)
  status?: CampusManagerLessonStatus;
}

export class CampusManagerCreateLessonSessionDto {
  @IsUUID('4')
  classGroupId!: string;

  @IsDateString({ strict: true })
  startsAt!: string;

  @IsDateString({ strict: true })
  endsAt!: string;

  @IsEnum(LESSON_KINDS)
  kind!: CampusManagerLessonKind;
}

export class CampusManagerUpdateLessonSessionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @IsDateString({ strict: true })
  startsAt!: string;

  @IsDateString({ strict: true })
  endsAt!: string;

  @IsEnum(LESSON_KINDS)
  kind!: CampusManagerLessonKind;
}

export class CampusManagerCancelLessonSessionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
