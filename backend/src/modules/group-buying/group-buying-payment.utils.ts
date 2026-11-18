import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type { PaymentMode } from '../../infrastructure/payment/payment.constants';

export function createPaymentBusinessNo(): string {
  return `GPAY-${randomUUID().replaceAll('-', '').slice(0, 27)}`;
}

export async function resolveGroupPaymentPayer(
  transaction: Prisma.TransactionClient,
  userId: string,
  mode: PaymentMode,
): Promise<string> {
  if (mode === 'MOCK') return userId;
  const identity = await transaction.authIdentity.findUnique({
    where: { userId_provider: { userId, provider: 'WECHAT' } },
    select: { subject: true },
  });
  if (!identity?.subject.trim()) {
    throw new DomainError(
      ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
      'A bound WeChat identity is required for payment',
      503,
    );
  }
  return identity.subject;
}
