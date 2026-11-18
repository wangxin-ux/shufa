import { createHash, randomUUID } from 'node:crypto';
import { createConnection, type AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { PartnerStudentQueryService } from '../src/modules/partner/partner-student-query.service';
import { assertApplicationPageTestTarget } from './support/partner-application-page-policy';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import {
  CampaignPageTransport,
  captureCampaignPage,
} from './support/partner-campaign-page-harness';

assertApplicationPageTestTarget(process.env);
jest.setTimeout(60_000);

describe('partner home enrollment through isolated PostgreSQL and Page TCP', () => {
  const runTag = `phroll-${randomUUID().slice(0, 8)}`;
  const users: string[] = [],
    campuses: string[] = [],
    students: string[] = [],
    tokens: string[] = [];
  let app: INestApplication,
    prisma: PrismaService,
    server: Server,
    port: number | undefined;
  const proof = () =>
    prisma.storedFile.create({
      data: {
        purpose: 'FINANCE_RECEIPT_PROOF',
        storageKey: `${runTag}/${randomUUID()}.png`,
        originalName: 'synthetic.png',
        mimeType: 'image/png',
        sizeBytes: 1,
        sha256: '0'.repeat(64),
        createdByUserId: users[0],
      },
    });
  const receive = async (index: number, amountFen: number) =>
    prisma.financeReceipt.create({
      data: {
        campusId: campuses[index],
        studentId: students[index],
        amountFen,
        receivedOn: new Date('2026-09-01'),
        channel: 'BANK',
        proofFileId: (await proof()).id,
        createdByUserId: users[0],
      },
    });
  const dashboard = (index = 0) =>
    request(server)
      .get('/partners/me/dashboard')
      .auth(tokens[index], { type: 'bearer' });
  const data = (response: { body: unknown }) =>
    (
      response.body as {
        data: {
          highlight: null | { studentId: string; enrollmentSummary?: unknown };
        };
      }
    ).data;
  const initial = {
    receivedAmountFen: 188000,
    refundedAmountFen: 20000,
    initialMainUnits: 1000,
    initialGiftUnits: 200,
    pendingIssuanceCount: 1,
  };
  const sourceFacts = async () => {
    const where = { campusId: campuses[0], studentId: students[0] };
    const records = {
      receipts: await prisma.financeReceipt.findMany({
        where,
        orderBy: { id: 'asc' },
      }),
      packages: await prisma.coursePackage.findMany({
        where,
        orderBy: { id: 'asc' },
      }),
      ledger: await prisma.lessonLedgerEntry.findMany({
        where,
        orderBy: { id: 'asc' },
      }),
      refunds: await prisma.financeRefundRequest.findMany({
        where: { issuance: { receipt: where } },
        orderBy: { id: 'asc' },
      }),
      payments: await prisma.financeRefundPayment.findMany({
        where: { refund: { issuance: { receipt: where } } },
        orderBy: { id: 'asc' },
      }),
    };
    return createHash('sha256').update(JSON.stringify(records)).digest('hex');
  };
  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    for (const suffix of ['a', 'b']) {
      const campus = await prisma.campus.create({
        data: { code: `${runTag}-${suffix}`, name: `${runTag}-合成校区` },
      });
      campuses.push(campus.id);
      const student = await prisma.student.create({
        data: {
          campusId: campus.id,
          displayName: `${runTag}-${suffix}合成学员`,
        },
      });
      students.push(student.id);
      const user = await prisma.user.create({
        data: {
          displayName: `${runTag}-${suffix}合作方`,
          roles: { create: { roleCode: 'PARTNER', campusId: campus.id } },
        },
      });
      users.push(user.id);
      tokens.push(
        (await app.get(AuthService).issueSessionForUser(user.id)).accessToken,
      );
    }
    const teacher = await prisma.user.create({
      data: {
        displayName: `${runTag}-合成教师`,
        roles: { create: { roleCode: 'TEACHER', campusId: campuses[0] } },
      },
    });
    users.push(teacher.id);
    tokens.push(
      (await app.get(AuthService).issueSessionForUser(teacher.id)).accessToken,
    );
    const receipt = await receive(0, 100000);
    await receive(0, 88000);
    await receive(1, 222000);
    const pack = await prisma.coursePackage.create({
      data: {
        campusId: campuses[0],
        studentId: students[0],
        name: `${runTag}-过期课包`,
        mainBalanceUnits: 0,
        giftBalanceUnits: 0,
        paidAmountFen: 100000,
        validFrom: new Date('2025-01-01'),
        expiresAt: new Date('2025-12-31'),
        isActive: false,
      },
    });
    const issuance = await prisma.financePackageIssuance.create({
      data: {
        receiptId: receipt.id,
        coursePackageId: pack.id,
        originalAmountFen: 100000,
        initialMainUnits: 1000,
        initialGiftUnits: 200,
        name: pack.name,
        validFrom: pack.validFrom,
        expiresAt: pack.expiresAt,
        issuedByUserId: users[0],
      },
    });
    for (const [bucket, units] of [
      ['MAIN', 1000],
      ['GIFT', 200],
    ] as const) {
      await prisma.lessonLedgerEntry.create({
        data: {
          campusId: campuses[0],
          studentId: students[0],
          coursePackageId: pack.id,
          entryType: 'GRANT',
          bucket,
          deltaUnits: units,
          balanceBeforeUnits: 0,
          balanceAfterUnits: units,
          actorUserId: users[0],
          idempotencyKey: `${runTag}-${bucket}`,
        },
      });
    }
    const refund = await prisma.financeRefundRequest.create({
      data: {
        issuanceId: issuance.id,
        mainUnits: 100,
        giftUnits: 0,
        referenceAmountFen: 10000,
        amountFen: 20000,
        reason: '合成已退',
        status: 'PAID',
        requestedByUserId: users[0],
      },
    });
    await prisma.financeRefundPayment.create({
      data: {
        refundId: refund.id,
        amountFen: 20000,
        paidAt: new Date('2026-09-05'),
        proofFileId: (await proof()).id,
        externalReference: `${runTag}-refund`,
        recordedByUserId: users[0],
      },
    });
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
              'synthetic fixtures retained; metadata-only proof; no deletion',
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
            reject(Error('Home listener remains open'));
          });
          socket.once('timeout', () => {
            socket.destroy();
            reject(Error('Home listener closure unconfirmed'));
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
  it('matches student detail while keeping other campuses and roles isolated', async () => {
    const home = data(await dashboard().expect(200)).highlight;
    const detail = await request(server)
      .get(`/partners/me/students/${students[0]}`)
      .auth(tokens[0], { type: 'bearer' })
      .expect(200);
    expect(home?.enrollmentSummary).toEqual(initial);
    expect(home?.enrollmentSummary).toEqual(
      (detail.body as { data: { enrollmentSummary: unknown } }).data
        .enrollmentSummary,
    );
    const other = await dashboard(1).expect(200);
    expect(data(other).highlight).toMatchObject({
      studentId: students[1],
      enrollmentSummary: { receivedAmountFen: 222000, refundedAmountFen: 0 },
    });
    expect(JSON.stringify(other.body)).not.toContain(students[0]);
    const forged = await dashboard()
      .query({ campusId: campuses[1] })
      .expect(200);
    expect(data(forged).highlight?.studentId).toBe(students[0]);
    await dashboard(2).expect(403);
  });
  it('keeps selected identity and money in one repeatable snapshot during a competing receipt', async () => {
    let barriers = 0;
    const wrapped = {
      $transaction: (
        read: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: { isolationLevel: Prisma.TransactionIsolationLevel },
      ) =>
        prisma.$transaction(
          async (tx) =>
            read(
              new Proxy(tx, {
                get(target, property, receiver) {
                  if (property !== 'student')
                    return Reflect.get(target, property, receiver) as unknown;
                  return {
                    findMany: async (args: Prisma.StudentFindManyArgs) => {
                      const rows = await tx.student.findMany(args);
                      barriers++;
                      await receive(0, 10000);
                      return rows;
                    },
                  };
                },
              }),
            ),
          options,
        ),
    } as unknown as PrismaService;
    const result = await new PartnerStudentQueryService(wrapped).highlight(
      campuses[0],
      500,
    );
    expect(barriers).toBe(1);
    expect(
      (result as { enrollmentSummary?: unknown }).enrollmentSummary,
    ).toEqual(initial);
    expect(
      data(await dashboard().expect(200)).highlight?.enrollmentSummary,
    ).toEqual({
      ...initial,
      receivedAmountFen: 198000,
      pendingIssuanceCount: 2,
    });
  });
  it('shows real home Page money through TCP without modifying financial facts', async () => {
    const before = await sourceFacts();
    await app.listen(0, '127.0.0.1');
    port = (server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;
    const transport = new CampaignPageTransport(
      origin,
      new Set([tokens[0]]),
      false,
      false,
      false,
      false,
      false,
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
      accessToken: tokens[0],
    };
    host.wx = {
      getStorageSync: (key: string) =>
        key === 'education.runtime' ? runtime : undefined,
      request: transport.request,
      setStorageSync: jest.fn(),
      navigateTo: jest.fn(),
      reLaunch: jest.fn(),
      showToast: jest.fn(),
      stopPullDownRefresh: jest.fn(),
    };
    interface HomePage {
      data: { viewState: string; highlightEnrollment: unknown };
      pendingRequest?: Promise<void>;
      onLoad(): void;
      onShow(): void;
      onUnload(): void;
    }
    const page = captureCampaignPage<HomePage>('home');
    try {
      page.onLoad();
      page.onShow();
      await page.pendingRequest;
      await transport.idle();
      expect(page.data.viewState).toBe('ready');
      expect(page.data.highlightEnrollment).toMatchObject({
        receivedLabel: '¥1980.00',
        refundedLabel: '¥200.00',
      });
      expect(await sourceFacts()).toBe(before);
      process.stdout.write(
        `PARTNER_HOME_ENROLLMENT_PAGE_TCP ${JSON.stringify({
          runTag,
          port,
          studentId: students[0],
          immutableSourceSha256: before,
          boundary:
            'actual Page/service and local TCP; wx host/native APIs are substitutes',
        })}\n`,
      );
    } finally {
      page.onUnload();
      await transport.drain();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(host, key, descriptor);
        else Reflect.deleteProperty(host, key);
      }
    }
  });
  it('shows unknown for unsupported history and no money when no highlight remains', async () => {
    await prisma.coursePackage.create({
      data: {
        campusId: campuses[0],
        studentId: students[0],
        name: `${runTag}-旧包`,
        mainBalanceUnits: 0,
        giftBalanceUnits: 0,
      },
    });
    expect(
      data(await dashboard().expect(200)).highlight?.enrollmentSummary,
    ).toMatchObject({
      receivedAmountFen: null,
      refundedAmountFen: null,
    });
    await prisma.student.update({
      where: { id: students[0] },
      data: { isActive: false },
    });
    expect(data(await dashboard().expect(200)).highlight).toBeNull();
  });
});
