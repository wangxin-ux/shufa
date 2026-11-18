import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PartnerSearchQueryDto } from '../partner/dto/partner-query.dto';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().normalize('NFC') : value;

export class SubjectPageQueryDto extends PartnerSearchQueryDto {}
export class SubjectLinksQueryDto extends SubjectPageQueryDto {
  @IsIn(['CLASS', 'PACKAGE'])
  kind: 'CLASS' | 'PACKAGE' = 'PACKAGE';
}
export class SubjectCreateDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}
export class SubjectUpdateDto extends SubjectCreateDto {
  @IsBoolean()
  isActive!: boolean;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
export class SubjectBindDto {
  @ValidateIf((_: unknown, value: unknown) => value !== null)
  @IsUUID('4')
  subjectId!: string | null;

  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  reason!: string;
}
