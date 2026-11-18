import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { PartnerPageQueryDto } from './partner-query.dto';

export const PARTNER_RANKING_METRICS = [
  'STUDENTS',
  'PARTNER_EARNINGS',
  'HEADQUARTERS_EARNINGS',
] as const;
export type PartnerRankingMetric = (typeof PARTNER_RANKING_METRICS)[number];

export class PartnerRankingQueryDto extends PartnerPageQueryDto {
  @IsIn(PARTNER_RANKING_METRICS)
  metric: PartnerRankingMetric = 'STUDENTS';

  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/)
  month?: string;

  @IsOptional()
  @IsUUID('4')
  revisionId?: string;
}
