import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PartnerApplicationStatus } from '@prisma/client';
import { SubmitPartnerApplicationDto } from './partner-application-submit.dto';

export class PartnerApplicationHistoryQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class PartnerApplicationReviewQueryDto extends PartnerApplicationHistoryQueryDto {
  @IsOptional()
  @IsEnum(PartnerApplicationStatus)
  status?: PartnerApplicationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  query?: string;
}

export class RejectPartnerApplicationDto extends SubmitPartnerApplicationDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class ReopenPartnerApplicationDto extends SubmitPartnerApplicationDto {
  @IsUUID('4')
  submissionId!: string;
}
