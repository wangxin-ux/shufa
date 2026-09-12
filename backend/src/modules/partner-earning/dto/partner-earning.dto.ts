import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../scheduling/dto/teacher-read-query.dto';
import {
  PARTNER_REPORT_PERIODS,
  type PartnerReportPeriod,
} from '../../partner/partner-period';

const CONFIGURATION_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
const PARTNER_EARNING_STATUSES = [
  'PENDING_REVIEW',
  'AVAILABLE',
  'REJECTED',
  'REVERSED',
] as const;
const LESSON_KINDS = ['REGULAR', 'MAKEUP', 'TRIAL'] as const;
const ATTENDANCE_STATUSES = ['PRESENT', 'LEAVE', 'ABSENT'] as const;

export class ManagementPartnerEarningRulesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @IsOptional()
  @IsIn(CONFIGURATION_STATUSES)
  status?: (typeof CONFIGURATION_STATUSES)[number];
}

export class ManagementPartnerEarningsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @IsOptional()
  @IsIn(PARTNER_EARNING_STATUSES)
  status?: (typeof PARTNER_EARNING_STATUSES)[number];
}

export class PartnerEarningPeriodQueryDto {
  @IsOptional()
  @IsIn(PARTNER_REPORT_PERIODS)
  period?: PartnerReportPeriod;

  @IsOptional()
  @IsISO8601({ strict: true })
  anchorDate?: string;
}

export class PartnerEarningsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(PARTNER_EARNING_STATUSES)
  status?: (typeof PARTNER_EARNING_STATUSES)[number];

  @IsOptional()
  @IsIn(PARTNER_REPORT_PERIODS)
  period?: PartnerReportPeriod;

  @IsOptional()
  @IsISO8601({ strict: true })
  anchorDate?: string;
}

export class CreatePartnerEarningRuleDto {
  @IsUUID('4')
  campusId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitPriceFen!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  shareBasisPoints!: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsIn(LESSON_KINDS, { each: true })
  eligibleLessonKinds!: Array<(typeof LESSON_KINDS)[number]>;

  @IsArray()
  @ArrayNotEmpty()
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
