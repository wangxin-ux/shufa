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
import { ROLE_PERMISSION_MATRIX } from '../src/modules/iam/role-permission.matrix';

interface ParameterRef {
  name?: string;
  $ref?: string;
}

interface OpenApiOperation {
  parameters?: ParameterRef[];
  requestBody?: unknown;
  responses?: Record<string, unknown>;
}

interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { schemas: Record<string, unknown> };
}

const contractPath = path.resolve(__dirname, '../../contracts/openapi.yaml');
const document = loadYaml(
  fs.readFileSync(contractPath, 'utf8'),
) as OpenApiDocument;

function hasParameter(operation: OpenApiOperation, name: string): boolean {
  return (operation.parameters ?? []).some(
    (parameter) =>
      parameter.name === name || parameter.$ref?.endsWith(`/${name}`),
  );
}

describe('staff account management contract', () => {
  it.each([
    ['/management/staff-accounts', 'get'],
    ['/management/staff-accounts', 'post'],
    ['/management/staff-accounts/{staffAccountId}/status', 'patch'],
    ['/management/staff-accounts/{staffAccountId}/unbind-wechat', 'post'],
  ] as const)('declares %s %s', (route, method) => {
    expect(document.paths[route]?.[method]).toBeDefined();
  });

  it('keeps pagination on account reads and idempotency on writes', () => {
    expect(
      hasParameter(document.paths['/management/staff-accounts'].get, 'Page'),
    ).toBe(true);
    expect(
      hasParameter(
        document.paths['/management/staff-accounts'].get,
        'PageSize',
      ),
    ).toBe(true);
    for (const [route, method] of [
      ['/management/staff-accounts', 'post'],
      ['/management/staff-accounts/{staffAccountId}/status', 'patch'],
      ['/management/staff-accounts/{staffAccountId}/unbind-wechat', 'post'],
    ] as const) {
      expect(hasParameter(document.paths[route][method], 'IdempotencyKey')).toBe(
        true,
      );
    }
  });

  it('assigns account management only to the super administrator', () => {
    expect(ROLE_PERMISSION_MATRIX.SUPER_ADMIN).toContain(
      'STAFF_ACCOUNT_MANAGE',
    );
    for (const role of [
      'PARENT',
      'PARTNER',
      'TEACHER',
      'OPERATOR',
      'CAMPUS_MANAGER',
      'HR',
      'FINANCE',
    ] as const) {
      expect(ROLE_PERMISSION_MATRIX[role]).not.toContain(
        'STAFF_ACCOUNT_MANAGE',
      );
    }
  });

  it('publishes headquarters roles and keeps teachers outside direct creation', () => {
    const serialized = JSON.stringify(
      document.components.schemas.StaffAccountView,
    );
    expect(serialized).toContain('maskedPhone');
    expect(serialized).not.toContain('openId');
    expect(serialized).not.toContain('openid');
    expect(document.components.schemas.ManageableStaffRole).toEqual({
      type: 'string',
      enum: ['TEACHER', 'CAMPUS_MANAGER', 'PARTNER', 'HR', 'FINANCE'],
    });
    expect(document.components.schemas.DirectlyCreatableStaffRole).toEqual({
      type: 'string',
      enum: ['CAMPUS_MANAGER', 'PARTNER', 'HR', 'FINANCE'],
    });
    expect(
      (
        document.components.schemas.CreateStaffAccountRequest as {
          properties: { roleCode: unknown };
        }
      ).properties.roleCode,
    ).toEqual({
      $ref: '#/components/schemas/DirectlyCreatableStaffRole',
    });
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

describe('staff account management HTTP workflow', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;
  let superToken: string;
  let managerToken: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await seedTeacherCore(prisma);
    const { AppModule } =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Server;
    superToken = await login(server, 'mock-demo-super-admin');
    managerToken = await login(server, 'mock-demo-east-campus-manager');
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { resourceId: { in: createdUserIds } } });
      await prisma.idempotencyRecord.deleteMany({
        where: { route: { startsWith: '/management/staff-accounts' } },
      });
      await prisma.authIdentity.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.teacherProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  it('seeds one deterministic unbound account for every manageable role', async () => {
    await seedTeacherCore(prisma);
    await seedTeacherCore(prisma);
    const accounts = await prisma.user.findMany({
      where: {
        staffPhone: {
          in: ['+8613800001001', '+8613800001002', '+8613800001003'],
        },
      },
      select: {
        staffPhone: true,
        roles: { select: { roleCode: true, campusId: true } },
        authIdentities: {
          where: { provider: 'WECHAT' },
          select: { id: true },
        },
      },
      orderBy: { staffPhone: 'asc' },
    });

    expect(accounts).toEqual([
      expect.objectContaining({
        staffPhone: '+8613800001001',
        roles: [expect.objectContaining({ roleCode: 'TEACHER' })],
        authIdentities: [],
      }),
      expect.objectContaining({
        staffPhone: '+8613800001002',
        roles: [expect.objectContaining({ roleCode: 'CAMPUS_MANAGER' })],
        authIdentities: [],
      }),
      expect.objectContaining({
        staffPhone: '+8613800001003',
        roles: [expect.objectContaining({ roleCode: 'PARTNER' })],
        authIdentities: [],
      }),
    ]);
  });

  it('creates and idempotently replays a masked partner account only for a super admin', async () => {
    const campus = await prisma.campus.findFirstOrThrow({ select: { id: true } });
    const phone = `139${Date.now().toString().slice(-8)}`;
    const key = `staff-create-${Date.now()}`;
    const body = {
      displayName: '新建合作方账号',
      phone,
      roleCode: 'PARTNER',
      campusId: campus.id,
    };
    const submit = (token: string, requestKey = key) =>
      request(server)
        .post('/management/staff-accounts')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', requestKey)
        .send(body);

    const first = await submit(superToken).expect(201);
    const replay = await submit(superToken).expect(201);
    const userId = (first.body as { data: { id: string } }).data.id;
    createdUserIds.push(userId);
    expect(replay.body.data).toEqual(first.body.data);
    expect(first.body.data).toMatchObject({
      displayName: body.displayName,
      maskedPhone: `+86****${phone.slice(-4)}`,
      roleCode: 'PARTNER',
      campusId: campus.id,
      bindingStatus: 'UNBOUND',
      status: 'ACTIVE',
      version: 1,
    });
    expect(JSON.stringify(first.body)).not.toContain(`+86${phone}`);
    await expect(
      prisma.teacherProfile.count({ where: { userId } }),
    ).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({
        where: { action: 'STAFF_ACCOUNT_CREATE', resourceId: userId },
      }),
    ).resolves.toBe(1);
    await submit(superToken, `${key}-duplicate`).expect(409);
    await submit(managerToken, `${key}-manager`).expect(403);
  });

  it('rejects teacher creation on the direct staff account endpoint', async () => {
    const campus = await prisma.campus.findFirstOrThrow({ select: { id: true } });
    const phone = `136${Date.now().toString().slice(-8)}`;

    await request(server)
      .post('/management/staff-accounts')
      .set('Authorization', `Bearer ${superToken}`)
      .set('Idempotency-Key', `staff-create-teacher-rejected-${Date.now()}`)
      .send({
        displayName: '应从教师名册录入',
        phone,
        roleCode: 'TEACHER',
        campusId: campus.id,
      })
      .expect(400);

    await expect(
      prisma.user.count({ where: { staffPhone: `+86${phone}` } }),
    ).resolves.toBe(0);
  });

  it('disables an account, invalidates its token, and unbinds only WeChat', async () => {
    const campus = await prisma.campus.findFirstOrThrow({ select: { id: true } });
    const phone = `137${Date.now().toString().slice(-8)}`;
    const createResponse = await request(server)
      .post('/management/staff-accounts')
      .set('Authorization', `Bearer ${superToken}`)
      .set('Idempotency-Key', `staff-create-state-${Date.now()}`)
      .send({
        displayName: '状态测试管理员',
        phone,
        roleCode: 'CAMPUS_MANAGER',
        campusId: campus.id,
      })
      .expect(201);
    const userId = (createResponse.body as { data: { id: string } }).data.id;
    createdUserIds.push(userId);
    const mockCode = `mock-runtime-staff-${Date.now()}`;
    await prisma.authIdentity.createMany({
      data: [
        { userId, provider: 'MOCK', subject: mockCode },
        { userId, provider: 'WECHAT', subject: `wx-runtime-${Date.now()}` },
      ],
    });
    const staffToken = await login(server, mockCode);

    const disabled = await request(server)
      .patch(`/management/staff-accounts/${userId}/status`)
      .set('Authorization', `Bearer ${superToken}`)
      .set('Idempotency-Key', `staff-disable-${Date.now()}`)
      .send({ status: 'DISABLED', expectedVersion: 1 })
      .expect(200);
    expect(disabled.body.data).toMatchObject({ status: 'DISABLED', version: 2 });
    await request(server)
      .get('/me')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(401);

    const unbound = await request(server)
      .post(`/management/staff-accounts/${userId}/unbind-wechat`)
      .set('Authorization', `Bearer ${superToken}`)
      .set('Idempotency-Key', `staff-unbind-${Date.now()}`)
      .send({ expectedVersion: 2 })
      .expect(200);
    expect(unbound.body.data).toMatchObject({
      bindingStatus: 'UNBOUND',
      status: 'DISABLED',
      version: 3,
    });
    await expect(
      prisma.authIdentity.count({ where: { userId, provider: 'WECHAT' } }),
    ).resolves.toBe(0);
    await expect(
      prisma.authIdentity.count({ where: { userId, provider: 'MOCK' } }),
    ).resolves.toBe(1);
  });
});

async function login(server: Server, code: string): Promise<string> {
  const response = await request(server).post('/auth/login').send({ code }).expect(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
}
