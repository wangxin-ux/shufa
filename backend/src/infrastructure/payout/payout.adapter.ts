export interface MarkManualPayoutInput {
  withdrawalId: string;
  payoutReference: string;
  payoutProofFileId: string;
}

export interface PayoutAdapter {
  markPaid(input: MarkManualPayoutInput): Promise<{ paidAt: Date }>;
}
