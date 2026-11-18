import { randomUUID } from 'node:crypto';
import { createConnection, type AddressInfo } from 'node:net';
import { request as httpRequest, type Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { AuthenticatedUser } from '../src/common/auth/authenticated-user';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { PartnerRankingService } from '../src/modules/partner/partner-ranking.service';
import {
  PartnerRankingQueryDto,
  type PartnerRankingMetric,
} from '../src/modules/partner/dto/partner-ranking.dto';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);

describe('monthly rankings through isolated PostgreSQL and TCP', () => {
  const runTag = `prank-${randomUUID().slice(0, 8)}`;
  const campusIds: string[] = [],
    userIds: string[] = [],
    studentIds: string[] = [],
    entryIds: string[] = [];
  let app: INestApplication,
    prisma: PrismaService,
    service: PartnerRankingService,
    server: Server,
    port: number;
  let token: string,
    nonPartnerToken: string,
    mixedToken: string,
    actor: AuthenticatedUser;
  const query = (
    metric: PartnerRankingMetric = 'STUDENTS',
    extra: Partial<PartnerRankingQueryDto> = {},
  ) =>
    Object.assign(
      new PartnerRankingQueryDto(),
      { metric, month: '2026-10', page: 1, pageSize: 100 },
      extra,
    );
  const get = (params: Record<string, unknown> = {}, auth = token) =>
    request(server)
      .get('/partners/me/rankings')
      .set('Authorization', `Bearer ${auth}`)
      .query(params);
  const ownValues = async (revisionId: string) =>
    prisma.partnerRankingRow.findMany({
      where: { revisionId, campusId: { in: campusIds } },
      orderBy: { position: 'asc' },
    });
  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    service = app.get(PartnerRankingService);
    server = app.getHttpServer() as Server;
    for (const suffix of ['a', 'b', 'c', 'negative']) {
      const campus = await prisma.campus.create({
        data: {
          code: `${runTag}-${suffix}`,
          name: `${runTag}-${suffix}合成校区`,
          createdAt: new Date('2026-08-01T00:00:00Z'),
        },
      });
      campusIds.push(campus.id);
    }
    const owner = await prisma.user.create({
      data: {
        displayName: `${runTag}-owner`,
        roles: { create: { roleCode: 'PARTNER', campusId: campusIds[0] } },
      },
    });
    userIds.push(owner.id);
    actor = {
      userId: owner.id,
      roles: [{ code: 'PARTNER', campusId: campusIds[0] }],
    };
    const issue = async (id: string) =>
      (await app.get(AuthService).issueSessionForUser(id)).accessToken;
    token = await issue(owner.id);
    for (let campus = 0; campus < 3; campus++) {
      for (let count = 0; count < 3 - campus; count++) {
        const student = await prisma.student.create({
          data: {
            campusId: campusIds[campus],
            displayName: `${runTag}-${campus}-${count}`,
          },
        });
        studentIds.push(student.id);
      }
    }
    const inactive = await prisma.student.create({
      data: {
        campusId: campusIds[0],
        displayName: `${runTag}-inactive`,
        isActive: false,
      },
    });
    studentIds.push(inactive.id);
    for (const kind of ['TEACHER', 'MIXED'] as const) {
      const user = await prisma.user.create({
        data: {
          displayName: `${runTag}-${kind}`,
          roles: {
            create:
              kind === 'MIXED'
                ? [
                    { roleCode: 'PARTNER', campusId: campusIds[0] },
                    { roleCode: 'TEACHER', campusId: campusIds[0] },
                  ]
                : [{ roleCode: 'TEACHER', campusId: campusIds[0] }],
          },
        },
      });
      userIds.push(user.id);
      if (kind === 'MIXED') mixedToken = await issue(user.id);
      else nonPartnerToken = await issue(user.id);
    }
    const teacher = await prisma.user.create({
      data: {
        displayName: `${runTag}-teaching`,
        roles: { create: { roleCode: 'TEACHER', campusId: campusIds[0] } },
        teacherProfile: {
          create: { campusId: campusIds[0], employeeCode: runTag },
        },
      },
      include: { teacherProfile: true },
    });
    userIds.push(teacher.id);
    const teacherId = teacher.teacherProfile!.id;
    const rules: string[] = [];
    for (const campusId of campusIds) {
      const rule = await prisma.partnerEarningRule.create({
        data: {
          campusId,
          scopeKey: `campus:${campusId}:partner`,
          version: 1,
          status: 'ACTIVE',
          unitPriceFen: 1000,
          shareBasisPoints: 5000,
          eligibleLessonKinds: ['REGULAR'],
          countedAttendanceStatuses: ['PRESENT'],
          effectiveFrom: new Date('2026-08-01T00:00:00Z'),
          createdByUserId: owner.id,
        },
      });
      rules.push(rule.id);
    }
    const addEntry = async (
      campusIndex: number,
      amountFen: number,
      price: number,
      createdAt: Date,
      status: 'PENDING_REVIEW' | 'REJECTED' | 'REVERSED' = 'PENDING_REVIEW',
    ) => {
      const campusId = campusIds[campusIndex];
      const group = await prisma.classGroup.create({
        data: {
          campusId,
          teacherId,
          name: `${runTag}-${entryIds.length}`,
          courseName: '合成月榜课程',
        },
      });
      const completedAt = new Date(
        Math.min(
          Date.parse('2026-09-15T03:00:00Z'),
          createdAt.getTime() - 3_600_000,
        ),
      );
      const lesson = await prisma.lessonSession.create({
        data: {
          campusId,
          classGroupId: group.id,
          teacherId,
          completedAt,
          startsAt: new Date(completedAt.getTime() - 3_600_000),
          endsAt: completedAt,
          status: 'COMPLETED',
        },
      });
      const teaching = await prisma.teachingRecord.create({
        data: {
          campusId,
          lessonSessionId: lesson.id,
          teacherId,
          attendeeCount: 1,
          lessonUnits: 100,
          recordedByUserId: teacher.id,
          completedAt,
          status: 'COMPLETED',
        },
      });
      const basis = await prisma.partnerEarningBasis.create({
        data: {
          campusId,
          teachingRecordId: teaching.id,
          lessonSessionId: lesson.id,
          lessonKind: 'REGULAR',
          lessonUnits: 100,
          actualAttendeeCount: 1,
          countedAttendeeCount: 1,
          attendanceSnapshot: [],
          completedAt,
          status: 'PRICED',
          selectedRuleId: rules[campusIndex],
        },
      });
      const entry = await prisma.partnerEarningEntry.create({
        data: {
          campusId,
          earningBasisId: basis.id,
          entryType: 'ACCRUAL',
          amountFen,
          status,
          ruleSnapshot: { unitPriceFen: price },
          reviewableAt: createdAt,
          createdAt,
        },
      });
      entryIds.push(entry.id);
      return entry;
    };
    const date = new Date('2026-10-02T03:00:00Z');
    await addEntry(0, 100_000_000, 200_000_000, date);
    await addEntry(1, 300_000_000, 400_000_000, date);
    await addEntry(2, 200_000_000, 700_000_000, date);
    await addEntry(0, 1_000_000_000, 2_000_000_000, date, 'REJECTED');
    const original = await addEntry(
      3,
      50_000_000,
      60_000_000,
      new Date('2026-09-30T15:59:59.999Z'),
      'REVERSED',
    );
    const reversal = await prisma.partnerEarningEntry.create({
      data: {
        campusId: campusIds[3],
        earningBasisId: original.earningBasisId,
        entryType: 'REVERSAL',
        amountFen: -50_000_000,
        status: 'REVERSED',
        ruleSnapshot: original.ruleSnapshot!,
        reversalOfId: original.id,
        reviewableAt: date,
        createdAt: new Date('2026-09-30T16:00:00Z'),
      },
    });
    entryIds.push(reversal.id);
    await addEntry(
      2,
      1_000_000_000,
      2_000_000_000,
      new Date('2026-10-31T16:00:00Z'),
    );
    await addEntry(
      0,
      10_000_000,
      20_000_000,
      new Date('2026-08-15T03:00:00Z'),
      'REJECTED',
    );
    await app.listen(0, '127.0.0.1');
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    try {
      if (prisma && userIds.length) {
        await prisma.user.updateMany({
          where: { id: { in: userIds }, displayName: { startsWith: runTag } },
          data: { status: 'DISABLED' },
        });
        const disabled = await prisma.user.count({
          where: { id: { in: userIds }, status: 'DISABLED' },
        });
        console.log(
          'PARTNER_RANKING_FIXTURES',
          JSON.stringify({
            runTag,
            userIds,
            campusIds,
            studentIds,
            entryIds,
            disabled,
            port,
            factCount: await prisma.partnerRankingStudentFact.count({
              where: { studentId: { in: studentIds } },
            }),
          }),
        );
        expect(disabled).toBe(userIds.length);
      }
    } finally {
      await app?.close();
    }
    if (port) {
      const closed = await new Promise<boolean>((resolve) => {
        const socket = createConnection({ host: '127.0.0.1', port });
        socket.setTimeout(1500);
        socket.once('connect', () => {
          socket.destroy();
          resolve(false);
        });
        socket.once('error', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('timeout', () => {
          socket.destroy();
          resolve(false);
        });
      });
      console.log(
        'PARTNER_RANKING_PORT_CLOSED',
        JSON.stringify({ port, closed }),
      );
      expect(closed).toBe(true);
    }
  });

  it('counts each active student without requiring a package and excludes disabled students', async () => {
    const page = await service.list(actor, query());
    const rows = await ownValues(page.revisionId!);
    expect(new Map(rows.map((row) => [row.campusId, row.value]))).toEqual(
      new Map([
        [campusIds[0], 3n],
        [campusIds[1], 2n],
        [campusIds[2], 1n],
        [campusIds[3], 0n],
      ]),
    );
    expect(page.ownCampus?.previousRank).toBeNull();
  });
  it('uses internal pending earnings, excludes rejected entries, and subtracts the current-month reversal', async () => {
    const page = await service.list(actor, query('PARTNER_EARNINGS'));
    const rows = await ownValues(page.revisionId!);
    expect(rows.map((row) => row.campusId)).toEqual([
      campusIds[1],
      campusIds[2],
      campusIds[0],
      campusIds[3],
    ]);
    expect(rows.map((row) => row.value)).toEqual([
      300_000_000n,
      200_000_000n,
      100_000_000n,
      -50_000_000n,
    ]);
  });
  it('ranks headquarters retained revenue independently with dense ties and negative totals', async () => {
    const page = await service.list(actor, query('HEADQUARTERS_EARNINGS'));
    const rows = await ownValues(page.revisionId!);
    expect(rows[0]).toMatchObject({
      campusId: campusIds[2],
      value: 500_000_000n,
      rank: 1,
    });
    const ties = rows.filter((row) => row.value === 100_000_000n);
    expect(ties).toHaveLength(2);
    expect(ties.map((row) => row.rank)).toEqual([2, 2]);
    expect(rows.find((row) => row.campusId === campusIds[3])?.value).toBe(
      -10_000_000n,
    );
    expect(
      rows.find((row) => row.campusId === campusIds[3])?.rank,
    ).toBeGreaterThan(2);
  });
  it('groups entries by their own Beijing created month, independently of lesson completion', async () => {
    const september = await service.list(
      actor,
      query('PARTNER_EARNINGS', { month: '2026-09' }),
    );
    const rows = await ownValues(september.revisionId!);
    expect(rows.find((row) => row.campusId === campusIds[3])?.value).toBe(
      50_000_000n,
    );
    expect(rows.find((row) => row.campusId === campusIds[0])?.value).toBe(0n);
    const october = await service.list(
      actor,
      query('PARTNER_EARNINGS'),
      new Date('2026-11-01T00:00:00Z'),
    );
    expect(
      (await ownValues(october.revisionId!)).find(
        (row) => row.campusId === campusIds[2],
      )?.value,
    ).toBe(200_000_000n);
    expect(october.availability).toBe('SNAPSHOT');
    expect(october.ownCampus?.rankDelta).toBe(
      october.ownCampus!.previousRank! - october.ownCampus!.rank,
    );
  });
  it.each(['PARTNER_EARNINGS', 'HEADQUARTERS_EARNINGS'] as const)(
    'keeps rejected-only older %s history calculable with a previous comparison',
    async (metric) => {
      const older = await service.list(
        actor,
        query(metric, { month: '2026-08' }),
      );
      expect(older.availability).toBe('SNAPSHOT');
      expect(
        (await ownValues(older.revisionId!)).map((row) => row.value),
      ).toEqual([0n, 0n, 0n, 0n]);
      expect(older.ownCampus?.rank).toBe(1);
      const september = await service.list(
        actor,
        query(metric, { month: '2026-09' }),
      );
      expect(september.ownCampus?.previousRank).toBe(1);
    },
  );
  it('returns only public rank fields and includes the own-campus row outside the first page', async () => {
    const response = await get({
      metric: 'PARTNER_EARNINGS',
      month: '2026-10',
      pageSize: 1,
    });
    expect(response.status).toBe(200);
    const page = (
      response.body as {
        data: {
          data: Array<Record<string, unknown>>;
          ownCampus: Record<string, unknown>;
        };
      }
    ).data;
    expect(page.data[0].rank).toBe(1);
    expect(page.ownCampus.campusId).toBe(campusIds[0]);
    for (const row of [...page.data, page.ownCampus])
      expect(Object.keys(row).sort()).toEqual(
        [
          'campusId',
          'campusName',
          'rank',
          'previousRank',
          'rankDelta',
          'isOwnCampus',
        ].sort(),
      );
    expect(JSON.stringify(page)).not.toMatch(
      /amountFen|unitPriceFen|countedAttendeeCount|studentId|"value":/,
    );
  });
  it('pins later pages to an immutable revision while refresh produces a changed revision', async () => {
    const first = await service.list(actor, query('STUDENTS', { pageSize: 1 }));
    const second = await service.list(
      actor,
      query('STUDENTS', {
        pageSize: 1,
        page: 2,
        revisionId: first.revisionId!,
      }),
    );
    await prisma.student.update({
      where: { id: studentIds[0] },
      data: { campusId: campusIds[1] },
    });
    const pinned = await service.list(
      actor,
      query('STUDENTS', {
        pageSize: 1,
        page: 2,
        revisionId: first.revisionId!,
      }),
    );
    expect(pinned).toEqual(second);
    const refreshed = await service.list(
      actor,
      query('STUDENTS', { pageSize: 1 }),
    );
    expect(refreshed.revisionId).not.toBe(first.revisionId);
    expect(
      (await ownValues(refreshed.revisionId!)).find(
        (row) => row.campusId === campusIds[0],
      )?.value,
    ).toBe(2n);
    expect(
      await prisma.partnerRankingRow.count({
        where: { revisionId: first.revisionId! },
      }),
    ).toBe(first.meta.total);
  });
  it('reconstructs the October month end and reports unavailable earlier student history', async () => {
    const current = await service.list(actor, query());
    const saved = await service.list(
      actor,
      query(),
      new Date('2026-11-01T00:00:00Z'),
    );
    expect(saved.availability).toBe('SNAPSHOT');
    expect(
      (await ownValues(saved.revisionId!)).map((row) => [
        row.campusId,
        row.value,
      ]),
    ).toEqual(
      (await ownValues(current.revisionId!)).map((row) => [
        row.campusId,
        row.value,
      ]),
    );
    const older = await service.list(
      actor,
      query('STUDENTS', { month: '2026-09' }),
    );
    expect(older).toMatchObject({
      availability: 'UNAVAILABLE',
      unavailableReason: 'HISTORY_UNAVAILABLE',
      revisionId: null,
      data: [],
      ownCampus: null,
      meta: { total: 0 },
    });
    const ancient = await service.list(
      actor,
      query('PARTNER_EARNINGS', { month: '1000-01' }),
    );
    expect(ancient.availability).toBe('UNAVAILABLE');
  });
  it('appends state facts for disabling and reactivation, without recording unrelated name edits', async () => {
    const id = studentIds[1];
    const before = await prisma.partnerRankingStudentFact.count({
      where: { studentId: id },
    });
    await prisma.student.update({
      where: { id },
      data: { displayName: `${runTag}-renamed` },
    });
    expect(
      await prisma.partnerRankingStudentFact.count({
        where: { studentId: id },
      }),
    ).toBe(before);
    await prisma.student.update({ where: { id }, data: { isActive: false } });
    const disabled = await service.list(actor, query());
    expect(
      (await ownValues(disabled.revisionId!)).find(
        (row) => row.campusId === campusIds[0],
      )?.value,
    ).toBe(1n);
    await prisma.student.update({ where: { id }, data: { isActive: true } });
    expect(
      await prisma.partnerRankingStudentFact.count({
        where: { studentId: id },
      }),
    ).toBe(before + 2);
  });
  it('rolls back both student changes and their appended facts in a failed transaction', async () => {
    const count = await prisma.partnerRankingStudentFact.count({
      where: { campusId: { in: campusIds } },
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.student.update({
          where: { id: studentIds[1] },
          data: { isActive: false },
        });
        await tx.student.create({
          data: { campusId: campusIds[0], displayName: `${runTag}-rollback` },
        });
        throw Error('synthetic rollback');
      }),
    ).rejects.toThrow('synthetic rollback');
    expect(
      await prisma.partnerRankingStudentFact.count({
        where: { campusId: { in: campusIds } },
      }),
    ).toBe(count);
    expect(
      (await prisma.student.findUniqueOrThrow({ where: { id: studentIds[1] } }))
        .isActive,
    ).toBe(true);
    expect(
      await prisma.student.count({
        where: { displayName: `${runTag}-rollback` },
      }),
    ).toBe(0);
  });
  it('coalesces concurrent reads of the same changed source into one saved revision', async () => {
    const added = await prisma.student.create({
      data: { campusId: campusIds[2], displayName: `${runTag}-concurrent` },
    });
    studentIds.push(added.id);
    const pages = await Promise.all(
      Array.from({ length: 3 }, () => service.list(actor, query())),
    );
    expect(new Set(pages.map((page) => page.revisionId)).size).toBe(1);
    const revision = await prisma.partnerRankingRevision.findUniqueOrThrow({
      where: { id: pages[0].revisionId! },
    });
    expect(
      await prisma.partnerRankingRevision.count({
        where: {
          metric: revision.metric,
          month: revision.month,
          sourceHash: revision.sourceHash,
        },
      }),
    ).toBe(1);
  });
  it('returns unavailable rather than an invented ranking for invalid revenue source data', async () => {
    const entry = await prisma.partnerEarningEntry.findUniqueOrThrow({
      where: { id: entryIds[0] },
    });
    try {
      await prisma.partnerEarningEntry.update({
        where: { id: entry.id },
        data: { ruleSnapshot: { unitPriceFen: 'invalid' } },
      });
      expect(
        await service.list(actor, query('HEADQUARTERS_EARNINGS')),
      ).toMatchObject({
        availability: 'UNAVAILABLE',
        unavailableReason: 'SOURCE_DATA_INVALID',
        data: [],
        revisionId: null,
      });
    } finally {
      await prisma.partnerEarningEntry.update({
        where: { id: entry.id },
        data: { ruleSnapshot: entry.ruleSnapshot! },
      });
    }
  });
  it.each([
    { campusId: 'untrusted' },
    { month: '2026-13' },
    { month: '2026-11' },
    { month: '2026-1' },
    { metric: 'OTHER' },
    { page: 0 },
    { pageSize: 101 },
    { revisionId: 'invalid' },
  ])('rejects invalid or client-selected scope query (%#)', async (params) => {
    expect((await get(params)).status).toBe(400);
  });
  it('rejects a revision from another metric or month', async () => {
    const page = await service.list(actor, query());
    expect(
      (await get({ metric: 'PARTNER_EARNINGS', revisionId: page.revisionId }))
        .status,
    ).toBe(404);
    expect(
      (
        await get({
          metric: 'STUDENTS',
          month: '2026-09',
          revisionId: page.revisionId,
        })
      ).status,
    ).toBe(404);
  });
  it('rejects nonpartner, mixed-role, missing, and expired access', async () => {
    expect((await get({}, nonPartnerToken)).status).toBe(403);
    expect((await get({}, mixedToken)).status).toBe(403);
    expect((await request(server).get('/partners/me/rankings')).status).toBe(
      401,
    );
    const expired = await app.get(JwtService).signAsync(
      { sub: actor.userId, kind: 'access' },
      {
        secret: app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: -1,
      },
    );
    expect((await get({}, expired)).status).toBe(401);
  });
  it('checks the current role and campus again outside the read snapshot', async () => {
    const transaction = prisma.$transaction.bind(prisma);
    let reads = 0;
    const spy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementation(async (...args: unknown[]) => {
        const result: unknown = await transaction(...args);
        if (++reads === 1)
          await prisma.userRole.updateMany({
            where: {
              userId: actor.userId,
              roleCode: 'PARTNER',
              campusId: campusIds[0],
            },
            data: { campusId: campusIds[1] },
          });
        return result;
      });
    try {
      await expect(service.list(actor, query())).rejects.toMatchObject({
        statusCode: 403,
      });
    } finally {
      spy.mockRestore();
      await prisma.userRole.updateMany({
        where: { userId: actor.userId, roleCode: 'PARTNER' },
        data: { campusId: campusIds[0] },
      });
    }
  });
  it('uses the actual role-private frontend parser over local TCP with no sensitive data', async () => {
    const { PartnerRankingService: FrontendService } = jest.requireActual<
      typeof import('../../frontend/pages/partner/runtime/partner-ranking.service')
    >('../../frontend/pages/partner/runtime/partner-ranking.service');
    const origin = `http://127.0.0.1:${port}`;
    const frontend = new FrontendService({
      dataDriver: 'api',
      apiBaseUrl: origin,
      accessToken: () => token,
      request: (options) => {
        const url = new URL(options.url);
        if (
          url.origin !== origin ||
          url.pathname !== '/partners/me/rankings' ||
          options.method !== 'GET' ||
          options.header.Authorization !== `Bearer ${token}`
        )
          throw Error('Ranking transport outside exact local read scope');
        const outgoing = httpRequest(
          url,
          { headers: options.header, method: options.method },
          (response) => {
            let text = '';
            response.setEncoding('utf8');
            response.on('data', (chunk: string) => {
              text += chunk;
            });
            response.on('end', () =>
              options.success({
                statusCode: response.statusCode!,
                data: JSON.parse(text) as unknown,
              }),
            );
            response.on('error', () =>
              options.fail({ errMsg: 'synthetic local response failure' }),
            );
          },
        );
        outgoing.setTimeout(10_000, () => outgoing.destroy());
        outgoing.on('error', () =>
          options.fail({ errMsg: 'synthetic local request failure' }),
        );
        outgoing.end();
      },
    });
    const page = await frontend.list({
      metric: 'PARTNER_EARNINGS',
      month: '2026-10',
      pageSize: 1,
    });
    expect(page.data[0].rank).toBe(1);
    expect(page.ownCampus?.campusId).toBe(campusIds[0]);
    const second = await frontend.list({
      metric: 'PARTNER_EARNINGS',
      month: '2026-10',
      page: 2,
      pageSize: 1,
      revisionId: page.revisionId!,
    });
    expect(second.data).toHaveLength(1);
    expect(second.revisionId).toBe(page.revisionId);
  });
});
