import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../scheduling/dto/teacher-read-query.dto';
import { VersionedActionDto } from '../../earning/dto/earning.dto';

const WITHDRAWAL_STATUSES = [
  'SUBMITTED',
  'APPROVED',
  'PAYING',
  'PAID',
  'CANCELLED',
  'REJECTED',
  'FAILED',
] as const;
const CONFIGURATION_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;

export class CreateWithdrawalDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountFen!: number;
}

export class TeacherWithdrawalsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(WITHDRAWAL_STATUSES)
  status?: (typeof WITHDRAWAL_STATUSES)[number];
}

export class ManagementWithdrawalsQueryDto extends TeacherWithdrawalsQueryDto {
  @IsOptional()
  @IsUUID('4')
  campusId?: string;
}

export class WithdrawalPoliciesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(CONFIGURATION_STATUSES)
  status?: (typeof CONFIGURATION_STATUSES)[number];
}

export class CreateWithdrawalPolicyDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minimumAmountFen!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  dailyRequestLimit!: number;

  @IsISO8601({ strict: true })
  effectiveFrom!: string;
}

export class MarkWithdrawalPaidDto extends VersionedActionDto {
  @IsString()
  @MaxLength(128)
  payoutReference!: string;

  @IsUUID('4')
  payoutProofFileId!: string;
}
