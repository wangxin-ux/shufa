import {
  IsBoolean,
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
} from 'class-validator';
import { PaginationQueryDto } from '../scheduling/dto/teacher-read-query.dto';

export class SettlementVersionDto {
  @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}
export class PartnerWithdrawalCreateDto {
  @IsInt() @Min(1) @Max(2147483647) amountFen!: number;
  @IsInt() @Min(1) @Max(2147483647) expectedProfileVersion!: number;
}
export class PartnerSettlementConfigurationDto {
  @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
  @IsString() @Matches(/^模拟\S.{0,97}$/u) @MaxLength(100) payerName!: string;
  @IsString()
  @Matches(/^模拟\S.{0,97}$/u)
  @MaxLength(100)
  beneficiaryName!: string;
  @IsString() @Matches(/^[0-9]{4}$/) accountLastFour!: string;
  @IsInt() @Min(1) @Max(2147483647) minimumAmountFen!: number;
  @IsInt() @Min(1) @Max(100) dailyRequestLimit!: number;
  @IsString() @Matches(/\S/) @MinLength(1) @MaxLength(500) reason!: string;
}
export class PartnerSettlementConfirmDto extends SettlementVersionDto {
  @IsInt() @Min(1) @Max(2147483647) expectedProfileVersion!: number;
  @IsString() @Matches(/\S/) @MinLength(1) @MaxLength(500) reason!: string;
}
export class PartnerWithdrawalActionDto extends SettlementVersionDto {
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(500) reason?: string;
  @IsOptional() @IsBoolean() confirmedUnpaid?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) amountFen?: number;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) accountVersion?: number;
  @IsOptional()
  @IsString()
  @Matches(/^SIM-\S+$/)
  @MaxLength(128)
  payoutReference?: string;
  @IsOptional() @IsIn(['PAID', 'UNPAID']) evidenceOutcome?: 'PAID' | 'UNPAID';
  @IsOptional() @IsUUID('4') proofFileId?: string;
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d\d:\d\d)$/)
  paidAt?: string;
}
export class PartnerWithdrawalQueryDto extends PaginationQueryDto {}
export class ManagedPartnerWithdrawalQueryDto extends PartnerWithdrawalQueryDto {
  @IsOptional() @IsUUID('4') campusId?: string;
}
