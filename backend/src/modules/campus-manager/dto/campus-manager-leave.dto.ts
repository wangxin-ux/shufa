import { Transform, Type, type TransformFnParams } from 'class-transformer';
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

const trim = (params: TransformFnParams): unknown =>
  typeof params.value === 'string' ? params.value.trim() : params.value;

const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export class CampusManagerLeaveRequestsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsIn(LEAVE_STATUSES)
  status?: (typeof LEAVE_STATUSES)[number];
}

export class CampusManagerReviewLeaveDto {
  @IsInt()
  @Min(1)
  version!: number;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewReason?: string;
}

export class CampusManagerRejectLeaveDto {
  @IsInt()
  @Min(1)
  version!: number;

  @Transform(trim)
  @IsString()
  @Matches(/\S/, { message: 'reviewReason must contain non-whitespace text' })
  @MaxLength(500)
  reviewReason!: string;
}
