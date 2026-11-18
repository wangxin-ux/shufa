import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ManagementModule } from '../management/management.module';
import { PartnerApplicantController } from './partner-applicant.controller';
import { PartnerApplicantGuard } from './partner-applicant.guard';
import { PartnerApplicantSessionService } from './partner-applicant-session.service';
import { PartnerApplicationController } from './partner-application.controller';
import { PartnerApplicationArchiveController } from './partner-application-archive.controller';
import { PartnerApplicationService } from './partner-application.service';
import { PartnerApplicationBankService } from './partner-application-bank.service';
import { FileModule } from '../file/file.module';
import {
  PARTNER_APPLICATION_MATERIAL_RUN_TAG,
  PartnerPrivateImageStore,
} from '../file/partner-private-image-store';
import { PartnerApplicationMaterialService } from './partner-application-material.service';
import { PartnerApplicationMaterialController } from './partner-application-material.controller';
import { PartnerApplicationSubmissionService } from './partner-application-submission.service';
import { PartnerApplicationReviewService } from './partner-application-review.service';
import { PartnerApplicationReviewController } from './partner-application-review.controller';
import {
  PARTNER_APPLICATION_REGION_CATALOG,
  unavailableRegionCatalog,
} from './partner-application-region-catalog';
import {
  PARTNER_APPLICATION_PRIVATE_KEY_RING,
  PartnerApplicationPrivateCipher,
  unavailablePrivateKeyRing,
} from './partner-application-private-cipher';
import {
  PARTNER_APPLICANT_RATE_LIMIT,
  PartnerApplicantRateLimit,
} from './partner-applicant-rate-limit';

@Module({
  imports: [AuthModule, FileModule, ManagementModule],
  controllers: [
    PartnerApplicantController,
    PartnerApplicationController,
    PartnerApplicationArchiveController,
    PartnerApplicationMaterialController,
    PartnerApplicationReviewController,
  ],
  providers: [
    PartnerApplicantSessionService,
    PartnerApplicationService,
    PartnerApplicationBankService,
    PartnerApplicationMaterialService,
    PartnerApplicationSubmissionService,
    PartnerApplicationReviewService,
    {
      provide: PARTNER_APPLICATION_REGION_CATALOG,
      useValue: unavailableRegionCatalog,
    },
    PartnerPrivateImageStore,
    { provide: PARTNER_APPLICATION_MATERIAL_RUN_TAG, useValue: undefined },
    PartnerApplicationPrivateCipher,
    {
      provide: PARTNER_APPLICATION_PRIVATE_KEY_RING,
      useValue: unavailablePrivateKeyRing,
    },
    PartnerApplicantGuard,
    {
      provide: PARTNER_APPLICANT_RATE_LIMIT,
      useClass: PartnerApplicantRateLimit,
    },
  ],
})
export class PartnerApplicationModule {}
