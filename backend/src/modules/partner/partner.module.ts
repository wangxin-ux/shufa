import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PartnerController } from './partner.controller';
import { PartnerReadService } from './partner-read.service';
import { PartnerEarningModule } from '../partner-earning/partner-earning.module';

@Module({
  imports: [AuthModule, PartnerEarningModule],
  controllers: [PartnerController],
  providers: [PartnerReadService],
})
export class PartnerModule {}
