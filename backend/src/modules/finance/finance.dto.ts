import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class FinanceQueryDto {
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
  @MaxLength(100)
  query?: string;

  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @IsOptional()
  @IsIn(['UNLINKED', 'LINKED'])
  status?: 'UNLINKED' | 'LINKED';
}

export class CreateFinanceReceiptDto {
  @IsUUID('4') campusId!: string;
  @IsUUID('4') studentId!: string;
  @IsInt() @Min(1) @Max(2147483647) amountFen!: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) receivedOn!: string;
  @IsIn(['WECHAT', 'ALIPAY', 'BANK', 'CASH', 'OTHER']) channel!: string;
  @IsUUID('4') proofFileId!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class IssueFinancePackageDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsInt() @Min(1) @Max(100000000) mainUnits!: number;
  @IsInt() @Min(0) @Max(100000000) giftUnits!: number;
  @IsISO8601({ strict: true })
  @Matches(/(Z|[+-]\d{2}:\d{2})$/)
  validFrom!: string;
  @ValidateIf((_object, value) => value !== null)
  @IsISO8601({ strict: true })
  @Matches(/(Z|[+-]\d{2}:\d{2})$/)
  expiresAt!: string | null;
}
