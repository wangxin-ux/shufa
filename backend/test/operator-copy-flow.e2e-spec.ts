import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { load as loadYaml } from 'js-yaml';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { RoleCode } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { assertCampusArchiveTestTarget } from './support/campus-archive-test-database';

assertCampusArchiveTestTarget(process.env);
jest.setTimeout(60_000);

function data<T = Record<string, unknown>>(response: { body: unknown }): T {
  return (response.body as { data: T }).data;
}

type Validate = ((value: unknown) => boolean) & { errors: unknown };
interface Validator {
  addSchema(schema: unknown, id: string): void;
  getSchema(ref: string): Validate | undefined;
}
const buildDependencies = createRequire(
  createRequire(require.resolve('@nestjs/cli/package.json')).resolve(
    '@angular-devkit/core',
  ),
);
const { default: Ajv2020 } = buildDependencies('ajv/dist/2020') as {
  default: new (options: { strict: boolean; allErrors: boolean }) => Validator;
};
const addFormats = buildDependencies('ajv-formats') as (
  validator: Validator,
) => void;
const validator = new Ajv2020({ strict: false, allErrors: true });
addFormats(validator);
const contractBase = 'https://education.invalid/contracts/';
for (const name of [
  'openapi.yaml',
  'operator.openapi.yaml',
  'operator-student-archive.openapi.yaml',
]) {
  validator.addSchema(
    loadYaml(readFileSync(resolve(__dirname, '../../contracts', name), 'utf8')),
    contractBase + name,
  );
}
function expectSchema(value: unknown, schema: string) {
  const validate = validator.getSchema(
    `${contractBase}operator.openapi.yaml#/components/schemas/${schema}`,
  );
  if (!validate) throw new Error(`Missing schema: ${schema}`);
  expect({ valid: validate(value), errors: validate.errors }).toEqual({
    valid: true,
    errors: null,
  });
}

describe('independent operator copy with real roles and database', () => {
  const tag = `opcopy-${randomUUID().slice(0, 8)}`;
  const users: string[] = [];
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let campusId: string;
  let otherCampusId: string;
  let classId: string;
  let studentId: string;
  let lessonId: string;
  let leaveId: string;
  let token: string;
  let managerToken: string;
  let totalToken: string;
  let mixedToken: string;
  let otherToken: string;
  let parentToken: string;
  let teacherToken: string;
  let adminToken: string;
  const get = (url: string, bearer = token) =>
    request(server).get(url).auth(bearer, { type: 'bearer' });
  const post = (url: string, body: object, key: string, bearer = token) =>
    request(server)
      .post(url)
      .auth(bearer, { type: 'bearer' })
      .set('Idempotency-Key', `${tag}-${key}`)
      .send(body);
  const patch = (url: string, body: object, key: string) =>
    request(server)
      .patch(url)
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', `${tag}-${key}`)
      .send(body);
  const snapshot = async () =>
    JSON.stringify({
      units: await prisma.coursePackage.findMany({
        where: { campusId },
        orderBy: { id: 'asc' },
      }),
      ledger: await prisma.lessonLedgerEntry.findMany({
        where: { campusId },
        orderBy: { id: 'asc' },
      }),
      attendance: await prisma.attendanceRecord.findMany({
        where: { campusId },
        orderBy: { id: 'asc' },
      }),
    });

  async function account(roleCode: RoleCode, scope: string | null) {
    const row = await prisma.user.create({
      data: {
        displayName: `${tag}-${roleCode}`,
        roles: { create: { roleCode, campusId: scope } },
      },
    });
    users.push(row.id);
    const session = await app.get(AuthService).issueSessionForUser(row.id);
    return { userId: row.id, token: session.accessToken };
  }

  beforeAll(async () => {
    const { AppModule } =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      );
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    campusId = (
      await prisma.campus.create({ data: { code: `${tag}-a`, name: tag } })
    ).id;
    otherCampusId = (
      await prisma.campus.create({
        data: { code: `${tag}-b`, name: `${tag}-other` },
      })
    ).id;
    const operator = await account('OPERATOR', campusId);
    token = operator.token;
    managerToken = (await account('CAMPUS_MANAGER', campusId)).token;
    totalToken = (await account('OPERATOR', null)).token;
    otherToken = (await account('OPERATOR', otherCampusId)).token;
    const mixed = await account('OPERATOR', campusId);
    await prisma.userRole.create({
      data: {
        userId: mixed.userId,
        roleCode: 'CAMPUS_MANAGER',
        campusId,
      },
    });
    mixedToken = mixed.token;
    const parent = await account('PARENT', campusId);
    parentToken = parent.token;
    const teacher = await account('TEACHER', campusId);
    teacherToken = teacher.token;
    const teacherProfile = await prisma.teacherProfile.create({
      data: { userId: teacher.userId, campusId, employeeCode: tag },
    });
    classId = (
      await prisma.classGroup.create({
        data: {
          campusId,
          teacherId: teacherProfile.id,
          name: tag,
          courseName: '合成美术',
        },
      })
    ).id;
    studentId = (
      await prisma.student.create({
        data: { campusId, displayName: tag, birthDate: new Date('2020-01-01') },
      })
    ).id;
    await prisma.classMember.create({
      data: { campusId, studentId, classGroupId: classId },
    });
    await prisma.parentStudentBinding.create({
      data: { campusId, studentId, parentUserId: parent.userId },
    });
    await prisma.coursePackage.create({
      data: {
        campusId,
        studentId,
        name: tag,
        validFrom: new Date('2020-01-01'),
        mainBalanceUnits: 500,
      },
    });
    lessonId = (
      await prisma.lessonSession.create({
        data: {
          campusId,
          classGroupId: classId,
          teacherId: teacherProfile.id,
          startsAt: new Date('2040-01-01T06:00:00Z'),
          endsAt: new Date('2040-01-01T07:00:00Z'),
          lessonUnits: 100,
          kind: 'REGULAR',
        },
      })
    ).id;
    leaveId = (
      await prisma.parentLeaveRequest.create({
        data: {
          campusId,
          parentUserId: parent.userId,
          studentId,
          lessonSessionId: lessonId,
          reason: tag,
        },
      })
    ).id;
    adminToken = (await account('SUPER_ADMIN', null)).token;
    await prisma.authIdentity.create({
      data: {
        userId: operator.userId,
        provider: 'MOCK',
        subject: `${tag}-login`,
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.updateMany({
        where: { id: { in: users } },
        data: { status: 'DISABLED' },
      });
      const active = await prisma.user.count({
        where: { id: { in: users }, status: 'ACTIVE' },
      });
      console.log(
        `OPERATOR_COPY_POSTFLIGHT ${JSON.stringify({ tag, accounts: users.length, active, retained: true })}`,
      );
    }
    await app?.close();
  });

  it('logs in as OPERATOR, preserves the manager route, and rejects cross-role access', async () => {
    const login = await request(server)
      .post('/auth/login')
      .send({ code: `${tag}-login` })
      .expect(200);
    expect(data<{ me: { roles: unknown } }>(login).me.roles).toEqual([
      { code: 'OPERATOR', campusId },
    ]);
    expect(data(await get('/operators/me/profile').expect(200))).toMatchObject({
      roleCode: 'OPERATOR',
      campusId,
    });
    expect(
      data(await get('/campus-managers/me/profile', managerToken).expect(200)),
    ).toMatchObject({ roleCode: 'CAMPUS_MANAGER', campusId });
    await get('/campus-managers/me/profile').expect(403);
    await get('/operators/me/profile', managerToken).expect(403);
  });

  it('blocks total, mixed and unrelated roles on every copied read entry', async () => {
    for (const url of [
      '/operators/me/dashboard',
      '/operators/me/profile',
      '/operators/me/students',
      `/operators/me/students/${studentId}`,
      `/operators/me/students/${studentId}/archive`,
      `/operators/me/students/${studentId}/archive/growth`,
      '/operators/me/scheduling-options',
      '/operators/me/lesson-sessions',
      '/operators/me/leave-requests',
      '/operators/me/warnings',
      '/operators/me/campus',
      '/operators/me/rosters/teachers',
      '/operators/me/rosters/teachers/template',
      '/operators/me/rosters/customers/template',
    ]) {
      for (const denied of [totalToken, mixedToken, parentToken])
        await get(url, denied).expect(403);
    }
    await get(`/operators/me/students/${studentId}`, otherToken).expect(404);
  });

  it('returns age instead of birth date in list and detail, with complete schema validation', async () => {
    const list = await get('/operators/me/students').expect(200);
    const detail = await get(`/operators/me/students/${studentId}`).expect(200);
    expectSchema(list.body, 'OperatorStudentsPageEnvelope');
    expectSchema(detail.body, 'OperatorStudentDetailEnvelope');
    for (const response of [list, detail]) {
      expect(JSON.stringify(response.body)).not.toMatch(
        /birthDate|homeAddress|profileAge/,
      );
    }
    expect(data(detail).id).toBe(studentId);
    expect(typeof data(detail).ageYears).toBe('number');
  });

  it('approves once, updates both clients, and leaves units and attendance unchanged', async () => {
    const before = await snapshot();
    expect(
      data(await get('/operators/me/dashboard').expect(200)).pendingLeaveCount,
    ).toBe(1);
    const url = `/operators/me/leave-requests/${leaveId}/approve`;
    await post(url, { version: 1 }, 'approve', totalToken).expect(403);
    await post(url, { version: 1 }, 'approve', otherToken).expect(404);
    const result = await post(url, { version: 1 }, 'approve').expect(200);
    expect(data(result)).toMatchObject({ status: 'APPROVED', version: 2 });
    expect(
      data(await post(url, { version: 1 }, 'approve').expect(200)),
    ).toEqual(data(result));
    await post(url, { version: 1 }, 'stale').expect(409);
    expect(
      data(await get('/operators/me/dashboard').expect(200)).pendingLeaveCount,
    ).toBe(0);
    expect(
      data(
        await get(
          `/teachers/me/lesson-sessions/${lessonId}`,
          teacherToken,
        ).expect(200),
      ).students,
    ).toContainEqual(
      expect.objectContaining({ id: studentId, attendanceStatus: 'LEAVE' }),
    );
    const parent = await get(
      `/parents/me/leave?studentId=${studentId}`,
      parentToken,
    ).expect(200);
    expect(data(parent).records).toContainEqual(
      expect.objectContaining({ id: leaveId, status: 'APPROVED' }),
    );
    expect(
      await prisma.auditLog.count({
        where: {
          campusId,
          resourceId: leaveId,
          action: 'OPERATOR_LEAVE_APPROVE',
        },
      }),
    ).toBe(1);
    expect(await snapshot()).toBe(before);
  });

  it('creates, updates and cancels a future lesson idempotently without granting total-account writes', async () => {
    const body = {
      classGroupId: classId,
      startsAt: '2040-01-02T06:00:00Z',
      endsAt: '2040-01-02T07:00:00Z',
      kind: 'REGULAR',
    };
    const url = '/operators/me/lesson-sessions';
    await post(url, body, 'schedule-total', totalToken).expect(403);
    await post(url, body, 'schedule-other', otherToken).expect(404);
    const created = await post(url, body, 'schedule').expect(200);
    const id = data(created).id as string;
    expect(data(await post(url, body, 'schedule').expect(200)).id).toBe(id);
    const change = {
      startsAt: '2040-01-03T06:00:00Z',
      endsAt: '2040-01-03T07:00:00Z',
      kind: 'REGULAR',
      version: 1,
    };
    const updated = await patch(`${url}/${id}`, change, 'update').expect(200);
    expect(data(updated)).toMatchObject({ id, version: 2 });
    expect(
      data(await patch(`${url}/${id}`, change, 'update').expect(200)),
    ).toEqual(data(updated));
    await patch(`${url}/${id}`, change, 'update-stale').expect(409);
    const cancel = `/operators/me/lesson-sessions/${id}/cancel`;
    await post(cancel, { version: 2 }, 'cancel-total', totalToken).expect(403);
    expect(
      data(await post(cancel, { version: 2 }, 'cancel').expect(200)).status,
    ).toBe('CANCELLED');
    expect(
      data(await post(cancel, { version: 2 }, 'cancel').expect(200)).status,
    ).toBe('CANCELLED');
    await post(cancel, { version: 2 }, 'cancel-stale').expect(409);
  });

  it('rejects changing an already-started scheduled lesson without recording a partial write', async () => {
    const source = await prisma.lessonSession.findUniqueOrThrow({
      where: { id: lessonId },
    });
    const started = await prisma.lessonSession.create({
      data: {
        campusId,
        classGroupId: classId,
        teacherId: source.teacherId,
        startsAt: new Date('2020-01-01T06:00:00Z'),
        endsAt: new Date('2020-01-01T07:00:00Z'),
        kind: 'REGULAR',
        lessonUnits: 100,
      },
    });
    const before = await snapshot();
    const url = `/operators/me/lesson-sessions/${started.id}`;
    await patch(
      url,
      {
        startsAt: '2040-01-04T06:00:00Z',
        endsAt: '2040-01-04T07:00:00Z',
        kind: 'REGULAR',
        version: 1,
      },
      'started-update',
    ).expect(409);
    await post(`${url}/cancel`, { version: 1 }, 'started-cancel').expect(409);
    expect(
      await prisma.lessonSession.findUniqueOrThrow({
        where: { id: started.id },
      }),
    ).toEqual(started);
    expect(
      await prisma.auditLog.count({
        where: { campusId, resourceId: started.id },
      }),
    ).toBe(0);
    expect(await snapshot()).toBe(before);
  });

  it.each(['update', 'cancel'] as const)(
    'rechecks the start time after a real competing row lock for %s',
    async (operation) => {
      const source = await prisma.lessonSession.findUniqueOrThrow({
        where: { id: lessonId },
      });
      const startsAt = new Date(Date.now() + 3_000);
      const lesson = await prisma.lessonSession.create({
        data: {
          campusId,
          classGroupId: classId,
          teacherId: source.teacherId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3_600_000),
          kind: 'REGULAR',
          lessonUnits: 100,
        },
      });
      let release!: () => void;
      let locked!: () => void;
      let holderPid = 0;
      const gate = new Promise<void>((resolveGate) => {
        release = resolveGate;
      });
      const ready = new Promise<void>((resolveReady) => {
        locked = resolveReady;
      });
      const holder = prisma.$transaction(
        async (transaction) => {
          const [process] = await transaction.$queryRaw<Array<{ pid: number }>>`
            SELECT pg_backend_pid() AS pid
          `;
          holderPid = process.pid;
          await transaction.$queryRaw`
            SELECT "id" FROM "LessonSession"
            WHERE "id" = ${lesson.id}::uuid FOR UPDATE
          `;
          locked();
          await gate;
        },
        { timeout: 15_000 },
      );
      await ready;
      const url = `/operators/me/lesson-sessions/${lesson.id}`;
      const pending = (
        operation === 'update'
          ? patch(
              url,
              {
                startsAt: '2040-01-05T06:00:00Z',
                endsAt: '2040-01-05T07:00:00Z',
                kind: 'REGULAR',
                version: 1,
              },
              'lock-update',
            )
          : post(`${url}/cancel`, { version: 1 }, 'lock-cancel')
      ).then((response) => response);
      try {
        let blocked = false;
        while (Date.now() < startsAt.getTime()) {
          const [state] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
            SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity
              WHERE ${holderPid}::int = ANY(pg_blocking_pids(pid))
            ) AS blocked
          `;
          if (state.blocked) {
            blocked = true;
            break;
          }
          await delay(25);
        }
        expect(blocked).toBe(true);
        while (Date.now() <= startsAt.getTime()) await delay(25);
      } finally {
        release();
        await holder;
      }
      expect((await pending).status).toBe(409);
      expect(
        await prisma.lessonSession.findUniqueOrThrow({
          where: { id: lesson.id },
        }),
      ).toEqual(lesson);
      expect(
        await prisma.auditLog.count({
          where: { campusId, resourceId: lesson.id },
        }),
      ).toBe(0);
    },
  );

  it('creates a campus operator through staff management and refuses a null-campus ordinary account', async () => {
    const input = {
      displayName: `${tag}-staff`,
      phone: `139${randomInt(10_000_000, 100_000_000)}`,
      roleCode: 'OPERATOR',
      campusId,
    };
    await post(
      '/management/staff-accounts',
      { ...input, campusId: null },
      'staff-total',
      adminToken,
    ).expect(400);
    const created = await post(
      '/management/staff-accounts',
      input,
      'staff',
      adminToken,
    ).expect(201);
    const id = data(created).id as string;
    users.push(id);
    expect(data(created)).toMatchObject({ roleCode: 'OPERATOR', campusId });
    expect(
      data(
        await post(
          '/management/staff-accounts',
          input,
          'staff',
          adminToken,
        ).expect(201),
      ).id,
    ).toBe(id);
    await post('/management/staff-accounts', input, 'staff-denied').expect(403);
  });
});
