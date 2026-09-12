import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { seedTeacherCore } from '../prisma/seed';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { StaffBindTokenService } from '../src/modules/auth/staff-bind-token.service';

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
  eastTeacherUser: '20000000-0000-4000-8000-000000000001',
  eastStudentA: '40000000-0000-4000-8000-000000000001',
  eastStudentB: '40000000-0000-4000-8000-000000000002',
  eastCompleted: '70000000-0000-4000-8000-000000000001',
  eastScheduled: '70000000-0000-4000-8000-000000000002',
  eastWorkshop: '70000000-0000-4000-8000-000000000003',
  westScheduled: '70000000-0000-4000-8000-000000000004',
} as const;

interface Envelope<T> {
  data: T;
  requestId: string;
}

interface PageEnvelope<T> extends Envelope<T[]> {
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface LessonSummary {
  id: string;
  version: number;
  className: string;
  courseName: string;
  campusName: string;
  startsAt: string;
  endsAt: string;
  lessonUnits: number;
  status: string;
  studentCount: number;
}

describe('teacher scoped read models', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaClient;
  let accessToken: string;
  let eastScheduledStartsAt: Date;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await seedTeacherCore(prisma);
    eastScheduledStartsAt = new Date(Date.now() + 10 * 60 * 1_000);
    eastScheduledStartsAt.setMilliseconds(0);
    await prisma.lessonSession.update({
      where: { id: ids.eastScheduled },
      data: {
        startsAt: eastScheduledStartsAt,
        endsAt: new Date(eastScheduledStartsAt.getTime() + 90 * 60 * 1_000),
        status: 'SCHEDULED',
        version: 1,
      },
    });
    await prisma.idempotencyRecord.deleteMany({
      where: { route: '/auth/staff/bind', key: 'bind-teacher-reads-0001' },
    });
    await prisma.authIdentity.deleteMany({
      where: { userId: ids.eastTeacherUser },
    });
    await prisma.staffBindToken.deleteMany({
      where: { userId: ids.eastTeacherUser },
    });

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

    await app.get(StaffBindTokenService).issue({
      userId: ids.eastTeacherUser,
      rawToken: 'teacher-reads-bind-token-0001',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const bindResponse = await request(httpServer)
      .post('/auth/staff/bind')
      .set('Idempotency-Key', 'bind-teacher-reads-0001')
      .send({
        code: 'mock-teacher-reads-code',
        bindToken: 'teacher-reads-bind-token-0001',
      })
      .expect(200);
    accessToken = (bindResponse.body as Envelope<{ accessToken: string }>).data
      .accessToken;
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  const get = (path: string) =>
    request(httpServer).get(path).set('Authorization', `Bearer ${accessToken}`);

  it('returns dashboard totals and the earliest upcoming lesson', async () => {
    const response = await get('/teachers/me/dashboard').expect(200);
    const body = response.body as Envelope<{
      teacher: {
        displayName: string;
        subjectLabel: string;
        campusName: string;
      };
      nextLesson: LessonSummary | null;
      todayPendingCount: number;
      todayCompletedCount: number;
      responsibleStudentCount: number;
      serverTime: string;
    }>;

    expect(body.data.teacher).toEqual({
      displayName: '林老师',
      subjectLabel: '创意基础 / 团体创意工坊',
      campusName: '启明东校区',
    });
    expect(body.data.nextLesson).toEqual(
      expect.objectContaining({
        id: ids.eastScheduled,
        startsAt: eastScheduledStartsAt.toISOString(),
        lessonUnits: 100,
        studentCount: 2,
      }) as unknown,
    );
    expect(body.data.todayPendingCount).toEqual(expect.any(Number));
    expect(body.data.todayCompletedCount).toEqual(expect.any(Number));
    expect(body.data.responsibleStudentCount).toBe(2);
    expect(body.data.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns the scoped teacher profile without sensitive fields', async () => {
    const response = await get('/teachers/me/profile').expect(200);
    expect(response.body).toEqual({
      data: {
        displayName: '林老师',
        subjectLabel: '创意基础 / 团体创意工坊',
        campusName: '启明东校区',
        responsibleStudentCount: 2,
        roleCode: 'TEACHER',
      },
      requestId: expect.any(String) as unknown,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/phone|account|amount/i);
  });

  it('paginates lesson sessions in start-time order with RFC 3339 times', async () => {
    const response = await get(
      '/teachers/me/lesson-sessions?page=1&pageSize=2',
    ).expect(200);
    const body = response.body as PageEnvelope<LessonSummary>;

    expect(body.meta).toEqual({
      page: 1,
      pageSize: 2,
      total: 3,
      totalPages: 2,
    });
    expect(body.data.map(({ id }) => id)).toEqual([
      ids.eastCompleted,
      ids.eastScheduled,
    ]);
    expect(body.data[0].startsAt).toBe('2026-08-28T01:00:00.000Z');
    expect(body.data.every(({ lessonUnits }) => lessonUnits === 100)).toBe(
      true,
    );
  });

  it('returns an empty page for an empty date range', async () => {
    const response = await get(
      '/teachers/me/lesson-sessions?page=1&pageSize=20&from=2027-01-01T00:00:00Z&to=2027-01-02T00:00:00Z',
    ).expect(200);

    expect(response.body).toEqual({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      requestId: expect.any(String) as unknown,
    });
  });

  it('reads an assigned lesson roster and rejects another teacher lesson', async () => {
    const ownResponse = await get(
      `/teachers/me/lesson-sessions/${ids.eastCompleted}`,
    ).expect(200);
    const ownBody = ownResponse.body as Envelope<
      LessonSummary & {
        students: Array<{
          id: string;
          attendanceStatus: string | null;
          expectedConsumeUnits: number;
          feedback: string | null;
        }>;
        canComplete: boolean;
        canReverse: boolean;
      }
    >;

    expect(ownBody.data.students.map(({ id }) => id)).toEqual([
      ids.eastStudentB,
      ids.eastStudentA,
    ]);
    expect(ownBody.data.students).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ids.eastStudentA,
          attendanceStatus: 'PRESENT',
          expectedConsumeUnits: 100,
          feedback: expect.any(String) as unknown,
        }),
      ]) as unknown,
    );
    expect(ownBody.data.canComplete).toBe(false);
    expect(ownBody.data.canReverse).toEqual(expect.any(Boolean));

    await get(`/teachers/me/lesson-sessions/${ids.westScheduled}`)
      .expect(403)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({ code: 'FORBIDDEN' }) as unknown,
        );
      });
  });

  it('searches only responsible students and derives class names', async () => {
    const response = await get(
      '/teachers/me/students?page=1&pageSize=20&query=%E5%AE%89',
    ).expect(200);

    expect(response.body).toEqual({
      data: [
        {
          id: ids.eastStudentB,
          displayName: '安然',
          classNames: ['创意基础A班'],
          nextLessonAt: eastScheduledStartsAt.toISOString(),
          latestFeedbackAt: null,
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      requestId: expect.any(String) as unknown,
    });
  });

  it('returns one responsible student teaching detail without private or financial fields', async () => {
    const response = await get(
      `/teachers/me/students/${ids.eastStudentA}`,
    ).expect(200);

    expect(response.body).toEqual({
      data: expect.objectContaining({
        id: ids.eastStudentA,
        displayName: '陈晨',
        classNames: ['创意基础A班', '创意工坊A班'],
        classes: expect.arrayContaining([
          expect.objectContaining({
            className: '创意基础A班',
            courseName: '创意基础',
          }),
        ]),
        nextLesson: expect.objectContaining({
          id: ids.eastScheduled,
          startsAt: eastScheduledStartsAt.toISOString(),
        }),
        attendance: {
          presentCount: 1,
          leaveCount: 0,
          absentCount: 0,
          recordedCount: 1,
          attendanceRateBasisPoints: 10000,
        },
        recentAttendance: [
          expect.objectContaining({
            courseName: '创意基础',
            status: 'PRESENT',
          }),
        ],
        latestFeedback: expect.objectContaining({
          courseName: '创意基础',
          content: expect.any(String),
        }),
      }),
      requestId: expect.any(String),
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /phone|mobile|address|coursePackages|balance|paidAmount|parent/i,
    );
  });

  it('lists completed teaching records for the authenticated teacher', async () => {
    const response = await get(
      '/teachers/me/teaching-records?page=1&pageSize=20',
    ).expect(200);
    const body = response.body as PageEnvelope<{
      lessonSessionId: string;
      attendeeCount: number;
      lessonUnits: number;
      status: string;
      feedbackCompletedCount: number;
      feedbackRequiredCount: number;
    }>;

    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toEqual(
      expect.objectContaining({
        lessonSessionId: ids.eastCompleted,
        attendeeCount: 2,
        lessonUnits: 100,
        status: 'COMPLETED',
        feedbackCompletedCount: 1,
        feedbackRequiredCount: 2,
      }) as unknown,
    );
    expect(body.meta.total).toBe(1);
  });

  it('lists only lesson-ledger summaries caused by the teacher sessions', async () => {
    const response = await get(
      '/teachers/me/lesson-ledger?page=1&pageSize=20',
    ).expect(200);
    const body = response.body as PageEnvelope<{
      lessonSessionId: string;
      studentId: string;
      deltaUnits: number;
    }>;

    expect(body.data).toHaveLength(2);
    expect(
      body.data.every(
        ({ lessonSessionId }) => lessonSessionId === ids.eastCompleted,
      ),
    ).toBe(true);
    expect(body.data.map(({ studentId }) => studentId).sort()).toEqual([
      ids.eastStudentA,
      ids.eastStudentB,
    ]);
    expect(body.data.every(({ deltaUnits }) => deltaUnits === -100)).toBe(true);
  });
});
