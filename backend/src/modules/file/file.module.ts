import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerServiceQrMediaController } from './customer-service-qr-media.controller';
import { PayoutProofController } from './payout-proof.controller';
import { PayoutProofService } from './payout-proof.service';
import { StoredFileService } from './stored-file.service';
import { StudentPhotoMediaController } from './student-photo-media.controller';
import { PartnerPrivateLocalAdapter } from './partner-private-local.adapter';

@Module({
  imports: [AuthModule],
  controllers: [
    PayoutProofController,
    CustomerServiceQrMediaController,
    StudentPhotoMediaController,
  ],
  providers: [
    StoredFileService,
    PayoutProofService,
    PartnerPrivateLocalAdapter,
  ],
  exports: [StoredFileService, PayoutProofService, PartnerPrivateLocalAdapter],
})
export class FileModule {}
