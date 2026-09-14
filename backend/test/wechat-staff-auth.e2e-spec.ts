import * as fs from 'node:fs';
import * as path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { load as loadYaml } from 'js-yaml';
import type { Server } from 'node:http';
import request from 'supertest';
import { seedTeacherCore } from '../prisma/seed';
import { configureApplication } from '../src/common/bootstrap/configure-app';

interface OpenApiDocument {
  paths: Record<string, Record<string, unknown>>;
}

const document = loadYaml(
  fs.readFileSync(
    path.resolve(__dirname, '../../contracts/openapi.yaml'),
    'utf8',
  ),
) as OpenApiDocument;

describe('WeChat staff authentication contract', () => {
  it.each([
    ['/auth/wechat/login', 'post'],
    ['/auth/wechat/staff/bind-phone', 'post'],
  ] as const)('declares %s %s', (route, method) => {
    expect(document.paths[route]?.[method]).toBeDefined();
  });

  it('does not accept a caller-supplied phone number', () => {
    const serialized = JSON.stringify(
      document.paths['/auth/wechat/staff/bind-phone'],
    );
    expect(serialized).toContain('phoneCode');
    expect(serialized).not.toContain('phoneNumber');
  });
});

jest.setTimeout(30_000);

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';
const TEST_ENV = {
  NODE_ENV: 'test',
  PORT: '3001',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  FILE_STORAGE_DRIVER: 'local',
  FILE_STORAGE_ROOT: './storage/test',
  AUTH_DRIVER: 'mock',
  PAYMENT_DRIVER: 'mock',
  PAYOUT_DRIVER: 'manual',
  MESSAGE_DRIVER: 'mock',
  TZ: 'Asia/Shanghai',
};

describe('WeChat staff authentication HTTP workflow', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;
  let campusId: string;
  const createdUserIds: string[] = [];
  let phoneSequence = 0;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await seedTeacherCore(prisma);
    campusId = (await prisma.campus.findFirstOrThrow({ select: { id: true } })).id;
    const { AppModule } =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { resourceId: { in: createdUserIds } } });
      await prisma.idempotencyRecord.deleteMany({
        where: { route: '/auth/wechat/staff/bind-phone' },
      });
      await prisma.authIdentity.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  it('requires phone authorization, binds once, and then logs in silently', async () => {
    const phone = nextPhone();
    const userId = await createStaff(phone);
    const openId = `openid-success-${Date.now()}`;
    const loginCode = `mock-wechat-login:${openId}`;

    await request(server)
      .post('/auth/wechat/login')
      .send({ code: loginCode })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('STAFF_PHONE_BINDING_REQUIRED');
      });

    const key = `wechat-bind-success-${Date.now()}`;
    const bind = () =>
      request(server)
        .post('/auth/wechat/staff/bind-phone')
        .set('Idempotency-Key', key)
        .send({ code: loginCode, phoneCode: `mock-wechat-phone:${phone}` });
    const first = await bind().expect(200);
    const replay = await bind().expect(200);
    expect(first.body.data.me).toMatchObject({
      userId,
      roles: [{ code: 'PARTNER', campusId }],
    });
    expect(replay.body.data.me).toEqual(first.body.data.me);
    await request(server)
      .post('/auth/wechat/login')
      .send({ code: loginCode })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.me.userId).toBe(userId);
      });
    await expect(
      prisma.authIdentity.count({ where: { userId, provider: 'WECHAT' } }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: { action: 'STAFF_ACCOUNT_WECHAT_BIND', resourceId: userId },
      }),
    ).resolves.toBe(1);
  });

  it('rejects an unknown phone and a disabled account with stable errors', async () => {
    const unknownPhone = nextPhone();
    await request(server)
      .post('/auth/wechat/staff/bind-phone')
      .set('Idempotency-Key', `wechat-bind-unknown-${Date.now()}`)
      .send({
        code: `mock-wechat-login:unknown-${Date.now()}`,
        phoneCode: `mock-wechat-phone:${unknownPhone}`,
      })
      .expect(404)
      .expect((response) => {
        expect(response.body.code).toBe('STAFF_ACCOUNT_UNAVAILABLE');
        expect(JSON.stringify(response.body)).not.toContain(unknownPhone);
      });

    const disabledPhone = nextPhone();
    await createStaff(disabledPhone, 'DISABLED');
    await request(server)
      .post('/auth/wechat/staff/bind-phone')
      .set('Idempotency-Key', `wechat-bind-disabled-${Date.now()}`)
      .send({
        code: `mock-wechat-login:disabled-${Date.now()}`,
        phoneCode: `mock-wechat-phone:${disabledPhone}`,
      })
      .expect(404)
      .expect((response) => {
        expect(response.body.code).toBe('STAFF_ACCOUNT_UNAVAILABLE');
      });
  });

  it('refuses to overwrite either side of an existing WeChat binding', async () => {
    const firstPhone = nextPhone();
    const secondPhone = nextPhone();
    await createStaff(firstPhone);
    await createStaff(secondPhone);
    const firstOpenId = `openid-first-${Date.now()}`;
    await bind(firstPhone, firstOpenId, `wechat-bind-first-${Date.now()}`).expect(200);

    await bind(secondPhone, firstOpenId, `wechat-bind-openid-conflict-${Date.now()}`)
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('WECHAT_IDENTITY_CONFLICT');
      });
    await bind(firstPhone, `openid-other-${Date.now()}`, `wechat-bind-user-conflict-${Date.now()}`)
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('WECHAT_IDENTITY_CONFLICT');
      });
  });

  it('allows only one of two concurrent WeChat identities to bind one phone', async () => {
    const phone = nextPhone();
    const userId = await createStaff(phone);
    const responses = await Promise.all([
      bind(phone, `openid-concurrent-a-${Date.now()}`, `wechat-bind-a-${Date.now()}`),
      bind(phone, `openid-concurrent-b-${Date.now()}`, `wechat-bind-b-${Date.now()}`),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    await expect(
      prisma.authIdentity.count({ where: { userId, provider: 'WECHAT' } }),
    ).resolves.toBe(1);
  });

  async function createStaff(
    phone: string,
    status: 'ACTIVE' | 'DISABLED' = 'ACTIVE',
  ): Promise<string> {
    const account = await prisma.user.create({
      data: {
        displayName: '微信登录测试账号',
        staffPhone: `+86${phone}`,
        status,
        roles: { create: { roleCode: 'PARTNER', campusId } },
      },
      select: { id: true },
    });
    createdUserIds.push(account.id);
    return account.id;
  }

  function bind(phone: string, openId: string, key: string) {
    return request(server)
      .post('/auth/wechat/staff/bind-phone')
      .set('Idempotency-Key', key)
      .send({
        code: `mock-wechat-login:${openId}`,
        phoneCode: `mock-wechat-phone:${phone}`,
      });
  }

  function nextPhone(): string {
    phoneSequence += 1;
    const suffix = `${Date.now().toString().slice(-7)}${phoneSequence % 10}`;
    return `136${suffix}`;
  }
});
