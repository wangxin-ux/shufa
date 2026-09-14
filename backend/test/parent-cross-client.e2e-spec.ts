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
  eastTeacherUser: '20000000-0000-4000-8000-000000000001',
  eastParentUser: '20000000-0000-4000-8000-000000000003',
  eastStudentA: '40000000-0000-4000-8000-000000000001',
  eastStudentB: '40000000-0000-4000-8000-000000000002',
  westStudentA: '40000000-0000-4000-8000-000000000003',
  eastScheduled: '70000000-0000-4000-8000-000000000002',
  eastWorkshop: '70000000-0000-4000-8000-000000000003',
  eastPackageA: '80000000-0000-4000-8000-000000000001',
  eastPackageB: '80000000-0000-4000-8000-000000000002',
} as const;

interface Envelope<T> {
  data: T;
  requestId: string;
}

interface ParentHomeBody {
  student: { id: string };
  remainingUnits: number;
  attendanceRatePercent: number | null;
}

interface ParentHoursBody {
  remainingTotalUnits: number;
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  entries: Array<{
    lessonSessionId: string | null;
    entryType: string;
    deltaUnits: number;
    reason: string | null;
  }>;
}

interface ParentLeaveBody {
  students: Array<{ id: string; name: string; age: number }>;
}

interface ParentProfileBody {
  student: {
    id: string;
    name: string;
    age: number;
    homeAddress: string | null;
    profileVersion: number;
  } | null;
  unreadMessageCount: number;
}

interface ParentUpdatesBody {
  records: Array<{
    lessonSessionId: string;
    studentId: string;
    attendanceStatus: string | null;
    feedback: string | null;
    feedbackImages: Array<{
      id: string;
      mimeType: string;
      sizeBytes: number;
      accessUrl: string;
      accessUrlExpiresAt: string;
    }>;
  }>;
}

describe('parent API and teacher-to-parent data closure', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaClient;
  let parentAccessToken: string;
  let teacherAccessToken: string;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await resetCrossClientFixtures(prisma);

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

    const parentResponse = await request(httpServer)
      .post('/auth/login')
      .send({ code: 'mock-demo-east-parent' })
      .expect(200);
    parentAccessToken = (
      parentResponse.body as Envelope<{ accessToken: string }>
    ).data.accessToken;
    const teacherResponse = await request(httpServer)
      .post('/auth/login')
      .send({ code: 'mock-demo-east-teacher' })
      .expect(200);
    teacherAccessToken = (
      teacherResponse.body as Envelope<{ accessToken: string }>
    ).data.accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      await resetCrossClientFixtures(prisma);
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  const parentGet = (path: string) =>
    request(httpServer)
      .get(path)
      .set('Authorization', `Bearer ${parentAccessToken}`);
  const parentPost = (path: string) =>
    request(httpServer)
      .post(path)
      .set('Authorization', `Bearer ${parentAccessToken}`);
  const parentPut = (path: string) =>
    request(httpServer)
      .put(path)
      .set('Authorization', `Bearer ${parentAccessToken}`);
  const teacherGet = (path: string) =>
    request(httpServer)
      .get(path)
      .set('Authorization', `Bearer ${teacherAccessToken}`);
  const teacherPost = (path: string) =>
    request(httpServer)
      .post(path)
      .set('Authorization', `Bearer ${teacherAccessToken}`);
  const teacherPut = (path: string) =>
    request(httpServer)
      .put(path)
      .set('Authorization', `Bearer ${teacherAccessToken}`);

  it('reads only the authenticated parent bound student', async () => {
    await parentGet('/parents/me/profile')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          data: {
            student: {
              id: ids.eastStudentA,
              name: '陈晨',
              age: 9,
              homeAddress: null,
              profileVersion: 1,
            },
            unreadMessageCount: 0,
          },
          requestId: expect.any(String) as unknown,
        });
      });

    await parentGet(`/parents/me/hours?studentId=${ids.westStudentA}`)
      .expect(403)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({ code: 'FORBIDDEN' }) as unknown,
        );
      });
  });

  it('keeps parent and teacher permissions on separate accounts', async () => {
    await parentGet('/teachers/me/dashboard').expect(403);
    await teacherGet('/parents/me/profile').expect(403);
    await request(httpServer)
      .put('/parents/me/profile')
      .set('Authorization', `Bearer ${teacherAccessToken}`)
      .set('Idempotency-Key', 'teacher-profile-overreach-0001')
      .send({ age: 10, homeAddress: '越权地址', expectedVersion: 1 })
      .expect(403);
  });

  it('updates the primary bound student profile idempotently and rejects stale versions', async () => {
    const key = 'parent-profile-update-0001';
    const auditCountBefore = await prisma.auditLog.count({
      where: { action: 'PARENT_PROFILE_UPDATE', resourceId: ids.eastStudentA },
    });
    const body = {
      age: 10,
      homeAddress: '长沙市岳麓区启明路 20 号',
      expectedVersion: 1,
    };

    const first = await parentPut('/parents/me/profile')
      .set('Idempotency-Key', key)
      .send(body)
      .expect(200);
    const replay = await parentPut('/parents/me/profile')
      .set('Idempotency-Key', key)
      .send(body)
      .expect(200);

    expect(
      (first.body as Envelope<ParentProfileBody>).data.student,
    ).toMatchObject({
      id: ids.eastStudentA,
      age: 10,
      homeAddress: '长沙市岳麓区启明路 20 号',
      profileVersion: 2,
    });
    expect((replay.body as Envelope<ParentProfileBody>).data).toEqual(
      (first.body as Envelope<ParentProfileBody>).data,
    );
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'PARENT_PROFILE_UPDATE',
          resourceId: ids.eastStudentA,
        },
      }),
    ).resolves.toBe(auditCountBefore + 1);

    await parentPut('/parents/me/profile')
      .set('Idempotency-Key', 'parent-profile-update-stale-0001')
      .send({ ...body, age: 11 })
      .expect(409)
      .expect(({ body: errorBody }) => {
        expect(errorBody).toEqual(
          expect.objectContaining({
            code: 'STUDENT_PROFILE_VERSION_CONFLICT',
          }) as unknown,
        );
      });

    await parentGet('/parents/me/profile')
      .expect(200)
      .expect(({ body: currentBody }) => {
        expect(
          (currentBody as Envelope<ParentProfileBody>).data.student,
        ).toMatchObject({
          age: 10,
          homeAddress: '长沙市岳麓区启明路 20 号',
          profileVersion: 2,
        });
      });
  });

  it('serves all existing parent pages from PostgreSQL', async () => {
    const [home, hours, leave, updates] = await Promise.all([
      parentGet('/parents/me/home').expect(200),
      parentGet('/parents/me/hours').expect(200),
      parentGet('/parents/me/leave').expect(200),
      parentGet('/parents/me/updates').expect(200),
    ]);

    const homeBody = (home.body as Envelope<ParentHomeBody>).data;
    expect(homeBody).toMatchObject({
      student: { id: ids.eastStudentA },
      remainingUnits: 1100,
      attendanceRatePercent: 100,
    });

    const hoursBody = (hours.body as Envelope<ParentHoursBody>).data;
    expect(hoursBody).toMatchObject({
      remainingTotalUnits: 1100,
      mainBalanceUnits: 900,
      giftBalanceUnits: 200,
    });
    expect(hoursBody.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lessonSessionId: expect.any(String) as unknown,
          deltaUnits: -100,
        }),
      ]),
    );

    const leaveBody = (leave.body as Envelope<ParentLeaveBody>).data;
    expect(leaveBody.students).toEqual([
      { id: ids.eastStudentA, name: '陈晨', age: 10 },
    ]);

    const updatesBody = (updates.body as Envelope<ParentUpdatesBody>).data;
    expect(updatesBody.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          studentId: ids.eastStudentA,
          attendanceStatus: 'PRESENT',
          feedback: expect.any(String) as unknown,
        }),
      ]),
    );
  });

  it('shows one teacher completion, feedback, and reversal to the parent', async () => {
    const attendance = [
      { studentId: ids.eastStudentA, status: 'PRESENT' },
      { studentId: ids.eastStudentB, status: 'LEAVE' },
    ];

    await teacherPost(
      `/teachers/me/lesson-sessions/${ids.eastScheduled}/complete`,
    )
      .set('Idempotency-Key', 'cross-client-complete-0001')
      .send({ lessonVersion: 1, attendance })
      .expect(200);

    const afterCompletion = await parentGet('/parents/me/hours').expect(200);
    expect(afterCompletion.body).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          remainingTotalUnits: 1000,
          entries: expect.arrayContaining([
            expect.objectContaining({
              lessonSessionId: ids.eastScheduled,
              entryType: 'CONSUME',
              deltaUnits: -100,
              reason: '教师确认完成课次',
            }),
          ]) as unknown,
        }) as unknown,
      }) as unknown,
    );

    const feedbackImage = await request(httpServer)
      .post(
        `/teachers/me/lesson-sessions/${ids.eastScheduled}/students/${ids.eastStudentA}/feedback-images`,
      )
      .set('Authorization', `Bearer ${teacherAccessToken}`)
      .attach('file', onePixelPng(), {
        filename: 'class-photo.png',
        contentType: 'image/png',
      })
      .expect(200);
    const feedbackImageId = (feedbackImage.body as Envelope<{ id: string }>)
      .data.id;

    await teacherPut(
      `/teachers/me/lesson-sessions/${ids.eastScheduled}/students/${ids.eastStudentA}/feedback`,
    )
      .set('Idempotency-Key', 'cross-client-feedback-0001')
      .send({
        content: 'Cross-client feedback is visible.',
        imageFileIds: [feedbackImageId],
      })
      .expect(200);

    const updates = await parentGet('/parents/me/updates').expect(200);
    expect(updates.body).toEqual(
      expect.objectContaining({
        data: {
          records: expect.arrayContaining([
            expect.objectContaining({
              lessonSessionId: ids.eastScheduled,
              attendanceStatus: 'PRESENT',
              feedback: 'Cross-client feedback is visible.',
              feedbackImages: [
                expect.objectContaining({
                  id: feedbackImageId,
                  mimeType: 'image/png',
                  accessUrl: expect.stringContaining(
                    `/media/student-feedback/${feedbackImageId}`,
                  ) as unknown,
                }),
              ],
            }),
          ]) as unknown,
        },
      }) as unknown,
    );

    const parentUpdates = (updates.body as Envelope<ParentUpdatesBody>).data;
    const imageUrl = parentUpdates.records.find(
      ({ lessonSessionId }) => lessonSessionId === ids.eastScheduled,
    )?.feedbackImages[0]?.accessUrl;
    expect(imageUrl).toBeTruthy();
    await request(httpServer)
      .get(imageUrl as string)
      .expect('Content-Type', /image\/png/)
      .expect(200);

    await teacherPost(
      `/teachers/me/lesson-sessions/${ids.eastScheduled}/reverse`,
    )
      .set('Idempotency-Key', 'cross-client-reverse-0001')
      .send({ lessonVersion: 2, reason: 'Cross-client verification' })
      .expect(200);

    const afterReversal = await parentGet('/parents/me/hours').expect(200);
    expect(afterReversal.body).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          remainingTotalUnits: 1100,
          entries: expect.arrayContaining([
            expect.objectContaining({
              lessonSessionId: ids.eastScheduled,
              entryType: 'REVERSAL',
              deltaUnits: 100,
            }),
          ]) as unknown,
        }) as unknown,
      }) as unknown,
    );
  });

  it('submits leave idempotently and rejects a foreign student', async () => {
    await prisma.lessonSession.update({
      where: { id: ids.eastWorkshop },
      data: {
        startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 25 * 60 * 60 * 1000),
      },
    });
    const body = {
      studentId: ids.eastStudentA,
      lessonSessionId: ids.eastWorkshop,
      reason: 'Family schedule conflict',
    };
    const first = await parentPost('/parents/me/leave-requests')
      .set('Idempotency-Key', 'parent-leave-cross-0001')
      .send(body)
      .expect(200);
    const replay = await parentPost('/parents/me/leave-requests')
      .set('Idempotency-Key', 'parent-leave-cross-0001')
      .send(body)
      .expect(200);
    expect((replay.body as Envelope<Record<string, unknown>>).data).toEqual(
      (first.body as Envelope<Record<string, unknown>>).data,
    );

    await parentPost('/parents/me/leave-requests')
      .set('Idempotency-Key', 'parent-leave-cross-0002')
      .send({ ...body, studentId: ids.westStudentA })
      .expect(403);
  });
});

async function resetCrossClientFixtures(prisma: PrismaClient): Promise<void> {
  const lessonSessionIds = [ids.eastScheduled, ids.eastWorkshop];
  await prisma.parentLeaveRequest.deleteMany({
    where: { parentUserId: ids.eastParentUser },
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { resourceId: { in: lessonSessionIds } },
        { action: { startsWith: 'PARENT_' } },
      ],
    },
  });
  await prisma.idempotencyRecord.deleteMany({
    where: {
      OR: [
        { route: { contains: ids.eastScheduled } },
        { route: { contains: ids.eastWorkshop } },
        { route: { startsWith: '/parents/me/' } },
        { key: 'bind-dual-role-parent-01' },
      ],
    },
  });
  await prisma.studentFeedbackImage.deleteMany({
    where: { feedback: { lessonSessionId: { in: lessonSessionIds } } },
  });
  await prisma.studentFeedback.deleteMany({
    where: { lessonSessionId: { in: lessonSessionIds } },
  });
  await prisma.lessonLedgerEntry.deleteMany({
    where: {
      lessonSessionId: { in: lessonSessionIds },
      reversalOfId: { not: null },
    },
  });
  await prisma.lessonLedgerEntry.deleteMany({
    where: { lessonSessionId: { in: lessonSessionIds } },
  });
  await prisma.withdrawalAllocation.deleteMany({
    where: {
      earningEntry: {
        earningBasis: { lessonSessionId: { in: lessonSessionIds } },
      },
    },
  });
  await prisma.teacherEarningEntry.deleteMany({
    where: {
      earningBasis: { lessonSessionId: { in: lessonSessionIds } },
      reversalOfId: { not: null },
    },
  });
  await prisma.teacherEarningEntry.deleteMany({
    where: {
      earningBasis: { lessonSessionId: { in: lessonSessionIds } },
    },
  });
  await prisma.teacherEarningBasis.deleteMany({
    where: { lessonSessionId: { in: lessonSessionIds } },
  });
  await prisma.partnerEarningEntry.deleteMany({
    where: {
      earningBasis: { lessonSessionId: { in: lessonSessionIds } },
    },
  });
  await prisma.partnerEarningBasis.deleteMany({
    where: { lessonSessionId: { in: lessonSessionIds } },
  });
  await prisma.teachingRecord.deleteMany({
    where: { lessonSessionId: { in: lessonSessionIds } },
  });
  await prisma.attendanceRecord.deleteMany({
    where: { lessonSessionId: { in: lessonSessionIds } },
  });
  await prisma.authIdentity.deleteMany({
    where: { userId: { in: [ids.eastTeacherUser, ids.eastParentUser] } },
  });
  await prisma.staffBindToken.deleteMany({
    where: { userId: ids.eastTeacherUser },
  });
  await seedTeacherCore(prisma);
}

function onePixelPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
}
