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

export class PartnerApplicationBankDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  bankName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountHolder?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  accountNumber?: string | null;
}

export class SavePartnerApplicationBankDto {
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  expectedVersion!: number;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PartnerApplicationBankDto)
  bankInformation!: PartnerApplicationBankDto;
}
