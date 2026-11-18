import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsEnum,
  IsInt,
  IsObject,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PartnerApplicationMaterialKind } from '@prisma/client';

export class ReservePartnerMaterialDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedVersion!: number;
  @IsUUID('4')
  requestKey!: string;
  @IsEnum(PartnerApplicationMaterialKind)
  kind!: PartnerApplicationMaterialKind;
}
export class PartnerMaterialReferenceDto {
  @IsUUID('4')
  storedFileId!: string;
  @IsEnum(PartnerApplicationMaterialKind)
  kind!: PartnerApplicationMaterialKind;
}
export class SavePartnerMaterialsDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedVersion!: number;
  @IsDefined()
  @IsArray()
  @ArrayMaxSize(14)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => PartnerMaterialReferenceDto)
  materials!: PartnerMaterialReferenceDto[];
}
