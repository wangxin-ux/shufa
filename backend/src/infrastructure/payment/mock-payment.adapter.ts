import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type {
  PaymentAdapter,
  PaymentInvocation,
  VerifiedPaymentEvent,
} from './payment.adapter';

@Injectable()
export class MockPaymentAdapter implements PaymentAdapter {
  readonly mode = 'MOCK' as const;

  async createJsapiPayment(input: {
    outTradeNo: string;
    amountFen: number;
    description: string;
    payerOpenId: string;
  }): Promise<PaymentInvocation> {
    return { mode: this.mode, outTradeNo: input.outTradeNo };
  }

  async verifyNotification(
    _headers: Record<string, string>,
    rawBody: Buffer,
  ): Promise<VerifiedPaymentEvent> {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as unknown;
    } catch {
      this.invalidNotification('Mock payment notification is not valid JSON');
    }

    if (!isVerifiedMockPayload(payload)) {
      this.invalidNotification('Mock payment notification fields are invalid');
    }

    return {
      provider: this.mode,
      outTradeNo: payload.outTradeNo,
      providerTradeNo: payload.providerTradeNo,
      amountFen: payload.amountFen,
      status: payload.status,
      rawNotification: payload,
    };
  }

  async requestRefund(input: {
    outTradeNo: string;
    outRefundNo: string;
    amountFen: number;
    totalFen: number;
    reason: string;
  }): Promise<{ providerRefundNo: string; status: 'SUCCEEDED' }> {
    return {
      providerRefundNo: `MOCK-${input.outRefundNo}`,
      status: 'SUCCEEDED',
    };
  }

  private invalidNotification(message: string): never {
    throw new DomainError(
      ErrorCode.PAYMENT_NOTIFICATION_INVALID,
      message,
      400,
    );
  }
}

function isVerifiedMockPayload(
  value: unknown,
): value is {
  outTradeNo: string;
  providerTradeNo: string;
  amountFen: number;
  status: 'SUCCEEDED' | 'FAILED';
} & Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.outTradeNo === 'string' &&
    payload.outTradeNo.length > 0 &&
    typeof payload.providerTradeNo === 'string' &&
    payload.providerTradeNo.length > 0 &&
    Number.isInteger(payload.amountFen) &&
    (payload.amountFen as number) > 0 &&
    (payload.status === 'SUCCEEDED' || payload.status === 'FAILED')
  );
}
