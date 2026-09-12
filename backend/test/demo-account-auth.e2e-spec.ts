import * as fs from 'node:fs';
import * as path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { load as loadYaml } from 'js-yaml';
import type { Server } from 'node:http';
import request from 'supertest';
import { prepareFinanceDemo } from '../prisma/prepare-finance-demo';
import { prepareHrDemo } from '../prisma/prepare-hr-demo';
import { seedTeacherCore } from '../prisma/seed';
import { configureApplication } from '../src/common/bootstrap/configure-app';

interface OpenApiDocument {
  paths: Record<string, Record<string, unknown>>;
}

interface MockAuthEnvelope {
  data: {
    accessToken: string;
    refreshToken: string;
    me: {
      userId: string;
      displayName: string;
      roles: Array<{ code: string; campusId: string | null }>;
    };
  };
}

interface ErrorEnvelope {
  code: string;
}

const document = loadYaml(
  fs.readFileSync(
    path.resolve(__dirname, '../../contracts/openapi.yaml'),
    'utf8',
  ),
) as OpenApiDocument;

describe('Mock WeChat identity authentication contract', () => {
  it('declares code exchange without an account-password or caller-role surface', () => {
    const operation = document.paths['/auth/login']?.post;
    expect(operation).toBeDefined();
    expect(JSON.stringify(operation)).toContain('LoginRequest');
    expect(JSON.stringify(operation)).not.toContain('roleCode');
    expect(JSON.stringify(operation)).not.toContain('password');
    expect(document.paths['/auth/demo/login']).toBeUndefined();
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

const EAST_CAMPUS_ID = '10000000-0000-4000-8000-000000000001';
const WEST_CAMPUS_ID = '10000000-0000-4000-8000-000000000002';

describe('Mock WeChat identity authentication HTTP workflow', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await seedTeacherCore(prisma);
    await prepareHrDemo(prisma);
    await prepareFinanceDemo(prisma);
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
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it.each([
    ['mock-demo-east-parent', 'PARENT', EAST_CAMPUS_ID, '陈家长'],
    ['mock-demo-east-partner', 'PARTNER', EAST_CAMPUS_ID, '朱元璋'],
    ['mock-demo-east-teacher', 'TEACHER', EAST_CAMPUS_ID, '林老师'],
    [
      'mock-demo-east-campus-manager',
      'CAMPUS_MANAGER',
      EAST_CAMPUS_ID,
      '周园长',
    ],
    ['mock-demo-super-admin', 'SUPER_ADMIN', null, '系统管理员'],
    ['mock-demo-hr', 'HR', null, '何主管'],
    ['mock-demo-finance', 'FINANCE', null, '钱会计'],
    ['mock-demo-west-parent', 'PARENT', WEST_CAMPUS_ID, '何家长'],
    ['mock-demo-west-teacher', 'TEACHER', WEST_CAMPUS_ID, '周老师'],
    [
      'mock-demo-west-campus-manager',
      'CAMPUS_MANAGER',
      WEST_CAMPUS_ID,
      '赵园长',
    ],
    ['mock-demo-west-partner', 'PARTNER', WEST_CAMPUS_ID, '孙经理'],
  ] as const)(
    'authenticates %s as one scoped %s account',
    async (code, roleCode, campusId, displayName) => {
      await request(server)
        .post('/auth/login')
        .send({ code })
        .expect(200)
        .expect((response) => {
          const body = response.body as MockAuthEnvelope;
          expect(body.data.accessToken).toEqual(expect.any(String));
          expect(body.data.refreshToken).toEqual(expect.any(String));
          expect(body.data.me.roles).toHaveLength(1);
          expect(body.data.me.roles[0].code).toBe(roleCode);
          expect(body.data.me.roles[0].campusId).toBe(campusId);
          expect(body.data.me.displayName).toBe(displayName);
          expect(body.data.me.displayName).not.toMatch(/测试账号|本地测试账号/);
        });
    },
  );

  it('rejects an unknown identity code without exposing identity details', async () => {
    await request(server)
      .post('/auth/login')
      .send({ code: 'unknown-mock-identity' })
      .expect(401)
      .expect((response) => {
        const body = response.body as ErrorEnvelope;
        expect(body.code).toBe('UNAUTHORIZED');
        expect(JSON.stringify(body)).not.toContain('unknown-mock-identity');
        expect(JSON.stringify(body)).not.toContain('mock-demo-east-teacher');
      });
  });

  it('rejects a disabled demo account and invalidates an existing token', async () => {
    const login = await request(server)
      .post('/auth/login')
      .send({ code: 'mock-demo-east-partner' })
      .expect(200);
    const loginBody = login.body as MockAuthEnvelope;
    const userId = loginBody.data.me.userId;
    await prisma.user.update({
      where: { id: userId },
      data: { status: 'DISABLED' },
    });
    try {
      await request(server)
        .post('/auth/login')
        .send({ code: 'mock-demo-east-partner' })
        .expect(401);
      await request(server)
        .get('/partners/me/dashboard')
        .set('Authorization', `Bearer ${loginBody.data.accessToken}`)
        .expect(401);
    } finally {
      await prisma.user.update({
        where: { id: userId },
        data: { status: 'ACTIVE' },
      });
    }
  });

  it('refuses a demo account whose persisted scope contains multiple roles', async () => {
    const identity = await prisma.authIdentity.findUniqueOrThrow({
      where: {
        provider_subject: {
          provider: 'MOCK',
          subject: 'mock-demo-east-teacher',
        },
      },
      select: { userId: true },
    });
    const extraRole = await prisma.userRole.create({
      data: {
        userId: identity.userId,
        roleCode: 'PARENT',
        campusId: null,
      },
      select: { id: true },
    });
    try {
      await request(server)
        .post('/auth/login')
        .send({ code: 'mock-demo-east-teacher' })
        .expect(401);
    } finally {
      await prisma.userRole.delete({ where: { id: extraRole.id } });
    }
  });

  it('does not let a valid parent demo token cross into management APIs', async () => {
    const login = await request(server)
      .post('/auth/login')
      .send({ code: 'mock-demo-east-parent' })
      .expect(200);
    const loginBody = login.body as MockAuthEnvelope;
    await request(server)
      .get('/management/dashboard')
      .set('Authorization', `Bearer ${loginBody.data.accessToken}`)
      .expect(403);
  });
});
