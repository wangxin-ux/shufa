import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { PartnerEarningRecordingService } from '../src/modules/partner-earning/partner-earning-recording.service';
import { PartnerWithdrawalService } from '../src/modules/partner-withdrawal/partner-withdrawal.service';
import { lockPartnerSettlementCampus } from '../src/modules/partner-withdrawal/partner-settlement-account';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import {
  captureWithdrawalPage,
  WithdrawalPageTransport,
  withdrawalPageEvent,
  type WithdrawalFixturePage,
} from './support/partner-withdrawal-page-harness';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60000);
interface Summary {
  enabled: boolean;
  canApply: boolean;
  availableFen: number;
  reservedFen: number;
  paidFen: number;
  unresolvedFen: number;
  blockReason: string;
  profile: { version: number; accountLabel: string };
}
interface Withdrawal {
  id: string;
  version: number;
  status: string;
  amountFen: number;
  proofFileId: string;
  profile: { version: number };
}
const body = <T>(r: { body: unknown }) => (r.body as { data: T }).data;
describe('partner simulated withdrawal through local TCP and isolated PostgreSQL', () => {
  const runTag = `pw-${randomUUID().slice(0, 8)}`;
  const users: string[] = [],
    campuses: string[] = [];
  let app: INestApplication,
    prisma: PrismaService,
    server: Server,
    admin: string,
    adminId: string,
    port: number;
  let mockDriver: string | undefined;
  const key = () => `${runTag}-${randomUUID()}`;
  const post = (
    url: string,
    data: object,
    token = admin,
    idempotencyKey = key(),
  ) =>
    request(server)
      .post(url)
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', idempotencyKey)
      .send(data);
  const get = (url: string, token = admin) =>
    request(server).get(url).auth(token, { type: 'bearer' });
  const summary = async (token: string) =>
    body<Summary>(
      await get('/partners/me/withdrawal-summary', token).expect(200),
    );
  async function addUser(
    role: 'SUPER_ADMIN' | 'PARTNER' | 'TEACHER' | 'FINANCE',
    campusId: string | null,
  ) {
    const user = await prisma.user.create({
      data: {
        displayName: `${runTag}-${users.length}`,
        roles: { create: { roleCode: role, campusId } },
      },
    });
    users.push(user.id);
    return {
      id: user.id,
      token: (await app.get(AuthService).issueSessionForUser(user.id))
        .accessToken,
    };
  }
  async function fixture(
    amounts = [100000],
    daily = 100,
    confirmSources = true,
  ) {
    const campus = await prisma.campus.create({
      data: { code: `${runTag}-${campuses.length}`, name: `${runTag}合成校区` },
    });
    campuses.push(campus.id);
    const partner = await addUser('PARTNER', campus.id),
      teacher = await addUser('TEACHER', campus.id);
    const profile = await prisma.teacherProfile.create({
      data: {
        userId: teacher.id,
        campusId: campus.id,
        employeeCode: `${runTag}-${campuses.length}`,
      },
    });
    const group = await prisma.classGroup.create({
      data: {
        campusId: campus.id,
        teacherId: profile.id,
        name: runTag,
        courseName: '模拟课程',
      },
    });
    const rule = await prisma.partnerEarningRule.create({
      data: {
        campusId: campus.id,
        scopeKey: `${runTag}:${campus.id}`,
        unitPriceFen: 100000,
        shareBasisPoints: 1000,
        eligibleLessonKinds: ['REGULAR'],
        countedAttendanceStatuses: ['PRESENT'],
        version: 1,
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        createdByUserId: adminId,
      },
    });
    const entries: Array<{ id: string; teachingId: string; version: number }> =
      [];
    for (const amountFen of amounts) {
      const now = new Date();
      const lesson = await prisma.lessonSession.create({
        data: {
          campusId: campus.id,
          teacherId: profile.id,
          classGroupId: group.id,
          startsAt: new Date(now.getTime() - 3600000),
          endsAt: now,
          completedAt: now,
          status: 'COMPLETED',
        },
      });
      const teaching = await prisma.teachingRecord.create({
        data: {
          campusId: campus.id,
          teacherId: profile.id,
          lessonSessionId: lesson.id,
          attendeeCount: 0,
          lessonUnits: 100,
          recordedByUserId: teacher.id,
          completedAt: now,
        },
      });
      const basis = await prisma.partnerEarningBasis.create({
        data: {
          campusId: campus.id,
          teachingRecordId: teaching.id,
          lessonSessionId: lesson.id,
          selectedRuleId: rule.id,
          lessonKind: 'REGULAR',
          lessonUnits: 100,
          actualAttendeeCount: 0,
          countedAttendeeCount: 0,
          attendanceSnapshot: [],
          completedAt: now,
          status: 'PRICED',
        },
      });
      const entry = await prisma.partnerEarningEntry.create({
        data: {
          campusId: campus.id,
          earningBasisId: basis.id,
          amountFen,
          entryType: 'ACCRUAL',
          status: 'AVAILABLE',
          reviewedByUserId: adminId,
          reviewedAt: now,
          reviewableAt: now,
          ruleSnapshot: { simulated: true },
        },
      });
      entries.push({
        id: entry.id,
        teachingId: teaching.id,
        version: entry.version,
      });
    }
    const root = `/management/campuses/${campus.id}/partner-settlement`;
    const configuration = {
      expectedVersion: 0,
      payerName: '模拟付款机构',
      beneficiaryName: '模拟合作机构',
      accountLastFour: '1234',
      minimumAmountFen: 10000,
      dailyRequestLimit: daily,
      reason: '本轮合成结算确认',
    };
    await request(server)
      .put(root)
      .auth(admin, { type: 'bearer' })
      .set('Idempotency-Key', key())
      .send(configuration)
      .expect(200);
    for (const entry of confirmSources ? entries : [])
      await post(`${root}/sources/${entry.id}`, {
        expectedVersion: entry.version,
        expectedProfileVersion: 1,
        reason: '合成可结算确认',
      }).expect(200);
    return {
      campusId: campus.id,
      partner,
      teacher,
      entries,
      root,
      configuration,
    };
  }
  const apply = (token: string, amountFen = 80000, k = key(), version = 1) =>
    post(
      '/partners/me/withdrawals',
      { amountFen, expectedProfileVersion: version },
      token,
      k,
    );
  const act = (w: Withdrawal, action: string, extra: object = {}, k = key()) =>
    post(
      `/management/partner-withdrawals/${w.id}/${action}`,
      { expectedVersion: w.version, ...extra },
      admin,
      k,
    );
  async function reverse(teachingId: string) {
    await prisma.$transaction(async (tx) => {
      const reversal = {
        teachingRecordId: teachingId,
        reversedAt: new Date(),
        actorUserId: adminId,
      };
      await app
        .get(PartnerEarningRecordingService)
        .recordReversedLesson(tx, reversal);
    });
  }
  async function paying(w: Withdrawal) {
    w = body<Withdrawal>(await act(w, 'approve').expect(200));
    return body<Withdrawal>(await act(w, 'mark-paying').expect(200));
  }
  async function proof(w: Withdrawal, evidenceOutcome = 'PAID') {
    return body<Withdrawal>(
      await act(w, 'mock-proof', {
        evidenceOutcome,
        reason: '合成核对结果',
      }).expect(200),
    );
  }
  const paidInput = (w: Withdrawal) => ({
    amountFen: w.amountFen,
    accountVersion: w.profile.version,
    payoutReference: `SIM-${key()}`,
    proofFileId: w.proofFileId,
    paidAt: new Date().toISOString(),
  });
  beforeAll(async () => {
    mockDriver = process.env.PARTNER_WITHDRAWAL_DRIVER;
    process.env.PARTNER_WITHDRAWAL_DRIVER = 'mock';
    ({ app, prisma } = await createPartnerPdfTestApp());
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
    port = (server.address() as AddressInfo).port;
    const a = await addUser('SUPER_ADMIN', null);
    admin = a.token;
    adminId = a.id;
  });
  afterAll(async () => {
    try {
      if (prisma) {
        assertPartnerPdfTestTarget(process.env);
        const disabled = await prisma.user.updateMany({
          where: { id: { in: users }, displayName: { startsWith: runTag } },
          data: { status: 'DISABLED' },
        });
        expect(disabled.count).toBe(users.length);
        expect(
          await prisma.user.count({
            where: { id: { in: users }, status: 'ACTIVE' },
          }),
        ).toBe(0);
        process.stdout.write(
          `PARTNER_WITHDRAWAL_FIXTURES ${JSON.stringify({ runTag, userIds: users, campusIds: campuses, port, disabled: disabled.count, sources: await prisma.partnerSettlementSource.count({ where: { campusId: { in: campuses } } }), withdrawals: await prisma.partnerWithdrawal.count({ where: { campusId: { in: campuses } } }), disposition: 'synthetic facts retained; no deletion' })}\n`,
        );
      }
    } finally {
      await app?.close();
      if (mockDriver === undefined)
        delete process.env.PARTNER_WITHDRAWAL_DRIVER;
      else process.env.PARTNER_WITHDRAWAL_DRIVER = mockDriver;
    }
  });
  it('defaults closed without reading or creating financial facts', async () => {
    const campus = await prisma.campus.create({
      data: { code: `${runTag}-disabled`, name: '模拟关闭校区' },
    });
    campuses.push(campus.id);
    const partner = await addUser('PARTNER', campus.id);
    delete process.env.PARTNER_WITHDRAWAL_DRIVER;
    try {
      expect(await summary(partner.token)).toMatchObject({
        enabled: false,
        canApply: false,
        blockReason: 'SIMULATION_DISABLED',
        availableFen: 0,
      });
      await apply(partner.token).expect(409);
      expect(
        await prisma.partnerWithdrawal.count({
          where: { campusId: campus.id },
        }),
      ).toBe(0);
    } finally {
      process.env.PARTNER_WITHDRAWAL_DRIVER = 'mock';
    }
  });
  it('reserves reviewed confirmed sources, replays once, and never restores paid funds', async () => {
    const f = await fixture(),
      k = key();
    let w = body<Withdrawal>(
      await apply(f.partner.token, 80000, k).expect(200),
    );
    expect(
      body<Withdrawal>(await apply(f.partner.token, 80000, k).expect(200)).id,
    ).toBe(w.id);
    expect(await summary(f.partner.token)).toMatchObject({
      availableFen: 20000,
      reservedFen: 80000,
      paidFen: 0,
    });
    await apply(f.partner.token, 80000, k).expect(200);
    await apply(f.partner.token).expect(409);
    w = await proof(await paying(w));
    const data = paidInput(w),
      paidKey = key();
    w = body<Withdrawal>(await act(w, 'mark-paid', data, paidKey).expect(200));
    await post(
      `/management/partner-withdrawals/${w.id}/mark-paid`,
      { expectedVersion: w.version - 1, ...data },
      admin,
      paidKey,
    ).expect(200);
    expect(await summary(f.partner.token)).toMatchObject({
      availableFen: 20000,
      reservedFen: 0,
      paidFen: 80000,
    });
    await get(`/partners/me/withdrawals/${w.id}/proof`, f.partner.token)
      .expect(200)
      .expect('Content-Type', /pdf/);
    const other = await fixture();
    await get(`/partners/me/withdrawals/${w.id}`, other.partner.token).expect(
      404,
    );
    await get(
      `/partners/me/withdrawals/${w.id}/proof`,
      other.partner.token,
    ).expect(404);
    await act(w, 'mark-failed', {
      reason: '不能释放已付',
      confirmedUnpaid: true,
      proofFileId: w.proofFileId,
    }).expect(409);
  });
  it('serializes concurrent applications and retains daily quota after cancellation', async () => {
    const f = await fixture();
    expect(await summary(f.partner.token)).toMatchObject({
      canApply: true,
      availableFen: 100000,
    });
    await apply(f.partner.token, 9999).expect(409);
    expect(
      await prisma.partnerWithdrawal.count({ where: { campusId: f.campusId } }),
    ).toBe(0);
    const results = await Promise.all([
      apply(f.partner.token),
      apply(f.partner.token),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const w = body<Withdrawal>(results.find((r) => r.status === 200)!);
    await post(
      `/partners/me/withdrawals/${w.id}/cancel`,
      { expectedVersion: w.version },
      f.partner.token,
    ).expect(200);
    expect((await summary(f.partner.token)).availableFen).toBe(100000);
    const limited = await fixture([100000], 1);
    const one = body<Withdrawal>(
      await apply(limited.partner.token).expect(200),
    );
    await post(
      `/partners/me/withdrawals/${one.id}/cancel`,
      { expectedVersion: one.version },
      limited.partner.token,
    ).expect(200);
    expect(await summary(limited.partner.token)).toMatchObject({
      availableFen: 100000,
      canApply: false,
      blockReason: 'DAILY_LIMIT',
    });
    await apply(limited.partner.token).expect(409);
  });
  it('keeps account snapshots, validates inputs and refuses unconfirmed or reversed sources', async () => {
    const f = await fixture(),
      w = body<Withdrawal>(await apply(f.partner.token).expect(200));
    await request(server)
      .put(f.root)
      .auth(admin, { type: 'bearer' })
      .set('Idempotency-Key', key())
      .send({ ...f.configuration, expectedVersion: 1, accountLastFour: '9876' })
      .expect(200);
    expect(
      body<Withdrawal>(
        await get(`/partners/me/withdrawals/${w.id}`, f.partner.token).expect(
          200,
        ),
      ).profile,
    ).toMatchObject({ version: 1, accountLabel: '模拟对公 ****1234' });
    await apply(f.partner.token, 10000, key(), 1).expect(409);
    await post(`${f.root}/sources/${f.entries[0].id}`, {
      expectedVersion: 1,
      expectedProfileVersion: 2,
      reason: '重复来源',
    }).expect(409);
    for (const amountFen of [0, -1, 1.2, 2147483648])
      await apply(f.partner.token, amountFen).expect(400);
    await post(
      '/partners/me/withdrawals',
      { amountFen: 10000, expectedProfileVersion: 2, campusId: f.campusId },
      f.partner.token,
    ).expect(400);
    const privateEntry = await prisma.partnerEarningEntry.findUniqueOrThrow({
      where: { id: f.entries[0].id },
    });
    await prisma.partnerEarningEntry.update({
      where: { id: privateEntry.id },
      data: { status: 'PENDING_REVIEW' },
    });
    const before = await summary(f.partner.token);
    expect(before.canApply).toBe(false);
  });
  it('releases a rejected application without creating a refund fact', async () => {
    const f = await fixture(),
      w = body<Withdrawal>(await apply(f.partner.token).expect(200));
    await act(w, 'reject', { reason: '合成驳回' }).expect(200);
    expect(await summary(f.partner.token)).toMatchObject({
      availableFen: 100000,
      reservedFen: 0,
      paidFen: 0,
    });
    expect(
      await prisma.partnerSettlementReversal.count({
        where: { source: { campusId: f.campusId } },
      }),
    ).toBe(0);
  });
  it('invalidates an entire unpaid request while releasing still valid sources', async () => {
    const f = await fixture([40000, 60000]);
    const w = body<Withdrawal>(await apply(f.partner.token).expect(200));
    await reverse(f.entries[0].teachingId);
    expect(
      body<Withdrawal>(
        await get(`/partners/me/withdrawals/${w.id}`, f.partner.token).expect(
          200,
        ),
      ).status,
    ).toBe('INVALIDATED');
    expect(await summary(f.partner.token)).toMatchObject({
      availableFen: 60000,
      reservedFen: 0,
      unresolvedFen: 0,
    });
    await act(w, 'approve').expect(409);
    await reverse(f.entries[0].teachingId);
    expect(
      await prisma.partnerSettlementReversal.count({
        where: { source: { campusId: f.campusId } },
      }),
    ).toBe(1);
  });
  it('keeps unknown payouts frozen until evidence proves nonpayment', async () => {
    const f = await fixture(),
      w = await proof(
        await paying(
          body<Withdrawal>(await apply(f.partner.token).expect(200)),
        ),
        'UNPAID',
      );
    const unknown = body<Withdrawal>(
      await act(w, 'mark-unknown', { reason: '模拟结果不明' }).expect(200),
    );
    expect(await summary(f.partner.token)).toMatchObject({
      reservedFen: 80000,
      availableFen: 20000,
    });
    await act(unknown, 'mark-failed', { reason: '仅超时' }).expect(400);
    await act(unknown, 'mark-failed', {
      reason: '已核对合成未付款证据',
      confirmedUnpaid: true,
      proofFileId: unknown.proofFileId,
    }).expect(200);
    expect(await summary(f.partner.token)).toMatchObject({
      availableFen: 100000,
      reservedFen: 0,
    });
  });
  it('moves a paying reversal to investigation then records source-specific paid differences', async () => {
    const f = await fixture([40000, 60000]);
    let w = await proof(
      await paying(body<Withdrawal>(await apply(f.partner.token).expect(200))),
    );
    await reverse(f.entries[0].teachingId);
    w = body<Withdrawal>(
      await get(`/partners/me/withdrawals/${w.id}`, f.partner.token).expect(
        200,
      ),
    );
    expect(w.status).toBe('RECONCILING');
    expect(await summary(f.partner.token)).toMatchObject({
      canApply: false,
      blockReason: 'RECONCILIATION_REQUIRED',
      reservedFen: 80000,
    });
    w = body<Withdrawal>(await act(w, 'mark-paid', paidInput(w)).expect(200));
    expect(await summary(f.partner.token)).toMatchObject({
      canApply: false,
      unresolvedFen: 40000,
      paidFen: 80000,
      availableFen: 0,
    });
    expect(
      await prisma.partnerSettlementIssue.count({
        where: { allocation: { withdrawalId: w.id } },
      }),
    ).toBe(1);
  });
  it('creates an issue for each paid revoked allocation without double subtracting the reversal', async () => {
    const f = await fixture([100000]);
    const paid = await proof(
      await paying(body<Withdrawal>(await apply(f.partner.token).expect(200))),
    );
    await act(paid, 'mark-paid').expect(400);
    await act(paid, 'mark-paid', paidInput(paid)).expect(200);
    await reverse(f.entries[0].teachingId);
    expect(await summary(f.partner.token)).toMatchObject({
      unresolvedFen: 80000,
      availableFen: 0,
      paidFen: 80000,
      canApply: false,
    });
  });
  it('denies other roles, inactive actors, foreign sources, self review and mismatched proofs', async () => {
    const f = await fixture(),
      other = await fixture(),
      finance = await addUser('FINANCE', null);
    await apply(finance.token).expect(403);
    await get('/management/partner-withdrawals', f.partner.token).expect(403);
    await post(`${f.root}/sources/${other.entries[0].id}`, {
      expectedVersion: 1,
      expectedProfileVersion: 1,
      reason: '越权来源',
    }).expect(409);
    let w = body<Withdrawal>(await apply(f.partner.token).expect(200));
    await prisma.partnerWithdrawal.update({
      where: { id: w.id },
      data: { requestedByUserId: adminId },
    });
    await act(w, 'approve').expect(403);
    await prisma.partnerWithdrawal.update({
      where: { id: w.id },
      data: { requestedByUserId: f.partner.id },
    });
    w = await proof(await paying(w));
    await act(w, 'mark-paid', { ...paidInput(w), amountFen: 1 }).expect(409);
    const otherProof = await proof(
      await paying(
        body<Withdrawal>(await apply(other.partner.token).expect(200)),
      ),
    );
    await act(w, 'mark-paid', {
      ...paidInput(w),
      proofFileId: otherProof.proofFileId,
    }).expect(400);
    await prisma.user.update({
      where: { id: f.partner.id },
      data: { status: 'DISABLED' },
    });
    await get('/partners/me/withdrawal-summary', f.partner.token).expect(401);
  });
  it('rolls back allocation, audit and idempotency when the transaction fails', async () => {
    const f = await fixture();
    const trigger = `pw_fail_${runTag.slice(3).replace(/-/g, '')}`;
    // The temporary trigger is restricted to this run's newly created campus.
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."campusId" = '${f.campusId}'::uuid AND NEW."action" = 'PARTNER_WITHDRAWAL_CREATE' THEN RAISE EXCEPTION 'synthetic rollback'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`,
    );
    try {
      const k = key();
      await apply(f.partner.token, 80000, k).expect(500);
      expect(
        await prisma.partnerWithdrawal.count({
          where: { campusId: f.campusId },
        }),
      ).toBe(0);
      expect(await prisma.idempotencyRecord.count({ where: { key: k } })).toBe(
        0,
      );
      expect((await summary(f.partner.token)).availableFen).toBe(100000);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON "AuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${trigger}"()`);
    }
  });
  it('requires outcome-specific evidence and rejects contradictory action inputs', async () => {
    const f = await fixture();
    let w = await paying(
      body<Withdrawal>(await apply(f.partner.token).expect(200)),
    );
    await act(w, 'mock-proof').expect(400);
    w = await proof(w);
    const unknown = body<Withdrawal>(
      await act(w, 'mark-unknown', { reason: '待核对' }).expect(200),
    );
    await act(unknown, 'mark-failed', {
      reason: '与已付证据矛盾',
      confirmedUnpaid: true,
      proofFileId: w.proofFileId,
    }).expect(400);
    const unpaid = await fixture();
    let u = await proof(
      await paying(
        body<Withdrawal>(await apply(unpaid.partner.token).expect(200)),
      ),
      'UNPAID',
    );
    await act(u, 'mark-paid', paidInput(u)).expect(400);
    u = body<Withdrawal>(
      await act(u, 'mark-unknown', { reason: '待核对' }).expect(200),
    );
    await act(u, 'mark-failed', {
      reason: '矛盾字段',
      confirmedUnpaid: true,
      proofFileId: u.proofFileId,
      ...paidInput(u),
    }).expect(400);
    expect((await summary(unpaid.partner.token)).reservedFen).toBe(80000);
  });
  it('refuses unconfirmed reviewed sources and concurrent repeated payout references', async () => {
    const f = await fixture([100000], 100, false);
    expect((await summary(f.partner.token)).availableFen).toBe(0);
    await apply(f.partner.token).expect(409);
    const a = await fixture(),
      b = await fixture();
    const wa = await proof(
      await paying(body<Withdrawal>(await apply(a.partner.token).expect(200))),
    );
    const wb = await proof(
      await paying(body<Withdrawal>(await apply(b.partner.token).expect(200))),
    );
    const reference = `SIM-${key()}`;
    const results = await Promise.all([
      act(wa, 'mark-paid', { ...paidInput(wa), payoutReference: reference }),
      act(wb, 'mark-paid', { ...paidInput(wb), payoutReference: reference }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results[0].status === 409 ? wa : wb;
    await act(loser, 'mark-paid', {
      ...paidInput(loser),
      payoutReference: `${reference} `,
    }).expect(400);
    expect(
      body<Withdrawal>(
        await get(`/management/partner-withdrawals/${loser.id}`).expect(200),
      ).status,
    ).toBe('PAYING');
  });
  it('keeps actual teaching reversal atomic when racing application and paid confirmation', async () => {
    const f = await fixture();
    const teaching = await prisma.teachingRecord.findUniqueOrThrow({
      where: { id: f.entries[0].teachingId },
      include: { lessonSession: true },
    });
    const route = `/teachers/me/lesson-sessions/${teaching.lessonSessionId}/reverse`,
      reversalKey = key();
    const reversalBody = {
      lessonVersion: teaching.lessonSession.version,
      reason: '本轮实际教学撤销并发',
    };
    const results = await Promise.all([
      apply(f.partner.token),
      post(route, reversalBody, f.teacher.token, reversalKey),
    ]);
    expect(results[1].status).toBe(200);
    expect([200, 409]).toContain(results[0].status);
    const records = await prisma.partnerWithdrawal.findMany({
      where: { campusId: f.campusId },
    });
    expect(records.every((w) => w.status === 'INVALIDATED')).toBe(true);
    await post(route, reversalBody, f.teacher.token, reversalKey).expect(200);
    expect(
      await prisma.partnerSettlementReversal.count({
        where: { source: { campusId: f.campusId } },
      }),
    ).toBe(1);
    expect((await summary(f.partner.token)).availableFen).toBe(0);
    const g = await fixture(),
      w = await proof(
        await paying(
          body<Withdrawal>(await apply(g.partner.token).expect(200)),
        ),
      );
    const second = await prisma.teachingRecord.findUniqueOrThrow({
      where: { id: g.entries[0].teachingId },
      include: { lessonSession: true },
    });
    const competing = await Promise.all([
      act(w, 'mark-paid', paidInput(w)),
      post(
        `/teachers/me/lesson-sessions/${second.lessonSessionId}/reverse`,
        {
          lessonVersion: second.lessonSession.version,
          reason: '模拟已付登记与教学撤销竞争',
        },
        g.teacher.token,
      ),
    ]);
    expect(competing[1].status).toBe(200);
    expect([200, 409]).toContain(competing[0].status);
    const final = await prisma.partnerWithdrawal.findUniqueOrThrow({
      where: { id: w.id },
    });
    expect(['PAID', 'RECONCILING']).toContain(final.status);
    const s = await summary(g.partner.token);
    expect(s.availableFen).toBe(0);
    expect(s.unresolvedFen).toBe(final.status === 'PAID' ? 80000 : 0);
    expect(s.reservedFen).toBe(final.status === 'PAID' ? 0 : 80000);
  });
  it('never starts payout after prepayment nonpayment evidence has been bound', async () => {
    const f = await fixture();
    const submitted = body<Withdrawal>(
      await apply(f.partner.token).expect(200),
    );
    const approved = body<Withdrawal>(
      await act(submitted, 'approve').expect(200),
    );
    const unpaid = await proof(approved, 'UNPAID');
    await act(unpaid, 'mark-paying').expect(409);
    await act(unpaid, 'mock-proof', {
      evidenceOutcome: 'PAID',
      reason: '不能覆盖既有未付结果',
    }).expect(400);
    await act(unpaid, 'mark-failed', {
      reason: '按本单未付证据收尾',
      proofFileId: unpaid.proofFileId,
      confirmedUnpaid: true,
    }).expect(200);
    expect(await summary(f.partner.token)).toMatchObject({
      availableFen: 100000,
      reservedFen: 0,
      paidFen: 0,
    });
  });
  it('uses the same post-lock instant for Beijing quota and the persisted request date', async () => {
    const f = await fixture([100000], 1);
    let release!: () => void, entered!: () => void;
    const acquired = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let time = new Date('2026-10-16T15:59:59.000Z');
    const clock = jest
      .spyOn(app.get(PartnerWithdrawalService), 'applicationTime')
      .mockImplementation(() => time);
    const blocker = prisma.$transaction(
      async (tx) => {
        await lockPartnerSettlementCampus(tx, f.campusId);
        entered();
        await held;
      },
      { timeout: 10000 },
    );
    try {
      await acquired;
      const pending = apply(f.partner.token, 80000).then(
        (response) => response,
      );
      time = new Date('2026-10-16T16:00:01.000Z');
      release();
      await blocker;
      const response = await pending;
      expect(response.status).toBe(200);
      const w = await prisma.partnerWithdrawal.findUniqueOrThrow({
        where: { id: body<Withdrawal>(response).id },
      });
      expect(w.createdAt.toISOString()).toBe(time.toISOString());
      await apply(f.partner.token, 10000).expect(409);
    } finally {
      release();
      await blocker;
      clock.mockRestore();
    }
  });
  it('runs actual partner and headquarters Pages through TCP, lost receipts and the isolated database', async () => {
    const f = await fixture();
    const campus = await prisma.campus.findUniqueOrThrow({
      where: { id: f.campusId },
    });
    const origin = `http://127.0.0.1:${port}`;
    const transport = new WithdrawalPageTransport(
      origin,
      new Set([admin, f.partner.token]),
      f.campusId,
      campus.code,
    );
    const host = globalThis as unknown as Record<string, unknown>,
      globals = new Map<string, PropertyDescriptor | undefined>();
    for (const name of ['wx', 'Page'])
      globals.set(name, Object.getOwnPropertyDescriptor(host, name));
    const settings = new Map<string, unknown>([
      [
        'education.runtime',
        {
          dataDriver: 'api',
          apiBaseUrl: origin,
          accessToken: f.partner.token,
          enableTestAccountSwitcher: false,
        },
      ],
    ]);
    const pages: WithdrawalFixturePage[] = [];
    const settle = async (p: WithdrawalFixturePage) => {
      for (let i = 0; i < 4; i++) {
        await p.pending;
        await transport.idle();
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    };
    try {
      host.wx = {
        request: transport.request,
        getStorageSync: (k: string) => settings.get(k),
        setStorageSync: (k: string, v: unknown) => settings.set(k, v),
        removeStorageSync: (k: string) => settings.delete(k),
        loadFontFace: (o: { success?: () => void }) => o.success?.(),
        showToast: jest.fn(),
        stopPullDownRefresh: jest.fn(),
      };
      const partner = captureWithdrawalPage('partner');
      pages.push(partner);
      partner.onLoad();
      partner.onShow();
      await settle(partner);
      expect(partner.data.viewState).toBe('ready');
      partner.onAmountInput(withdrawalPageEvent({}, '800'));
      transport.loseNext('/partners/me/withdrawals');
      await partner.onSubmit();
      expect(partner.data.unknown).toBe(true);
      await partner.onRetryAction();
      await settle(partner);
      expect(partner.data.unknown).toBe(false);
      expect(
        await prisma.partnerWithdrawal.count({
          where: { campusId: f.campusId },
        }),
      ).toBe(1);
      const createCalls = transport.calls.filter(
        (c) => c.method === 'POST' && c.path === '/partners/me/withdrawals',
      );
      expect(createCalls).toHaveLength(2);
      expect(createCalls[1]).toMatchObject({
        key: createCalls[0].key,
        body: createCalls[0].body,
      });
      partner.onUnload();
      settings.set('education.runtime', {
        dataDriver: 'api',
        apiBaseUrl: origin,
        accessToken: admin,
        enableTestAccountSwitcher: false,
      });
      const reviewer = captureWithdrawalPage('super-admin');
      pages.push(reviewer);
      reviewer.data.campusQuery = campus.code;
      reviewer.onLoad();
      reviewer.onShow();
      await settle(reviewer);
      expect(reviewer.data.viewState).toBe('ready');
      expect(reviewer.data.campusId).toBe(f.campusId);
      const w = await prisma.partnerWithdrawal.findFirstOrThrow({
        where: { campusId: f.campusId },
      });
      const select = () => reviewer.onSelect(withdrawalPageEvent({ id: w.id }));
      select();
      await reviewer.onAction(withdrawalPageEvent({ action: 'approve' }));
      await settle(reviewer);
      select();
      await reviewer.onAction(withdrawalPageEvent({ action: 'mark-paying' }));
      await settle(reviewer);
      select();
      reviewer.onField(
        withdrawalPageEvent({ field: 'reason' }, '模拟已付核对证据'),
      );
      await reviewer.onAction(
        withdrawalPageEvent({ action: 'mock-proof', outcome: 'PAID' }),
      );
      await settle(reviewer);
      select();
      reviewer.onField(
        withdrawalPageEvent({ field: 'payoutReference' }, `SIM-${key()}`),
      );
      transport.loseNext(`/management/partner-withdrawals/${w.id}/mark-paid`);
      await reviewer.onAction(withdrawalPageEvent({ action: 'mark-paid' }));
      expect(reviewer.data.unknown).toBe(true);
      await reviewer.onRetryAction();
      await settle(reviewer);
      expect(
        (
          await prisma.partnerWithdrawal.findUniqueOrThrow({
            where: { id: w.id },
          })
        ).status,
      ).toBe('PAID');
      expect(reviewer.data.availableLabel).toBe('200.00');
      const paymentCalls = transport.calls.filter((c) =>
        c.path.endsWith('/mark-paid'),
      );
      expect(paymentCalls).toHaveLength(2);
      expect(paymentCalls[1]).toMatchObject({
        key: paymentCalls[0].key,
        body: paymentCalls[0].body,
      });
      process.stdout.write(
        `PARTNER_WITHDRAWAL_PAGE_FLOW ${JSON.stringify({ campusId: f.campusId, withdrawalId: w.id, calls: transport.calls.length, lostCreateReplayed: true, lostPaidReplayed: true, paidRemainsConsumed: true })}\n`,
      );
    } finally {
      for (const p of pages) p.onUnload();
      await transport.idle();
      for (const [name, descriptor] of globals) {
        if (descriptor) Object.defineProperty(host, name, descriptor);
        else delete host[name];
      }
    }
  });
});
