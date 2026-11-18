import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '@prisma/client';
import {
  createCipheriv,
  generateKeyPairSync,
  randomUUID,
  sign,
} from 'node:crypto';
import {
  ParentScopeService,
  type ParentScope,
} from '../src/common/auth/parent-scope.service';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';
import { ErrorCode } from '../src/common/errors/error-codes';
import { MockPaymentAdapter } from '../src/infrastructure/payment/mock-payment.adapter';
import { WechatPaymentAdapter } from '../src/infrastructure/payment/wechat-payment.adapter';
import type { PaymentAdapter } from '../src/infrastructure/payment/payment.adapter';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { GroupBuyingCommandService } from '../src/modules/group-buying/group-buying-command.service';
import { GroupBuyingPaymentService } from '../src/modules/group-buying/group-buying-payment.service';
import { GroupBuyingSettlementService } from '../src/modules/group-buying/group-buying-settlement.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';

jest.setTimeout(30_000);
const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 });
const platform = generateKeyPairSync('rsa', { modulusLength: 2048 });
const apiKey = '0123456789abcdef0123456789abcdef';
const keyId = 'PUB_KEY_ID_123456789';
const syntheticConfig = {
  PAYMENT_DRIVER: 'wechat',
  WECHAT_APP_ID: 'wx-synthetic-payment',
  WECHAT_MCH_ID: '1900000001',
  WECHAT_PAY_API_V3_KEY: apiKey,
  WECHAT_PAY_CERT_SERIAL_NO: '123456ABCDEF',
  WECHAT_PAY_PRIVATE_KEY: merchant.privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString(),
  WECHAT_PAY_PUBLIC_KEY: platform.publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString(),
  WECHAT_PAY_PUBLIC_KEY_ID: keyId,
  WECHAT_PAY_NOTIFY_URL: 'https://example.test/payments/wechat/notifications',
};

function signedHeaders(raw: Buffer | string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  return {
    'wechatpay-timestamp': timestamp,
    'wechatpay-nonce': nonce,
    'wechatpay-serial': keyId,
    'wechatpay-signature': sign(
      'RSA-SHA256',
      Buffer.concat([
        Buffer.from(`${timestamp}\n${nonce}\n`),
        Buffer.from(raw),
        Buffer.from('\n'),
      ]),
      platform.privateKey,
    ).toString('base64'),
  };
}

function paymentEvent(outTradeNo: string, amountFen = 1990) {
  const nonce = 'testnonce123';
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(apiKey),
    Buffer.from(nonce),
  );
  cipher.setAAD(Buffer.from('transaction'));
  const ciphertext = Buffer.concat([
    cipher.update(
      JSON.stringify({
        appid: syntheticConfig.WECHAT_APP_ID,
        mchid: syntheticConfig.WECHAT_MCH_ID,
        out_trade_no: outTradeNo,
        transaction_id: `WX${randomUUID().replaceAll('-', '').slice(0, 28)}`,
        trade_type: 'JSAPI',
        trade_state: 'SUCCESS',
        amount: { total: amountFen, currency: 'CNY' },
      }),
    ),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
  const raw = Buffer.from(
    JSON.stringify({
      id: randomUUID(),
      event_type: 'TRANSACTION.SUCCESS',
      resource_type: 'encrypt-resource',
      resource: {
        algorithm: 'AEAD_AES_256_GCM',
        original_type: 'transaction',
        associated_data: 'transaction',
        nonce,
        ciphertext,
      },
    }),
  );
  return { raw, headers: signedHeaders(raw) };
}

type Joined = {
  team: { id: string };
  order: { id: string; memberId: string; version: number };
  prepay: { memberId: string; outTradeNo: string };
};

describe('synthetic WeChat payments with PostgreSQL', () => {
  let prisma: PrismaClient;
  let transport: jest.SpiedFunction<typeof fetch>;
  beforeAll(async () => {
    const target = assertPartnerPdfTestTarget(process.env);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: target.href }),
    });
    await prisma.$connect();
  });
  beforeEach(() => {
    transport = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      const raw = JSON.stringify({ prepay_id: 'synthetic-prepay' });
      return Promise.resolve(
        new Response(raw, { status: 200, headers: signedHeaders(raw) }),
      );
    });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function rollbackFixture(
    work: (fixture: Awaited<ReturnType<typeof setup>>) => Promise<void>,
    adapter: PaymentAdapter = new WechatPaymentAdapter(
      new ConfigService(syntheticConfig),
    ),
  ) {
    const marker = `WPAY-CHECK-${randomUUID()}`;
    const rolledBack = new Error('Intentional synthetic fixture rollback');
    await expect(
      prisma.$transaction(
        async (transaction) => {
          await work(await setup(transaction, marker, adapter));
          throw rolledBack;
        },
        { timeout: 20_000 },
      ),
    ).rejects.toBe(rolledBack);
    expect(await prisma.campus.count({ where: { code: marker } })).toBe(0);
    expect(await prisma.user.count({ where: { displayName: marker } })).toBe(0);
  }

  async function setup(
    transaction: Prisma.TransactionClient,
    marker: string,
    adapter: PaymentAdapter,
  ) {
    const campus = await transaction.campus.create({
      data: { code: marker, name: marker },
    });
    const parent = await transaction.user.create({
      data: { displayName: marker },
    });
    const student = await transaction.student.create({
      data: { campusId: campus.id, displayName: marker },
    });
    const openId = `synthetic-${randomUUID()}`;
    await transaction.authIdentity.create({
      data: { userId: parent.id, provider: 'WECHAT', subject: openId },
    });
    await transaction.parentStudentBinding.create({
      data: {
        campusId: campus.id,
        parentUserId: parent.id,
        studentId: student.id,
      },
    });
    const product = await transaction.courseProduct.create({
      data: {
        campusId: campus.id,
        name: marker,
        summary: marker,
        priceFen: 1990,
        mainUnits: 100,
        giftUnits: 0,
        validityDays: 365,
        status: 'ACTIVE',
        createdByUserId: parent.id,
      },
    });
    const campaign = await transaction.groupCampaign.create({
      data: {
        code: marker,
        campusId: campus.id,
        courseProductId: product.id,
        title: 'Synthetic course',
        description: marker,
        priceFen: 1990,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 3600_000),
        status: 'ACTIVE',
        createdByUserId: parent.id,
      },
    });
    // Savepoints exercise each service transaction while the outer fixture always rolls back.
    const database = {
      ...transaction,
      $transaction: async <T>(
        operation: (tx: Prisma.TransactionClient) => Promise<T>,
      ) => {
        await transaction.$executeRaw`SAVEPOINT payment_operation`;
        try {
          const result = await operation(transaction);
          await transaction.$executeRaw`RELEASE SAVEPOINT payment_operation`;
          return result;
        } catch (error) {
          await transaction.$executeRaw`ROLLBACK TO SAVEPOINT payment_operation`;
          await transaction.$executeRaw`RELEASE SAVEPOINT payment_operation`;
          throw error;
        }
      },
    } as unknown as PrismaService;
    const parentScope = new ParentScopeService(database);
    const idempotency = new IdempotencyService();
    const command = new GroupBuyingCommandService(
      database,
      parentScope,
      idempotency,
      adapter,
    );
    const payment = new GroupBuyingPaymentService(
      database,
      idempotency,
      new GroupBuyingSettlementService(),
      adapter,
    );
    const scope: ParentScope = { userId: parent.id, campusId: campus.id };
    const create = (key = randomUUID()) =>
      command.createTeam(
        scope,
        { campaignId: campaign.id, studentId: student.id },
        key,
      ) as Promise<Joined>;
    return {
      transaction,
      scope,
      parent,
      student,
      campaign,
      openId,
      command,
      payment,
      create,
    };
  }

  it('creates and retries using bound OpenID, a short order number and the same reservation deadline', async () => {
    await rollbackFixture(async (f) => {
      const key = randomUUID();
      const joined = await f.create(key);
      const repeated = await f.create(key);
      expect(repeated).toEqual(joined);
      expect(transport).toHaveBeenCalledTimes(1);
      const member = await f.transaction.groupMember.findUniqueOrThrow({
        where: { id: joined.prepay.memberId },
      });
      await f.payment.retryPrepay(
        f.scope,
        member.id,
        member.version,
        randomUUID(),
      );
      const payloads = transport.mock.calls.map(
        ([, request]) =>
          JSON.parse(String(request?.body)) as Record<string, unknown>,
      );
      expect(payloads).toHaveLength(2);
      for (const payload of payloads) {
        expect(payload).toMatchObject({
          out_trade_no: joined.prepay.outTradeNo,
          payer: { openid: f.openId },
          time_expire: member.reservationExpiresAt.toISOString(),
        });
      }
      expect(joined.prepay.outTradeNo).toMatch(/^[a-zA-Z0-9_-]{6,32}$/);
      expect(
        await f.transaction.paymentTransaction.count({
          where: { groupMemberId: member.id },
        }),
      ).toBe(1);
    });
  });

  it('rolls back a missing-identity request and refuses an unbound student before transport', async () => {
    await rollbackFixture(async (f) => {
      // Preserve the identity fact but make it unsuitable for WeChat payments.
      await f.transaction.authIdentity.update({
        where: { userId_provider: { userId: f.parent.id, provider: 'WECHAT' } },
        data: { provider: 'MOCK', subject: `mock-${randomUUID()}` },
      });
      await expect(f.create()).rejects.toMatchObject({
        code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
      });
      const stranger = await f.transaction.student.create({
        data: {
          campusId: f.scope.campusId,
          displayName: 'Unbound synthetic child',
        },
      });
      await expect(
        f.command.createTeam(
          f.scope,
          {
            campaignId: f.campaign.id,
            studentId: stranger.id,
          },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(transport).not.toHaveBeenCalled();
      expect(
        await f.transaction.groupTeam.count({
          where: { campaignId: f.campaign.id },
        }),
      ).toBe(0);
      expect(
        await f.transaction.enrollmentOrder.count({
          where: { campusId: f.scope.campusId },
        }),
      ).toBe(0);
      expect(
        await f.transaction.idempotencyRecord.count({
          where: { actorUserId: f.parent.id },
        }),
      ).toBe(0);
    });
  });

  it('rolls back local order and idempotency records when provider transport fails', async () => {
    transport.mockRejectedValue(new Error('Synthetic connection lost'));
    await rollbackFixture(async (f) => {
      await expect(f.create()).rejects.toMatchObject({
        code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
      });
      expect(transport).toHaveBeenCalledTimes(1);
      expect(
        await f.transaction.groupMember.count({
          where: { campaignId: f.campaign.id },
        }),
      ).toBe(0);
      expect(
        await f.transaction.enrollmentOrder.count({
          where: { campusId: f.scope.campusId },
        }),
      ).toBe(0);
      expect(
        await f.transaction.idempotencyRecord.count({
          where: { actorUserId: f.parent.id },
        }),
      ).toBe(0);
    });
  });

  it('accepts a verified notification once, rejects wrong amounts and settles the third paid member once', async () => {
    await rollbackFixture(async (f) => {
      const joined = await f.create();
      const wrong = paymentEvent(joined.prepay.outTradeNo, 1989);
      await expect(
        f.payment.handleNotification(wrong.headers, wrong.raw),
      ).rejects.toMatchObject({ code: ErrorCode.PAYMENT_NOTIFICATION_INVALID });
      expect(
        await f.transaction.groupTeam.findUnique({
          where: { id: joined.team.id },
        }),
      ).toMatchObject({ paidMemberCount: 0 });
      const first = paymentEvent(joined.prepay.outTradeNo);
      await f.payment.handleNotification(first.headers, first.raw);
      await f.payment.handleNotification(first.headers, first.raw);
      expect(
        await f.transaction.groupTeam.findUnique({
          where: { id: joined.team.id },
        }),
      ).toMatchObject({ paidMemberCount: 1 });
      expect(
        await f.transaction.coursePackage.count({
          where: { campusId: f.scope.campusId },
        }),
      ).toBe(0);
      for (let index = 0; index < 2; index++) {
        const parent = await f.transaction.user.create({
          data: { displayName: `Synthetic member ${index}` },
        });
        const student = await f.transaction.student.create({
          data: {
            campusId: f.scope.campusId,
            displayName: `Synthetic child ${index}`,
          },
        });
        await f.transaction.authIdentity.create({
          data: {
            userId: parent.id,
            provider: 'WECHAT',
            subject: `synthetic-${randomUUID()}`,
          },
        });
        await f.transaction.parentStudentBinding.create({
          data: {
            campusId: f.scope.campusId,
            parentUserId: parent.id,
            studentId: student.id,
          },
        });
        const next = (await f.command.joinTeam(
          { userId: parent.id, campusId: f.scope.campusId },
          joined.team.id,
          { studentId: student.id },
          randomUUID(),
        )) as Joined;
        const event = paymentEvent(next.prepay.outTradeNo);
        await f.payment.handleNotification(event.headers, event.raw);
        await f.payment.handleNotification(event.headers, event.raw);
      }
      expect(
        await f.transaction.groupTeam.findUnique({
          where: { id: joined.team.id },
        }),
      ).toMatchObject({ paidMemberCount: 3, status: 'SETTLED', finalTier: 3 });
      const packages = await f.transaction.coursePackage.findMany({
        where: { campusId: f.scope.campusId },
      });
      expect(packages).toHaveLength(3);
      expect(
        packages.every(
          (item) =>
            item.mainBalanceUnits === 100 && item.giftBalanceUnits === 400,
        ),
      ).toBe(true);
      expect(
        await f.transaction.lessonLedgerEntry.count({
          where: { campusId: f.scope.campusId },
        }),
      ).toBe(6);
    });
  });

  it('continues to support the existing mock payment flow', async () => {
    await rollbackFixture(async (f) => {
      const joined = await f.create();
      await f.payment.confirmMockPayment(
        f.scope,
        joined.prepay.memberId,
        joined.prepay.outTradeNo,
        randomUUID(),
      );
      expect(
        await f.transaction.groupMember.findUnique({
          where: { id: joined.prepay.memberId },
        }),
      ).toMatchObject({ status: 'PAID' });
      expect(transport).not.toHaveBeenCalled();
    }, new MockPaymentAdapter());
  });
});
