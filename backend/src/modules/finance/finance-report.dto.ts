import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export const FINANCE_REPORT_KINDS = ['lesson-consumption', 'refunds'] as const;
export type FinanceReportKind = (typeof FINANCE_REPORT_KINDS)[number];

export class FinanceReportFiltersDto {
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}

export class FinanceReportQueryDto extends FinanceReportFiltersDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;
}

export class FinanceReportExportQueryDto extends FinanceReportFiltersDto {}

export class FinanceReportExportParamsDto {
  @IsIn(FINANCE_REPORT_KINDS)
  kind!: FinanceReportKind;
}
