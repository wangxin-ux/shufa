import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { RoleCode } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { ROLE_PERMISSION_MATRIX } from '../src/modules/iam/role-permission.matrix';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';
const target = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
) {
  throw new Error(
    'Headquarters integration tests require a local *_test database',
  );
}
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  PORT: '3001',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  FILE_STORAGE_DRIVER: 'local',
  FILE_STORAGE_ROOT: './storage/test',
  AUTH_DRIVER: 'mock',
  PAYMENT_DRIVER: 'mock',
  PAYOUT_DRIVER: 'manual',
  MESSAGE_DRIVER: 'mock',
});

function responseData<T>(response: { body: unknown }): T {
  return (response.body as { data: T }).data;
}

describe('headquarters staff real database and HTTP boundary', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let auth: AuthService;
  let campusId: string;
  let superToken: string;
  const users: string[] = [];
  const runId = randomUUID();
  const phone = () =>
    `139${BigInt(`0x${randomUUID().replace(/-/g, '').slice(0, 12)}`)
      .toString()
      .slice(-8)
      .padStart(8, '0')}`;

  beforeAll(async () => {
    const { AppModule } =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      );
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
    const campus = await prisma.campus.create({
      data: { code: `HQ-TEST-${runId}`, name: '总部账号隔离测试校区' },
    });
    campusId = campus.id;
    superToken = await createActor('SUPER_ADMIN', null);
  }, 60_000);

  afterAll(async () => {
    // Keep test audit/history; never reset the shared demonstration database.
    if (prisma && users.length) {
      await prisma.user.updateMany({
        where: { id: { in: users } },
        data: { status: 'DISABLED' },
      });
    }
    await app?.close();
  });

  async function createActor(roleCode: RoleCode, actorCampusId: string | null) {
    const user = await prisma.user.create({
      data: {
        displayName: `权限验证-${roleCode}`,
        roles: { create: { roleCode, campusId: actorCampusId } },
      },
    });
    users.push(user.id);
    return (await auth.issueSessionForUser(user.id)).accessToken;
  }

  it.each(['HR', 'FINANCE'] as const)(
    'creates, replays, lists, authenticates and disables %s',
    async (roleCode) => {
      const body = {
        displayName: `总部测试-${roleCode}-${runId}`,
        phone: phone(),
        roleCode,
        campusId: null,
      };
      const key = randomUUID();
      const created = await request(server)
        .post('/management/staff-accounts')
        .auth(superToken, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);
      const account = responseData<{
        id: string;
        version: number;
        campusId: string | null;
      }>(created);
      users.push(account.id);
      expect(account).toMatchObject({
        roleCode,
        campusId: null,
        campusName: '总部',
        bindingStatus: 'UNBOUND',
      });
      const replay = await request(server)
        .post('/management/staff-accounts')
        .auth(superToken, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);
      expect(responseData<{ id: string }>(replay).id).toBe(account.id);
      expect(
        await prisma.teacherProfile.count({ where: { userId: account.id } }),
      ).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: { resourceId: account.id, action: 'STAFF_ACCOUNT_CREATE' },
        }),
      ).toBe(1);
      const token = (await auth.issueSessionForUser(account.id)).accessToken;
      const me = await request(server)
        .get('/me')
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(
        responseData<{
          roles: Array<{ code: string; campusId: string | null }>;
        }>(me).roles,
      ).toEqual([{ code: roleCode, campusId: null }]);
      await request(server)
        .get('/management/staff-accounts')
        .auth(token, { type: 'bearer' })
        .expect(403);
      const listed = await request(server)
        .get('/management/staff-accounts')
        .auth(superToken, { type: 'bearer' })
        .query({ roleCode, query: body.displayName })
        .expect(200);
      const accounts =
        responseData<Array<{ id: string; campusId: string | null }>>(listed);
      expect(accounts).toHaveLength(1);
      expect(accounts[0]?.campusId).toBeNull();
      expect(JSON.stringify(listed.body)).not.toContain(body.phone);
      await request(server)
        .patch(`/management/staff-accounts/${account.id}/status`)
        .auth(superToken, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({ status: 'DISABLED', expectedVersion: 1 })
        .expect(200);
      await request(server)
        .get('/me')
        .auth(token, { type: 'bearer' })
        .expect(401);
    },
  );

  it.each([
    'HR',
    'FINANCE',
    'CAMPUS_MANAGER',
    'PARTNER',
    'TEACHER',
    'PARENT',
  ] as const)('%s cannot create headquarters accounts', async (roleCode) => {
    const token = await createActor(
      roleCode,
      ['HR', 'FINANCE'].includes(roleCode) ? null : campusId,
    );
    await request(server)
      .post('/management/staff-accounts')
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({
        displayName: '不应创建',
        phone: phone(),
        roleCode: 'HR',
        campusId: null,
      })
      .expect(403);
  });

  it('rejects mismatched campus scopes and direct teacher creation before persistence', async () => {
    for (const scope of [
      { roleCode: 'HR', campusId },
      { roleCode: 'FINANCE', campusId },
      { roleCode: 'PARTNER', campusId: null },
      { roleCode: 'CAMPUS_MANAGER', campusId: null },
      { roleCode: 'TEACHER', campusId },
    ]) {
      const staffPhone = phone();
      await request(server)
        .post('/management/staff-accounts')
        .auth(superToken, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({ displayName: '校验范围', phone: staffPhone, ...scope })
        .expect(400);
      expect(
        await prisma.user.count({ where: { staffPhone: `+86${staffPhone}` } }),
      ).toBe(0);
    }
  });

  it('prevents concurrent duplicate phone creation and rolls back the failed claim', async () => {
    const body = {
      displayName: '并发建号测试',
      phone: phone(),
      roleCode: 'FINANCE',
      campusId: null,
    };
    const keys = [randomUUID(), randomUUID()];
    const results = await Promise.all(
      keys.map((key) =>
        request(server)
          .post('/management/staff-accounts')
          .auth(superToken, { type: 'bearer' })
          .set('Idempotency-Key', key)
          .send(body),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const created = results.find((result) => result.status === 201)!;
    users.push(responseData<{ id: string }>(created).id);
    expect(
      await prisma.user.count({ where: { staffPhone: `+86${body.phone}` } }),
    ).toBe(1);
    expect(
      await prisma.idempotencyRecord.count({
        where: { key: { in: keys }, route: '/management/staff-accounts' },
      }),
    ).toBe(1);
  });

  it('does not grant headquarters staff existing management or teaching powers', () => {
    expect(ROLE_PERMISSION_MATRIX.HR).toEqual([
      'HR_TEACHER_READ',
      'HR_TEACHER_RECORD_WRITE',
      'HR_REPORT_READ',
      'HR_REPORT_EXPORT',
    ]);
    expect(ROLE_PERMISSION_MATRIX.FINANCE).toEqual([
      'FINANCE_CORRECTION_READ',
      'FINANCE_CORRECTION_WRITE',
      'FINANCE_CORRECTION_APPLY',
      'FINANCE_REPORT_READ',
      'FINANCE_REPORT_EXPORT',
      'FINANCE_REFUND_READ',
      'FINANCE_REFUND_WRITE',
      'FINANCE_REFUND_PAY',
      'FINANCE_RECEIPT_READ',
      'FINANCE_RECEIPT_EXPORT',
      'FINANCE_RECEIPT_WRITE',
      'FINANCE_PACKAGE_ISSUE',
      'FINANCE_OVERSIGHT_READ',
      'FINANCE_OVERSIGHT_EXPORT',
    ]);
  });
});
