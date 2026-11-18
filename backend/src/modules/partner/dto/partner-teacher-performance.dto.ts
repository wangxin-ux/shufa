import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PartnerPageQueryDto } from './partner-query.dto';

export const TEACHER_MONTH = /^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/;
export const TEACHER_RATING_FIELDS = [
  'teachingRating',
  'communicationRating',
  'attendanceRating',
  'overallRating',
] as const;

export class PartnerTeacherPerformanceQueryDto extends PartnerPageQueryDto {
  @IsOptional()
  @Matches(TEACHER_MONTH)
  month?: string;
}

export class PartnerTeacherEvaluationDto {
  @Matches(TEACHER_MONTH)
  periodMonth!: string;

  @IsInt()
  @Min(0)
  @Max(2147483646)
  expectedVersion!: number;

  @IsInt()
  @Min(1)
  @Max(10)
  teachingRating!: number;

  @IsInt()
  @Min(1)
  @Max(10)
  communicationRating!: number;

  @IsInt()
  @Min(1)
  @Max(10)
  attendanceRating!: number;

  @IsInt()
  @Min(1)
  @Max(10)
  overallRating!: number;

  @IsString()
  @MaxLength(1000)
  guidance!: string;
}
