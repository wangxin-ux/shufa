import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export type ManagementRevenuePeriod =
  'TODAY' | 'LAST_7_DAYS' | 'CURRENT_MONTH' | 'HISTORY';

export class ManagementDashboardQueryDto {
  @IsOptional()
  @IsIn(['TODAY', 'LAST_7_DAYS', 'CURRENT_MONTH', 'HISTORY'])
  revenuePeriod: ManagementRevenuePeriod = 'TODAY';
}

export class ManagementPageQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class ManagementCampusesQueryDto extends ManagementPageQueryDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;
}

export class ManagementUpdateCampusMapLocationDto {
  @Transform(trim)
  @IsString()
  @Matches(/\S/, { message: 'address must contain non-whitespace text' })
  @MaxLength(300)
  address!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsBoolean()
  mapVisible!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ManagementUploadCampusCustomerServiceQrDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ManagementStudentsQueryDto extends ManagementPageQueryDto {
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;
}

export class ManagementLessonLedgerQueryDto extends ManagementPageQueryDto {
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @IsOptional()
  @IsUUID('4')
  studentId?: string;

  @IsOptional()
  @IsIn(['GRANT', 'CONSUME', 'REVERSAL', 'ADJUSTMENT', 'REFUND', 'CORRECTION'])
  entryType?:
    'GRANT' | 'CONSUME' | 'REVERSAL' | 'ADJUSTMENT' | 'REFUND' | 'CORRECTION';

  @IsOptional()
  @IsIn(['MAIN', 'GIFT'])
  bucket?: 'MAIN' | 'GIFT';
}

export class ManagementAdjustLessonLedgerDto {
  @IsUUID('4')
  coursePackageId!: string;

  @IsIn(['MAIN', 'GIFT'])
  bucket!: 'MAIN' | 'GIFT';

  @Type(() => Number)
  @IsInt()
  deltaUnits!: number;

  @Transform(trim)
  @IsString()
  @Matches(/\S/, { message: 'reason must contain non-whitespace text' })
  @MaxLength(500)
  reason!: string;
}

export class ManagementUpdateCoursePackageValidityDto {
  @IsISO8601({ strict: true })
  validFrom!: string;

  @ValidateIf((_object, value) => value !== null)
  @IsISO8601({ strict: true })
  expiresAt!: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @Transform(trim)
  @IsString()
  @Matches(/\S/, { message: 'reason must contain non-whitespace text' })
  @MaxLength(500)
  reason!: string;
}

export class ManagementAuditLogsQueryDto extends ManagementPageQueryDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @IsUUID('4')
  campusId?: string;
}
