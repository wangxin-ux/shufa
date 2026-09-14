import { Injectable } from '@nestjs/common';
import type { MarkManualPayoutInput, PayoutAdapter } from './payout.adapter';

@Injectable()
export class ManualPayoutAdapter implements PayoutAdapter {
  markPaid(input: MarkManualPayoutInput): Promise<{ paidAt: Date }> {
    if (!input.payoutReference.trim() || !input.payoutProofFileId) {
      throw new RangeError('Manual payout evidence is required');
    }
    return Promise.resolve({ paidAt: new Date() });
  }
}
