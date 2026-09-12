import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const trim = (params: TransformFnParams): unknown =>
  typeof params.value === 'string' ? params.value.trim() : params.value;

const trimNullable = (params: TransformFnParams): unknown => {
  if (typeof params.value !== 'string') {
    return params.value;
  }
  const value = params.value.trim();
  return value.length === 0 ? null : value;
};

const CHINA_PHONE_PATTERN = /^(?:1[3-9]\d{9}|0\d{2,3}-?\d{7,8})$/;

export class CampusManagerWarningsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;
}

export class CampusManagerUpdateCampusDto {
  @IsInt()
  @Min(1)
  version!: number;

  @Transform(trim)
  @IsString()
  @Matches(/\S/, { message: 'name must contain non-whitespace text' })
  @MaxLength(200)
  name!: string;

  @Transform(trimNullable)
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(CHINA_PHONE_PATTERN, {
    message: 'contactPhone must be a mainland China mobile or landline number',
  })
  @MaxLength(30)
  contactPhone!: string | null;

  @Transform(trimNullable)
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(300)
  address!: string | null;

  @IsInt()
  @Min(0)
  lessonWarningThresholdUnits!: number;
}
