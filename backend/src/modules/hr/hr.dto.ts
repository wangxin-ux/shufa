import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Matches,
} from 'class-validator';

export class HrDirectoryQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize = 20;
  @IsOptional() @IsString() @MaxLength(100) query?: string;
}
export class HrTeacherQueryDto extends HrDirectoryQueryDto {
  @IsOptional() @IsUUID('4') campusId?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
}
export class HrReportQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize = 20;
  @IsOptional() @IsUUID('4') campusId?: string;
  @IsOptional() @IsUUID('4') teacherId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}
