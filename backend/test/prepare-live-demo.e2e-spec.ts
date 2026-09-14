import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { prepareLiveDemo } from '../prisma/prepare-live-demo';
import { seedTeacherCore } from '../prisma/seed';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';

if (!new URL(TEST_DATABASE_URL).pathname.includes('education_app_test')) {
  throw new Error('Live demo preparation tests must use education_app_test');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
});

const ids = {
  campus: '10000000-0000-4000-8000-000000000001',
  teacherUser: '20000000-0000-4000-8000-000000000001',
  teacher: '30000000-0000-4000-8000-000000000001',
  student: '40000000-0000-4000-8000-000000000001',
  package: '80000000-0000-4000-8000-000000000001',
  historicalLesson: '70000000-0000-4000-8000-000000000001',
  leaveLesson: '70000000-0000-4000-8000-000000000002',
  liveLesson: '70000000-0000-4000-8000-000000000003',
  withdrawalPolicy: 'f1000000-0000-4000-8000-000000000001',
  seedEarningEntry: 'f3000000-0000-4000-8000-000000000001',
  previousTeachingRecord: 'a9000000-0000-4000-8000-000000000001',
  previousWithdrawal: 'a9000000-0000-4000-8000-000000000002',
  previousAllocation: 'a9000000-0000-4000-8000-000000000003',
} as const;

const preparedAt = new Date('2026-09-06T08:30:00.000Z');

describe('live cross-role demo preparation', () => {
  beforeAll(async () => {
    await prisma.withdrawalAllocation.deleteMany({
      where: { withdrawalId: ids.previousWithdrawal },
    });
    await prisma.withdrawal.deleteMany({
      where: { id: ids.previousWithdrawal },
    });
    await seedTeacherCore(prisma);
  });

  afterAll(async () => {
    await prisma.withdrawalAllocation.deleteMany({
      where: { withdrawalId: ids.previousWithdrawal },
    });
    await prisma.withdrawal.deleteMany({
      where: { id: ids.previousWithdrawal },
    });
    await seedTeacherCore(prisma);
    await prisma.$disconnect();
  });

  it('clears prior seeded teaching and earnings while restoring eleven lesson units', async () => {
    await prisma.lessonSession.update({
      where: { id: ids.leaveLesson },
      data: {
        status: 'COMPLETED',
        version: 2,
        completedAt: preparedAt,
      },
    });
    await prisma.teachingRecord.create({
      data: {
        id: ids.previousTeachingRecord,
        campusId: ids.campus,
        lessonSessionId: ids.leaveLesson,
        teacherId: ids.teacher,
        status: 'COMPLETED',
        attendeeCount: 1,
        lessonUnits: 100,
        recordedByUserId: ids.teacherUser,
        completedAt: preparedAt,
      },
    });
    await prisma.withdrawal.create({
      data: {
        id: ids.previousWithdrawal,
        requestNo: 'TW-LIVE-DEMO-OLD',
        campusId: ids.campus,
        teacherProfileId: ids.teacher,
        requestedByUserId: ids.teacherUser,
        policyId: ids.withdrawalPolicy,
        amountFen: 10000,
        status: 'SUBMITTED',
        policySnapshot: { source: 'live-demo-test' },
        version: 1,
      },
    });
    await prisma.withdrawalAllocation.create({
      data: {
        id: ids.previousAllocation,
        withdrawalId: ids.previousWithdrawal,
        earningEntryId: ids.seedEarningEntry,
        amountFen: 10000,
      },
    });

    await prepareLiveDemo(prisma, preparedAt);

    await expect(
      prisma.coursePackage.findUniqueOrThrow({
        where: { id: ids.package },
        select: {
          mainBalanceUnits: true,
          giftBalanceUnits: true,
          version: true,
        },
      }),
    ).resolves.toEqual({
      mainBalanceUnits: 900,
      giftBalanceUnits: 200,
      version: 1,
    });
    await expect(
      prisma.lessonSession.findUnique({
        where: { id: ids.historicalLesson },
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.lessonSession.findMany({
        where: { id: { in: [ids.liveLesson, ids.leaveLesson] } },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          status: true,
          startsAt: true,
          completedAt: true,
          version: true,
        },
      }),
    ).resolves.toEqual([
      {
        id: ids.leaveLesson,
        status: 'SCHEDULED',
        startsAt: new Date('2026-09-07T08:30:00.000Z'),
        completedAt: null,
        version: 1,
      },
      {
        id: ids.liveLesson,
        status: 'SCHEDULED',
        startsAt: new Date('2026-09-06T08:15:00.000Z'),
        completedAt: null,
        version: 1,
      },
    ]);

    const lessonSessionIds = [
      ids.historicalLesson,
      ids.leaveLesson,
      ids.liveLesson,
    ];
    await expect(
      Promise.all([
        prisma.attendanceRecord.count({
          where: { lessonSessionId: { in: lessonSessionIds } },
        }),
        prisma.teachingRecord.count({
          where: { lessonSessionId: { in: lessonSessionIds } },
        }),
        prisma.studentFeedback.count({
          where: { lessonSessionId: { in: lessonSessionIds } },
        }),
        prisma.lessonLedgerEntry.count({
          where: { lessonSessionId: { in: lessonSessionIds } },
        }),
        prisma.teacherEarningEntry.count({
          where: {
            earningBasis: { lessonSessionId: { in: lessonSessionIds } },
          },
        }),
        prisma.partnerEarningEntry.count({
          where: {
            earningBasis: { lessonSessionId: { in: lessonSessionIds } },
          },
        }),
        prisma.parentLeaveRequest.count({
          where: { lessonSessionId: { in: lessonSessionIds } },
        }),
      ]),
    ).resolves.toEqual([0, 0, 0, 0, 0, 0, 1]);
    await expect(
      prisma.parentLeaveRequest.findUnique({
        where: {
          parentUserId_studentId_lessonSessionId: {
            parentUserId: '20000000-0000-4000-8000-000000000003',
            studentId: ids.student,
            lessonSessionId: ids.leaveLesson,
          },
        },
        select: { status: true, reason: true, version: true },
      }),
    ).resolves.toEqual({
      status: 'PENDING',
      reason: '参加学校活动，请审批本次请假。',
      version: 1,
    });
    await expect(
      prisma.withdrawal.findUnique({
        where: { id: ids.previousWithdrawal },
      }),
    ).resolves.toBeNull();
  });
});
