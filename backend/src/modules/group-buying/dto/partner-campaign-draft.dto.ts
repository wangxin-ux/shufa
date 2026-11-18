import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsDefined,
  IsArray,
  ArrayMaxSize,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { PartnerCampaignType } from '@prisma/client';
import { GroupPageQueryDto } from './group-buying.dto';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() || null : value;

export class PartnerCampaignDraftQueryDto extends GroupPageQueryDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(Object.values(PartnerCampaignType))
  campaignType?: PartnerCampaignType;
}

export class PartnerCampaignDraftBasicDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  title?: string | null;

  @Transform(trim)
  @IsOptional()
  @IsIn(Object.values(PartnerCampaignType))
  campaignType?: PartnerCampaignType | null;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  shareDescription?: string | null;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string | null;
}

export class SavePartnerCampaignDraftBasicDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedVersion!: number;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PartnerCampaignDraftBasicDto)
  basicInformation!: PartnerCampaignDraftBasicDto;
}

export class SavePartnerCampaignDraftContentDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedVersion!: number;

  @Transform(trim)
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MaxLength(10000)
  activityContent!: string | null;
}

export class SavePartnerCampaignDraftFormDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedVersion!: number;

  @IsArray()
  @ArrayMaxSize(20)
  registrationForm!: unknown[];
}
