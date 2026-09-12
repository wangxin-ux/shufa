import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  ManagementPartnerEarningController,
  ManagementPartnerEarningReviewController,
} from './management-partner-earning.controller';
import { PartnerEarningQueryService } from './partner-earning-query.service';
import { PartnerEarningRuleManagementService } from './partner-earning-rule-management.service';
import { PartnerEarningRuleService } from './partner-earning-rule.service';
import { PartnerEarningRecordingService } from './partner-earning-recording.service';
import { PartnerEarningReviewService } from './partner-earning-review.service';

@Module({
  imports: [AuthModule],
  controllers: [
    ManagementPartnerEarningController,
    ManagementPartnerEarningReviewController,
  ],
  providers: [
    PartnerEarningRuleService,
    PartnerEarningRuleManagementService,
    PartnerEarningRecordingService,
    PartnerEarningQueryService,
    PartnerEarningReviewService,
  ],
  exports: [
    PartnerEarningRuleService,
    PartnerEarningRecordingService,
    PartnerEarningQueryService,
  ],
})
export class PartnerEarningModule {}
