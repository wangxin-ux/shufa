import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createConnection, type AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { assertApplicationPageTestTarget } from './support/partner-application-page-policy';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import { readPartnerEnrollmentSummary } from '../src/modules/partner/partner-enrollment-summary';
import {
  CampaignPageTransport,
  captureCampaignPage,
} from './support/partner-campaign-page-harness';

assertApplicationPageTestTarget(process.env);
jest.setTimeout(60_000);

describe('partner recorded enrollment summary', () => {
  const runTag = `penroll-${randomUUID().slice(0, 8)}`;
  const users: string[] = [];
  const campuses: string[] = [];
  const students: string[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let campusId: string;
  let token: string;
  let otherToken: string;
  let teacherToken: string;
  let actorId: string;
  let port: number | undefined;

  const student = async (other = false) => {
    const row = await prisma.student.create({
      data: {
        campusId: other ? campuses[1] : campusId,
        displayName: `${runTag}-学员`,
      },
    });
    students.push(row.id);
    return row.id;
  };
  const proof = () =>
    prisma.storedFile.create({
      data: {
        purpose: 'FINANCE_RECEIPT_PROOF',
        storageKey: `${runTag}/${randomUUID()}.png`,
        originalName: 'synthetic.png',
        mimeType: 'image/png',
        sizeBytes: 1,
        sha256: '0'.repeat(64),
        createdByUserId: actorId,
      },
    });
  const receipt = async (
    studentId: string,
    amountFen = 100000,
    issued = true,
    options: { giftUnits?: number; omitGiftGrant?: boolean } = {},
  ) => {
    const giftUnits = options.giftUnits ?? 200;
    const owner = await prisma.student.findUniqueOrThrow({
      where: { id: studentId },
    });
    const row = await prisma.financeReceipt.create({
      data: {
        campusId: owner.campusId,
        studentId,
        amountFen,
        receivedOn: new Date('2026-09-01'),
        channel: 'BANK',
        proofFileId: (await proof()).id,
        createdByUserId: actorId,
      },
    });
    if (!issued) return { receipt: row, issuance: null };
    const pack = await prisma.coursePackage.create({
      data: {
        campusId: owner.campusId,
        studentId,
        name: `${runTag}-课包`,
        mainBalanceUnits: 300,
        giftBalanceUnits: 100,
        paidAmountFen: amountFen,
        validFrom: new Date('2025-01-01'),
        expiresAt: new Date('2025-12-31'),
        isActive: false,
      },
    });
    const issuance = await prisma.financePackageIssuance.create({
      data: {
        receiptId: row.id,
        coursePackageId: pack.id,
        originalAmountFen: amountFen,
        initialMainUnits: 1000,
        initialGiftUnits: giftUnits,
        name: pack.name,
        validFrom: pack.validFrom,
        expiresAt: pack.expiresAt,
        issuedByUserId: actorId,
      },
    });
    await prisma.lessonLedgerEntry.createMany({
      data: (['MAIN', 'GIFT'] as const)
        .filter(
          (bucket) =>
            bucket === 'MAIN' || (giftUnits > 0 && !options.omitGiftGrant),
        )
        .map((bucket) => ({
          campusId: owner.campusId,
          studentId,
          coursePackageId: pack.id,
          entryType: 'GRANT' as const,
          bucket,
          deltaUnits: bucket === 'MAIN' ? 1000 : giftUnits,
          balanceBeforeUnits: 0,
          balanceAfterUnits: bucket === 'MAIN' ? 1000 : giftUnits,
          actorUserId: actorId,
          idempotencyKey: `${runTag}-${randomUUID()}`,
        })),
    });
    return { receipt: row, issuance };
  };
  const read = (id: string, bearer = token) =>
    request(server)
      .get(`/partners/me/students/${id}`)
      .auth(bearer, { type: 'bearer' });
  const summary = (response: { body: unknown }): unknown =>
    (response.body as { data: { enrollmentSummary: unknown } }).data
      .enrollmentSummary;
  const correction = async (
    original: Awaited<ReturnType<typeof receipt>>,
    replacement?: Awaited<ReturnType<typeof receipt>>,
    applied = true,
  ) =>
    prisma.financeReceiptCorrection.create({
      data: {
        originalIssuanceId: original.issuance!.id,
        type: replacement ? 'REPLACE' : 'VOID',
        status: applied ? 'APPLIED' : 'APPROVED',
        reason: '合成纠错',
        originalAmountFen: original.receipt.amountFen,
        sourcePackageVersion: 1,
        requestedByUserId: actorId,
        reviewedByUserId: users[1],
        reviewedAt: new Date(),
        ...(applied ? { appliedByUserId: actorId, appliedAt: new Date() } : {}),
        ...(replacement
          ? {
              replacementSnapshot: {},
              proposedProofFileId: replacement.receipt.proofFileId,
              replacementReceiptId: applied ? replacement.receipt.id : null,
            }
          : {}),
      },
    });
  const groupOrder = async (
    studentId: string,
    state: 'PAID' | 'EFFECTIVE' | 'REFUNDED' = 'EFFECTIVE',
  ) => {
    const product = await prisma.courseProduct.create({
      data: {
        campusId,
        name: `${runTag}-产品`,
        summary: '合成产品',
        priceFen: 1990,
        mainUnits: 100,
        giftUnits: 0,
        validityDays: 30,
        createdByUserId: actorId,
      },
    });
    const campaign = await prisma.groupCampaign.create({
      data: {
        campusId,
        courseProductId: product.id,
        code: `${runTag}-${randomUUID()}`,
        title: '合成拼团',
        description: '',
        priceFen: 9999,
        startsAt: new Date('2026-01-01'),
        endsAt: new Date('2026-02-01'),
        createdByUserId: actorId,
      },
    });
    const team = await prisma.groupTeam.create({
      data: {
        campaignId: campaign.id,
        leaderUserId: actorId,
        status: state === 'PAID' ? 'OPEN' : 'SETTLED',
      },
    });
    const order = await prisma.enrollmentOrder.create({
      data: {
        orderNo: `${runTag}-${randomUUID()}`,
        campusId,
        studentId,
        parentUserId: actorId,
        courseProductId: product.id,
        productNameSnapshot: product.name,
        priceFenSnapshot: 1990,
        mainUnitsSnapshot: state === 'PAID' ? 100 : 300,
        giftUnitsSnapshot: 0,
        validityDaysSnapshot: 30,
        status: state,
      },
    });
    const member = await prisma.groupMember.create({
      data: {
        campaignId: campaign.id,
        teamId: team.id,
        parentUserId: actorId,
        studentId,
        enrollmentOrderId: order.id,
        status: state === 'EFFECTIVE' ? 'SETTLED' : state,
        reservationExpiresAt: new Date('2026-02-01'),
        paidAt: new Date('2026-01-02'),
        ...(state === 'PAID'
          ? {}
          : {
              settledAt: new Date('2026-02-01'),
              grantedMainUnits: 300,
              grantedGiftUnits: 0,
            }),
      },
    });
    const payment = await prisma.paymentTransaction.create({
      data: {
        groupMemberId: member.id,
        enrollmentOrderId: order.id,
        type: 'PAYMENT',
        provider: 'MOCK',
        outTradeNo: `${runTag}-${randomUUID()}`,
        amountFen: 1990,
        status: 'SUCCEEDED',
        succeededAt: new Date('2026-01-02'),
      },
    });
    if (state !== 'PAID') {
      const pack = await prisma.coursePackage.create({
        data: {
          campusId,
          studentId,
          name: `${runTag}-拼团课包`,
          sourceOrderId: order.id,
          mainBalanceUnits: 0,
          giftBalanceUnits: 0,
          isActive: false,
        },
      });
      await prisma.lessonLedgerEntry.create({
        data: {
          campusId,
          studentId,
          coursePackageId: pack.id,
          actorUserId: actorId,
          entryType: 'GRANT',
          bucket: 'MAIN',
          deltaUnits: 300,
          balanceBeforeUnits: 0,
          balanceAfterUnits: 300,
          idempotencyKey: `${runTag}-${randomUUID()}`,
        },
      });
    }
    if (state === 'REFUNDED')
      await prisma.paymentTransaction.create({
        data: {
          groupMemberId: member.id,
          enrollmentOrderId: order.id,
          type: 'REFUND',
          provider: 'MOCK',
          outTradeNo: `${runTag}-${randomUUID()}`,
          amountFen: 1990,
          status: 'SUCCEEDED',
          succeededAt: new Date('2026-02-02'),
        },
      });
    return { order, member, payment };
  };

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    for (const suffix of ['a', 'b']) {
      campuses.push(
        (
          await prisma.campus.create({
            data: { code: `${runTag}-${suffix}`, name: `${runTag}-合成校区` },
          })
        ).id,
      );
    }
    campusId = campuses[0];
    for (const [roleCode, campus] of [
      ['PARTNER', campusId],
      ['PARTNER', campuses[1]],
      ['TEACHER', campusId],
    ] as const) {
      const user = await prisma.user.create({
        data: {
          displayName: `${runTag}-账号`,
          roles: { create: { roleCode, campusId: campus } },
        },
      });
      users.push(user.id);
      const session = await app.get(AuthService).issueSessionForUser(user.id);
      if (roleCode === 'TEACHER') teacherToken = session.accessToken;
      else if (campus === campusId) {
        token = session.accessToken;
        actorId = user.id;
      } else otherToken = session.accessToken;
    }
  });

  afterAll(async () => {
    try {
      if (prisma && users.length) {
        assertApplicationPageTestTarget(process.env);
        const result = await prisma.user.updateMany({
          where: { id: { in: users }, displayName: { startsWith: runTag } },
          data: { status: 'DISABLED' },
        });
        expect(result.count).toBe(users.length);
        process.stdout.write(
          `PARTNER_ENROLLMENT_OWNERSHIP ${JSON.stringify({
            runTag,
            users,
            campuses,
            students,
            disabled: true,
            disposition:
              'synthetic fixtures retained; metadata-only proof fixtures; no deletion',
          })}\n`,
        );
      }
    } finally {
      await app?.close();
      if (port) {
        const closedPort = port;
        await new Promise<void>((resolve, reject) => {
          const socket = createConnection({
            host: '127.0.0.1',
            port: closedPort,
          });
          socket.setTimeout(1500);
          socket.once('connect', () => {
            socket.destroy();
            reject(Error('Enrollment listener remains open'));
          });
          socket.once('timeout', () => {
            socket.destroy();
            reject(Error('Enrollment listener closure unconfirmed'));
          });
          socket.once('error', (error: NodeJS.ErrnoException) => {
            socket.destroy();
            if (error.code === 'ECONNREFUSED') resolve();
            else reject(error);
          });
        });
        process.stdout.write(
          `PARTNER_ENROLLMENT_SERVER_CLOSED ${JSON.stringify({ runTag, port })}\n`,
        );
      }
    }
  });

  it('keeps received and actual refunded money separate and includes expired issuance snapshots', async () => {
    const id = await student();
    const source = await receipt(id);
    const refund = await prisma.financeRefundRequest.create({
      data: {
        issuanceId: source.issuance!.id,
        mainUnits: 100,
        giftUnits: 0,
        referenceAmountFen: 10000,
        amountFen: 20000,
        reason: '合成退款',
        status: 'PAID',
        requestedByUserId: actorId,
      },
    });
    await prisma.financeRefundPayment.create({
      data: {
        refundId: refund.id,
        amountFen: 20000,
        paidAt: new Date('2026-09-05'),
        proofFileId: (await proof()).id,
        externalReference: `${runTag}-${randomUUID()}`,
        recordedByUserId: actorId,
      },
    });
    await prisma.financeRefundRequest.create({
      data: {
        issuanceId: source.issuance!.id,
        mainUnits: 100,
        giftUnits: 0,
        referenceAmountFen: 10000,
        amountFen: 30000,
        reason: '尚未退款',
        status: 'APPROVED',
        requestedByUserId: actorId,
      },
    });
    expect(summary(await read(id).expect(200))).toEqual({
      receivedAmountFen: 100000,
      refundedAmountFen: 20000,
      initialMainUnits: 1000,
      initialGiftUnits: 200,
      pendingIssuanceCount: 0,
    });
  });

  it('includes paid receipts without inventing unissued lessons', async () => {
    const id = await student();
    await receipt(id, 88000, false);
    expect(summary(await read(id).expect(200))).toEqual({
      receivedAmountFen: 88000,
      refundedAmountFen: 0,
      initialMainUnits: 0,
      initialGiftUnits: 0,
      pendingIssuanceCount: 1,
    });
  });

  it('returns field-level unknown for unsupported historical packages instead of counting known parts as all', async () => {
    const id = await student();
    await receipt(id);
    await prisma.coursePackage.create({
      data: {
        campusId,
        studentId: id,
        name: `${runTag}-旧包`,
        paidAmountFen: 99999,
        mainBalanceUnits: 9900,
      },
    });
    expect(summary(await read(id).expect(200))).toEqual({
      receivedAmountFen: null,
      refundedAmountFen: null,
      initialMainUnits: null,
      initialGiftUnits: null,
      pendingIssuanceCount: 0,
    });
  });

  it('returns recorded zero for no history and denies other campuses and other roles', async () => {
    const id = await student();
    expect(summary(await read(id).expect(200))).toEqual({
      receivedAmountFen: 0,
      refundedAmountFen: 0,
      initialMainUnits: 0,
      initialGiftUnits: 0,
      pendingIssuanceCount: 0,
    });
    await read(id, otherToken).expect(404);
    await read(id, teacherToken).expect(403);
    await read(await student(true)).expect(404);
  });

  it('does not exclude an approved but unapplied correction', async () => {
    const id = await student();
    await correction(await receipt(id), undefined, false);
    expect(summary(await read(id).expect(200))).toMatchObject({
      receivedAmountFen: 100000,
      initialMainUnits: 1000,
      initialGiftUnits: 200,
    });
  });

  it('counts only the terminal receipt of a repeated replacement and keeps original records', async () => {
    const id = await student();
    const first = await receipt(id),
      second = await receipt(id, 90000),
      third = await receipt(id, 80000);
    await correction(first, second);
    await correction(second, third);
    expect(summary(await read(id).expect(200))).toEqual({
      receivedAmountFen: 80000,
      refundedAmountFen: 0,
      initialMainUnits: 1000,
      initialGiftUnits: 200,
      pendingIssuanceCount: 0,
    });
    expect(
      await prisma.financeReceipt.count({ where: { studentId: id } }),
    ).toBe(3);
    expect(
      await prisma.lessonLedgerEntry.count({
        where: { studentId: id, entryType: 'GRANT' },
      }),
    ).toBe(6);
  });

  it('excludes an applied void without treating it as an actual refund', async () => {
    const id = await student();
    await correction(await receipt(id));
    expect(summary(await read(id).expect(200))).toEqual({
      receivedAmountFen: 0,
      refundedAmountFen: 0,
      initialMainUnits: 0,
      initialGiftUnits: 0,
      pendingIssuanceCount: 0,
    });
  });

  it('projects a cross-campus replacement separately without exposing the counterpart', async () => {
    const id = await student(),
      target = await student(true);
    await correction(await receipt(id), await receipt(target, 70000));
    expect(summary(await read(id).expect(200))).toMatchObject({
      receivedAmountFen: 0,
      initialMainUnits: 0,
    });
    const response = await read(target, otherToken).expect(200);
    expect(summary(response)).toMatchObject({
      receivedAmountFen: 70000,
      initialMainUnits: 1000,
    });
    expect(JSON.stringify(response.body).includes(id)).toBe(false);
  });

  it('marks correction cycles unknown instead of erasing all enrollment history to zero', async () => {
    const id = await student();
    const first = await receipt(id),
      second = await receipt(id, 90000);
    await correction(first, second);
    await correction(second, first);
    expect(summary(await read(id).expect(200))).toMatchObject({
      receivedAmountFen: null,
      refundedAmountFen: null,
      initialMainUnits: null,
      initialGiftUnits: null,
    });
  });

  it('keeps known receipt and main lessons when a gift grant is missing', async () => {
    const id = await student();
    await receipt(id, 100000, true, { omitGiftGrant: true });
    expect(summary(await read(id).expect(200))).toMatchObject({
      receivedAmountFen: 100000,
      refundedAmountFen: 0,
      initialMainUnits: 1000,
      initialGiftUnits: null,
    });
  });

  it('treats explicit zero gift lessons as known without requiring a zero GRANT', async () => {
    const id = await student();
    await receipt(id, 100000, true, { giftUnits: 0 });
    expect(summary(await read(id).expect(200))).toMatchObject({
      initialMainUnits: 1000,
      initialGiftUnits: 0,
    });
  });

  it.each(['PAID', 'EFFECTIVE', 'REFUNDED'] as const)(
    'reads the actual payment and immutable grants for a %s group order',
    async (state) => {
      const id = await student();
      await groupOrder(id, state);
      expect(summary(await read(id).expect(200))).toEqual({
        receivedAmountFen: 1990,
        refundedAmountFen: state === 'REFUNDED' ? 1990 : 0,
        initialMainUnits: state === 'PAID' ? 0 : 300,
        initialGiftUnits: 0,
        pendingIssuanceCount: state === 'PAID' ? 1 : 0,
      });
    },
  );

  it('marks successful group money with a mismatching frozen quote for reconciliation', async () => {
    const id = await student();
    const { order } = await groupOrder(id);
    await prisma.enrollmentOrder.update({
      where: { id: order.id },
      data: { priceFenSnapshot: 2090 },
    });
    expect(summary(await read(id).expect(200))).toMatchObject({
      receivedAmountFen: null,
    });
  });

  it('keeps never-issued lessons visible after a full pre-issuance refund', async () => {
    const id = await student();
    const { order, member } = await groupOrder(id, 'PAID');
    await prisma.enrollmentOrder.update({
      where: { id: order.id },
      data: { status: 'REFUNDED' },
    });
    await prisma.groupMember.update({
      where: { id: member.id },
      data: { status: 'REFUNDED' },
    });
    await prisma.paymentTransaction.create({
      data: {
        groupMemberId: member.id,
        enrollmentOrderId: order.id,
        type: 'REFUND',
        provider: 'MOCK',
        outTradeNo: `${runTag}-${randomUUID()}`,
        amountFen: 1990,
        status: 'SUCCEEDED',
        succeededAt: new Date('2026-02-02'),
      },
    });
    expect(summary(await read(id).expect(200))).toEqual({
      receivedAmountFen: 1990,
      refundedAmountFen: 1990,
      initialMainUnits: 0,
      initialGiftUnits: 0,
      pendingIssuanceCount: 1,
    });
  });

  it('marks a local member linked to an out-of-scope order unknown without exposing its money', async () => {
    const id = await student();
    const otherId = await student(true);
    const { order } = await groupOrder(id, 'PAID');
    await prisma.enrollmentOrder.update({
      where: { id: order.id },
      data: { campusId: campuses[1], studentId: otherId },
    });
    const response = await read(id).expect(200);
    expect(summary(response)).toMatchObject({
      receivedAmountFen: null,
      refundedAmountFen: null,
      initialMainUnits: null,
      initialGiftUnits: null,
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      new RegExp(`${otherId}|${campuses[1]}|1990`),
    );
  });

  it('keeps money and the unaffected gift snapshot when the final main snapshot conflicts', async () => {
    const id = await student();
    const { order } = await groupOrder(id);
    await prisma.enrollmentOrder.update({
      where: { id: order.id },
      data: { mainUnitsSnapshot: 400 },
    });
    expect(summary(await read(id).expect(200))).toEqual({
      receivedAmountFen: 1990,
      refundedAmountFen: 0,
      initialMainUnits: null,
      initialGiftUnits: 0,
      pendingIssuanceCount: 0,
    });
  });

  it('keeps reliable money when only group settlement metadata is missing', async () => {
    const id = await student();
    const { member } = await groupOrder(id);
    await prisma.groupMember.update({
      where: { id: member.id },
      data: { settledAt: null },
    });
    expect(summary(await read(id).expect(200))).toEqual({
      receivedAmountFen: 1990,
      refundedAmountFen: 0,
      initialMainUnits: null,
      initialGiftUnits: null,
      pendingIssuanceCount: 0,
    });
  });

  it('does not report a broken paid order without a successful payment as zero money', async () => {
    const id = await student();
    const { payment } = await groupOrder(id, 'PAID');
    await prisma.paymentTransaction.update({
      where: { id: payment.id },
      data: { status: 'FAILED', succeededAt: null },
    });
    expect(summary(await read(id).expect(200))).toMatchObject({
      receivedAmountFen: null,
    });
  });

  it('does not accept money in a cancelled order as a normal paid enrollment', async () => {
    const id = await student();
    const { order } = await groupOrder(id, 'PAID');
    await prisma.enrollmentOrder.update({
      where: { id: order.id },
      data: { status: 'CANCELLED' },
    });
    expect(summary(await read(id).expect(200))).toMatchObject({
      receivedAmountFen: null,
    });
  });

  it('rejects duplicate successful payments instead of counting both', async () => {
    const id = await student();
    const { order, member } = await groupOrder(id);
    await prisma.paymentTransaction.create({
      data: {
        groupMemberId: member.id,
        enrollmentOrderId: order.id,
        type: 'PAYMENT',
        provider: 'MOCK',
        outTradeNo: `${runTag}-${randomUUID()}`,
        amountFen: 1990,
        status: 'SUCCEEDED',
        succeededAt: new Date(),
      },
    });
    expect(summary(await read(id).expect(200))).toMatchObject({
      receivedAmountFen: null,
      initialMainUnits: null,
    });
  });

  it('reads financial sources in one repeatable snapshot during a competing commit', async () => {
    const id = await student();
    await receipt(id);
    const observed = await prisma.$transaction(
      async (tx) => {
        const proxy = new Proxy(tx, {
          get(target, property, receiver) {
            if (property !== 'financeReceipt')
              return Reflect.get(target, property, receiver) as unknown;
            return {
              findMany: async (args: Prisma.FinanceReceiptFindManyArgs) => {
                const rows = await tx.financeReceipt.findMany(args);
                await receipt(id, 88000);
                return rows;
              },
            };
          },
        });
        return readPartnerEnrollmentSummary(proxy, campusId, id);
      },
      { isolationLevel: 'RepeatableRead' },
    );
    expect(observed).toMatchObject({
      receivedAmountFen: 100000,
      initialMainUnits: 1000,
    });
    expect(summary(await read(id).expect(200))).toMatchObject({
      receivedAmountFen: 188000,
      initialMainUnits: 2000,
    });
  });

  it('treats a paid refund without a matching payment fact as unknown without erasing received money', async () => {
    const id = await student();
    const source = await receipt(id);
    await prisma.financeRefundRequest.create({
      data: {
        issuanceId: source.issuance!.id,
        mainUnits: 100,
        giftUnits: 0,
        referenceAmountFen: 10000,
        amountFen: 20000,
        reason: '合成缺凭据',
        status: 'PAID',
        requestedByUserId: actorId,
      },
    });
    expect(summary(await read(id).expect(200))).toMatchObject({
      receivedAmountFen: 100000,
      refundedAmountFen: null,
      initialMainUnits: 1000,
    });
  });

  it('delivers the enrollment summary through real Page services and local TCP without changing source facts', async () => {
    const id = await student();
    const query = `${runTag}-联调学员`;
    await prisma.student.update({
      where: { id },
      data: { displayName: query },
    });
    const source = await receipt(id, 100000);
    await receipt(id, 88000, false);
    const refund = await prisma.financeRefundRequest.create({
      data: {
        issuanceId: source.issuance!.id,
        mainUnits: 100,
        giftUnits: 0,
        referenceAmountFen: 10000,
        amountFen: 20000,
        reason: '合成已退款',
        status: 'PAID',
        requestedByUserId: actorId,
      },
    });
    await prisma.financeRefundPayment.create({
      data: {
        refundId: refund.id,
        amountFen: 20000,
        paidAt: new Date('2026-09-05'),
        proofFileId: (await proof()).id,
        externalReference: `${runTag}-${randomUUID()}`,
        recordedByUserId: actorId,
      },
    });
    const facts = async () => {
      const snapshot = {
        receipts: await prisma.financeReceipt.findMany({
          where: { studentId: id },
          orderBy: { id: 'asc' },
        }),
        packages: await prisma.coursePackage.findMany({
          where: { studentId: id },
          orderBy: { id: 'asc' },
        }),
        ledger: await prisma.lessonLedgerEntry.findMany({
          where: { studentId: id },
          orderBy: { id: 'asc' },
        }),
        refunds: await prisma.financeRefundRequest.findMany({
          where: { issuanceId: source.issuance!.id },
          orderBy: { id: 'asc' },
        }),
        payments: await prisma.financeRefundPayment.findMany({
          where: { refundId: refund.id },
        }),
      };
      return createHash('sha256')
        .update(JSON.stringify(snapshot))
        .digest('hex');
    };
    const before = await facts();
    await app.listen(0, '127.0.0.1');
    port = (server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;
    const transport = new CampaignPageTransport(
      origin,
      new Set([token]),
      false,
      false,
      true,
      false,
      false,
      true,
    );
    const host = globalThis as unknown as Record<string, unknown>;
    const originals = new Map(
      ['wx', 'Page'].map((key) => [
        key,
        Object.getOwnPropertyDescriptor(host, key),
      ]),
    );
    const runtime = {
      dataDriver: 'api',
      apiBaseUrl: origin,
      accessToken: token,
    };
    host.wx = {
      getStorageSync: (key: string) =>
        key === 'education.runtime' ? runtime : undefined,
      setStorageSync: jest.fn(),
      request: transport.request,
      navigateTo: jest.fn(),
      reLaunch: jest.fn(),
      showToast: jest.fn(),
      stopPullDownRefresh: jest.fn(),
    };
    interface EnrollmentPage {
      data: {
        expandedState?: string;
        expandedDetail?: { enrollment: unknown };
        detail?: { enrollment: unknown };
        viewState: string;
        searchValue?: string;
        activeQuery?: string;
      };
      onLoad(options?: { id: string }): void;
      onShow(): void;
      onUnload(): void;
      onStudentToggle?(event: {
        currentTarget: { dataset: { id: string } };
      }): void;
      loadExpanded?(id: string): Promise<void>;
      pendingResetRequest?: Promise<void>;
      pendingRequest?: Promise<void>;
      growthPending?: Promise<void>;
    }
    const pages: EnrollmentPage[] = [];
    try {
      const list = captureCampaignPage<EnrollmentPage>('students');
      pages.push(list);
      list.data.searchValue = query;
      list.data.activeQuery = query;
      list.onLoad();
      list.onShow();
      await list.pendingResetRequest;
      await transport.idle();
      list.onStudentToggle!({ currentTarget: { dataset: { id } } });
      await list.loadExpanded!(id);
      await transport.idle();
      expect(list.data.expandedState).toBe('ready');
      const expected = {
        receivedLabel: '¥1880.00',
        refundedLabel: '¥200.00',
        lessonsLabel: '购买10节 · 赠送2节',
        pendingLabel: '另有1笔未发放',
      };
      expect(list.data.expandedDetail?.enrollment).toEqual(expected);
      list.onUnload();
      const detail = captureCampaignPage<EnrollmentPage>('student-detail');
      pages.push(detail);
      detail.onLoad({ id });
      detail.onShow();
      await detail.pendingRequest;
      await detail.growthPending;
      await transport.idle();
      expect(detail.data.viewState).toBe('ready');
      expect(detail.data.detail?.enrollment).toEqual(expected);
      expect(await facts()).toBe(before);
      process.stdout.write(
        `PARTNER_ENROLLMENT_PAGE_TCP ${JSON.stringify({
          runTag,
          studentId: id,
          port,
          immutableSourceSha256: before,
          views: ['students expansion', 'student-detail'],
          boundary:
            'actual Page and service code; wx host and native APIs are substitutes',
        })}\n`,
      );
    } finally {
      for (const page of pages) page.onUnload();
      await transport.drain();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(host, key, descriptor);
        else Reflect.deleteProperty(host, key);
      }
    }
  });
});
