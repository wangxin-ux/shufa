import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsIn,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';
import { LessonLedgerEntryType } from '@prisma/client';
import {
  PARTNER_REPORT_PERIODS,
  type PartnerReportPeriod,
} from '../partner-period';

const trim = (params: TransformFnParams): unknown =>
  typeof params.value === 'string' ? params.value.trim() : params.value;

export class PartnerPageQueryDto {
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

export class PartnerSearchQueryDto extends PartnerPageQueryDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;
}

export class PartnerLessonQueryDto extends PartnerPageQueryDto {
  @IsOptional()
  @IsEnum(LessonLedgerEntryType)
  entryType?: LessonLedgerEntryType;

  @IsOptional()
  @Matches(
    /^(?:UNCLASSIFIED|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$/,
  )
  subjectId?: string;
}

export const PARTNER_BALANCE_BANDS = [
  'ALL',
  'ZERO',
  'LTE_FIVE',
  'GT_FIVE',
] as const;
export type PartnerBalanceBand = (typeof PARTNER_BALANCE_BANDS)[number];

export class PartnerStudentQueryDto extends PartnerSearchQueryDto {
  @IsOptional()
  @Matches(
    /^(?:UNCLASSIFIED|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$/,
  )
  subjectId?: string;

  @IsOptional()
  @IsIn(PARTNER_BALANCE_BANDS)
  balanceBand: PartnerBalanceBand = 'ALL';
}

export class PartnerPeriodQueryDto {
  @IsIn(PARTNER_REPORT_PERIODS)
  period: PartnerReportPeriod = 'MONTH';

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  anchorDate?: string;
}
