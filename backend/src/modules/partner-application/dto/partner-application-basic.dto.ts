import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PartnerApplicationBasicDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  institutionName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  detailedAddress?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string | null;
}

export class SavePartnerApplicationBasicDto {
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  expectedVersion!: number;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PartnerApplicationBasicDto)
  basicInformation!: PartnerApplicationBasicDto;
}
