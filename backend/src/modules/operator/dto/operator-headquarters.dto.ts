import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { PartnerSearchQueryDto } from '../../partner/dto/partner-query.dto';

export class OperatorHeadquartersCampusesQueryDto extends PartnerSearchQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  page = 1;
}
