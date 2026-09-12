import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { seedTeacherCore } from '../prisma/seed';
import { configureApplication } from '../src/common/bootstrap/configure-app';

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

const ids = {
  eastCampus: '10000000-0000-4000-8000-000000000001',
  westCampus: '10000000-0000-4000-8000-000000000002',
  managerUser: '20000000-0000-4000-8000-000000000005',
  parentUser: '20000000-0000-4000-8000-000000000003',
  eastStudent: '40000000-0000-4000-8000-000000000001',
  westStudent: '40000000-0000-4000-8000-000000000003',
  eastScheduled: '70000000-0000-4000-8000-000000000002',
  eastWorkshop: '70000000-0000-4000-8000-000000000003',
  westScheduled: '70000000-0000-4000-8000-000000000004',
  eastPending: 'e1000000-0000-4000-8000-000000000001',
  westPending: 'e1000000-0000-4000-8000-000000000002',
  concurrentPending: 'e1000000-0000-4000-8000-000000000003',
} as const;

interface Envelope<T> {
  data: T;
  requestId: string;
}

interface AuthSession {
  accessToken: string;
}

interface LeaveView {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewerName: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  version: number;
}

describe('campus manager leave review', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaClient;
  let managerToken: string;
  let parentToken: string;

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
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    httpServer = app.getHttpServer() as Server;
    managerToken = await login('mock-demo-east-campus-manager');
    parentToken = await login('mock-demo-east-parent');
  });

  beforeEach(async () => resetReviewFixtures());

  afterAll(async () => {
    if (prisma) {
      await seedTeacherCore(prisma);
      await prisma.idempotencyRecord.deleteMany({
        where: { route: { startsWith: '/campus-managers/me/leave-requests/' } },
      });
      await prisma.auditLog.deleteMany({
        where: { action: { startsWith: 'CAMPUS_LEAVE_' } },
      });
      await prisma.parentLeaveRequest.deleteMany({
        where: { id: { in: [ids.westPending, ids.concurrentPending] } },
      });
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  async function login(code: string): Promise<string> {
    const response = await request(httpServer)
      .post('/auth/login')
      .send({ code })
      .expect(200);
    return (response.body as Envelope<AuthSession>).data.accessToken;
  }

  async function resetReviewFixtures(): Promise<void> {
    await prisma.idempotencyRecord.deleteMany({
      where: { route: { startsWith: '/campus-managers/me/leave-requests/' } },
    });
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: 'CAMPUS_LEAVE_' } },
    });
    await prisma.parentLeaveRequest.update({
      where: { id: ids.eastPending },
      data: {
        status: 'PENDING',
        reviewerUserId: null,
        reviewedAt: null,
        reviewReason: null,
        version: 1,
      },
    });
    await prisma.parentLeaveRequest.upsert({
      where: { id: ids.westPending },
      update: {
        campusId: ids.westCampus,
        parentUserId: ids.parentUser,
        studentId: ids.westStudent,
        lessonSessionId: ids.westScheduled,
        reason: '西校区测试申请',
        status: 'PENDING',
        reviewerUserId: null,
        reviewedAt: null,
        reviewReason: null,
        version: 1,
      },
      create: {
        id: ids.westPending,
        campusId: ids.westCampus,
        parentUserId: ids.parentUser,
        studentId: ids.westStudent,
        lessonSessionId: ids.westScheduled,
        reason: '西校区测试申请',
      },
    });
    await prisma.parentLeaveRequest.upsert({
      where: { id: ids.concurrentPending },
      update: {
        campusId: ids.eastCampus,
        parentUserId: ids.parentUser,
        studentId: ids.eastStudent,
        lessonSessionId: ids.eastWorkshop,
        reason: '并发审批测试申请',
        status: 'PENDING',
        reviewerUserId: null,
        reviewedAt: null,
        reviewReason: null,
        version: 1,
      },
      create: {
        id: ids.concurrentPending,
        campusId: ids.eastCampus,
        parentUserId: ids.parentUser,
        studentId: ids.eastStudent,
        lessonSessionId: ids.eastWorkshop,
        reason: '并发审批测试申请',
      },
    });
  }

  const getAs = (path: string, token = managerToken) =>
    request(httpServer).get(path).set('Authorization', `Bearer ${token}`);

  const reviewAs = (
    leaveId: string,
    action: 'approve' | 'reject',
    body: { version: number; reviewReason?: string },
    key: string,
    token = managerToken,
  ) =>
    request(httpServer)
      .post(`/campus-managers/me/leave-requests/${leaveId}/${action}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);

  it('lists only current-campus requests with paging and status filters', async () => {
    const response = await getAs(
      '/campus-managers/me/leave-requests?page=1&pageSize=10&status=PENDING',
    ).expect(200);
    const page = response.body as {
      data: LeaveView[];
      meta: { total: number };
    };

    expect(page.meta.total).toBe(2);
    expect(page.data.map(({ id }) => id)).toEqual(
      expect.arrayContaining([ids.eastPending, ids.concurrentPending]),
    );
    expect(page.data.map(({ id }) => id)).not.toContain(ids.westPending);
    await getAs('/campus-managers/me/leave-requests', parentToken).expect(403);
  });

  it('approves once with reviewer metadata, audit, and idempotent replay', async () => {
    const first = await reviewAs(
      ids.eastPending,
      'approve',
      { version: 1, reviewReason: '已核对课程安排' },
      'cm-leave-approve-001',
    ).expect(200);
    const replay = await reviewAs(
      ids.eastPending,
      'approve',
      { version: 1, reviewReason: '已核对课程安排' },
      'cm-leave-approve-001',
    ).expect(200);
    const approved = (first.body as Envelope<LeaveView>).data;

    expect(approved).toMatchObject({
      id: ids.eastPending,
      status: 'APPROVED',
      reviewerName: '周园长',
      reviewedAt: expect.any(String) as unknown,
      reviewReason: '已核对课程安排',
      version: 2,
    });
    expect((replay.body as Envelope<LeaveView>).data).toEqual(approved);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'CAMPUS_LEAVE_APPROVE',
          resourceId: ids.eastPending,
          actorUserId: ids.managerUser,
        },
      }),
    ).resolves.toBe(1);
  });

  it('requires a trimmed rejection reason and returns it in history', async () => {
    await reviewAs(
      ids.eastPending,
      'reject',
      { version: 1 },
      'cm-leave-reject-missing-001',
    ).expect(400);
    const response = await reviewAs(
      ids.eastPending,
      'reject',
      { version: 1, reviewReason: '  当日课程已开始准备  ' },
      'cm-leave-reject-001',
    ).expect(200);

    expect((response.body as Envelope<LeaveView>).data).toMatchObject({
      status: 'REJECTED',
      reviewerName: '周园长',
      reviewReason: '当日课程已开始准备',
      version: 2,
    });
    const history = await getAs(
      '/campus-managers/me/leave-requests?status=REJECTED',
    ).expect(200);
    expect((history.body as { data: LeaveView[] }).data).toEqual([
      expect.objectContaining({
        id: ids.eastPending,
        reviewReason: '当日课程已开始准备',
      }),
    ]);
  });

  it('rejects stale and terminal reviews while rolling back failed idempotency claims', async () => {
    await reviewAs(
      ids.eastPending,
      'approve',
      { version: 99 },
      'cm-leave-version-retry-001',
    ).expect(409);
    await reviewAs(
      ids.eastPending,
      'approve',
      { version: 1 },
      'cm-leave-version-retry-001',
    ).expect(200);
    await reviewAs(
      ids.eastPending,
      'reject',
      { version: 2, reviewReason: '不能重复审批' },
      'cm-leave-terminal-001',
    ).expect(409);

    await expect(
      prisma.parentLeaveRequest.findUniqueOrThrow({
        where: { id: ids.eastPending },
        select: { status: true, version: true },
      }),
    ).resolves.toEqual({ status: 'APPROVED', version: 2 });
  });

  it('denies cross-campus review without exposing or mutating the request', async () => {
    await reviewAs(
      ids.westPending,
      'approve',
      { version: 1 },
      'cm-leave-cross-campus-001',
    ).expect(404);
    await expect(
      prisma.parentLeaveRequest.findUniqueOrThrow({
        where: { id: ids.westPending },
        select: { status: true, version: true },
      }),
    ).resolves.toEqual({ status: 'PENDING', version: 1 });
  });

  it('allows only one of two concurrent terminal reviews', async () => {
    const [approve, reject] = await Promise.all([
      reviewAs(
        ids.concurrentPending,
        'approve',
        { version: 1 },
        'cm-leave-concurrent-approve-001',
      ),
      reviewAs(
        ids.concurrentPending,
        'reject',
        { version: 1, reviewReason: '并发驳回' },
        'cm-leave-concurrent-reject-001',
      ),
    ]);

    expect([approve.status, reject.status].sort()).toEqual([200, 409]);
    const stored = await prisma.parentLeaveRequest.findUniqueOrThrow({
      where: { id: ids.concurrentPending },
      select: { status: true, version: true },
    });
    expect(['APPROVED', 'REJECTED']).toContain(stored.status);
    expect(stored.version).toBe(2);
  });
});
