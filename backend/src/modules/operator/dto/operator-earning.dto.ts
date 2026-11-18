import { PartnerEarningEntryType, PartnerEarningStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export const OPERATOR_EARNING_MAX_OFFSET = 2147483647;

export class OperatorEarningQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(OPERATOR_EARNING_MAX_OFFSET)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsEnum(PartnerEarningStatus)
  status?: PartnerEarningStatus;

  @IsOptional()
  @IsEnum(PartnerEarningEntryType)
  entryType?: PartnerEarningEntryType;
}
