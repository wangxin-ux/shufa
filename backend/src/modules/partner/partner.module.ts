import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PartnerController } from './partner.controller';
import { PartnerReadService } from './partner-read.service';
import { PartnerStudentQueryService } from './partner-student-query.service';
import { PartnerEarningModule } from '../partner-earning/partner-earning.module';
import { FileModule } from '../file/file.module';
import { PartnerStudentGrowthService } from './partner-student-growth.service';
import { PartnerRankingController } from './partner-ranking.controller';
import { PartnerRankingService } from './partner-ranking.service';
import { PartnerTeacherPerformanceController } from './partner-teacher-performance.controller';
import { PartnerTeacherPerformanceService } from './partner-teacher-performance.service';

@Module({
  imports: [AuthModule, PartnerEarningModule, FileModule],
  controllers: [PartnerController, PartnerRankingController, PartnerTeacherPerformanceController],
  providers: [
    PartnerReadService,
    PartnerStudentQueryService,
    PartnerStudentGrowthService,
    PartnerRankingService,
    PartnerTeacherPerformanceService,
  ],
  exports: [PartnerRankingService],
})
export class PartnerModule {}
