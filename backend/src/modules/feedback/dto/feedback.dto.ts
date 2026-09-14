import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

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
}
