import { Module } from '@nestjs/common';
import { ManualPayoutAdapter } from '../../infrastructure/payout/manual-payout.adapter';
import { AuthModule } from '../auth/auth.module';
import { ManagementWithdrawalController } from './management-withdrawal.controller';
import { WithdrawalController } from './withdrawal.controller';
import { WithdrawalManagementService } from './withdrawal-management.service';
import { WithdrawalPolicyService } from './withdrawal-policy.service';
import { WithdrawalService } from './withdrawal.service';

@Module({
  imports: [AuthModule],
  controllers: [WithdrawalController, ManagementWithdrawalController],
  providers: [
    WithdrawalService,
    WithdrawalManagementService,
    WithdrawalPolicyService,
    ManualPayoutAdapter,
  ],
  exports: [WithdrawalService],
})
export class WithdrawalModule {}
