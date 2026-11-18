import { GroupBuyingCommandService } from './group-buying-command.service';
import { GroupBuyingPaymentService } from './group-buying-payment.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ParentScopeService } from '../../common/auth/parent-scope.service';
import type { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type { GroupBuyingSettlementService } from './group-buying-settlement.service';
import type { PaymentAdapter } from '../../infrastructure/payment/payment.adapter';

const scope = { userId: 'internal-user-id', campusId: 'campus-id' };
const expiresAt = new Date(Date.now() + 30 * 60_000);

function fixture(
  mode: 'MOCK' | 'WECHAT' = 'WECHAT',
  subject: string | null = 'bound-openid',
) {
  const campaign = {
    id: 'campaign-id',
    title: 'Synthetic course',
    campusId: scope.campusId,
    priceFen: 1990,
    courseProductId: 'product-id',
    status: 'ACTIVE',
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 3600_000),
    courseProduct: { validityDays: 365, status: 'ACTIVE' },
  };
  const invocation = {
    mode: 'WECHAT',
    outTradeNo: 'GPAY-001',
    timeStamp: '1',
    nonceStr: 'nonce',
    package: 'prepay_id=test',
    signType: 'RSA',
    paySign: 'test',
  };
  const payment = {
    id: 'payment-id',
    outTradeNo: 'GPAY-001',
    amountFen: 1990,
    status: 'PENDING',
  };
  const member = {
    id: 'member-id',
    status: 'PENDING_PAYMENT',
    version: 1,
    reservationExpiresAt: expiresAt,
    enrollmentOrderId: 'order-id',
    campaign,
    transactions: [payment],
  };
  const transaction = {
    authIdentity: {
      findUnique: jest.fn().mockResolvedValue(subject ? { subject } : null),
    },
    groupCampaign: { findFirst: jest.fn().mockResolvedValue(campaign) },
    groupTeam: { create: jest.fn().mockResolvedValue({ id: 'team-id' }) },
    groupMember: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(member),
      findFirst: jest.fn().mockResolvedValue(member),
    },
    enrollmentOrder: {
      create: jest.fn().mockResolvedValue({ id: 'order-id' }),
    },
    paymentTransaction: { create: jest.fn().mockResolvedValue(payment) },
  };
  const prisma = {
    $transaction: async (work: (value: typeof transaction) => unknown) =>
      work(transaction),
  };
  const idempotency = {
    claim: jest.fn().mockResolvedValue({ replayed: false }),
    complete: jest.fn(),
  };
  const adapter = {
    mode,
    createJsapiPayment: jest.fn().mockResolvedValue(invocation),
  };
  const parentScope = {
    resolveStudent: jest.fn().mockResolvedValue({ id: 'student-id' }),
  };
  return {
    transaction,
    adapter,
    command: new GroupBuyingCommandService(
      prisma as unknown as PrismaService,
      parentScope as unknown as ParentScopeService,
      idempotency as unknown as IdempotencyService,
      adapter as unknown as PaymentAdapter,
    ),
    payment: new GroupBuyingPaymentService(
      prisma as unknown as PrismaService,
      idempotency as unknown as IdempotencyService,
      {} as GroupBuyingSettlementService,
      adapter as unknown as PaymentAdapter,
    ),
  };
}

describe('group buying payment payer', () => {
  it('reads the server-bound OpenID for retry instead of the system user ID', async () => {
    const test = fixture();
    await test.payment.retryPrepay(scope, 'member-id', 1, 'retry-key');
    expect(test.transaction.authIdentity.findUnique).toHaveBeenCalledWith({
      where: { userId_provider: { userId: scope.userId, provider: 'WECHAT' } },
      select: { subject: true },
    });
    expect(test.adapter.createJsapiPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        payerOpenId: 'bound-openid',
        expiresAt,
      }),
    );
  });

  it('blocks a retry without a bound WeChat identity', async () => {
    const test = fixture('WECHAT', null);
    await expect(
      test.payment.retryPrepay(scope, 'member-id', 1, 'retry-key'),
    ).rejects.toMatchObject({ code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE });
    expect(test.adapter.createJsapiPayment).not.toHaveBeenCalled();
  });

  it('keeps mock accounts usable without a WeChat identity lookup', async () => {
    const test = fixture('MOCK', null);
    await test.payment.retryPrepay(scope, 'member-id', 1, 'retry-key');
    expect(test.transaction.authIdentity.findUnique).not.toHaveBeenCalled();
    expect(test.adapter.createJsapiPayment).toHaveBeenCalled();
  });

  it('passes the bound payer, provider-compatible order number and expiry on creation', async () => {
    const test = fixture();
    // Stop after the provider boundary; query serialization is covered by DB tests.
    test.adapter.createJsapiPayment.mockRejectedValue(
      new Error('stop-after-prepay'),
    );
    await expect(
      test.command.createTeam(
        scope,
        { campaignId: 'campaign-id', studentId: 'student-id' },
        'create-key',
      ),
    ).rejects.toThrow('stop-after-prepay');
    expect(test.adapter.createJsapiPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        payerOpenId: 'bound-openid',
        expiresAt,
        outTradeNo: expect.stringMatching(/^[a-zA-Z0-9_-]{6,32}$/),
      }),
    );
  });
});
