import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { request as httpRequest, type Server } from 'node:http';
import request from 'supertest';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import { PartnerTeacherPerformanceService } from '../src/modules/partner/partner-teacher-performance.service';
import { PartnerTeacherPerformanceQueryDto } from '../src/modules/partner/dto/partner-teacher-performance.dto';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);

describe('partner teacher performance and evaluations in isolated PostgreSQL', () => {
  const runTag = `pteach-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [],
    campusIds: string[] = [],
    teacherIds: string[] = [];
  let app: INestApplication, prisma: PrismaService, server: Server;
  let token: string,
    colleague: string,
    foreign: string,
    mixed: string,
    teacherToken: string;
  const body = (patch = {}) => ({
    periodMonth: '2026-09',
    expectedVersion: 0,
    teachingRating: 1,
    communicationRating: 7,
    attendanceRating: 10,
    overallRating: 4,
    guidance: '合成指导意见',
    ...patch,
  });
  const read = (id = teacherIds[0], auth = token, month = '2026-09') =>
    request(server)
      .get(`/partners/me/teachers/${id}/performance`)
      .set('Authorization', `Bearer ${auth}`)
      .query({ month });
  const save = (payload = body(), id = teacherIds[0], auth = token) =>
    request(server)
      .put(`/partners/me/teachers/${id}/evaluation`)
      .set('Authorization', `Bearer ${auth}`)
      .send(payload);
  const history = (page = 1, pageSize = 20) =>
    request(server)
      .get(`/partners/me/teachers/${teacherIds[0]}/evaluation-history`)
      .set('Authorization', `Bearer ${token}`)
      .query({ month: '2026-09', page, pageSize });

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
    for (const suffix of ['a', 'b']) {
      const campus = await prisma.campus.create({
        data: {
          code: `${runTag}-${suffix}`,
          name: `${runTag}-合成校区`,
          timezone: 'Asia/Shanghai',
        },
      });
      campusIds.push(campus.id);
    }
    for (const kind of [
      'owner',
      'colleague',
      'foreign',
      'mixed',
      'teacher',
    ] as const) {
      const campusId = campusIds[kind === 'foreign' ? 1 : 0];
      const user = await prisma.user.create({
        data: {
          displayName: `${runTag}-${kind}`,
          roles: {
            create:
              kind === 'mixed'
                ? [
                    { roleCode: 'PARTNER', campusId },
                    { roleCode: 'TEACHER', campusId },
                  ]
                : [
                    {
                      roleCode: kind === 'teacher' ? 'TEACHER' : 'PARTNER',
                      campusId,
                    },
                  ],
          },
        },
      });
      userIds.push(user.id);
      const issued = (await app.get(AuthService).issueSessionForUser(user.id))
        .accessToken;
      if (kind === 'owner') token = issued;
      if (kind === 'colleague') colleague = issued;
      if (kind === 'foreign') foreign = issued;
      if (kind === 'mixed') mixed = issued;
      if (kind === 'teacher') teacherToken = issued;
    }
    for (let i = 0; i < 3; i++) {
      const user = await prisma.user.create({
        data: {
          displayName: `${runTag}-教师${i}`,
          teacherProfile: {
            create: {
              employeeCode: `${runTag}-${i}`,
              campusId: campusIds[i === 2 ? 1 : 0],
            },
          },
        },
        include: { teacherProfile: true },
      });
      userIds.push(user.id);
      teacherIds.push(user.teacherProfile!.id);
    }
    const group = await prisma.classGroup.create({
      data: {
        name: `${runTag}-合成班`,
        courseName: '合成课程',
        teacherId: teacherIds[1],
        campusId: campusIds[0],
      },
    });
    for (const [index, spec] of [
      {
        at: '2026-08-31T15:59:59.999Z',
        status: 'COMPLETED',
        record: 'COMPLETED',
      },
      {
        at: '2026-08-31T16:00:00.000Z',
        status: 'COMPLETED',
        record: 'COMPLETED',
      },
      {
        at: '2026-09-30T15:59:59.999Z',
        status: 'COMPLETED',
        record: 'COMPLETED',
      },
      {
        at: '2026-09-30T16:00:00.000Z',
        status: 'COMPLETED',
        record: 'COMPLETED',
      },
      { at: '2026-09-10T02:00:00.000Z', status: 'SCHEDULED' },
      { at: '2026-09-11T02:00:00.000Z', status: 'IN_PROGRESS' },
      { at: '2026-09-12T02:00:00.000Z', status: 'CANCELLED' },
      {
        at: '2026-09-13T02:00:00.000Z',
        status: 'REVERSED',
        record: 'REVERSED',
      },
      { at: '2026-09-14T02:00:00.000Z', status: 'COMPLETED' },
      {
        at: '2026-09-15T02:00:00.000Z',
        status: 'COMPLETED',
        record: 'COMPLETED',
        wrongTeacher: true,
      },
      {
        at: '2026-09-16T02:00:00.000Z',
        status: 'COMPLETED',
        record: 'COMPLETED',
        wrongCampus: true,
      },
      { at: '2099-09-10T02:00:00.000Z', status: 'SCHEDULED' },
    ].entries()) {
      const startsAt = new Date(spec.at);
      const lesson = await prisma.lessonSession.create({
        data: {
          campusId: campusIds[0],
          teacherId: teacherIds[0],
          classGroupId: group.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3600_000),
          status: spec.status as 'COMPLETED',
          completedAt: ['COMPLETED', 'REVERSED'].includes(spec.status)
            ? new Date('2026-10-02T02:00:00Z')
            : null,
          ...(spec.status === 'REVERSED'
            ? {
                reversedAt: new Date('2026-10-03T02:00:00Z'),
                reversalReason: '合成撤销',
              }
            : {}),
        },
      });
      if (spec.record)
        await prisma.teachingRecord.create({
          data: {
            campusId:
              campusIds['wrongCampus' in spec && spec.wrongCampus ? 1 : 0],
            teacherId:
              teacherIds['wrongTeacher' in spec && spec.wrongTeacher ? 1 : 0],
            lessonSessionId: lesson.id,
            status: spec.record as 'COMPLETED',
            attendeeCount: index,
            lessonUnits: 100,
            recordedByUserId: userIds[0],
            completedAt: new Date('2026-10-02T02:00:00Z'),
            ...(spec.record === 'REVERSED'
              ? {
                  reversedAt: new Date('2026-10-03T02:00:00Z'),
                  reversalReason: '合成撤销',
                }
              : {}),
          },
        });
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    try {
      const owned = await prisma.user.findMany({
        where: {
          id: { in: userIds },
          displayName: { startsWith: runTag + '-' },
        },
      });
      if (owned.length !== userIds.length)
        throw Error('Fixture ownership mismatch');
      await prisma.user.updateMany({
        where: {
          id: { in: userIds },
          displayName: { startsWith: runTag + '-' },
        },
        data: { status: 'DISABLED' },
      });
      console.log(
        'PARTNER_TEACHER_FIXTURES ' +
          JSON.stringify({
            runTag,
            userIds,
            campusIds,
            teacherIds,
            port: (server.address() as { port: number }).port,
          }),
      );
    } finally {
      await app.close();
    }
  });

  it('counts lesson starts in campus month, excludes cancellations and validates teaching records', async () => {
    const result = await read();
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({
      teacherId: teacherIds[0],
      periodMonth: '2026-09',
      timezone: 'Asia/Shanghai',
      scheduledLessonCount: 8,
      completedLessonCount: 2,
      completionRateBasisPoints: 2500,
      evaluation: null,
    });
  });
  it('returns null for no schedule and excludes future lessons even within the selected month', async () => {
    expect((await read(teacherIds[1])).body.data).toMatchObject({
      scheduledLessonCount: 0,
      completionRateBasisPoints: null,
    });
    expect(
      (await read(teacherIds[0], token, '2099-09')).body.data,
    ).toMatchObject({
      scheduledLessonCount: 0,
      completionRateBasisPoints: null,
    });
    expect(
      (
        await request(server)
          .get(`/partners/me/teachers/${teacherIds[0]}/performance`)
          .set('Authorization', `Bearer ${token}`)
      ).body.data.periodMonth,
    ).toMatch(/^[1-9]\d{3}-\d\d$/);
  });
  it('denies cross campus, mixed roles, non-partners, anonymous access and malformed parameters', async () => {
    for (const auth of [mixed, teacherToken])
      expect((await read(teacherIds[0], auth)).status).toBe(403);
    expect((await read(teacherIds[0], foreign)).status).toBe(404);
    expect((await read(teacherIds[2])).status).toBe(404);
    expect((await read(teacherIds[0], '')).status).toBe(401);
    expect((await read(teacherIds[0], token, '2026-13')).status).toBe(400);
    expect((await read('bad')).status).toBe(400);
  });
  it('saves all independent half-star ratings and returns only author display name', async () => {
    const result = await save();
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({
      version: 1,
      teachingRating: 1,
      overallRating: 4,
      canEdit: true,
    });
    expect(JSON.stringify(result.body)).not.toContain(userIds[0]);
    expect((await read()).body.data.evaluation).toEqual(result.body.data);
  });
  it('makes same-body retries naturally idempotent and appends one immutable revision', async () => {
    const results = await Promise.all([save(), save()]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.map((r) => r.body.data.version)).toEqual([1, 1]);
    expect((await history()).body.meta.total).toBe(1);
  });
  it('permits original author revision and rejects stale different content and other authors', async () => {
    expect(
      (await save(body({ guidance: '第二版', expectedVersion: 1 }))).body.data
        .version,
    ).toBe(2);
    expect((await save()).status).toBe(409);
    expect(
      (await save(body({ expectedVersion: 2 }), teacherIds[0], colleague))
        .status,
    ).toBe(403);
    expect(
      (await read(teacherIds[0], colleague)).body.data.evaluation.canEdit,
    ).toBe(false);
    expect((await save(body(), teacherIds[0], foreign)).status).toBe(404);
  });
  it('serializes conflicting updates without losing a revision', async () => {
    const results = await Promise.all([
      save(body({ expectedVersion: 2, guidance: '并发甲' })),
      save(body({ expectedVersion: 2, guidance: '并发乙' })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const page = await history(1, 2);
    expect(page.body.meta).toEqual({
      page: 1,
      pageSize: 2,
      total: 3,
      totalPages: 2,
    });
    expect(page.body.data.map((r: { version: number }) => r.version)).toEqual([
      3, 2,
    ]);
    expect((await history(2, 2)).body.data[0].version).toBe(1);
    expect((await history(1, 101)).status).toBe(400);
  });
  it('rejects incomplete, fractional, oversized, invalid Unicode or unexpected content', async () => {
    for (const patch of [
      { teachingRating: 0 },
      { communicationRating: 11 },
      { attendanceRating: 1.5 },
      { overallRating: null },
      { guidance: '字'.repeat(1001) },
      { guidance: '\u0000' },
      { guidance: '\ud800' },
      { periodMonth: '0000-01' },
      { campusId: campusIds[1] },
    ])
      expect((await save(body(patch), teacherIds[1])).status).toBe(400);
    const missing = body() as Record<string, unknown>;
    delete missing.overallRating;
    expect(
      (await save(missing as ReturnType<typeof body>, teacherIds[1])).status,
    ).toBe(400);
    expect(
      (await save(body({ guidance: '😀'.repeat(1000) }), teacherIds[1])).status,
    ).toBe(200);
  });
  it('rolls back the current value and revision when audit creation fails', async () => {
    const before = (await read()).body.data.evaluation;
    const original = prisma.$transaction.bind(prisma);
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation(((
      action: unknown,
      options: unknown,
    ) =>
      original(async (tx) => {
        const audit = tx.auditLog.create.bind(tx.auditLog);
        tx.auditLog.create = ((args: { data: { action: string } }) => {
          if (args.data.action === 'PARTNER_TEACHER_EVALUATION_SAVED')
            throw Error('Synthetic audit failure');
          return audit(args as never);
        }) as typeof tx.auditLog.create;
        return (action as (client: typeof tx) => Promise<unknown>)(tx);
      }, options as never)) as typeof prisma.$transaction);
    try {
      expect(
        (await save(body({ expectedVersion: 3, guidance: '必须回滚' }))).status,
      ).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect((await read()).body.data.evaluation).toEqual(before);
    expect((await history()).body.meta.total).toBe(3);
    const audits = await prisma.auditLog.findMany({
      where: {
        actorUserId: userIds[0],
        action: 'PARTNER_TEACHER_EVALUATION_SAVED',
        resourceId: before.id,
      },
    });
    expect(audits).toHaveLength(3);
    expect(JSON.stringify(audits.map((a) => a.details))).not.toContain('并发');
  });
  it('rechecks a lost campus scope after the read snapshot and before returning any private content', async () => {
    const original = prisma.$transaction.bind(prisma);
    let changed = false;
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation((async (
      action: unknown,
      options: { isolationLevel?: string },
    ) => {
      const result = await original(action as never, options as never);
      if (!changed && options?.isolationLevel === 'RepeatableRead') {
        changed = true;
        await prisma.userRole.updateMany({
          where: { userId: userIds[0], roleCode: 'PARTNER' },
          data: { campusId: campusIds[1] },
        });
      }
      return result;
    }) as typeof prisma.$transaction);
    try {
      await expect(
        app.get(PartnerTeacherPerformanceService).performance(
          {
            userId: userIds[0],
            roles: [{ code: 'PARTNER', campusId: campusIds[0] }],
          },
          teacherIds[0],
          Object.assign(new PartnerTeacherPerformanceQueryDto(), {
            month: '2026-09',
          }),
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(changed).toBe(true);
    } finally {
      spy.mockRestore();
      await prisma.userRole.updateMany({
        where: { userId: userIds[0], roleCode: 'PARTNER' },
        data: { campusId: campusIds[0] },
      });
    }
  });
  it('rechecks teacher availability after reading and rolls back immutable revision changes', async () => {
    const original = prisma.$transaction.bind(prisma);
    let changed = false;
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation((async (
      action: unknown,
      options: { isolationLevel?: string },
    ) => {
      const result = await original(action as never, options as never);
      if (!changed && options?.isolationLevel === 'RepeatableRead') {
        changed = true;
        await prisma.teacherProfile.update({
          where: { id: teacherIds[0] },
          data: { isActive: false },
        });
      }
      return result;
    }) as typeof prisma.$transaction);
    try {
      await expect(
        app.get(PartnerTeacherPerformanceService).history(
          {
            userId: userIds[0],
            roles: [{ code: 'PARTNER', campusId: campusIds[0] }],
          },
          teacherIds[0],
          Object.assign(new PartnerTeacherPerformanceQueryDto(), {
            month: '2026-09',
          }),
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
    } finally {
      spy.mockRestore();
      await prisma.teacherProfile.update({
        where: { id: teacherIds[0] },
        data: { isActive: true },
      });
    }
    const revision =
      await prisma.partnerTeacherEvaluationRevision.findFirstOrThrow({
        where: {
          evaluation: { teacherId: teacherIds[0], periodMonth: '2026-09' },
        },
      });
    await expect(
      prisma.$transaction((tx) =>
        tx.partnerTeacherEvaluationRevision.update({
          where: { id: revision.id },
          data: { guidance: '禁止覆盖的旧版本' },
        }),
      ),
    ).rejects.toThrow('immutable');
    expect(
      (
        await prisma.partnerTeacherEvaluationRevision.findUniqueOrThrow({
          where: { id: revision.id },
        })
      ).guidance,
    ).toBe(revision.guidance);
  });
  it('allows only one original author when two partners concurrently create the same monthly evaluation', async () => {
    const results = await Promise.all([
      save(body({ periodMonth: '2026-07' })),
      save(body({ periodMonth: '2026-07' }), teacherIds[0], colleague),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    expect(
      await prisma.partnerTeacherEvaluationRevision.count({
        where: {
          evaluation: { teacherId: teacherIds[0], periodMonth: '2026-07' },
        },
      }),
    ).toBe(1);
  });
  it.each(['actor', 'teacher'] as const)(
    'rechecks %s access after a real row-lock wait before writing',
    async (kind) => {
      let release!: () => void, locked!: (pid: number) => void;
      const gate = new Promise<void>((yes) => {
        release = yes;
      });
      const ready = new Promise<number>((yes) => {
        locked = yes;
      });
      const holder = prisma.$transaction(
        async (tx) => {
          if (kind === 'actor')
            await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userIds[0]}::uuid FOR UPDATE`;
          else
            await tx.$queryRaw`SELECT "id" FROM "TeacherProfile" WHERE "id" = ${teacherIds[0]}::uuid FOR UPDATE`;
          const [process] = await tx.$queryRaw<
            Array<{ pid: number }>
          >`SELECT pg_backend_pid() AS pid`;
          locked(process.pid);
          await gate;
          if (kind === 'actor')
            await tx.user.update({
              where: { id: userIds[0] },
              data: { status: 'DISABLED' },
            });
          else
            await tx.teacherProfile.update({
              where: { id: teacherIds[0] },
              data: { isActive: false },
            });
        },
        { timeout: 15000 },
      );
      const holderPid = await ready;
      const pending = app
        .get(PartnerTeacherPerformanceService)
        .save(
          {
            userId: userIds[0],
            roles: [{ code: 'PARTNER', campusId: campusIds[0] }],
          },
          teacherIds[0],
          body({ periodMonth: '2026-06' }),
        )
        .then(
          () => null,
          (error: unknown) => error,
        );
      try {
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
          const sessions = await prisma.$queryRaw<
            Array<{ blockers: number[] }>
          >`
            SELECT pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'`;
          waiting = sessions.some((row) => row.blockers.includes(holderPid));
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        release();
        await holder;
        expect(await pending).toMatchObject({
          statusCode: kind === 'actor' ? 401 : 404,
        });
        expect(
          await prisma.partnerTeacherEvaluation.count({
            where: { teacherId: teacherIds[0], periodMonth: '2026-06' },
          }),
        ).toBe(0);
      } finally {
        release();
        await holder;
        await pending;
        if (kind === 'actor')
          await prisma.user.update({
            where: { id: userIds[0] },
            data: { status: 'ACTIVE' },
          });
        else
          await prisma.teacherProfile.update({
            where: { id: teacherIds[0] },
            data: { isActive: true },
          });
      }
    },
  );
  it('runs the actual frontend component and client through TCP into durable evaluation and revision rows', async () => {
    const frontend = jest.requireActual<
      typeof import('../../frontend/pages/partner/runtime/partner-teacher-performance.service')
    >(
      '../../frontend/pages/partner/runtime/partner-teacher-performance.service',
    );
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const client = new frontend.PartnerTeacherPerformanceClient({
      dataDriver: 'api',
      apiBaseUrl: origin,
      accessToken: () => token,
      request: (options) => {
        const url = new URL(options.url);
        if (
          url.origin !== origin ||
          !url.pathname.startsWith(`/partners/me/teachers/${teacherIds[0]}/`) ||
          !['GET', 'PUT'].includes(options.method)
        )
          throw Error('Transport outside owned local teacher');
        const outgoing = httpRequest(
          url,
          { method: options.method, headers: options.header },
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
              options.fail('Synthetic local response failure'),
            );
          },
        );
        outgoing.setTimeout(10000, () => outgoing.destroy());
        outgoing.on('error', () =>
          options.fail('Synthetic local request failure'),
        );
        outgoing.end(options.data ? JSON.stringify(options.data) : undefined);
      },
    });
    const factory = jest
      .spyOn(frontend, 'createPartnerTeacherPerformanceClient')
      .mockReturnValue(client);
    const globals = globalThis as unknown as Record<string, unknown>;
    const previous = globals.Component;
    let definition: any, component: any;
    globals.Component = (config: any) => {
      definition = config;
      component = {
        ...config.methods,
        data: {
          ...structuredClone(config.data),
          teacherId: teacherIds[0],
          blocked: false,
          month: '2026-08',
        },
        triggerEvent: jest.fn(),
        setData(patch: object) {
          Object.assign(this.data, patch);
        },
      };
    };
    try {
      jest.requireActual(
        '../../frontend/pages/partner/components/teacher-performance/index.ts',
      );
      definition.lifetimes.attached.call(component);
      await component.load();
      expect(component.data.state).toBe('ready');
      for (const [field, score] of Object.entries({
        teachingRating: 9,
        communicationRating: 7,
        attendanceRating: 8,
        overallRating: 3,
      }))
        component.onRate({ currentTarget: { dataset: { field, score } } });
      component.onGuidanceInput({ detail: { value: '跨层合成指导' } });
      await component.onSave();
      expect(component.data).toMatchObject({
        dirty: false,
        message: '评价已保存',
      });
      await component.onHistoryToggle();
      expect(component.data.historyRows[0]).toMatchObject({
        version: 1,
        overallLabel: '1.5 星',
        guidance: '跨层合成指导',
      });
      const persisted = await prisma.partnerTeacherEvaluation.findUniqueOrThrow(
        {
          where: {
            teacherId_periodMonth: {
              teacherId: teacherIds[0],
              periodMonth: '2026-08',
            },
          },
        },
      );
      expect(persisted).toMatchObject({
        version: 1,
        overallRating: 3,
        guidance: '跨层合成指导',
      });
      definition.pageLifetimes.hide.call(component);
      expect(component.data.guidance).toBe('');
      definition.pageLifetimes.show.call(component);
      await component.load();
      expect(component.data.guidance).toBe('跨层合成指导');
    } finally {
      definition?.lifetimes.detached.call(component);
      factory.mockRestore();
      if (previous === undefined) delete globals.Component;
      else globals.Component = previous;
    }
  });
});
