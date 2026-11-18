import { Module } from '@nestjs/common';
import { ManualPayoutAdapter } from '../../infrastructure/payout/manual-payout.adapter';
import { AuthModule } from '../auth/auth.module';
import { FileModule } from '../file/file.module';
import { PartnerSettlementService } from './partner-settlement.service';
import { PartnerWithdrawalService } from './partner-withdrawal.service';
import {
  LocalPartnerSettlementGuard,
  ManagementPartnerWithdrawalController,
  PartnerWithdrawalController,
  PartnerWithdrawalProofController,
} from './partner-withdrawal.controllers';

@Module({
  imports: [AuthModule, FileModule],
  controllers: [
    PartnerWithdrawalController,
    PartnerWithdrawalProofController,
    ManagementPartnerWithdrawalController,
  ],
  providers: [
    PartnerSettlementService,
    PartnerWithdrawalService,
    ManualPayoutAdapter,
    LocalPartnerSettlementGuard,
  ],
})
export class PartnerWithdrawalModule {}
