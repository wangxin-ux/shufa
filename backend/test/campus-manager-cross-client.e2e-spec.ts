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
  eastStudentA: '40000000-0000-4000-8000-000000000001',
  eastStudentB: '40000000-0000-4000-8000-000000000002',
  eastScheduled: '70000000-0000-4000-8000-000000000002',
  eastWorkshop: '70000000-0000-4000-8000-000000000003',
  eastPending: 'e1000000-0000-4000-8000-000000000001',
  eastRejected: 'e1000000-0000-4000-8000-000000000004',
  parentUser: '20000000-0000-4000-8000-000000000003',
  eastCampus: '10000000-0000-4000-8000-000000000001',
} as const;

interface Envelope<T> {
  data: T;
  requestId: string;
}

interface AuthSession {
  accessToken: string;
}

interface TeacherLesson {
  version: number;
  students: Array<{
    id: string;
    attendanceStatus: 'PRESENT' | 'LEAVE' | 'ABSENT' | null;
  }>;
}

describe('campus manager leave cross-client semantics', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaClient;
  let managerToken: string;
  let parentToken: string;
  let teacherToken: string;

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
    teacherToken = await login('mock-demo-east-teacher');
  });

  beforeEach(async () => {
    await seedTeacherCore(prisma);
    await prisma.idempotencyRecord.deleteMany({
      where: { route: { startsWith: '/campus-managers/me/leave-requests/' } },
    });
  });

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
        where: { id: ids.eastRejected },
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

  const getAs = (path: string, token: string) =>
    request(httpServer).get(path).set('Authorization', `Bearer ${token}`);

  const review = (
    leaveId: string,
    action: 'approve' | 'reject',
    body: { version: number; reviewReason?: string },
    key: string,
  ) =>
    request(httpServer)
      .post(`/campus-managers/me/leave-requests/${leaveId}/${action}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('Idempotency-Key', key)
      .send(body);

  it('syncs approval to the parent and pre-fills teacher leave without deduction', async () => {
    await review(
      ids.eastPending,
      'approve',
      { version: 1, reviewReason: '批准参加校内活动' },
      'cm-cross-approve-001',
    ).expect(200);

    const parentResponse = await getAs('/parents/me/leave', parentToken).expect(
      200,
    );
    const parentRecord = (
      parentResponse.body as {
        data: {
          records: Array<{
            id: string;
            status: string;
            reviewerName: string | null;
            reviewReason: string | null;
          }>;
        };
      }
    ).data.records.find(({ id }) => id === ids.eastPending);
    expect(parentRecord).toMatchObject({
      status: 'APPROVED',
      reviewerName: '周园长',
      reviewReason: '批准参加校内活动',
    });

    const teacherResponse = await getAs(
      `/teachers/me/lesson-sessions/${ids.eastScheduled}`,
      teacherToken,
    ).expect(200);
    const lesson = (teacherResponse.body as Envelope<TeacherLesson>).data;
    expect(
      lesson.students.find(({ id }) => id === ids.eastStudentA)
        ?.attendanceStatus,
    ).toBe('LEAVE');

    const completion = await request(httpServer)
      .post(`/teachers/me/lesson-sessions/${ids.eastScheduled}/complete`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('Idempotency-Key', 'cm-cross-complete-001')
      .send({
        lessonVersion: lesson.version,
        attendance: [
          { studentId: ids.eastStudentA, status: 'LEAVE' },
          { studentId: ids.eastStudentB, status: 'PRESENT' },
        ],
      })
      .expect(200);
    const consumed = (
      completion.body as Envelope<{
        consumed: Array<{
          studentId: string;
          mainUnits: number;
          giftUnits: number;
        }>;
      }>
    ).data.consumed;
    expect(
      consumed.find(({ studentId }) => studentId === ids.eastStudentA),
    ).toEqual({ studentId: ids.eastStudentA, mainUnits: 0, giftUnits: 0 });
    await expect(
      prisma.lessonLedgerEntry.count({
        where: {
          lessonSessionId: ids.eastScheduled,
          studentId: ids.eastStudentA,
        },
      }),
    ).resolves.toBe(0);
  });

  it('keeps a rejected request out of teacher attendance prefill', async () => {
    await prisma.parentLeaveRequest.create({
      data: {
        id: ids.eastRejected,
        campusId: ids.eastCampus,
        parentUserId: ids.parentUser,
        studentId: ids.eastStudentA,
        lessonSessionId: ids.eastWorkshop,
        reason: '临时安排冲突',
      },
    });
    await review(
      ids.eastRejected,
      'reject',
      { version: 1, reviewReason: '超过可审批时段' },
      'cm-cross-reject-001',
    ).expect(200);

    const parentResponse = await getAs('/parents/me/leave', parentToken).expect(
      200,
    );
    const parentRecord = (
      parentResponse.body as {
        data: { records: Array<Record<string, unknown>> };
      }
    ).data.records.find(({ id }) => id === ids.eastRejected);
    expect(parentRecord).toMatchObject({
      status: 'REJECTED',
      reviewReason: '超过可审批时段',
    });

    const teacherResponse = await getAs(
      `/teachers/me/lesson-sessions/${ids.eastWorkshop}`,
      teacherToken,
    ).expect(200);
    const lesson = (teacherResponse.body as Envelope<TeacherLesson>).data;
    expect(lesson.students[0]?.attendanceStatus).toBeNull();
  });

  it('keeps explicit teacher attendance authoritative after approval', async () => {
    await review(
      ids.eastPending,
      'approve',
      { version: 1 },
      'cm-cross-explicit-approve-001',
    ).expect(200);
    await request(httpServer)
      .put(`/teachers/me/lesson-sessions/${ids.eastScheduled}/attendance`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('Idempotency-Key', 'cm-cross-explicit-attendance-001')
      .send({
        lessonVersion: 1,
        attendance: [
          { studentId: ids.eastStudentA, status: 'PRESENT' },
          { studentId: ids.eastStudentB, status: 'PRESENT' },
        ],
      })
      .expect(200);

    const teacherResponse = await getAs(
      `/teachers/me/lesson-sessions/${ids.eastScheduled}`,
      teacherToken,
    ).expect(200);
    const lesson = (teacherResponse.body as Envelope<TeacherLesson>).data;
    expect(
      lesson.students.find(({ id }) => id === ids.eastStudentA)
        ?.attendanceStatus,
    ).toBe('PRESENT');
  });
});
