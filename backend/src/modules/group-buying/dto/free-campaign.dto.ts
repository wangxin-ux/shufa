import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  FreeCampaignCapacityMode,
  CampaignReviewStatus,
  CampaignRegistrationStatus,
} from '@prisma/client';
import { GroupPageQueryDto } from './group-buying.dto';

export class FreeSettingsDto {
  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/,
  )
  startsAt!: string | null;

  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/,
  )
  endsAt!: string | null;

  @ValidateIf((_, value: unknown) => value !== null)
  @IsIn(Object.values(FreeCampaignCapacityMode))
  capacityMode!: FreeCampaignCapacityMode | null;

  @ValidateIf((_, value: unknown) => value !== null)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  maxRegistrations!: number | null;
}

export class FreeVersionedActionDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedVersion!: number;
}

export class FreeConfigurationMutationDto extends FreeVersionedActionDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => FreeSettingsDto)
  freeRegistration!: FreeSettingsDto;
}

export class FreeReasonedActionDto extends FreeVersionedActionDto {
  @IsString()
  reason!: string;
}

export class FreeReviewQueryDto extends GroupPageQueryDto {
  @IsOptional()
  @IsIn(Object.values(CampaignReviewStatus))
  status?: CampaignReviewStatus;
}

export class FreeRegistrationQueryDto extends GroupPageQueryDto {
  @IsOptional()
  @IsIn(Object.values(CampaignRegistrationStatus))
  status?: CampaignRegistrationStatus;
}

export class FreeCampaignPhaseQueryDto extends GroupPageQueryDto {
  @IsIn(['ONGOING', 'ENDED'])
  phase: 'ONGOING' | 'ENDED' = 'ONGOING';
}

export class FreeCampaignDetailQueryDto {
  @IsOptional()
  @IsUUID('4')
  versionId?: string;
}

export class FreeRegistrationInputDto {
  @IsUUID('4')
  versionId!: string;

  @IsUUID('4')
  studentId!: string;
}
