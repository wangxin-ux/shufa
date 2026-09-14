import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CORRECTION_ACTIONS,
  CORRECTION_STATUSES,
} from './finance-correction.rules';

export class FinanceCorrectionPackageDto {
  @IsString() @MinLength(1) @Matches(/\S/) @MaxLength(200) name!: string;
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

export class FinanceCorrectionReplacementDto {
  @IsUUID('4') campusId!: string;
  @IsUUID('4') studentId!: string;
  @IsInt() @Min(1) @Max(2147483647) amountFen!: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) receivedOn!: string;
  @IsIn(['WECHAT', 'ALIPAY', 'BANK', 'CASH', 'OTHER']) channel!: string;
  @IsUUID('4') proofFileId!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => FinanceCorrectionPackageDto)
  package!: FinanceCorrectionPackageDto;
}

export class CreateFinanceCorrectionDto {
  @IsIn(['VOID', 'REPLACE']) type!: 'VOID' | 'REPLACE';
  @IsString() @Matches(/\S/) @MaxLength(500) reason!: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => FinanceCorrectionReplacementDto)
  replacement?: FinanceCorrectionReplacementDto;
}

export class FinanceCorrectionActionDto {
  @IsIn(CORRECTION_ACTIONS) action!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Matches(/\S/) @MaxLength(500) reason!: string;
}

export class FinanceCorrectionQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize = 20;
  @IsOptional() @IsUUID('4') campusId?: string;
  @IsOptional() @IsUUID('4') receiptId?: string;
  @IsOptional()
  @IsIn(CORRECTION_STATUSES)
  status?: (typeof CORRECTION_STATUSES)[number];
}
