import type { PaymentMode } from './payment.constants';

export type PaymentInvocation =
  | { mode: 'MOCK'; outTradeNo: string }
  | {
      mode: 'WECHAT';
      outTradeNo: string;
      timeStamp: string;
      nonceStr: string;
      package: string;
      signType: 'RSA';
      paySign: string;
    };

export interface VerifiedPaymentEvent {
  provider: PaymentMode;
  outTradeNo: string;
  providerTradeNo: string;
  amountFen: number;
  status: 'SUCCEEDED' | 'FAILED';
  rawNotification: Record<string, unknown>;
}

export interface PaymentAdapter {
  readonly mode: PaymentMode;

  createJsapiPayment(input: {
    outTradeNo: string;
    amountFen: number;
    description: string;
    payerOpenId: string;
  }): Promise<PaymentInvocation>;

  verifyNotification(
    headers: Record<string, string>,
    rawBody: Buffer,
  ): Promise<VerifiedPaymentEvent>;

  requestRefund(input: {
    outTradeNo: string;
    outRefundNo: string;
    amountFen: number;
    totalFen: number;
    reason: string;
  }): Promise<{
    providerRefundNo: string;
    status: 'PROCESSING' | 'SUCCEEDED';
  }>;
}
