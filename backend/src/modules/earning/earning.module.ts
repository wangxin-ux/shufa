import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EarningRuleService } from './earning-rule.service';
import { EarningRecordingService } from './earning-recording.service';
import { EarningQueryService } from './earning-query.service';
import { EarningRuleManagementService } from './earning-rule-management.service';
import { EarningReviewService } from './earning-review.service';
import { TeacherEarningController } from './teacher-earning.controller';
import { ManagementEarningController } from './management-earning.controller';

@Module({
  imports: [AuthModule],
  controllers: [TeacherEarningController, ManagementEarningController],
  providers: [
    EarningRuleService,
    EarningRecordingService,
    EarningQueryService,
    EarningRuleManagementService,
    EarningReviewService,
  ],
  exports: [EarningRuleService, EarningRecordingService],
})
export class EarningModule {}
