import { IsIn, IsOptional, Matches } from 'class-validator';
import { PaginationQueryDto } from '../scheduling/dto/teacher-read-query.dto';

export const TEACHER_RANKING_METRICS = ['EARNINGS', 'ATTENDANCE'] as const;
export type TeacherRankingMetric = (typeof TEACHER_RANKING_METRICS)[number];

export class TeacherRankingQueryDto extends PaginationQueryDto {
  @IsIn(TEACHER_RANKING_METRICS)
  metric: TeacherRankingMetric = 'EARNINGS';

  @IsOptional()
  @Matches(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/)
  month?: string;

  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  revision?: string;
}
