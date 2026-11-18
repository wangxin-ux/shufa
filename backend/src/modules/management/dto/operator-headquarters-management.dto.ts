import { PickType } from '@nestjs/swagger';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import { CreateStaffAccountDto } from './staff-account-management.dto';

export class CreateOperatorHeadquartersDto extends PickType(
  CreateStaffAccountDto,
  ['displayName', 'phone'] as const,
) {}

export class UpdateOperatorCampusGrantDto {
  @IsBoolean()
  isActive!: boolean;

  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  expectedVersion!: number;
}
