import { createHash, randomUUID } from 'node:crypto';
import { createConnection, type AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { LessonLedgerEntry, Prisma } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { PartnerReadService } from '../src/modules/partner/partner-read.service';
import { PartnerScopeService } from '../src/common/auth/partner-scope.service';
import { PartnerStudentQueryService } from '../src/modules/partner/partner-student-query.service';
import { StoredFileService } from '../src/modules/file/stored-file.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import {
  CampaignPageTransport,
  captureCampaignPage,
} from './support/partner-campaign-page-harness';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);

interface AccountView {
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  availableTotalUnits: number;
  reservedTotalUnits: number;
  items: Array<{
    id: string;
    studentName: string;
    packageName: string;
    entryType: string;
    paymentContext: { receivedOn: string } | { paidAt: string } | null;
    teachingContext: {
      courseName: string;
      teacherName: string;
      lessonStartsAt: string;
    } | null;
  }>;
  meta: { page: number; total: number; totalPages: number };
}
const view = (response: { body: unknown }) =>
  (response.body as { data: AccountView }).data;
const recentLedger = (response: { body: unknown }) =>
  (response.body as { data: { recentLessonLedger: AccountView['items'] } }).data
    .recentLessonLedger;

describe('partner lesson account isolated read consistency', () => {
  const runTag = `ppdf-${randomUUID().slice(0, 8)}`;
  const ownedUsers: string[] = [];
  const campusIds: string[] = [];
  const studentIds: string[] = [];
  const packageIds: string[] = [];
  const ledgerIds: string[] = [];
  const correctionIds: string[] = [];
  const receiptIds: string[] = [];
  const issuanceIds: string[] = [];
  const fileIds: string[] = [];
  const refundIds: string[] = [];
  const teacherProfileIds: string[] = [];
  const classGroupIds: string[] = [];
  const lessonSessionIds: string[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let token: string;
  let otherToken: string;
  let teacherToken: string;
  let port: number | undefined;
  const get = (bearer = token) =>
    request(server)
      .get('/partners/me/lesson-account')
      .auth(bearer, { type: 'bearer' });
  const createLedger = async (
    campusIndex: number,
    relatedIndex = campusIndex,
    packageIndex = relatedIndex,
    entryType: Prisma.LessonLedgerEntryUncheckedCreateInput['entryType'] = 'ADJUSTMENT',
    lessonSessionId?: string,
  ): Promise<LessonLedgerEntry> => {
    const deltaUnits = ['CONSUME', 'REFUND', 'CORRECTION'].includes(entryType)
      ? -100
      : 100;
    const original =
      entryType === 'REVERSAL' || entryType === 'CORRECTION'
        ? await createLedger(
            campusIndex,
            relatedIndex,
            packageIndex,
            entryType === 'REVERSAL' ? 'CONSUME' : 'GRANT',
            lessonSessionId,
          )
        : null;
    let financeCorrectionId: string | undefined;
    let financeRefundId: string | undefined;
    if (entryType === 'CORRECTION' || entryType === 'REFUND') {
      let issuance = await prisma.financePackageIssuance.findUnique({
        where: { coursePackageId: packageIds[packageIndex] },
      });
      if (!issuance) {
        const proof = await prisma.storedFile.create({
          data: {
            purpose: 'FINANCE_RECEIPT_PROOF',
            storageKey: `${runTag}/${randomUUID()}`,
            originalName: 'synthetic-proof.png',
            mimeType: 'image/png',
            sizeBytes: 1,
            sha256: '0'.repeat(64),
            createdByUserId: ownedUsers[0],
          },
        });
        fileIds.push(proof.id);
        const receipt = await prisma.financeReceipt.create({
          data: {
            campusId: campusIds[campusIndex],
            studentId: studentIds[relatedIndex],
            amountFen: 100,
            receivedOn: new Date('2026-10-09T00:00:00Z'),
            channel: 'CASH',
            proofFileId: proof.id,
            createdByUserId: ownedUsers[0],
          },
        });
        receiptIds.push(receipt.id);
        issuance = await prisma.financePackageIssuance.create({
          data: {
            receiptId: receipt.id,
            coursePackageId: packageIds[packageIndex],
            originalAmountFen: 100,
            initialMainUnits: 100,
            initialGiftUnits: 0,
            name: `${runTag}合成初始发放`,
            validFrom: new Date('2020-01-01T00:00:00Z'),
            issuedByUserId: ownedUsers[0],
          },
        });
        issuanceIds.push(issuance.id);
      }
      if (entryType === 'CORRECTION') {
        const correction = await prisma.financeReceiptCorrection.create({
          data: {
            originalIssuanceId: issuance.id,
            type: 'VOID',
            status: 'APPLIED',
            reason: '隔离合成纠错',
            originalAmountFen: 100,
            sourcePackageVersion: 1,
            requestedByUserId: ownedUsers[0],
            reviewedByUserId: ownedUsers[1],
            reviewedAt: new Date(),
            appliedByUserId: ownedUsers[1],
            appliedAt: new Date(),
          },
        });
        correctionIds.push(correction.id);
        financeCorrectionId = correction.id;
      } else {
        const refund = await prisma.financeRefundRequest.create({
          data: {
            issuanceId: issuance.id,
            mainUnits: 100,
            giftUnits: 0,
            referenceAmountFen: 100,
            amountFen: 100,
            reason: '隔离合成退费读取',
            status: 'PAID',
            requestedByUserId: ownedUsers[0],
            reviewedByUserId: ownedUsers[1],
            reviewedAt: new Date(),
            paymentStartedAt: new Date(),
          },
        });
        refundIds.push(refund.id);
        financeRefundId = refund.id;
      }
    }
    const ledger = await prisma.lessonLedgerEntry.create({
      data: {
        campusId: campusIds[campusIndex],
        studentId: studentIds[relatedIndex],
        coursePackageId: packageIds[packageIndex],
        actorUserId: ownedUsers[0],
        entryType,
        bucket: 'MAIN',
        deltaUnits,
        balanceBeforeUnits: 1000,
        balanceAfterUnits: 1000 + deltaUnits,
        reversalOfId: original?.id,
        financeCorrectionId,
        financeRefundId,
        lessonSessionId,
        idempotencyKey: `${runTag}-${randomUUID()}`,
        reason: '隔离合成测试',
      },
    });
    ledgerIds.push(ledger.id);
    return ledger;
  };

  const createTeachingContext = async (
    sessionCampus = 0,
    classCampus = 0,
    teacherCampus = 0,
    status: 'COMPLETED' | 'REVERSED' = 'COMPLETED',
  ) => {
    const createTeacher = async (campusIndex: number, name: string) => {
      const user = await prisma.user.create({
        data: {
          displayName: `${runTag}${name}`,
          roles: {
            create: { roleCode: 'TEACHER', campusId: campusIds[campusIndex] },
          },
          teacherProfile: {
            create: {
              campusId: campusIds[campusIndex],
              employeeCode: `${runTag}-${randomUUID()}`,
            },
          },
        },
        include: { teacherProfile: true },
      });
      ownedUsers.push(user.id);
      teacherProfileIds.push(user.teacherProfile!.id);
      return user.teacherProfile!.id;
    };
    const classTeacherId = await createTeacher(classCampus, '班级默认教师');
    const lessonTeacherId = await createTeacher(teacherCampus, '课次授课教师');
    const group = await prisma.classGroup.create({
      data: {
        campusId: campusIds[classCampus],
        teacherId: classTeacherId,
        name: `${runTag}-${randomUUID()}`,
        courseName: `${runTag}关联课程`,
      },
    });
    classGroupIds.push(group.id);
    const lesson = await prisma.lessonSession.create({
      data: {
        campusId: campusIds[sessionCampus],
        classGroupId: group.id,
        teacherId: lessonTeacherId,
        startsAt: new Date('2026-10-01T02:00:00Z'),
        endsAt: new Date('2026-10-01T03:00:00Z'),
        status,
        completedAt: new Date('2026-10-01T03:00:00Z'),
        ...(status === 'REVERSED'
          ? {
              reversedAt: new Date('2026-10-01T04:00:00Z'),
              reversalReason: '合成撤销课次',
            }
          : {}),
      },
    });
    lessonSessionIds.push(lesson.id);
    return lesson.id;
  };

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    for (let index = 0; index < 2; index += 1) {
      const campus = await prisma.campus.create({
        data: { code: `${runTag}-${index}`, name: `${runTag}测试校区${index}` },
      });
      campusIds.push(campus.id);
      const user = await prisma.user.create({
        data: {
          displayName: `${runTag}合作方`,
          roles: { create: { roleCode: 'PARTNER', campusId: campus.id } },
        },
      });
      ownedUsers.push(user.id);
      const session = await app.get(AuthService).issueSessionForUser(user.id);
      if (index === 0) token = session.accessToken;
      else otherToken = session.accessToken;
      const student = await prisma.student.create({
        data: { campusId: campus.id, displayName: `${runTag}学员${index}` },
      });
      studentIds.push(student.id);
      const coursePackage = await prisma.coursePackage.create({
        data: {
          campusId: campus.id,
          studentId: student.id,
          name: `${runTag}课包${index}`,
          validFrom: new Date('2020-01-01T00:00:00Z'),
          mainBalanceUnits: 1000,
          giftBalanceUnits: 200,
          mainReservedUnits: 100,
          giftReservedUnits: 50,
        },
      });
      packageIds.push(coursePackage.id);
      await createLedger(index);
    }
    const teacher = await prisma.user.create({
      data: {
        displayName: `${runTag}教师`,
        roles: { create: { roleCode: 'TEACHER', campusId: campusIds[0] } },
      },
    });
    ownedUsers.push(teacher.id);
    teacherToken = (await app.get(AuthService).issueSessionForUser(teacher.id))
      .accessToken;
  });

  afterAll(async () => {
    try {
      if (prisma && ownedUsers.length > 0) {
        assertPartnerPdfTestTarget(process.env);
        await prisma.user.updateMany({
          where: {
            id: { in: ownedUsers },
            displayName: { startsWith: runTag },
          },
          data: { status: 'DISABLED' },
        });
      }
    } finally {
      await app?.close();
    }
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
          reject(Error('Ledger payment listener remains open'));
        });
        socket.once('timeout', () => {
          socket.destroy();
          reject(Error('Listener closure unconfirmed'));
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
    process.stdout.write(
      'PARTNER_PDF_FIXTURE_OWNERSHIP ' +
        JSON.stringify({
          runTag,
          campusIds,
          studentIds,
          packageIds,
          ledgerIds,
          correctionIds,
          receiptIds,
          issuanceIds,
          fileIds,
          refundIds,
          teacherProfileIds,
          classGroupIds,
          lessonSessionIds,
          userIds: ownedUsers,
          disposition: 'retained; owned users disabled; no deletion',
        }) +
        '\n',
    );
  });

  it('returns scoped ledger and distinct balance/reservation/available units', async () => {
    const response = view(await get().expect(200));
    expect(response).toMatchObject({
      mainBalanceUnits: 1000,
      giftBalanceUnits: 200,
      availableTotalUnits: 1050,
      reservedTotalUnits: 150,
      meta: { total: 1, totalPages: 1 },
    });
    expect(response.items.map((item) => item.id)).toEqual([ledgerIds[0]]);
    const other = view(await get(otherToken).expect(200));
    expect(other.items.map((item) => item.id)).toEqual([ledgerIds[1]]);
    expect(
      view(await get().query({ page: 99, pageSize: 1 }).expect(200)),
    ).toMatchObject({
      items: [],
      meta: { total: 1, page: 99 },
    });
  });

  it('rejects role, anonymous and client-supplied campus scope', async () => {
    await get(teacherToken).expect(403);
    await request(server).get('/partners/me/lesson-account').expect(401);
    await get().query({ campusId: campusIds[1] }).expect(400);
    await get().query({ pageSize: 101 }).expect(400);
  });

  it('does not expose cross-campus student or package relations on inconsistent ledger rows', async () => {
    await createLedger(0, 1);
    await createLedger(0, 0, 1);
    await createLedger(0, 1, 0);
    const response = view(await get().expect(200));
    expect(response.meta.total).toBe(1);
    expect(response.items.map((item) => item.id)).toEqual([ledgerIds[0]]);
    expect(JSON.stringify(response)).not.toContain(`${runTag}学员1`);
    expect(JSON.stringify(response)).not.toContain(`${runTag}课包1`);
  });

  it('excludes packages whose student belongs to another campus from the balance', async () => {
    const before = view(await get().expect(200));
    const coursePackage = await prisma.coursePackage.create({
      data: {
        campusId: campusIds[0],
        studentId: studentIds[1],
        name: `${runTag}跨校区关联课包`,
        validFrom: new Date('2020-01-01T00:00:00Z'),
        mainBalanceUnits: 9000,
      },
    });
    packageIds.push(coursePackage.id);
    const after = view(await get().expect(200));
    expect(after.mainBalanceUnits).toBe(before.mainBalanceUnits);
    expect(after.availableTotalUnits).toBe(before.availableTotalUnits);
  });

  it.each([undefined, 'ADJUSTMENT'] as const)(
    'reads balances, count and %s rows in one snapshot during a concurrent ledger change',
    async (entryType) => {
      const query = {
        page: 1,
        pageSize: 20,
        ...(entryType ? { entryType } : {}),
      };
      const before = view(await get().query(query).expect(200));
      let changed: Promise<void> | undefined;
      const wrap = (client: Prisma.TransactionClient) => ({
        coursePackage: {
          findMany: client.coursePackage.findMany.bind(client.coursePackage),
        },
        lessonLedgerEntry: {
          count: async (args: Prisma.LessonLedgerEntryCountArgs) => {
            const count = await client.lessonLedgerEntry.count(args);
            changed = prisma.$transaction(async (tx) => {
              const row = await tx.lessonLedgerEntry.create({
                data: {
                  campusId: campusIds[0],
                  studentId: studentIds[0],
                  coursePackageId: packageIds[0],
                  actorUserId: ownedUsers[0],
                  entryType: 'ADJUSTMENT',
                  bucket: 'MAIN',
                  deltaUnits: 100,
                  balanceBeforeUnits: before.mainBalanceUnits,
                  balanceAfterUnits: before.mainBalanceUnits + 100,
                  idempotencyKey: `${runTag}-concurrent-${entryType ?? 'all'}`,
                  reason: '合成并发验证',
                },
              });
              ledgerIds.push(row.id);
              await tx.coursePackage.update({
                where: { id: packageIds[0] },
                data: { mainBalanceUnits: before.mainBalanceUnits + 100 },
              });
            });
            await changed;
            return count;
          },
          findMany: async (args: Prisma.LessonLedgerEntryFindManyArgs) => {
            // Wait for count and the competing commit before selecting page rows.
            if (!changed) await countStarted;
            await changed;
            return client.lessonLedgerEntry.findMany(args);
          },
        },
      });
      let releaseCount!: () => void;
      const countStarted = new Promise<void>((resolve) => {
        releaseCount = resolve;
      });
      const instrument = (client: Prisma.TransactionClient) => {
        const wrapped = wrap(client);
        const count = wrapped.lessonLedgerEntry.count;
        wrapped.lessonLedgerEntry.count = async (args) => {
          try {
            return await count(args);
          } finally {
            releaseCount();
          }
        };
        return wrapped;
      };
      const base = instrument(prisma);
      const service = new PartnerReadService(
        {
          ...base,
          $transaction: (
            read: (tx: Prisma.TransactionClient) => Promise<unknown>,
            options: { isolationLevel: Prisma.TransactionIsolationLevel },
          ) =>
            prisma.$transaction(
              (tx) =>
                read(instrument(tx) as unknown as Prisma.TransactionClient),
              options,
            ),
        } as unknown as PrismaService,
        app.get(PartnerScopeService),
        app.get(PartnerStudentQueryService),
        app.get(StoredFileService),
      );
      const result = await service.getLessonAccount(
        {
          userId: ownedUsers[0],
          roles: [{ code: 'PARTNER', campusId: campusIds[0] }],
        },
        query,
      );
      expect(result.meta.total).toBe(before.meta.total);
      expect(result.items.map((item) => item.id)).toEqual(
        before.items.map((item) => item.id),
      );
      expect(result.mainBalanceUnits).toBe(before.mainBalanceUnits);
      expect(view(await get().query(query).expect(200))).toMatchObject({
        mainBalanceUnits: before.mainBalanceUnits + 100,
        meta: { total: before.meta.total + 1 },
      });
    },
  );

  it.each([
    'GRANT',
    'CONSUME',
    'REVERSAL',
    'ADJUSTMENT',
    'REFUND',
    'CORRECTION',
  ] as const)(
    'filters %s before counting and paging while preserving all-campus balances',
    async (entryType) => {
      const own = await createLedger(0, 0, 0, entryType);
      await createLedger(1, 1, 1, entryType);
      if (entryType !== 'CORRECTION') await createLedger(0, 1, 1, entryType);
      const all = view(await get().query({ pageSize: 100 }).expect(200));
      const expected = all.items.filter((item) => item.entryType === entryType);
      const first = view(
        await get().query({ entryType, page: 1, pageSize: 1 }).expect(200),
      );
      expect(first.meta.total).toBe(expected.length);
      expect(first.items.map((item) => item.id)).toEqual(
        expected.slice(0, 1).map((item) => item.id),
      );
      expect(expected.map((item) => item.id)).toContain(own.id);
      expect(first.mainBalanceUnits).toBe(all.mainBalanceUnits);
      expect(first.availableTotalUnits).toBe(all.availableTotalUnits);
      const outside = view(
        await get().query({ entryType, page: 99, pageSize: 1 }).expect(200),
      );
      expect(outside.items).toEqual([]);
      expect(outside.meta.total).toBe(expected.length);
    },
  );

  it.each(['ALL', 'INVALID', '', ['GRANT', 'CONSUME']])(
    'rejects invalid ledger filter %j',
    async (entryType) => {
      await get().query({ entryType }).expect(400);
    },
  );

  it('retains role and scope boundaries with ledger filters', async () => {
    await get(teacherToken).query({ entryType: 'GRANT' }).expect(403);
    await get()
      .query({ entryType: 'GRANT', campusId: campusIds[1] })
      .expect(400);
  });

  it('returns explicit unknown teaching context without guessing current student classes', async () => {
    const response = view(await get().expect(200));
    expect(response.items.length).toBeGreaterThan(0);
    for (const item of response.items) expect(item.teachingContext).toBeNull();
    const detail = await request(server)
      .get(`/partners/me/students/${studentIds[0]}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    for (const item of recentLedger(detail)) {
      expect(item.teachingContext).toBeNull();
    }
  });

  it.each(['CONSUME', 'REVERSAL'] as const)(
    'returns the linked lesson teacher, not the class default, for %s',
    async (entryType) => {
      const lessonId = await createTeachingContext(
        0,
        0,
        0,
        entryType === 'REVERSAL' ? 'REVERSED' : 'COMPLETED',
      );
      const ledger = await createLedger(0, 0, 0, entryType, lessonId);
      const response = view(await get().query({ entryType }).expect(200));
      const row = response.items.find((item) => item.id === ledger.id);
      expect(row?.teachingContext).toEqual({
        courseName: `${runTag}关联课程`,
        teacherName: `${runTag}课次授课教师`,
        lessonStartsAt: '2026-10-01T02:00:00.000Z',
      });
      expect(JSON.stringify(row)).not.toContain(`${runTag}班级默认教师`);
      const detail = await request(server)
        .get(`/partners/me/students/${studentIds[0]}`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(
        recentLedger(detail).find((item) => item.id === ledger.id)
          ?.teachingContext,
      ).toEqual(row?.teachingContext);
    },
  );

  it.each(['session', 'class', 'teacher'] as const)(
    'retains the owned ledger but hides a cross-campus %s relation',
    async (relation) => {
      const lessonId = await createTeachingContext(
        relation === 'session' ? 1 : 0,
        relation === 'class' ? 1 : 0,
        relation === 'teacher' ? 1 : 0,
      );
      const ledger = await createLedger(0, 0, 0, 'CONSUME', lessonId);
      const response = view(
        await get().query({ entryType: 'CONSUME' }).expect(200),
      );
      const row = response.items.find((item) => item.id === ledger.id);
      expect(row).toBeDefined();
      expect(row?.teachingContext).toBeNull();
      expect(JSON.stringify(row)).not.toContain(lessonId);
      expect(JSON.stringify(row)).not.toContain(`${runTag}关联课程`);
      expect(JSON.stringify(row)).not.toContain(`${runTag}课次授课教师`);
      const detail = await request(server)
        .get(`/partners/me/students/${studentIds[0]}`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(
        recentLedger(detail).find((item) => item.id === ledger.id)
          ?.teachingContext,
      ).toBeNull();
    },
  );

  it('uses current associated names without discarding a stopped teacher or changing ledger facts', async () => {
    const lessonId = await createTeachingContext();
    const ledger = await createLedger(0, 0, 0, 'CONSUME', lessonId);
    const before = view(
      await get().query({ entryType: 'CONSUME' }).expect(200),
    );
    const lesson = await prisma.lessonSession.findUniqueOrThrow({
      where: { id: lessonId },
    });
    await prisma.teacherProfile.update({
      where: { id: lesson.teacherId },
      data: {
        isActive: false,
        user: { update: { displayName: `${runTag}已更名教师` } },
      },
    });
    await prisma.classGroup.update({
      where: { id: lesson.classGroupId },
      data: { courseName: `${runTag}已更名课程` },
    });
    const after = view(await get().query({ entryType: 'CONSUME' }).expect(200));
    const beforeRow = before.items.find((item) => item.id === ledger.id)!;
    const afterRow = after.items.find((item) => item.id === ledger.id)!;
    expect(afterRow.teachingContext).toEqual({
      courseName: `${runTag}已更名课程`,
      teacherName: `${runTag}已更名教师`,
      lessonStartsAt: '2026-10-01T02:00:00.000Z',
    });
    expect({ ...afterRow, teachingContext: null }).toEqual({
      ...beforeRow,
      teachingContext: null,
    });
    expect(after.meta).toEqual(before.meta);
    expect(after.mainBalanceUnits).toBe(before.mainBalanceUnits);
  });

  const receiptContext = { receivedOn: '2026-10-09' };
  it('returns receipt calendar dates on every ledger type and on recent detail, including reversed history', async () => {
    const account = view(await get().query({ pageSize: 100 }).expect(200));
    for (const entryType of [
      'GRANT',
      'CONSUME',
      'REVERSAL',
      'ADJUSTMENT',
      'REFUND',
      'CORRECTION',
    ]) {
      const row = account.items.find((item) => item.entryType === entryType);
      expect(row).toBeDefined();
      expect(row!.paymentContext).toEqual(receiptContext);
    }
    const detail = await request(server)
      .get(`/partners/me/students/${studentIds[0]}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(recentLedger(detail).length).toBeGreaterThan(0);
    for (const row of recentLedger(detail))
      expect(row.paymentContext).toEqual(receiptContext);
  });

  it.each(['campus', 'student'] as const)(
    'does not disclose dates on a mismatched receipt %s',
    async (relation) => {
      const receiptId = receiptIds[0];
      await prisma.financeReceipt.update({
        where: { id: receiptId },
        data:
          relation === 'campus'
            ? { campusId: campusIds[1] }
            : { studentId: studentIds[1] },
      });
      try {
        const account = view(await get().query({ pageSize: 100 }).expect(200));
        const row = account.items.find(
          (item) => item.packageName === `${runTag}课包0`,
        );
        expect(row).toBeDefined();
        expect(row!.paymentContext).toBeNull();
        expect(JSON.stringify(row)).not.toContain(receiptId);
      } finally {
        await prisma.financeReceipt.update({
          where: { id: receiptId },
          data: { campusId: campusIds[0], studentId: studentIds[0] },
        });
      }
    },
  );

  it('keeps payment context in the account snapshot during a competing first issuance', async () => {
    const pack = await prisma.coursePackage.create({
      data: {
        campusId: campusIds[0],
        studentId: studentIds[0],
        name: `${runTag}缺源旧包`,
        mainBalanceUnits: 0,
      },
    });
    packageIds.push(pack.id);
    const row = await createLedger(0, 0, packageIds.length - 1);
    expect(
      view(await get().expect(200)).items.find((item) => item.id === row.id)
        ?.paymentContext,
    ).toBeNull();
    let barriers = 0;
    const service = new PartnerReadService(
      {
        $transaction: (
          read: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: { isolationLevel: Prisma.TransactionIsolationLevel },
        ) =>
          prisma.$transaction(
            async (tx) =>
              read(
                new Proxy(tx, {
                  get(target, property, receiver) {
                    if (property !== 'lessonLedgerEntry')
                      return Reflect.get(target, property, receiver) as unknown;
                    return {
                      count: async (
                        args: Prisma.LessonLedgerEntryCountArgs,
                      ) => {
                        const count = await tx.lessonLedgerEntry.count(args);
                        barriers++;
                        const proof = await prisma.storedFile.create({
                          data: {
                            purpose: 'FINANCE_RECEIPT_PROOF',
                            storageKey: `${runTag}/${randomUUID()}`,
                            originalName: 'synthetic.png',
                            mimeType: 'image/png',
                            sizeBytes: 1,
                            sha256: '0'.repeat(64),
                            createdByUserId: ownedUsers[0],
                          },
                        });
                        fileIds.push(proof.id);
                        const receipt = await prisma.financeReceipt.create({
                          data: {
                            campusId: campusIds[0],
                            studentId: studentIds[0],
                            amountFen: 100,
                            receivedOn: new Date('2026-09-10'),
                            channel: 'CASH',
                            proofFileId: proof.id,
                            createdByUserId: ownedUsers[0],
                          },
                        });
                        receiptIds.push(receipt.id);
                        const issuance =
                          await prisma.financePackageIssuance.create({
                            data: {
                              receiptId: receipt.id,
                              coursePackageId: pack.id,
                              originalAmountFen: 100,
                              initialMainUnits: 100,
                              initialGiftUnits: 0,
                              name: pack.name,
                              validFrom: pack.validFrom,
                              issuedByUserId: ownedUsers[0],
                            },
                          });
                        issuanceIds.push(issuance.id);
                        return count;
                      },
                      findMany: tx.lessonLedgerEntry.findMany.bind(
                        tx.lessonLedgerEntry,
                      ),
                    };
                  },
                }),
              ),
            options,
          ),
      } as unknown as PrismaService,
      app.get(PartnerScopeService),
      app.get(PartnerStudentQueryService),
      app.get(StoredFileService),
    );
    const result = await service.getLessonAccount(
      {
        userId: ownedUsers[0],
        roles: [{ code: 'PARTNER', campusId: campusIds[0] }],
      },
      { page: 1, pageSize: 100 },
    );
    expect(barriers).toBe(1);
    expect(
      (
        result.items.find(
          (item) => item.id === row.id,
        ) as unknown as AccountView['items'][number]
      ).paymentContext,
    ).toBeNull();
    expect(
      view(await get().expect(200)).items.find((item) => item.id === row.id)
        ?.paymentContext,
    ).toEqual({ receivedOn: '2026-09-10' });
  });

  it('uses only an unambiguous successful group payment, never a refund or failed attempt', async () => {
    const product = await prisma.courseProduct.create({
      data: {
        campusId: campusIds[0],
        name: `${runTag}合成产品`,
        summary: '合成',
        priceFen: 1990,
        mainUnits: 100,
        giftUnits: 0,
        validityDays: 30,
        createdByUserId: ownedUsers[0],
      },
    });
    const campaign = await prisma.groupCampaign.create({
      data: {
        campusId: campusIds[0],
        courseProductId: product.id,
        code: `${runTag}-payment`,
        title: '合成拼团',
        description: '',
        priceFen: 1990,
        startsAt: new Date('2026-09-01'),
        endsAt: new Date('2026-09-30'),
        createdByUserId: ownedUsers[0],
      },
    });
    const team = await prisma.groupTeam.create({
      data: {
        campaignId: campaign.id,
        leaderUserId: ownedUsers[0],
        status: 'SETTLED',
      },
    });
    const order = await prisma.enrollmentOrder.create({
      data: {
        campusId: campusIds[0],
        studentId: studentIds[0],
        parentUserId: ownedUsers[0],
        courseProductId: product.id,
        orderNo: `${runTag}-payment`,
        productNameSnapshot: product.name,
        priceFenSnapshot: 1990,
        mainUnitsSnapshot: 100,
        giftUnitsSnapshot: 0,
        validityDaysSnapshot: 30,
        status: 'REFUNDED',
      },
    });
    const member = await prisma.groupMember.create({
      data: {
        campaignId: campaign.id,
        teamId: team.id,
        studentId: studentIds[0],
        parentUserId: ownedUsers[0],
        enrollmentOrderId: order.id,
        status: 'REFUNDED',
        reservationExpiresAt: new Date('2026-09-30'),
        paidAt: new Date('2026-09-02T02:00:00Z'),
        settledAt: new Date('2026-09-30'),
        grantedMainUnits: 100,
        grantedGiftUnits: 0,
      },
    });
    const paymentData = {
      groupMemberId: member.id,
      enrollmentOrderId: order.id,
      provider: 'MOCK' as const,
      amountFen: 1990,
    };
    const payment = await prisma.paymentTransaction.create({
      data: {
        ...paymentData,
        type: 'PAYMENT',
        outTradeNo: `${runTag}-paid`,
        status: 'SUCCEEDED',
        succeededAt: new Date('2026-09-02T02:00:00Z'),
      },
    });
    await prisma.paymentTransaction.create({
      data: {
        ...paymentData,
        type: 'REFUND',
        outTradeNo: `${runTag}-refund`,
        status: 'SUCCEEDED',
        succeededAt: new Date('2026-09-29'),
      },
    });
    const attempt = await prisma.paymentTransaction.create({
      data: {
        ...paymentData,
        type: 'PAYMENT',
        outTradeNo: `${runTag}-failed`,
        status: 'FAILED',
      },
    });
    const pack = await prisma.coursePackage.create({
      data: {
        campusId: campusIds[0],
        studentId: studentIds[0],
        name: `${runTag}拼团包`,
        sourceOrderId: order.id,
        mainBalanceUnits: 0,
        isActive: false,
      },
    });
    packageIds.push(pack.id);
    const ledger = await createLedger(0, 0, packageIds.length - 1, 'GRANT');
    const context = async () =>
      view(await get().expect(200)).items.find((item) => item.id === ledger.id)
        ?.paymentContext;
    expect(await context()).toEqual({ paidAt: '2026-09-02T02:00:00.000Z' });
    await prisma.paymentTransaction.update({
      where: { id: payment.id },
      data: { succeededAt: null },
    });
    expect(await context()).toBeNull();
    await prisma.paymentTransaction.update({
      where: { id: payment.id },
      data: { succeededAt: member.paidAt },
    });
    await prisma.groupMember.update({
      where: { id: member.id },
      data: { studentId: studentIds[1] },
    });
    expect(await context()).toBeNull();
    await prisma.groupMember.update({
      where: { id: member.id },
      data: { studentId: studentIds[0] },
    });
    await prisma.paymentTransaction.update({
      where: { id: attempt.id },
      data: { status: 'SUCCEEDED', succeededAt: new Date('2026-09-03') },
    });
    expect(await context()).toBeNull();
    await prisma.paymentTransaction.update({
      where: { id: attempt.id },
      data: { status: 'FAILED', succeededAt: null },
    });
    expect(await context()).toEqual({ paidAt: '2026-09-02T02:00:00.000Z' });
  });

  it('renders payment labels through actual Page and TCP without changing source facts', async () => {
    const facts = async () =>
      createHash('sha256')
        .update(
          JSON.stringify({
            ledger: await prisma.lessonLedgerEntry.findMany({
              where: { id: { in: ledgerIds } },
              orderBy: { id: 'asc' },
            }),
            receipts: await prisma.financeReceipt.findMany({
              where: { id: { in: receiptIds } },
              orderBy: { id: 'asc' },
            }),
            packages: await prisma.coursePackage.findMany({
              where: { id: { in: packageIds } },
              orderBy: { id: 'asc' },
            }),
            payments: await prisma.paymentTransaction.findMany({
              where: { enrollmentOrder: { campusId: campusIds[0] } },
              orderBy: { id: 'asc' },
            }),
          }),
        )
        .digest('hex');
    const before = await facts();
    await app.listen(0, '127.0.0.1');
    port = (server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;
    const transport = new CampaignPageTransport(
      origin,
      new Set([token]),
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
    host.wx = {
      getStorageSync: (key: string) =>
        key === 'education.runtime'
          ? { dataDriver: 'api', apiBaseUrl: origin, accessToken: token }
          : undefined,
      request: transport.request,
      navigateTo: jest.fn(),
      reLaunch: jest.fn(),
      showToast: jest.fn(),
      stopPullDownRefresh: jest.fn(),
    };
    interface AccountPage {
      data: { viewState: string; items: Array<{ paymentLabel: string }> };
      pendingRequest?: Promise<void>;
      onLoad(): void;
      onShow(): void;
      onUnload(): void;
    }
    const page = captureCampaignPage<AccountPage>('lesson-account');
    try {
      page.onLoad();
      page.onShow();
      await page.pendingRequest;
      await transport.idle();
      expect(page.data.viewState).toBe('ready');
      expect(
        page.data.items.some(
          (item) => item.paymentLabel === '缴费日期 2026年10月9日',
        ),
      ).toBe(true);
      expect(
        page.data.items.some(
          (item) => item.paymentLabel === '缴费时间 2026年9月2日 10:00',
        ),
      ).toBe(true);
      expect(await facts()).toBe(before);
      process.stdout.write(
        `PARTNER_LEDGER_PAYMENT_PAGE_TCP ${JSON.stringify({ runTag, port, immutableSourceSha256: before })}\n`,
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
});
