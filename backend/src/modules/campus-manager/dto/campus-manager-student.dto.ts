import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = (params: TransformFnParams): unknown =>
  typeof params.value === 'string' ? params.value.trim() : params.value;

export class CampusManagerStudentsQueryDto {
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

export class CampusManagerCreateStudentDto {
  @Transform(trim)
  @IsString()
  @Matches(/\S/, {
    message: 'displayName must contain non-whitespace text',
  })
  @MaxLength(100)
  displayName!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  birthDate?: string | null;

  @IsOptional()
  @IsUUID('4')
  classGroupId?: string | null;
}
