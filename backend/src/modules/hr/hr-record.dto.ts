import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  Matches,
} from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RECORD_KINDS = ['QUALIFICATION', 'TRAINING', 'GROWTH'] as const;

export class HrTeacherRecordQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;

  @IsOptional()
  @IsIn(RECORD_KINDS)
  kind?: (typeof RECORD_KINDS)[number];

  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED', 'ALL'])
  status: 'ACTIVE' | 'ARCHIVED' | 'ALL' = 'ACTIVE';
}

export class HrTeacherRecordInputDto {
  @IsIn(RECORD_KINDS)
  kind!: (typeof RECORD_KINDS)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  organization?: string | null;

  @Matches(DATE_PATTERN)
  occurredOn!: string;

  @IsOptional()
  @Matches(DATE_PATTERN)
  expiresOn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsUUID('4')
  attachmentFileId?: string | null;
}

export class UpdateHrTeacherRecordDto extends HrTeacherRecordInputDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ArchiveHrTeacherRecordDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
