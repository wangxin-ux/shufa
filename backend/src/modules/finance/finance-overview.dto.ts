import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class FinanceOverviewFiltersDto {
  @IsOptional()
  @Matches(/^[0-9a-f-]{36}(,[0-9a-f-]{36})*$/i)
  campusIds?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;
}

export class FinanceOverviewQueryDto extends FinanceOverviewFiltersDto {
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

  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;

  @IsOptional()
  @IsIn(['ALL', 'PARENT_REFUND', 'PARTNER_PAYOUT', 'TEACHER_WITHDRAWAL'])
  category?:
    | 'ALL'
    | 'PARENT_REFUND'
    | 'PARTNER_PAYOUT'
    | 'TEACHER_WITHDRAWAL';
}

export class FinanceOverviewExportParamsDto {
  @IsIn(['cash-flow', 'profitability'])
  kind!: 'cash-flow' | 'profitability';
}
