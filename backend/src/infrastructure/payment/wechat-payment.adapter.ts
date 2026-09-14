import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type {
  PaymentAdapter,
  PaymentInvocation,
  VerifiedPaymentEvent,
} from './payment.adapter';

@Injectable()
export class WechatPaymentAdapter implements PaymentAdapter {
  readonly mode = 'WECHAT' as const;

  async createJsapiPayment(_input: {
    outTradeNo: string;
    amountFen: number;
    description: string;
    payerOpenId: string;
  }): Promise<PaymentInvocation> {
    this.unavailable();
  }

  async verifyNotification(
    _headers: Record<string, string>,
    _rawBody: Buffer,
  ): Promise<VerifiedPaymentEvent> {
    this.unavailable();
  }

  async requestRefund(_input: {
    outTradeNo: string;
    outRefundNo: string;
    amountFen: number;
    totalFen: number;
    reason: string;
  }): Promise<{ providerRefundNo: string; status: 'PROCESSING' | 'SUCCEEDED' }> {
    this.unavailable();
  }

  private unavailable(): never {
    throw new DomainError(
      ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
      'WeChat Pay is not connected to verified merchant credentials',
      503,
    );
  }
}
