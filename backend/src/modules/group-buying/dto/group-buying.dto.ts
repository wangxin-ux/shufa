import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class GroupPageQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class ParentGroupCampaignsQueryDto extends GroupPageQueryDto {
  @IsOptional()
  @IsUUID('4')
  studentId?: string;
}

export class GroupOrdersQueryDto extends GroupPageQueryDto {
  @IsOptional()
  @IsIn([
    'PENDING_PAYMENT',
    'PAID',
    'SETTLED',
    'REFUNDING',
    'REFUNDED',
    'CANCELLED',
  ])
  status?:
    | 'PENDING_PAYMENT'
    | 'PAID'
    | 'SETTLED'
    | 'REFUNDING'
    | 'REFUNDED'
    | 'CANCELLED';
}

export class JoinGroupDto {
  @IsUUID('4')
  campaignId!: string;

  @IsUUID('4')
  studentId!: string;
}

export class JoinExistingTeamDto {
  @IsUUID('4')
  studentId!: string;
}

export class GroupPrepayRetryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class MockPaymentConfirmationDto {
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  outTradeNo!: string;
}

export class ManagementGroupCampaignsQueryDto extends GroupPageQueryDto {
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED'])
  status?: 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'CANCELLED';
}

export class ManagementCourseProductsQueryDto extends GroupPageQueryDto {
  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE', 'RETIRED'])
  status?: 'DRAFT' | 'ACTIVE' | 'RETIRED';
}

export class ManagementGroupOrdersQueryDto extends GroupOrdersQueryDto {
  @IsOptional()
  @IsUUID('4')
  campusId?: string;
}

export class GroupCampaignMutationDto {
  @IsUUID('4')
  campusId!: string;

  @IsUUID('4')
  courseProductId!: string;

  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(200)
  title!: string;

  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(1000)
  description!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  priceFen!: number;

  @IsISO8601({ strict: true })
  startsAt!: string;

  @IsISO8601({ strict: true })
  endsAt!: string;
}

export class VersionedGroupCampaignMutationDto extends GroupCampaignMutationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class VersionedGroupActionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class GroupCampaignPosterOrderDto extends VersionedGroupActionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  posterIds!: string[];
}

export class VersionedReasonedGroupActionDto extends VersionedGroupActionDto {
  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(500)
  reason!: string;
}
