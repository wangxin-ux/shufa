import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const DEMO = {
  campusId: '10000000-0000-4000-8000-000000000001',
  teacherUserId: '20000000-0000-4000-8000-000000000001',
  parentUserId: '20000000-0000-4000-8000-000000000003',
  studentId: '40000000-0000-4000-8000-000000000001',
  coursePackageId: '80000000-0000-4000-8000-000000000001',
  historicalLessonSessionId: '70000000-0000-4000-8000-000000000001',
  liveLessonSessionId: '70000000-0000-4000-8000-000000000003',
  leaveLessonSessionId: '70000000-0000-4000-8000-000000000002',
  leaveRequestId: 'e1000000-0000-4000-8000-000000000001',
} as const;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function assertLocalDevelopmentDatabase(connectionString: string): void {
  const url = new URL(connectionString);
  const allowedHosts = new Set(['127.0.0.1', 'localhost', 'postgres']);
  if (
    process.env.NODE_ENV === 'production' ||
    !allowedHosts.has(url.hostname) ||
    url.pathname !== '/education_app'
  ) {
    throw new Error(
      'Live demo preparation is restricted to the local education_app development database',
    );
  }
}

export async function prepareLiveDemo(
  prisma: PrismaClient,
  now = new Date(),
): Promise<void> {
  const lessonSessionIds = [
    DEMO.historicalLessonSessionId,
    DEMO.liveLessonSessionId,
    DEMO.leaveLessonSessionId,
  ];
  const [student, coursePackage, lessons] = await Promise.all([
    prisma.student.findUnique({
      where: { id: DEMO.studentId },
      select: { displayName: true },
    }),
    prisma.coursePackage.findUnique({
      where: { id: DEMO.coursePackageId },
      select: { name: true },
    }),
    prisma.lessonSession.findMany({
      where: { id: { in: lessonSessionIds } },
      select: { id: true },
    }),
  ]);

  if (!student || !coursePackage || lessons.length !== 3) {
    throw new Error(
      'Fixed demo fixtures are missing; run db:seed before preparing the live demo',
    );
  }

  const liveStartsAt = new Date(now.getTime() - 15 * MINUTE_MS);
  const liveEndsAt = new Date(now.getTime() + 75 * MINUTE_MS);
  const leaveStartsAt = new Date(now.getTime() + DAY_MS);
  const leaveEndsAt = new Date(leaveStartsAt.getTime() + 90 * MINUTE_MS);

  const resetResult = await prisma.$transaction(async (transaction) => {
    const leaveRequests = await transaction.parentLeaveRequest.findMany({
      where: { lessonSessionId: { in: lessonSessionIds } },
      select: { id: true },
    });
    const leaveRequestIds = leaveRequests.map(({ id }) => id);
    const allocatedWithdrawals =
      await transaction.withdrawalAllocation.findMany({
        where: {
          earningEntry: {
            earningBasis: { lessonSessionId: { in: lessonSessionIds } },
          },
        },
        select: { withdrawalId: true },
      });
    const withdrawalIds = [
      ...new Set(allocatedWithdrawals.map(({ withdrawalId }) => withdrawalId)),
    ];

    if (withdrawalIds.length > 0) {
      const withdrawalAllocations =
        await transaction.withdrawalAllocation.findMany({
          where: { withdrawalId: { in: withdrawalIds } },
          select: {
            earningEntry: {
              select: {
                earningBasis: { select: { lessonSessionId: true } },
              },
            },
          },
        });
      const resetLessonIds = new Set<string>(lessonSessionIds);
      const includesNonDemoEarning = withdrawalAllocations.some(
        ({ earningEntry }) =>
          !resetLessonIds.has(earningEntry.earningBasis.lessonSessionId),
      );
      if (includesNonDemoEarning) {
        throw new Error(
          'A withdrawal mixes demo and non-demo earnings and cannot be reset safely',
        );
      }

      await transaction.withdrawalAllocation.deleteMany({
        where: { withdrawalId: { in: withdrawalIds } },
      });
      await transaction.withdrawal.deleteMany({
        where: { id: { in: withdrawalIds } },
      });
    }

    await transaction.partnerEarningEntry.deleteMany({
      where: {
        earningBasis: { lessonSessionId: { in: lessonSessionIds } },
      },
    });
    await transaction.partnerEarningBasis.deleteMany({
      where: { lessonSessionId: { in: lessonSessionIds } },
    });
    await transaction.teacherEarningEntry.deleteMany({
      where: {
        earningBasis: { lessonSessionId: { in: lessonSessionIds } },
      },
    });
    await transaction.teacherEarningBasis.deleteMany({
      where: { lessonSessionId: { in: lessonSessionIds } },
    });
    await transaction.parentLeaveRequest.deleteMany({
      where: { lessonSessionId: { in: lessonSessionIds } },
    });
    await transaction.studentFeedbackImage.deleteMany({
      where: { feedback: { lessonSessionId: { in: lessonSessionIds } } },
    });
    await transaction.studentFeedback.deleteMany({
      where: { lessonSessionId: { in: lessonSessionIds } },
    });
    await transaction.lessonLedgerEntry.deleteMany({
      where: {
        lessonSessionId: { in: lessonSessionIds },
        reversalOfId: { not: null },
      },
    });
    await transaction.lessonLedgerEntry.deleteMany({
      where: { lessonSessionId: { in: lessonSessionIds } },
    });
    await transaction.teachingRecord.deleteMany({
      where: { lessonSessionId: { in: lessonSessionIds } },
    });
    await transaction.attendanceRecord.deleteMany({
      where: { lessonSessionId: { in: lessonSessionIds } },
    });
    await transaction.idempotencyRecord.deleteMany({
      where: {
        OR: [
          ...lessonSessionIds.map((lessonSessionId) => ({
            route: {
              startsWith: `/teachers/me/lesson-sessions/${lessonSessionId}/`,
            },
          })),
          {
            actorUserId: DEMO.parentUserId,
            route: '/parents/me/leave-requests',
          },
          {
            actorUserId: DEMO.teacherUserId,
            route: '/teachers/me/withdrawals',
          },
          ...leaveRequestIds.map((leaveRequestId) => ({
            route: {
              startsWith: `/campus-managers/me/leave-requests/${leaveRequestId}/`,
            },
          })),
          ...withdrawalIds.map((withdrawalId) => ({
            route: { contains: `/withdrawals/${withdrawalId}/` },
          })),
        ],
      },
    });
    await transaction.auditLog.deleteMany({
      where: {
        OR: [
          {
            resourceId: {
              in: [...lessonSessionIds, ...leaveRequestIds, ...withdrawalIds],
            },
          },
          ...lessonSessionIds.map((lessonSessionId) => ({
            resourceId: { startsWith: `${lessonSessionId}:` },
          })),
        ],
      },
    });

    await transaction.lessonSession.deleteMany({
      where: { id: DEMO.historicalLessonSessionId },
    });

    await transaction.coursePackage.update({
      where: { id: DEMO.coursePackageId },
      data: {
        mainBalanceUnits: 900,
        giftBalanceUnits: 200,
        version: 1,
        isActive: true,
      },
    });
    await transaction.lessonSession.update({
      where: { id: DEMO.liveLessonSessionId },
      data: {
        startsAt: liveStartsAt,
        endsAt: liveEndsAt,
        status: 'SCHEDULED',
        kind: 'REGULAR',
        lessonUnits: 100,
        version: 1,
        completedAt: null,
        reversedAt: null,
        reversalReason: null,
      },
    });
    await transaction.lessonSession.update({
      where: { id: DEMO.leaveLessonSessionId },
      data: {
        startsAt: leaveStartsAt,
        endsAt: leaveEndsAt,
        status: 'SCHEDULED',
        kind: 'REGULAR',
        lessonUnits: 100,
        version: 1,
        completedAt: null,
        reversedAt: null,
        reversalReason: null,
      },
    });
    await transaction.parentLeaveRequest.create({
      data: {
        id: DEMO.leaveRequestId,
        campusId: DEMO.campusId,
        parentUserId: DEMO.parentUserId,
        studentId: DEMO.studentId,
        lessonSessionId: DEMO.leaveLessonSessionId,
        reason: '参加学校活动，请审批本次请假。',
        status: 'PENDING',
        version: 1,
        createdAt: now,
      },
    });

    const remainingRecordCounts = await Promise.all([
      transaction.attendanceRecord.count({
        where: { lessonSessionId: { in: lessonSessionIds } },
      }),
      transaction.teachingRecord.count({
        where: { lessonSessionId: { in: lessonSessionIds } },
      }),
      transaction.studentFeedback.count({
        where: { lessonSessionId: { in: lessonSessionIds } },
      }),
      transaction.lessonLedgerEntry.count({
        where: { lessonSessionId: { in: lessonSessionIds } },
      }),
      transaction.teacherEarningEntry.count({
        where: {
          earningBasis: { lessonSessionId: { in: lessonSessionIds } },
        },
      }),
      transaction.partnerEarningEntry.count({
        where: {
          earningBasis: { lessonSessionId: { in: lessonSessionIds } },
        },
      }),
      transaction.parentLeaveRequest.count({
        where: { lessonSessionId: { in: lessonSessionIds } },
      }),
    ]);
    if (
      remainingRecordCounts.slice(0, -1).some((count) => count !== 0) ||
      remainingRecordCounts.at(-1) !== 1
    ) {
      throw new Error('Live demo records were not fully cleared');
    }

    return { withdrawalsCleared: withdrawalIds.length };
  });

  const [teacherRule, partnerRule] = await Promise.all([
    prisma.teacherEarningRule.findFirst({
      where: {
        campusId: DEMO.campusId,
        status: 'ACTIVE',
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: [{ teacherProfileId: 'desc' }, { version: 'desc' }],
      select: {
        basisType: true,
        unitAmountFen: true,
        settlementDelayDays: true,
        version: true,
      },
    }),
    prisma.partnerEarningRule.findFirst({
      where: {
        campusId: DEMO.campusId,
        status: 'ACTIVE',
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: { version: 'desc' },
      select: {
        unitPriceFen: true,
        shareBasisPoints: true,
        settlementDelayDays: true,
        version: true,
      },
    }),
  ]);

  if (!teacherRule || !partnerRule) {
    throw new Error('Active teacher or partner earning rule is missing');
  }
  if (
    teacherRule.settlementDelayDays !== 0 ||
    partnerRule.settlementDelayDays !== 0
  ) {
    throw new Error('Live demo earning rules must use a zero-day review delay');
  }

  console.log(
    JSON.stringify(
      {
        preparedAt: now.toISOString(),
        student: student.displayName,
        initialLessonUnits: {
          total: 1100,
          main: 900,
          gift: 200,
        },
        clearedHistory: {
          lessonSessions: 1,
          withdrawals: resetResult.withdrawalsCleared,
          teachingAndFinancialRecords: 0,
        },
        liveLesson: {
          id: DEMO.liveLessonSessionId,
          startsAt: liveStartsAt.toISOString(),
          endsAt: liveEndsAt.toISOString(),
          status: 'SCHEDULED',
          expectedDeductionUnits: 100,
        },
        leaveLesson: {
          id: DEMO.leaveLessonSessionId,
          startsAt: leaveStartsAt.toISOString(),
          endsAt: leaveEndsAt.toISOString(),
          status: 'SCHEDULED',
          pendingRequestId: DEMO.leaveRequestId,
        },
        teacherRule,
        partnerRule,
      },
      null,
      2,
    ),
  );
}

async function run(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }
  assertLocalDevelopmentDatabase(connectionString);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    await prepareLiveDemo(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
