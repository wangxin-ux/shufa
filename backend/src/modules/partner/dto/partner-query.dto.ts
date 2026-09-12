import { Transform, Type, type TransformFnParams } from 'class-transformer';
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

export class PartnerPeriodQueryDto {
  @IsIn(PARTNER_REPORT_PERIODS)
  period: PartnerReportPeriod = 'MONTH';

  @IsOptional()
  @IsISO8601({ strict: true })
  anchorDate?: string;
}
