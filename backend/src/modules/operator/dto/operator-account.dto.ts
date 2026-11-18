import {
  PartnerLessonQueryDto,
  PartnerSearchQueryDto,
} from '../../partner/dto/partner-query.dto';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export const OPERATOR_ACCOUNT_MAX_OFFSET = 2147483647;

// Redeclaring page replaces its inherited validators; retain all page constraints.
export class OperatorAccountQueryDto extends PartnerLessonQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(OPERATOR_ACCOUNT_MAX_OFFSET)
  page = 1;
}

export class OperatorAccountSubjectsQueryDto extends PartnerSearchQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(OPERATOR_ACCOUNT_MAX_OFFSET)
  page = 1;
}
