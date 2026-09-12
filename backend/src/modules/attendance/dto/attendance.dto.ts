import { Type, Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const ATTENDANCE_STATUSES = ['PRESENT', 'LEAVE', 'ABSENT'] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export class AttendanceItemDto {
  @IsUUID('4')
  studentId!: string;

  @IsIn(ATTENDANCE_STATUSES)
  status!: AttendanceStatus;
}

export class AttendanceDraftDto {
  @IsInt()
  @Min(1)
  lessonVersion!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AttendanceItemDto)
  attendance!: AttendanceItemDto[];
}

export class CompleteLessonDto extends AttendanceDraftDto {}

export class ReverseLessonDto {
  @IsInt()
  @Min(1)
  lessonVersion!: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
