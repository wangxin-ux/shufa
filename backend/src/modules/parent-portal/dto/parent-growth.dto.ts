import { Transform } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';

export class StudentPhotoReplaceDto {
  @IsUUID('4')
  fileId!: string;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ParentProfileSetupDto extends StudentPhotoReplaceDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  name!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  birthDate!: string;
}

export class ParentLessonReviewDto {
  @IsInt()
  @Min(1)
  @Max(10)
  teaching!: number;

  @IsInt()
  @Min(1)
  @Max(10)
  communication!: number;

  @IsInt()
  @Min(1)
  @Max(10)
  environment!: number;

  @IsInt()
  @Min(1)
  @Max(10)
  overall!: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(500)
  note?: string;
}
