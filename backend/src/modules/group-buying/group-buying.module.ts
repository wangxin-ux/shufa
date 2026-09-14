import { Module } from '@nestjs/common';
import { PaymentModule } from '../../infrastructure/payment/payment.module';
import { AuthModule } from '../auth/auth.module';
import { FileModule } from '../file/file.module';
import { GroupCampaignPosterMediaController } from './group-campaign-poster-media.controller';
import { GroupBuyingCommandService } from './group-buying-command.service';
import { GroupBuyingPaymentService } from './group-buying-payment.service';
import { GroupBuyingQueryService } from './group-buying-query.service';
import { GroupBuyingSettlementService } from './group-buying-settlement.service';
import { GroupBuyingManagementService } from './group-buying-management.service';
import { ManagementGroupBuyingController } from './management-group-buying.controller';
import { ParentGroupBuyingController } from './parent-group-buying.controller';
import { PaymentNotificationController } from './payment-notification.controller';
import { PartnerGroupPromotionController } from './partner-group-promotion.controller';
import { TeacherGroupPromotionController } from './teacher-group-promotion.controller';

@Module({
  imports: [AuthModule, PaymentModule, FileModule],
  controllers: [
    ParentGroupBuyingController,
    ManagementGroupBuyingController,
    PaymentNotificationController,
    GroupCampaignPosterMediaController,
    TeacherGroupPromotionController,
    PartnerGroupPromotionController,
  ],
  providers: [
    GroupBuyingQueryService,
    GroupBuyingCommandService,
    GroupBuyingPaymentService,
    GroupBuyingSettlementService,
    GroupBuyingManagementService,
  ],
})
export class GroupBuyingModule {}
