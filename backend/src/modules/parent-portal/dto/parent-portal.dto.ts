import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ParentCampusesQueryDto {
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
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}

export class ParentStudentQueryDto {
  @IsOptional()
  @IsUUID('4')
  studentId?: string;
}

export class ParentLeaveRequestDto {
  @IsUUID('4')
  studentId!: string;

  @IsUUID('4')
  lessonSessionId!: string;

  @Transform((params: TransformFnParams): unknown => {
    const value = params.value as unknown;
    return typeof value === 'string' ? value.trim() : value;
  })
  @IsString()
  @Matches(/\S/, { message: 'reason must contain non-whitespace text' })
  @MaxLength(500)
  reason!: string;
}

export class ParentProfileUpdateDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  age!: number;

  @Transform((params: TransformFnParams): unknown => {
    const value = params.value as unknown;
    return typeof value === 'string' ? value.trim() : value;
  })
  @IsString()
  @MaxLength(300)
  homeAddress!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
