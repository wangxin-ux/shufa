import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerServiceQrMediaController } from './customer-service-qr-media.controller';
import { PayoutProofController } from './payout-proof.controller';
import { PayoutProofService } from './payout-proof.service';
import { StoredFileService } from './stored-file.service';

@Module({
  imports: [AuthModule],
  controllers: [PayoutProofController, CustomerServiceQrMediaController],
  providers: [StoredFileService, PayoutProofService],
  exports: [StoredFileService, PayoutProofService],
})
export class FileModule {}
