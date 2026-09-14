import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateBy,
  isUUID,
} from 'class-validator';
import { ManagementPageQueryDto } from './management.dto';
import {
  DIRECTLY_CREATABLE_STAFF_ROLES,
  MANAGEABLE_STAFF_ROLES,
  isHeadquartersStaffRole,
} from '../../../common/auth/staff-roles';
const STAFF_ACCOUNT_STATUSES = ['ACTIVE', 'DISABLED'] as const;

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export type ManageableStaffRole = (typeof MANAGEABLE_STAFF_ROLES)[number];
export type DirectlyCreatableStaffRole =
  (typeof DIRECTLY_CREATABLE_STAFF_ROLES)[number];
export type StaffAccountStatus = (typeof STAFF_ACCOUNT_STATUSES)[number];

export interface StaffAccountCreationInput {
  displayName: string;
  phone: string;
  roleCode: ManageableStaffRole;
  campusId: string | null;
}

export class StaffAccountsQueryDto extends ManagementPageQueryDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  @IsOptional()
  @IsIn(MANAGEABLE_STAFF_ROLES)
  roleCode?: ManageableStaffRole;

  @IsOptional()
  @IsUUID('4')
  campusId?: string;

  @IsOptional()
  @IsIn(STAFF_ACCOUNT_STATUSES)
  status?: StaffAccountStatus;
}

export class CreateStaffAccountDto implements StaffAccountCreationInput {
  @Transform(trim)
  @IsString()
  @Matches(/\S/, { message: 'displayName must contain non-whitespace text' })
  @MaxLength(100)
  displayName!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^(?:\+?86)?1[3-9][0-9]{9}$/)
  phone!: string;

  @IsIn(DIRECTLY_CREATABLE_STAFF_ROLES)
  roleCode!: DirectlyCreatableStaffRole;

  @ValidateBy({
    name: 'staffCampusScope',
    validator: {
      validate: (value: unknown, args) =>
        isHeadquartersStaffRole((args?.object as CreateStaffAccountDto).roleCode)
          ? value === null
          : typeof value === 'string' && isUUID(value, '4'),
      defaultMessage: () => 'Headquarters staff require null campusId; campus staff require a campus UUID',
    },
  })
  campusId!: string | null;
}

export class UpdateStaffAccountStatusDto {
  @IsIn(STAFF_ACCOUNT_STATUSES)
  status!: StaffAccountStatus;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class UnbindStaffWechatDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
