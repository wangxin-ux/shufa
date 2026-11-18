import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/modules/auth/auth.service';
import { TeacherRankingService } from '../src/modules/teacher-portal/teacher-ranking.service';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { assertTeacherPdfTestTarget } from './support/teacher-pdf-test-database';
import { createTeacherPdfTestApp } from './support/teacher-pdf-test-app';
import { createTeacherFixtureUser } from './support/teacher-feedback-integration-app';
import { completeTeacherFixtureCleanup } from './support/teacher-pdf-test-app';
import { DomainError } from '../src/common/errors/domain-error';
import { ErrorCode } from '../src/common/errors/error-codes';
import { toTeacherEarningRuleSnapshot } from '../src/modules/earning/earning-rule.service';

assertTeacherPdfTestTarget(process.env);
if (
  process.env.TEACHER_ACCOUNT_RANKING_INTEGRATION_ENABLED !== '1' ||
  process.env.TEACHER_PDF_NATIVE_ENABLED !== 'false'
) {
  throw new Error(
    'Explicit non-native coordinator ranking allocation required',
  );
}
jest.setTimeout(60_000);
type Metric = 'EARNINGS' | 'ATTENDANCE';
interface Row {
  position: number;
  displayName: string;
  rank: number;
  previousRank: number | null;
  rankDelta: number | null;
  isSelf: boolean;
}
interface Board {
  metric: Metric;
  month: string;
  timezone: string;
  revision: string;
  rows: Row[];
  own: { value: number; rank: number | null; hasActivity: boolean };
  meta: { page: number; total: number; totalPages: number };
}

describe('teacher monthly rankings through isolated PostgreSQL and HTTP', () => {
  const nativeEnabled = process.env.TEACHER_PDF_NATIVE_ENABLED === 'true';
  const runTag = `${nativeEnabled ? 'tnrank-20261026' : 'trank-20261025'}-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];
  const setupCancellation = new AbortController();
  let setupPromise: Promise<void> | undefined;
  let app: INestApplication<Server>, prisma: PrismaService, campusId: string;
  let owner: Actor, peer: Actor, third: Actor, empty: Actor, outside: Actor;
  let parentToken: string, origin: string;
  type Actor = {
    id: string;
    teacherId: string;
    token: string;
    name: string;
    campusId: string;
  };
  const http = () => request(app.getHttpServer());
  const get = (query: object = {}, token = owner.token) =>
    http()
      .get('/teachers/me/rankings')
      .auth(token, { type: 'bearer' })
      .query(query);
  const read = async (query: object = {}, token = owner.token) =>
    ((await get(query, token).expect(200)).body as { data: Board }).data;

  async function actor(suffix: string, campus: string): Promise<Actor> {
    setupCancellation.signal.throwIfAborted();
    const user = await createTeacherFixtureUser(prisma, {
      displayName: `${runTag}-${suffix}`,
      roles: { create: { roleCode: 'TEACHER', campusId: campus } },
      teacherProfile: {
        create: { campusId: campus, employeeCode: `${runTag}-${suffix}` },
      },
    });
    userIds.push(user.id);
    setupCancellation.signal.throwIfAborted();
    return {
      id: user.id,
      teacherId: user.teacherProfile!.id,
      name: user.displayName,
      campusId: campus,
      token: (await app.get(AuthService).issueSessionForUser(user.id))
        .accessToken,
    };
  }

  async function fact(
    teacher: Actor,
    startsAt: string,
    count: number,
    amount: number,
    options: {
      status?: 'PENDING_REVIEW' | 'AVAILABLE' | 'REJECTED';
      reversed?: boolean;
    } = {},
  ) {
    setupCancellation.signal.throwIfAborted();
    const group = await prisma.classGroup.create({
      data: {
        campusId: teacher.campusId,
        teacherId: teacher.teacherId,
        name: `${runTag}-${randomUUID().slice(0, 8)}`,
        courseName: '合成月榜课程',
      },
    });
    setupCancellation.signal.throwIfAborted();
    const lesson = await prisma.lessonSession.create({
      data: {
        campusId: teacher.campusId,
        teacherId: teacher.teacherId,
        classGroupId: group.id,
        startsAt: new Date(startsAt),
        endsAt: new Date(new Date(startsAt).getTime() + 3600000),
        status: options.reversed ? 'REVERSED' : 'COMPLETED',
        completedAt: new Date(startsAt),
        ...(options.reversed
          ? {
              reversedAt: new Date('2026-10-20'),
              reversalReason: '合成撤销历史',
            }
          : {}),
      },
    });
    setupCancellation.signal.throwIfAborted();
    const record = await prisma.teachingRecord.create({
      data: {
        campusId: teacher.campusId,
        teacherId: teacher.teacherId,
        lessonSessionId: lesson.id,
        status: options.reversed ? 'REVERSED' : 'COMPLETED',
        attendeeCount: count,
        lessonUnits: 100,
        recordedByUserId: teacher.id,
        completedAt: new Date(startsAt),
        ...(options.reversed
          ? {
              reversedAt: new Date('2026-10-20'),
              reversalReason: '合成撤销历史',
            }
          : {}),
      },
    });
    const students = [];
    for (let index = 0; index < count + 1; index++) {
      setupCancellation.signal.throwIfAborted();
      const student = await prisma.student.create({
        data: {
          campusId: teacher.campusId,
          displayName: `${runTag}-student-${index}`,
        },
      });
      students.push(student.id);
      setupCancellation.signal.throwIfAborted();
      await prisma.attendanceRecord.create({
        data: {
          campusId: teacher.campusId,
          lessonSessionId: lesson.id,
          studentId: student.id,
          status: index < count ? 'PRESENT' : 'LEAVE',
          recordedByUserId: teacher.id,
        },
      });
    }
    setupCancellation.signal.throwIfAborted();
    const rule = await prisma.teacherEarningRule.create({
      data: {
        campusId: teacher.campusId,
        teacherProfileId: teacher.teacherId,
        scopeKey: `${runTag}:${randomUUID()}`,
        basisType: 'PER_COMPLETED_SESSION',
        unitAmountFen: Math.max(1, amount),
        eligibleLessonKinds: ['REGULAR'],
        countedAttendanceStatuses: ['PRESENT'],
        version: 1,
        status: 'DRAFT',
        effectiveFrom: new Date('2025-01-01'),
        createdByUserId: teacher.id,
      },
    });
    setupCancellation.signal.throwIfAborted();
    const basis = await prisma.teacherEarningBasis.create({
      data: {
        campusId: teacher.campusId,
        teacherProfileId: teacher.teacherId,
        teachingRecordId: record.id,
        lessonSessionId: lesson.id,
        lessonKind: 'REGULAR',
        selectedRuleId: rule.id,
        lessonUnits: 100,
        attendeeCount: count,
        attendanceSnapshot: [],
        completedAt: new Date(startsAt),
        status: options.reversed ? 'REVERSED' : 'PRICED',
      },
    });
    const snapshot = {
      ...toTeacherEarningRuleSnapshot(rule),
      lessonKind: 'REGULAR',
      lessonUnits: 100,
      attendeeCount: count,
      calculation: `${amount}`,
      amountFen: amount,
    };
    setupCancellation.signal.throwIfAborted();
    const entry = await prisma.teacherEarningEntry.create({
      data: {
        campusId: teacher.campusId,
        teacherProfileId: teacher.teacherId,
        earningBasisId: basis.id,
        entryType: 'ACCRUAL',
        amountFen: amount,
        status: options.reversed ? 'REVERSED' : (options.status ?? 'AVAILABLE'),
        ruleSnapshot: snapshot,
        reviewableAt: new Date(startsAt),
        createdAt: new Date(startsAt),
      },
    });
    setupCancellation.signal.throwIfAborted();
    if (options.reversed)
      await prisma.teacherEarningEntry.create({
        data: {
          campusId: teacher.campusId,
          teacherProfileId: teacher.teacherId,
          earningBasisId: basis.id,
          entryType: 'REVERSAL',
          amountFen: -amount,
          status: 'REVERSED',
          reversalOfId: entry.id,
          ruleSnapshot: snapshot,
          reviewableAt: new Date('2026-10-20'),
        },
      });
    return { lesson, record, basis, entry, students };
  }

  async function setup() {
    ({ app, prisma } = await createTeacherPdfTestApp());
    setupCancellation.signal.throwIfAborted();
    campusId = (
      await prisma.campus.create({ data: { code: runTag, name: runTag } })
    ).id;
    setupCancellation.signal.throwIfAborted();
    const otherCampus = (
      await prisma.campus.create({
        data: { code: `${runTag}-outside`, name: `${runTag}-outside` },
      })
    ).id;
    owner = await actor('本人', campusId);
    peer = await actor('同名教师', campusId);
    third = await actor('第三位教师', campusId);
    empty = await actor('无记录教师', campusId);
    outside = await actor('校外教师', otherCampus);
    setupCancellation.signal.throwIfAborted();
    const parent = await createTeacherFixtureUser(prisma, {
      displayName: `${runTag}-家长`,
      roles: { create: { roleCode: 'PARENT', campusId } },
    });
    userIds.push(parent.id);
    setupCancellation.signal.throwIfAborted();
    parentToken = (await app.get(AuthService).issueSessionForUser(parent.id))
      .accessToken;
    await fact(owner, '2026-10-01T00:00:00Z', 2, 1000, {
      status: 'PENDING_REVIEW',
    });
    await fact(peer, '2026-09-30T16:00:00Z', 2, 1000);
    await fact(third, '2026-10-02T00:00:00Z', 1, 400);
    await fact(owner, '2026-09-30T15:59:59Z', 1, 500);
    await fact(peer, '2026-09-10T00:00:00Z', 2, 800);
    await fact(outside, '2026-10-02T00:00:00Z', 4, 90000);
    await fact(owner, '2026-10-03T00:00:00Z', 3, 9000, { reversed: true });
    await fact(owner, '2026-10-04T00:00:00Z', 1, 7000, { status: 'REJECTED' });
    setupCancellation.signal.throwIfAborted();
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  }

  beforeAll(async () => {
    setupPromise = setup();
    await setupPromise;
  });

  afterAll(async () => {
    setupCancellation.abort(new Error('Ranking fixture setup is closing'));
    await setupPromise?.catch(() => undefined);
    try {
      if (prisma && userIds.length) {
        await completeTeacherFixtureCleanup([
          async () => {
            await prisma.teacherEarningRule.updateMany({
              where: {
                campusId,
                createdByUserId: { in: userIds },
                status: 'ACTIVE',
              },
              data: { status: 'RETIRED' },
            });
          },
          async () => {
            expect(
              (
                await prisma.user.updateMany({
                  where: {
                    id: { in: userIds },
                    displayName: { startsWith: `${runTag}-` },
                  },
                  data: { status: 'DISABLED' },
                })
              ).count,
            ).toBe(userIds.length);
          },
        ]);
        console.log(
          'TEACHER_RANKING_FIXTURES',
          JSON.stringify({
            runTag,
            campusId,
            userIds,
            disposition: 'accounts disabled; facts retained',
          }),
        );
      }
    } finally {
      await app?.close();
    }
  });

  (nativeEnabled ? it : it.skip)(
    'native monthly ranking reads real API with pagination, conflicts and revoked owner clearing',
    async () => {
      for (let index = 0; index < 8; index++) {
        const member = await actor(`分页教师${index + 1}`, campusId);
        await fact(member, '2026-10-06T00:00:00Z', 1, 100);
      }
      const earningsNames = (
        await read({ month: '2026-10', pageSize: 100 })
      ).rows.map((row) => row.displayName);
      const attendanceNames = (
        await read({ month: '2026-10', metric: 'ATTENDANCE', pageSize: 100 })
      ).rows.map((row) => row.displayName);
      expect(earningsNames).toHaveLength(11);
      const facts = async () => ({
        entries: await prisma.teacherEarningEntry.findMany({
          where: { campusId },
          orderBy: { id: 'asc' },
        }),
        bases: await prisma.teacherEarningBasis.findMany({
          where: { campusId },
          orderBy: { id: 'asc' },
        }),
        lessons: await prisma.lessonSession.findMany({
          where: { campusId },
          orderBy: { id: 'asc' },
        }),
        attendance: await prisma.attendanceRecord.findMany({
          where: { campusId },
          orderBy: { id: 'asc' },
        }),
        lessonLedger: await prisma.lessonLedgerEntry.findMany({
          where: { campusId },
          orderBy: { id: 'asc' },
        }),
        withdrawals: await prisma.withdrawal.findMany({
          where: { campusId },
          orderBy: { id: 'asc' },
        }),
        audit: await prisma.auditLog.count({ where: { campusId } }),
      });
      const before = await facts();
      const calls: Array<{ method: string; path: string; status: number }> = [];
      app.getHttpServer().on('request', (req, res) => {
        res.once('finish', () =>
          calls.push({
            method: req.method ?? '',
            path: req.url ?? '',
            status: res.statusCode,
          }),
        );
      });
      const rankingCalls = () =>
        calls.filter((call) => call.path.startsWith('/teachers/me/rankings'))
          .length;
      const runNative = jest.requireActual<
        (options: {
          runTag: string;
          origin: string;
          token: string;
          earningsNames: string[];
          attendanceNames: string[];
          updatedPeerName: string;
          assertLazy(): void;
          rankingCalls(): number;
          accountCalls(): Record<string, number>;
          failNextRanking(): Promise<void>;
          changePeerName(): Promise<unknown>;
          revokeProfile(): Promise<unknown>;
          restoreProfile(): Promise<unknown>;
          disableOwner(): Promise<unknown>;
        }) => Promise<string>
      >(
        '../../docs/verification/teacher-pdf-increment-a/native-real-rankings.cjs',
      );
      let evidence: string | undefined;
      try {
        evidence = await runNative({
          runTag,
          origin,
          token: owner.token,
          earningsNames,
          attendanceNames,
          updatedPeerName: `${peer.name}-已更新`,
          rankingCalls,
          accountCalls: () =>
            Object.fromEntries(
              ['earning-rule', 'earnings/summary', 'earnings', 'rankings'].map(
                (route) => [
                  route,
                  calls.filter(
                    (call) =>
                      call.path.split('?')[0] === `/teachers/me/${route}` &&
                      call.status === 200,
                  ).length,
                ],
              ),
            ),
          assertLazy: () => expect(rankingCalls()).toBe(0),
          failNextRanking: () => {
            jest
              .spyOn(app.get(TeacherRankingService), 'list')
              .mockRejectedValueOnce(
                new DomainError(
                  ErrorCode.INTERNAL_SERVER_ERROR,
                  '合成短暂服务失败',
                  503,
                ),
              );
            return Promise.resolve();
          },
          changePeerName: () =>
            prisma.user.update({
              where: { id: peer.id },
              data: { displayName: `${peer.name}-已更新` },
            }),
          revokeProfile: () =>
            prisma.teacherProfile.update({
              where: { id: owner.teacherId },
              data: { isActive: false },
            }),
          restoreProfile: () =>
            prisma.teacherProfile.update({
              where: { id: owner.teacherId },
              data: { isActive: true },
            }),
          disableOwner: () =>
            prisma.user.update({
              where: { id: owner.id },
              data: { status: 'DISABLED' },
            }),
        });
      } finally {
        jest.restoreAllMocks();
        console.log(
          'TEACHER_NATIVE_RANKINGS_HTTP',
          JSON.stringify({ runTag, calls, evidence, completed: !!evidence }),
        );
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
        expect(await facts()).toEqual(before);
      }
      for (const status of [200, 401, 403, 409, 503])
        expect(calls.some((call) => call.status === status)).toBe(true);
      expect(
        calls.filter(
          (call) => call.path.includes('page=2') && call.status === 200,
        ),
      ).toHaveLength(2);
    },
    360_000,
  );

  it('uses campus month boundaries, independent metrics, competition ranks and private own values', async () => {
    const earnings = await read({ month: '2026-10', metric: 'EARNINGS' });
    expect(earnings).toMatchObject({
      timezone: 'Asia/Shanghai',
      own: { value: 1000, rank: 1, hasActivity: true },
    });
    expect(earnings.rows.map((row) => row.rank)).toEqual([1, 1, 3]);
    expect(earnings.rows.find((row) => row.isSelf)).toMatchObject({
      previousRank: 2,
      rankDelta: 1,
    });
    for (const row of earnings.rows)
      expect(Object.keys(row).sort()).toEqual(
        [
          'position',
          'displayName',
          'rank',
          'previousRank',
          'rankDelta',
          'isSelf',
        ].sort(),
      );
    expect(JSON.stringify(earnings)).not.toContain(outside.name);
    expect(JSON.stringify(earnings)).not.toContain(peer.teacherId);
    expect(JSON.stringify(earnings)).not.toContain(peer.id);
    const attendance = await read({ month: '2026-10', metric: 'ATTENDANCE' });
    // Rejected money does not erase the valid class attendance.
    expect(attendance.own).toMatchObject({ value: 3, rank: 1 });
    expect(
      attendance.rows.find((row) => row.displayName === third.name),
    ).toMatchObject({ rank: 3, previousRank: null });
    expect((await read({ month: '2026-09' })).own.value).toBe(500);
  });

  it('requires a consistent page revision, including changes to previous-month comparisons', async () => {
    const first = await read({ month: '2026-10', pageSize: 1 });
    const second = await read({
      month: '2026-10',
      page: 2,
      pageSize: 1,
      revision: first.revision,
    });
    expect(second.rows[0].position).toBe(2);
    expect(second.own).toEqual(first.own);
    await get({ month: '2026-10', page: 2 }).expect(400);
    await fact(third, '2026-09-12T00:00:00Z', 1, 2000);
    await get({ month: '2026-10', page: 2, revision: first.revision }).expect(
      409,
    );
    expect((await read({ month: '2026-10' })).revision).not.toBe(
      first.revision,
    );
  });

  it('distinguishes empty results and no own activity without exposing zero-value peers', async () => {
    expect((await read({ month: '2026-10' }, empty.token)).own).toMatchObject({
      value: 0,
      rank: null,
      hasActivity: false,
    });
    const blank = await read({ month: '2025-01', metric: 'ATTENDANCE' });
    expect(blank).toMatchObject({
      rows: [],
      own: { value: 0, rank: null, hasActivity: false },
      meta: { total: 0 },
    });
  });

  it('rejects other roles, caller-supplied scopes, invalid months/metrics and future periods', async () => {
    await get({}, parentToken).expect(403);
    for (const query of [
      { campusId },
      { teacherId: peer.teacherId },
      { metric: 'STUDENTS' },
      { month: '2026-13' },
      { month: '9999-01' },
      { page: 0 },
      { revision: 'bad' },
    ]) {
      await get(query).expect(400);
    }
    const board = await read({ month: '2026-10' }, outside.token);
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0].displayName).toBe(outside.name);
    expect(board.own.value).toBe(90000);
  });

  it('keeps rankings read-only and reflects a real reversal without rewriting original facts', async () => {
    const rule = await prisma.teacherEarningRule.create({
      data: {
        campusId,
        teacherProfileId: third.teacherId,
        scopeKey: `teacher:${third.teacherId}`,
        basisType: 'PER_COMPLETED_SESSION',
        unitAmountFen: 200,
        eligibleLessonKinds: ['REGULAR'],
        countedAttendanceStatuses: ['PRESENT'],
        version: 1,
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 86400000),
        createdByUserId: third.id,
      },
    });
    const group = await prisma.classGroup.create({
      data: {
        campusId,
        teacherId: third.teacherId,
        name: `${runTag}-actual`,
        courseName: '合成实际授课',
      },
    });
    const student = await prisma.student.create({
      data: {
        campusId,
        displayName: `${runTag}-复课学员`,
        classMemberships: {
          create: {
            campusId,
            classGroupId: group.id,
            joinedAt: new Date(Date.now() - 86400000),
          },
        },
      },
    });
    const pack = await prisma.coursePackage.create({
      data: {
        campusId,
        studentId: student.id,
        name: runTag,
        mainBalanceUnits: 500,
        validFrom: new Date(Date.now() - 86400000),
      },
    });
    await prisma.lessonLedgerEntry.create({
      data: {
        campusId,
        studentId: student.id,
        coursePackageId: pack.id,
        entryType: 'GRANT',
        bucket: 'MAIN',
        deltaUnits: 500,
        balanceBeforeUnits: 0,
        balanceAfterUnits: 500,
        idempotencyKey: randomUUID(),
        actorUserId: third.id,
      },
    });
    const lessonIds: string[] = [];
    for (let index = 0; index < 2; index++) {
      const lesson = await prisma.lessonSession.create({
        data: {
          campusId,
          teacherId: third.teacherId,
          classGroupId: group.id,
          startsAt: new Date(Date.now() - (index + 1) * 7200000),
          endsAt: new Date(Date.now() - (index + 1) * 3600000),
        },
      });
      lessonIds.push(lesson.id);
      await http()
        .post(`/teachers/me/lesson-sessions/${lesson.id}/complete`)
        .auth(third.token, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({
          lessonVersion: 1,
          attendance: [{ studentId: student.id, status: 'PRESENT' }],
        })
        .expect(200);
    }
    const entry = await prisma.teacherEarningEntry.findFirstOrThrow({
      where: {
        earningBasis: {
          lessonSessionId: lessonIds[0],
          selectedRuleId: rule.id,
        },
      },
    });
    const before = await read({ month: '2026-10' }, third.token);
    expect(before.own.value).toBe(800);
    expect(
      (await read({ month: '2026-10', metric: 'ATTENDANCE' }, third.token)).own
        .value,
    ).toBe(3);
    const ledgerCount = await prisma.lessonLedgerEntry.count({
      where: { campusId },
    });
    const auditCount = await prisma.auditLog.count({ where: { campusId } });
    await http()
      .post(`/teachers/me/lesson-sessions/${lessonIds[0]}/reverse`)
      .auth(third.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ lessonVersion: 2, reason: '合成月榜撤销核验' })
      .expect(200);
    const after = await read({ month: '2026-10' }, third.token);
    expect(after.own.value).toBe(600);
    expect(
      (await read({ month: '2026-10', metric: 'ATTENDANCE' }, third.token)).own
        .value,
    ).toBe(2);
    expect(after.revision).not.toBe(before.revision);
    expect(
      await prisma.teacherEarningEntry.findUnique({ where: { id: entry.id } }),
    ).toMatchObject({ amountFen: 200, status: 'REVERSED' });
    expect(
      await prisma.teacherEarningEntry.findFirst({
        where: { reversalOfId: entry.id },
      }),
    ).toMatchObject({ amountFen: -200, entryType: 'REVERSAL' });
    expect(await prisma.lessonLedgerEntry.count({ where: { campusId } })).toBe(
      ledgerCount + 1,
    );
    expect(
      await prisma.coursePackage.findUnique({ where: { id: pack.id } }),
    ).toMatchObject({ mainBalanceUnits: 400 });
    expect(
      await prisma.auditLog.count({ where: { campusId } }),
    ).toBeGreaterThan(auditCount);
    const facts = await prisma.teacherEarningEntry.count({
      where: { campusId },
    });
    await read({ month: '2026-10' });
    expect(
      await prisma.teacherEarningEntry.count({ where: { campusId } }),
    ).toBe(facts);
  });

  it('loads account and ranking through the actual Page, TCP and database with independent failure/retry', async () => {
    const support = jest.requireActual<
      typeof import('../../frontend/tests/teacher-http-page-test-support')
    >('../../frontend/tests/teacher-http-page-test-support');
    const host = support.createTeacherHttpPageHost({
      origin,
      accessToken: owner.token,
      routes: [
        { method: 'GET' as const, path: '/me' },
        ...['earnings/summary', 'earning-rule', 'earnings', 'rankings'].map(
          (route) => ({
            method: 'GET' as const,
            path: `/teachers/me/${route}`,
          }),
        ),
      ],
    });
    try {
      const page = host.capture('earnings') as {
        onLoad(): void;
        onShow?(): void;
        onHide?(): void;
        onOpenRankings(): Promise<void>;
        onRankingMetric(event: {
          currentTarget: { dataset: { metric: string } };
        }): void;
        data: {
          rankingState: string;
          rankingRows: { isSelf: boolean }[];
          summaryItems: unknown[];
          rankingMetric: string;
          rankingOwnLabel: string;
        };
      };
      page.onLoad();
      page.onShow?.();
      await host.idle();
      await page.onOpenRankings();
      await host.idle();
      expect(page.data.rankingState).toBe('ready');
      expect(
        page.data.rankingRows.some((row: { isSelf: boolean }) => row.isSelf),
      ).toBe(true);
      expect(page.data.summaryItems).toHaveLength(4);
      page.onRankingMetric({
        currentTarget: { dataset: { metric: 'ATTENDANCE' } },
      });
      await host.idle();
      expect(page.data.rankingMetric).toBe('ATTENDANCE');
      expect(page.data.rankingOwnLabel).toContain('3');
      page.onHide?.();
    } finally {
      await host.close();
    }
  });

  it('excludes inconsistent campus/teacher sources and distinguishes rejected-only own activity', async () => {
    const source = await fact(empty, '2026-10-08T00:00:00Z', 1, 100, {
      status: 'REJECTED',
    });
    expect((await read({ month: '2026-10' }, empty.token)).own).toMatchObject({
      value: 0,
      rank: null,
      hasActivity: true,
    });
    await prisma.teacherEarningEntry.update({
      where: { id: source.entry.id },
      data: { teacherProfileId: outside.teacherId },
    });
    expect((await read({ month: '2026-10' }, empty.token)).own).toMatchObject({
      value: 0,
      rank: null,
      hasActivity: false,
    });
    const foreignStudent = await prisma.student.create({
      data: {
        campusId: outside.campusId,
        displayName: `${runTag}-跨校区来源`,
      },
    });
    const attendance = await prisma.attendanceRecord.findFirstOrThrow({
      where: { lessonSessionId: source.lesson.id, status: 'PRESENT' },
    });
    await prisma.attendanceRecord.update({
      where: { id: attendance.id },
      data: { studentId: foreignStudent.id },
    });
    expect(
      (await read({ month: '2026-10', metric: 'ATTENDANCE' }, empty.token)).own
        .value,
    ).toBe(0);
  });

  it('uses configured campus timezone and rejects an active user with multiple roles', async () => {
    await prisma.campus.update({
      where: { id: outside.campusId },
      data: { timezone: 'UTC' },
    });
    await fact(outside, '2026-09-30T23:30:00Z', 1, 100);
    expect((await read({ month: '2026-10' }, outside.token)).own.value).toBe(
      90000,
    );
    expect((await read({ month: '2026-09' }, outside.token)).own.value).toBe(
      100,
    );
    const dual = await actor('双角色', campusId);
    await prisma.userRole.create({
      data: { userId: dual.id, roleCode: 'PARENT', campusId },
    });
    await get({}, dual.token).expect(403);
  });

  it('rechecks current authorization after the repeatable-read result is assembled', async () => {
    const service = app.get(TeacherRankingService);
    const internals = service as unknown as {
      assertOwner(tx: unknown, scope: unknown): Promise<void>;
    };
    const original = internals.assertOwner.bind(service);
    let checks = 0;
    const spy = jest
      .spyOn(internals, 'assertOwner')
      .mockImplementation(async (tx, scope) => {
        if (++checks === 2)
          await prisma.user.update({
            where: { id: empty.id },
            data: { status: 'DISABLED' },
          });
        return original(tx, scope);
      });
    try {
      await get({ month: '2026-10' }, empty.token).expect(403);
      expect(checks).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });
});
