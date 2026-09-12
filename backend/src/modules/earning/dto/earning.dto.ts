import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';
import {
  DateRangeQueryDto,
  PaginationQueryDto,
} from '../../scheduling/dto/teacher-read-query.dto';

const EARNING_STATUSES = [
  'PENDING_REVIEW',
  'AVAILABLE',
  'REJECTED',
  'REVERSED',
] as const;
const CONFIGURATION_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
const BASIS_TYPES = [
  'PER_COMPLETED_SESSION',
  'PER_LESSON_UNIT',
  'PER_PRESENT_ATTENDEE',
] as const;
const LESSON_KINDS = ['REGULAR', 'MAKEUP', 'TRIAL'] as const;
const ATTENDANCE_STATUSES = ['PRESENT', 'LEAVE', 'ABSENT'] as const;

export class TeacherEarningsQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsIn(EARNING_STATUSES)
  status?: (typeof EARNING_STATUSES)[number];
}

export class ManagementEarningRulesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @IsOptional()
  @IsUUID('4')
  teacherId?: string;

  @IsOptional()
  @IsIn(CONFIGURATION_STATUSES)
  status?: (typeof CONFIGURATION_STATUSES)[number];
}

export class ManagementTeacherEarningsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @IsOptional()
  @IsIn(EARNING_STATUSES)
  status?: (typeof EARNING_STATUSES)[number];
}

export class CreateTeacherEarningRuleDto {
  @IsUUID('4')
  campusId!: string;

  @IsOptional()
  @IsUUID('4')
  teacherId?: string | null;

  @IsIn(BASIS_TYPES)
  basisType!: (typeof BASIS_TYPES)[number];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitAmountFen!: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsIn(LESSON_KINDS, { each: true })
  eligibleLessonKinds!: Array<(typeof LESSON_KINDS)[number]>;

  @IsArray()
  @IsIn(ATTENDANCE_STATUSES, { each: true })
  countedAttendanceStatuses!: Array<(typeof ATTENDANCE_STATUSES)[number]>;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  settlementDelayDays!: number;

  @IsISO8601({ strict: true })
  effectiveFrom!: string;
}

export class VersionedActionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class RetireConfigurationDto extends VersionedActionDto {
  @IsISO8601({ strict: true })
  effectiveTo!: string;
}

export class ReasonedActionDto extends VersionedActionDto {
  @IsString()
  @Matches(/\S/)
  @MaxLength(500)
  reason!: string;
}
