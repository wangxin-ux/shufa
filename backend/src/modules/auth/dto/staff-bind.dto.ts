import { IsString, MaxLength, MinLength } from 'class-validator';

export class StaffBindDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  code!: string;

  @IsString()
  @MinLength(16)
  @MaxLength(256)
  bindToken!: string;
}
