import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { seedTeacherCore } from '../prisma/seed';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { StaffBindTokenService } from '../src/modules/auth/staff-bind-token.service';

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
  eastTeacher: '30000000-0000-4000-8000-000000000001',
  eastStudentA: '40000000-0000-4000-8000-000000000001',
  eastStudentB: '40000000-0000-4000-8000-000000000002',
  westStudentA: '40000000-0000-4000-8000-000000000003',
  eastScheduled: '70000000-0000-4000-8000-000000000002',
  eastWorkshop: '70000000-0000-4000-8000-000000000003',
  eastNoRule: '70000000-0000-4000-8000-000000000005',
  eastPackageA: '80000000-0000-4000-8000-000000000001',
  eastPackageB: '80000000-0000-4000-8000-000000000002',
} as const;

interface Envelope<T> {
  data: T;
  requestId: string;
}

interface CompletionResult {
  lessonSessionId: string;
  lessonVersion: number;
  status: 'COMPLETED' | 'REVERSED';
  teachingRecordId: string;
  consumed: Array<{
    studentId: string;
    mainUnits: number;
    giftUnits: number;
  }>;
}

const scheduledAttendance = [
  { studentId: ids.eastStudentA, status: 'PRESENT' },
  { studentId: ids.eastStudentB, status: 'LEAVE' },
] as const;

describe('teacher attendance, completion, reversal, and feedback', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaClient;
  let accessToken: string;
  let completionResult: CompletionResult;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await resetWriteFixtures(prisma);

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
      rawToken: 'teacher-attendance-bind-token-01',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const bindResponse = await request(httpServer)
      .post('/auth/staff/bind')
      .set('Idempotency-Key', 'bind-teacher-attendance-01')
      .send({
        code: 'mock-teacher-attendance-code',
        bindToken: 'teacher-attendance-bind-token-01',
      })
      .expect(200);
    accessToken = (bindResponse.body as Envelope<{ accessToken: string }>).data
      .accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      await resetWriteFixtures(prisma);
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  const put = (path: string) =>
    request(httpServer).put(path).set('Authorization', `Bearer ${accessToken}`);
  const post = (path: string) =>
    request(httpServer)
      .post(path)
      .set('Authorization', `Bearer ${accessToken}`);

  it('reads the assigned scheduled lesson', async () => {
    const response = await request(httpServer)
      .get(`/teachers/me/lesson-sessions/${ids.eastScheduled}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          id: ids.eastScheduled,
          version: 1,
          status: 'SCHEDULED',
          students: expect.arrayContaining([
            expect.objectContaining({ id: ids.eastStudentA }),
            expect.objectContaining({ id: ids.eastStudentB }),
          ]) as unknown,
        }) as unknown,
      }) as unknown,
    );
  });

  it('rejects foreign, incomplete, and stale attendance without partial rows', async () => {
    await put(`/teachers/me/lesson-sessions/${ids.eastScheduled}/attendance`)
      .set('Idempotency-Key', 'attendance-foreign-0001')
      .send({
        lessonVersion: 1,
        attendance: [
          { studentId: ids.eastStudentA, status: 'PRESENT' },
          { studentId: ids.westStudentA, status: 'ABSENT' },
        ],
      })
      .expect(403);

    await put(`/teachers/me/lesson-sessions/${ids.eastScheduled}/attendance`)
      .set('Idempotency-Key', 'attendance-incomplete-01')
      .send({
        lessonVersion: 1,
        attendance: [{ studentId: ids.eastStudentA, status: 'PRESENT' }],
      })
      .expect(400);

    await put(`/teachers/me/lesson-sessions/${ids.eastScheduled}/attendance`)
      .set('Idempotency-Key', 'attendance-stale-00001')
      .send({ lessonVersion: 99, attendance: scheduledAttendance })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            code: 'LESSON_VERSION_CONFLICT',
          }) as unknown,
        );
      });

    await expect(
      prisma.attendanceRecord.count({
        where: { lessonSessionId: ids.eastScheduled },
      }),
    ).resolves.toBe(0);
  });

  it('saves a complete attendance snapshot', async () => {
    const response = await put(
      `/teachers/me/lesson-sessions/${ids.eastScheduled}/attendance`,
    )
      .set('Idempotency-Key', 'attendance-save-000001')
      .send({ lessonVersion: 1, attendance: scheduledAttendance })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          id: ids.eastScheduled,
          version: 1,
          students: expect.arrayContaining([
            expect.objectContaining({
              id: ids.eastStudentA,
              attendanceStatus: 'PRESENT',
            }),
            expect.objectContaining({
              id: ids.eastStudentB,
              attendanceStatus: 'LEAVE',
            }),
          ]) as unknown,
        }) as unknown,
      }) as unknown,
    );
  });

  it('completes once, consumes configured rows, and writes immutable records', async () => {
    const response = await post(
      `/teachers/me/lesson-sessions/${ids.eastScheduled}/complete`,
    )
      .set('Idempotency-Key', 'complete-east-scheduled-01')
      .send({ lessonVersion: 1, attendance: scheduledAttendance })
      .expect(200);
    completionResult = (response.body as Envelope<CompletionResult>).data;

    expect(completionResult).toEqual({
      lessonSessionId: ids.eastScheduled,
      lessonVersion: 2,
      status: 'COMPLETED',
      teachingRecordId: expect.any(String) as unknown,
      consumed: [
        { studentId: ids.eastStudentA, mainUnits: 100, giftUnits: 0 },
        { studentId: ids.eastStudentB, mainUnits: 0, giftUnits: 0 },
      ],
    });

    const [lesson, packages, ledger, teachingRecords] = await Promise.all([
      prisma.lessonSession.findUniqueOrThrow({
        where: { id: ids.eastScheduled },
      }),
      prisma.coursePackage.findMany({
        where: { id: { in: [ids.eastPackageA, ids.eastPackageB] } },
        orderBy: { id: 'asc' },
      }),
      prisma.lessonLedgerEntry.findMany({
        where: { lessonSessionId: ids.eastScheduled },
      }),
      prisma.teachingRecord.findMany({
        where: { lessonSessionId: ids.eastScheduled },
      }),
    ]);
    expect(lesson).toMatchObject({ status: 'COMPLETED', version: 2 });
    expect(packages.map(({ mainBalanceUnits }) => mainBalanceUnits)).toEqual([
      800, 700,
    ]);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      studentId: ids.eastStudentA,
      entryType: 'CONSUME',
      bucket: 'MAIN',
      deltaUnits: -100,
      balanceBeforeUnits: 900,
      balanceAfterUnits: 800,
    });
    expect(teachingRecords).toHaveLength(1);
    await expect(
      prisma.teacherEarningBasis.findUnique({
        where: { teachingRecordId: completionResult.teachingRecordId },
        select: {
          status: true,
          selectedRuleId: true,
          lessonUnits: true,
          attendeeCount: true,
          entries: {
            select: { entryType: true, amountFen: true, status: true },
          },
        },
      }),
    ).resolves.toEqual({
      status: 'PRICED',
      selectedRuleId: 'f0000000-0000-4000-8000-000000000002',
      lessonUnits: 100,
      attendeeCount: 1,
      entries: [
        {
          entryType: 'ACCRUAL',
          amountFen: 300,
          status: 'PENDING_REVIEW',
        },
      ],
    });
  });

  it('replays the original completion and rejects a different key', async () => {
    const replay = await post(
      `/teachers/me/lesson-sessions/${ids.eastScheduled}/complete`,
    )
      .set('Idempotency-Key', 'complete-east-scheduled-01')
      .send({ lessonVersion: 1, attendance: scheduledAttendance })
      .expect(200);
    expect((replay.body as Envelope<CompletionResult>).data).toEqual(
      completionResult,
    );

    await post(`/teachers/me/lesson-sessions/${ids.eastScheduled}/complete`)
      .set('Idempotency-Key', 'complete-east-scheduled-02')
      .send({ lessonVersion: 1, attendance: scheduledAttendance })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            code: 'LESSON_ALREADY_COMPLETED',
          }) as unknown,
        );
      });

    await expect(
      prisma.lessonLedgerEntry.count({
        where: { lessonSessionId: ids.eastScheduled },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.teacherEarningBasis.count({
        where: { lessonSessionId: ids.eastScheduled },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.teacherEarningEntry.count({
        where: { earningBasis: { lessonSessionId: ids.eastScheduled } },
      }),
    ).resolves.toBe(1);
  });

  it('writes scoped per-student feedback', async () => {
    const response = await put(
      `/teachers/me/lesson-sessions/${ids.eastScheduled}/students/${ids.eastStudentA}/feedback`,
    )
      .set('Idempotency-Key', 'feedback-east-scheduled-1')
      .send({
        content: '  Focused and completed the activity.  ',
        imageFileIds: [],
      })
      .expect(200);

    expect(response.body).toEqual({
      data: {
        lessonSessionId: ids.eastScheduled,
        studentId: ids.eastStudentA,
        content: 'Focused and completed the activity.',
        images: [],
        updatedAt: expect.any(String) as unknown,
      },
      requestId: expect.any(String) as unknown,
    });
  });

  it('reverses by adding opposite ledger entries and retaining originals', async () => {
    const response = await post(
      `/teachers/me/lesson-sessions/${ids.eastScheduled}/reverse`,
    )
      .set('Idempotency-Key', 'reverse-east-scheduled-01')
      .send({ lessonVersion: 2, reason: 'Attendance correction' })
      .expect(200);
    const result = (response.body as Envelope<CompletionResult>).data;

    expect(result).toEqual({
      ...completionResult,
      lessonVersion: 3,
      status: 'REVERSED',
    });
    const [lesson, coursePackage, ledger, teachingRecord] = await Promise.all([
      prisma.lessonSession.findUniqueOrThrow({
        where: { id: ids.eastScheduled },
      }),
      prisma.coursePackage.findUniqueOrThrow({
        where: { id: ids.eastPackageA },
      }),
      prisma.lessonLedgerEntry.findMany({
        where: { lessonSessionId: ids.eastScheduled },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.teachingRecord.findUniqueOrThrow({
        where: { lessonSessionId: ids.eastScheduled },
      }),
    ]);
    expect(lesson).toMatchObject({ status: 'REVERSED', version: 3 });
    expect(coursePackage.mainBalanceUnits).toBe(900);
    expect(ledger).toHaveLength(2);
    expect(ledger[0]).toMatchObject({ entryType: 'CONSUME', deltaUnits: -100 });
    expect(ledger[1]).toMatchObject({
      entryType: 'REVERSAL',
      deltaUnits: 100,
      reversalOfId: ledger[0].id,
    });
    expect(teachingRecord.status).toBe('REVERSED');
    const earningBasis = await prisma.teacherEarningBasis.findUniqueOrThrow({
      where: { teachingRecordId: teachingRecord.id },
      select: {
        status: true,
        entries: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            entryType: true,
            amountFen: true,
            status: true,
            reversalOfId: true,
          },
        },
      },
    });
    expect(earningBasis.status).toBe('REVERSED');
    expect(earningBasis.entries).toHaveLength(2);
    expect(earningBasis.entries[0]).toMatchObject({
      entryType: 'ACCRUAL',
      amountFen: 300,
      status: 'REVERSED',
    });
    expect(earningBasis.entries[1]).toMatchObject({
      entryType: 'REVERSAL',
      amountFen: -300,
      status: 'REVERSED',
      reversalOfId: earningBasis.entries[0].id,
    });
  });

  it('completes normally and records an unpriced basis when no rule is active', async () => {
    await prisma.lessonSession.upsert({
      where: { id: ids.eastNoRule },
      update: {
        status: 'SCHEDULED',
        version: 1,
        completedAt: null,
        reversedAt: null,
        reversalReason: null,
      },
      create: {
        id: ids.eastNoRule,
        campusId: ids.eastCampus,
        classGroupId: '50000000-0000-4000-8000-000000000002',
        teacherId: ids.eastTeacher,
        startsAt: new Date('2026-09-03T14:00:00+08:00'),
        endsAt: new Date('2026-09-03T15:30:00+08:00'),
        status: 'SCHEDULED',
        kind: 'REGULAR',
        lessonUnits: 100,
        version: 1,
      },
    });
    await prisma.teacherEarningRule.update({
      where: { id: 'f0000000-0000-4000-8000-000000000002' },
      data: { status: 'RETIRED' },
    });

    try {
      await post(`/teachers/me/lesson-sessions/${ids.eastNoRule}/complete`)
        .set('Idempotency-Key', 'complete-without-rule-001')
        .send({
          lessonVersion: 1,
          attendance: [{ studentId: ids.eastStudentA, status: 'PRESENT' }],
        })
        .expect(200);
    } finally {
      await prisma.teacherEarningRule.update({
        where: { id: 'f0000000-0000-4000-8000-000000000002' },
        data: { status: 'ACTIVE' },
      });
    }

    await expect(
      prisma.teacherEarningBasis.findFirst({
        where: { lessonSessionId: ids.eastNoRule },
        select: { status: true, selectedRuleId: true, entries: true },
      }),
    ).resolves.toEqual({
      status: 'UNPRICED',
      selectedRuleId: null,
      entries: [],
    });
  });

  it('rolls back an insufficient-balance completion without partial rows', async () => {
    await prisma.coursePackage.updateMany({
      where: { studentId: ids.eastStudentA },
      data: {
        mainBalanceUnits: 0,
        giftBalanceUnits: 0,
        version: { increment: 1 },
      },
    });

    await post(`/teachers/me/lesson-sessions/${ids.eastWorkshop}/complete`)
      .set('Idempotency-Key', 'complete-insufficient-001')
      .send({
        lessonVersion: 1,
        attendance: [{ studentId: ids.eastStudentA, status: 'PRESENT' }],
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            code: 'INSUFFICIENT_LESSON_BALANCE',
          }) as unknown,
        );
      });

    const [lesson, attendanceCount, ledgerCount, teachingCount] =
      await Promise.all([
        prisma.lessonSession.findUniqueOrThrow({
          where: { id: ids.eastWorkshop },
        }),
        prisma.attendanceRecord.count({
          where: { lessonSessionId: ids.eastWorkshop },
        }),
        prisma.lessonLedgerEntry.count({
          where: { lessonSessionId: ids.eastWorkshop },
        }),
        prisma.teachingRecord.count({
          where: { lessonSessionId: ids.eastWorkshop },
        }),
      ]);
    expect(lesson).toMatchObject({ status: 'SCHEDULED', version: 1 });
    expect({ attendanceCount, ledgerCount, teachingCount }).toEqual({
      attendanceCount: 0,
      ledgerCount: 0,
      teachingCount: 0,
    });
  });
});

async function resetWriteFixtures(prisma: PrismaClient): Promise<void> {
  const lessonSessionIds = [
    ids.eastScheduled,
    ids.eastWorkshop,
    ids.eastNoRule,
  ];
  await prisma.auditLog.deleteMany({
    where: { resourceId: { in: lessonSessionIds } },
  });
  await prisma.idempotencyRecord.deleteMany({
    where: {
      OR: [
        { route: { contains: ids.eastScheduled } },
        { route: { contains: ids.eastWorkshop } },
        { route: { contains: ids.eastNoRule } },
        { key: 'bind-teacher-attendance-01' },
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
  await prisma.teacherEarningEntry.deleteMany({
    where: { earningBasis: { lessonSessionId: { in: lessonSessionIds } } },
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
  await seedTeacherCore(prisma);
  await prisma.lessonSession.deleteMany({ where: { id: ids.eastNoRule } });
  await prisma.authIdentity.deleteMany({
    where: { userId: ids.eastTeacherUser },
  });
  await prisma.staffBindToken.deleteMany({
    where: { userId: ids.eastTeacherUser },
  });
}
