import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsObject,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class TeacherFeedbackRatingsDto {
  @ValidateIf((_, value: unknown) => value !== null)
  @IsInt()
  @Min(0)
  @Max(10)
  classroomPerformance!: number | null;

  @ValidateIf((_, value: unknown) => value !== null)
  @IsInt()
  @Min(0)
  @Max(10)
  workCompletion!: number | null;

  @ValidateIf((_, value: unknown) => value !== null)
  @IsInt()
  @Min(0)
  @Max(10)
  communication!: number | null;

  @ValidateIf((_, value: unknown) => value !== null)
  @IsInt()
  @Min(0)
  @Max(10)
  overall!: number | null;
}

export class FeedbackUpsertDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  content!: string;

  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  imageFileIds!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  performanceRating?: number | null;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  expectedVersion?: number;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => TeacherFeedbackRatingsDto)
  teacherRatings?: TeacherFeedbackRatingsDto;
}
