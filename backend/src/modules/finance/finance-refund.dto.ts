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
  ValidateNested,
} from 'class-validator';
import { REFUND_ACTIONS, REFUND_STATUSES } from './finance-refund.rules';

export class CreateFinanceRefundDto {
  @IsInt() @Min(1) @Max(100000000) mainUnits!: number;
  @IsInt() @Min(0) @Max(100000000) giftUnits!: number;
  @IsInt() @Min(1) @Max(2147483647) amountFen!: number;
  @IsString() @Matches(/\S/) @MaxLength(500) reason!: string;
}

export class FinanceRefundQuoteDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000000) mainUnits!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(100000000) giftUnits!: number;
}

export class FinanceRefundPaymentDto {
  @IsInt() @Min(1) @Max(2147483647) amountFen!: number;
  @IsISO8601({ strict: true }) @Matches(/(Z|[+-]\d{2}:\d{2})$/) paidAt!: string;
  @IsUUID('4') proofFileId!: string;
  @IsString() @Matches(/\S/) @MaxLength(100) externalReference!: string;
}

export class FinanceRefundActionDto {
  @IsIn(REFUND_ACTIONS) action!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Matches(/\S/) @MaxLength(500) reason!: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => FinanceRefundPaymentDto)
  payment?: FinanceRefundPaymentDto;
}

export class FinanceRefundQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize = 20;
  @IsOptional() @IsUUID('4') campusId?: string;
  @IsOptional() @IsUUID('4') receiptId?: string;
  @IsOptional()
  @IsIn(REFUND_STATUSES)
  status?: (typeof REFUND_STATUSES)[number];
}
