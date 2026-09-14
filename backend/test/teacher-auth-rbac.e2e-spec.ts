import {
  Controller,
  Get,
  INestApplication,
  Module,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import type { AuthenticatedUser } from '../src/common/auth/authenticated-user';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../src/common/auth/permissions.guard';
import { TeacherScopeService } from '../src/common/auth/teacher-scope.service';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { AccessTokenGuard } from '../src/modules/auth/access-token.guard';
import { AuthModule } from '../src/modules/auth/auth.module';
import { StaffBindTokenService } from '../src/modules/auth/staff-bind-token.service';
import { seedTeacherCore } from '../prisma/seed';

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

const ids = {
  eastCampus: '10000000-0000-4000-8000-000000000001',
  eastTeacherUser: '20000000-0000-4000-8000-000000000001',
  westTeacherUser: '20000000-0000-4000-8000-000000000002',
  westStudent: '40000000-0000-4000-8000-000000000003',
  westLesson: '70000000-0000-4000-8000-000000000004',
  parentUser: 'e0000000-0000-4000-8000-000000000001',
  parentRole: 'e0000000-0000-4000-8000-000000000002',
  parentIdentity: 'e0000000-0000-4000-8000-000000000003',
} as const;

const teacherEastBinding = {
  bindToken: 'teacher-east-bind-token-0001',
  code: 'mock-teacher-east-code',
  idempotencyKey: 'bind-teacher-east-0001',
} as const;

interface AuthSessionBody {
  data: {
    accessToken: string;
    refreshToken: string;
    expiresInSeconds: number;
    me: {
      userId: string;
      displayName: string;
      roles: Array<{ code: string; campusId: string | null }>;
    };
  };
  requestId: string;
}

@Controller('__test/teacher-permission')
@UseGuards(AccessTokenGuard, PermissionsGuard)
class TeacherPermissionTestController {
  @Get()
  @RequirePermissions('TEACHER_PROFILE_READ')
  readTeacherResource() {
    return { allowed: true };
  }
}

@Module({
  imports: [AuthModule],
  controllers: [TeacherPermissionTestController],
})
class TeacherPermissionTestModule {}

describe('teacher authentication and RBAC', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaClient;
  let bindTokenService: StaffBindTokenService;
  let teacherScopeService: TeacherScopeService;
  let teacherAccessToken: string;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await seedTeacherCore(prisma);

    await prisma.idempotencyRecord.deleteMany({
      where: {
        route: '/auth/staff/bind',
        key: { startsWith: 'bind-teacher-' },
      },
    });
    await prisma.authIdentity.deleteMany({
      where: {
        OR: [
          { userId: ids.eastTeacherUser },
          { userId: ids.westTeacherUser },
          { userId: ids.parentUser },
        ],
      },
    });
    await prisma.staffBindToken.deleteMany({
      where: {
        userId: { in: [ids.eastTeacherUser, ids.westTeacherUser] },
      },
    });
    await prisma.userRole.deleteMany({ where: { userId: ids.parentUser } });
    await prisma.user.deleteMany({ where: { id: ids.parentUser } });

    await prisma.user.create({
      data: {
        id: ids.parentUser,
        displayName: 'Demo Parent',
        status: 'ACTIVE',
        roles: {
          create: {
            id: ids.parentRole,
            roleCode: 'PARENT',
            campusId: ids.eastCampus,
          },
        },
        authIdentities: {
          create: {
            id: ids.parentIdentity,
            provider: 'MOCK',
            subject: 'mock-parent-east-code',
          },
        },
      },
    });

    const { AppModule } =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      );
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, TeacherPermissionTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    httpServer = app.getHttpServer() as Server;
    bindTokenService = app.get(StaffBindTokenService);
    teacherScopeService = app.get(TeacherScopeService);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('binds a pre-created teacher with a one-time staff token', async () => {
    await bindTokenService.issue({
      userId: ids.eastTeacherUser,
      rawToken: teacherEastBinding.bindToken,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const response = await request(httpServer)
      .post('/auth/staff/bind')
      .set('Idempotency-Key', teacherEastBinding.idempotencyKey)
      .send({
        code: teacherEastBinding.code,
        bindToken: teacherEastBinding.bindToken,
      })
      .expect(200);
    const body = response.body as AuthSessionBody;

    expect(body.data.me).toEqual({
      userId: ids.eastTeacherUser,
      displayName: '林老师',
      roles: [{ code: 'TEACHER', campusId: ids.eastCampus }],
    });
    expect(body.data.accessToken).toEqual(expect.any(String));
    expect(body.data.refreshToken).toEqual(expect.any(String));
    expect(body.data.expiresInSeconds).toBeGreaterThan(0);
    teacherAccessToken = body.data.accessToken;

    const storedToken = await prisma.staffBindToken.findUniqueOrThrow({
      where: {
        tokenDigest: createHash('sha256')
          .update(teacherEastBinding.bindToken, 'utf8')
          .digest('hex'),
      },
      select: { tokenDigest: true, tokenHash: true, consumedAt: true },
    });
    expect(storedToken.tokenDigest).not.toBe(teacherEastBinding.bindToken);
    expect(storedToken.tokenHash).not.toContain(teacherEastBinding.bindToken);
    expect(storedToken.consumedAt).toEqual(expect.any(Date));
  });

  it('replays a successful bind for the same idempotency key and request', async () => {
    const response = await request(httpServer)
      .post('/auth/staff/bind')
      .set('Idempotency-Key', teacherEastBinding.idempotencyKey)
      .send({
        code: teacherEastBinding.code,
        bindToken: teacherEastBinding.bindToken,
      })
      .expect(200);

    expect((response.body as AuthSessionBody).data.me).toEqual({
      userId: ids.eastTeacherUser,
      displayName: '林老师',
      roles: [{ code: 'TEACHER', campusId: ids.eastCampus }],
    });
    await expect(
      prisma.authIdentity.count({
        where: { provider: 'MOCK', subject: teacherEastBinding.code },
      }),
    ).resolves.toBe(1);
  });

  it('rejects the same idempotency key with different binding data', async () => {
    await request(httpServer)
      .post('/auth/staff/bind')
      .set('Idempotency-Key', teacherEastBinding.idempotencyKey)
      .send({
        code: 'mock-teacher-east-different-code',
        bindToken: teacherEastBinding.bindToken,
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({ code: 'CONFLICT' }) as unknown,
        );
      });

    const record = await prisma.idempotencyRecord.findUniqueOrThrow({
      where: {
        key_route: {
          key: teacherEastBinding.idempotencyKey,
          route: '/auth/staff/bind',
        },
      },
      select: { status: true, responseBody: true },
    });
    expect(record).toEqual({
      status: 'COMPLETED',
      responseBody: { userId: ids.eastTeacherUser },
    });
    expect(JSON.stringify(record)).not.toContain(teacherEastBinding.bindToken);
    expect(JSON.stringify(record)).not.toContain(teacherAccessToken);
  });

  it('rejects a reused or expired staff token', async () => {
    await request(httpServer)
      .post('/auth/staff/bind')
      .set('Idempotency-Key', 'bind-teacher-east-0002')
      .send({
        code: 'mock-teacher-east-second-code',
        bindToken: 'teacher-east-bind-token-0001',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({ code: 'CONFLICT' }) as unknown,
        );
      });

    const expiredToken = 'teacher-west-expired-token-01';
    await expect(
      bindTokenService.issue({
        userId: ids.westTeacherUser,
        rawToken: expiredToken,
        expiresAt: new Date(Date.now() - 1_000),
      }),
    ).rejects.toThrow('Staff bind token expiration must be in the future');

    await bindTokenService.issue({
      userId: ids.westTeacherUser,
      rawToken: expiredToken,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const expiredAt = new Date(Date.now() - 1_000);
    await prisma.staffBindToken.update({
      where: {
        tokenDigest: createHash('sha256')
          .update(expiredToken, 'utf8')
          .digest('hex'),
      },
      data: {
        createdAt: new Date(expiredAt.getTime() - 60_000),
        expiresAt: expiredAt,
      },
    });

    await request(httpServer)
      .post('/auth/staff/bind')
      .set('Idempotency-Key', 'bind-teacher-west-0001')
      .send({ code: 'mock-teacher-west-code', bindToken: expiredToken })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({ code: 'CONFLICT' }) as unknown,
        );
      });
  });

  it('returns only the seeded TEACHER role from GET /me', async () => {
    const response = await request(httpServer)
      .get('/me')
      .set('Authorization', `Bearer ${teacherAccessToken}`)
      .expect(200);

    expect((response.body as AuthSessionBody).data).toEqual({
      userId: ids.eastTeacherUser,
      displayName: '林老师',
      roles: [{ code: 'TEACHER', campusId: ids.eastCampus }],
    });
  });

  it('rejects a parent token on teacher endpoints', async () => {
    const loginResponse = await request(httpServer)
      .post('/auth/login')
      .send({ code: 'mock-parent-east-code' })
      .expect(200);
    const parentToken = (loginResponse.body as AuthSessionBody).data
      .accessToken;

    await request(httpServer)
      .get('/__test/teacher-permission')
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(403)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({ code: 'FORBIDDEN' }) as unknown,
        );
      });
  });

  it('teacher east cannot access teacher west lesson or student IDs', async () => {
    const principal: AuthenticatedUser = {
      userId: ids.eastTeacherUser,
      roles: [{ code: 'TEACHER', campusId: ids.eastCampus }],
    };
    const scope = await teacherScopeService.resolve(principal);

    await expect(
      teacherScopeService.assertLessonSessionInScope(scope, ids.westLesson),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    await expect(
      teacherScopeService.assertStudentInScope(scope, ids.westStudent),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  });

  it('includes approved headquarters roles while preserving the existing role codes', async () => {
    const roleRows = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT unnest(enum_range(NULL::"RoleCode"))::text AS value
    `;
    const roleValues = roleRows.map(({ value }) => value);

    expect(roleValues).toEqual([
      'PARENT',
      'PARTNER',
      'TEACHER',
      'OPERATOR',
      'CAMPUS_MANAGER',
      'SUPER_ADMIN',
      'HR',
      'FINANCE',
    ]);
  });
});
