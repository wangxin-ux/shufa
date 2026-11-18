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
import { CourseProductService } from './course-product.service';
import { PartnerCampaignDraftsController } from './partner-campaign-drafts.controller';
import { PartnerCampaignDraftsService } from './partner-campaign-drafts.service';
import { PartnerCampaignImagesService } from './partner-campaign-images.service';
import { PartnerCampaignImagesController, PartnerCampaignImageMediaController } from './partner-campaign-images.controller';
import {
  PartnerFreeCampaignController,
  PartnerPublishedFreeCampaignController,
  ManagementFreeCampaignController,
  ParentFreeCampaignController,
} from './free-campaign.controllers';
import { FreeCampaignScopeService } from './free-campaign-scope.service';
import { FreeCampaignConfigService } from './free-campaign-config.service';
import { FreeCampaignReviewService } from './free-campaign-review.service';
import { FreeCampaignRegistrationService } from './free-campaign-registration.service';

@Module({
  imports: [AuthModule, PaymentModule, FileModule],
  controllers: [
    ParentGroupBuyingController,
    ManagementGroupBuyingController,
    PaymentNotificationController,
    GroupCampaignPosterMediaController,
    TeacherGroupPromotionController,
    PartnerGroupPromotionController,
    PartnerCampaignDraftsController,
    PartnerCampaignImagesController,
    PartnerCampaignImageMediaController,
    PartnerFreeCampaignController,
    PartnerPublishedFreeCampaignController,
    ManagementFreeCampaignController,
    ParentFreeCampaignController,
  ],
  providers: [
    CourseProductService,
    GroupBuyingQueryService,
    GroupBuyingCommandService,
    GroupBuyingPaymentService,
    GroupBuyingSettlementService,
    GroupBuyingManagementService,
    PartnerCampaignDraftsService,
    PartnerCampaignImagesService,
    FreeCampaignScopeService,
    FreeCampaignConfigService,
    FreeCampaignReviewService,
    FreeCampaignRegistrationService,
  ],
})
export class GroupBuyingModule {}
