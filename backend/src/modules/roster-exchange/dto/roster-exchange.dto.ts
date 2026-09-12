import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CustomerRosterEntryDto {
  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  studentName!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^(?:\+?86)?1[3-9][0-9]{9}$/)
  parentPhone!: string;
}

export class ManagementCustomerRosterEntryDto extends CustomerRosterEntryDto {
  @IsUUID('4')
  campusId!: string;
}

export class TeacherRosterEntryDto {
  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  teacherName!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^(?:\+?86)?1[3-9][0-9]{9}$/)
  phone!: string;
}

export class ManagementTeacherRosterEntryDto extends TeacherRosterEntryDto {
  @IsUUID('4')
  campusId!: string;
}

export class RosterListQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;
}

export class ManagementRosterListQueryDto extends RosterListQueryDto {
  @IsOptional()
  @IsUUID('4')
  campusId?: string;
}

export class RosterExportQueryDto {
  @Transform(({ value }: TransformFnParams) =>
    value === 'true' || value === true ? true : value === 'false' || value === false ? false : value,
  )
  @IsBoolean()
  confirmed!: boolean;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;
}

export class ManagementRosterExportQueryDto extends RosterExportQueryDto {
  @IsOptional()
  @IsUUID('4')
  campusId?: string;
}
