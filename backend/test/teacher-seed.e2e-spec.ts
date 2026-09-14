import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { seedTeacherCore } from '../prisma/seed';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';

if (!new URL(TEST_DATABASE_URL).pathname.includes('education_app_test')) {
  throw new Error('Teacher seed tests must use education_app_test');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
});

async function readStableCounts() {
  return {
    campuses: await prisma.campus.count(),
    teacherProfiles: await prisma.teacherProfile.count(),
    teacherRoles: await prisma.userRole.count({
      where: { roleCode: 'TEACHER' },
    }),
    lessonSessions: await prisma.lessonSession.count(),
    coursePackages: await prisma.coursePackage.count(),
  };
}

describe('teacher core seed', () => {
  afterAll(async () => prisma.$disconnect());

  it('is repeatable and keeps teachers isolated by campus', async () => {
    await seedTeacherCore(prisma);
    const firstCounts = await readStableCounts();

    await seedTeacherCore(prisma);
    const secondCounts = await readStableCounts();

    expect(firstCounts).toEqual({
      campuses: 2,
      teacherProfiles: 2,
      teacherRoles: 2,
      lessonSessions: expect.any(Number) as unknown,
      coursePackages: expect.any(Number) as unknown,
    });
    expect(firstCounts.lessonSessions).toBeGreaterThanOrEqual(3);
    expect(firstCounts.coursePackages).toBeGreaterThanOrEqual(4);
    expect(secondCounts).toEqual(firstCounts);

    await expect(
      prisma.authIdentity.findUnique({
        where: {
          provider_subject: {
            provider: 'MOCK',
            subject: 'mock-demo-east-teacher',
          },
        },
        select: { userId: true },
      }),
    ).resolves.toEqual({
      userId: '20000000-0000-4000-8000-000000000001',
    });

    await expect(
      prisma.authIdentity.findUnique({
        where: {
          provider_subject: {
            provider: 'MOCK',
            subject: 'mock-demo-east-parent',
          },
        },
        select: { userId: true },
      }),
    ).resolves.toEqual({
      userId: '20000000-0000-4000-8000-000000000003',
    });

    await expect(
      prisma.userRole.findMany({
        where: {
          userId: {
            in: [
              '20000000-0000-4000-8000-000000000001',
              '20000000-0000-4000-8000-000000000003',
            ],
          },
        },
        orderBy: { roleCode: 'asc' },
        select: { userId: true, roleCode: true },
      }),
    ).resolves.toEqual([
      {
        userId: '20000000-0000-4000-8000-000000000003',
        roleCode: 'PARENT',
      },
      {
        userId: '20000000-0000-4000-8000-000000000001',
        roleCode: 'TEACHER',
      },
    ]);

    const teachers = await prisma.teacherProfile.findMany({
      orderBy: { employeeCode: 'asc' },
      select: {
        id: true,
        employeeCode: true,
        campus: { select: { code: true } },
      },
    });

    expect(teachers).toEqual([
      {
        id: '30000000-0000-4000-8000-000000000001',
        employeeCode: 'teacher-demo-east',
        campus: { code: 'campus-demo-east' },
      },
      {
        id: '30000000-0000-4000-8000-000000000002',
        employeeCode: 'teacher-demo-west',
        campus: { code: 'campus-demo-west' },
      },
    ]);

    await expect(
      prisma.user.findMany({
        where: {
          id: {
            in: [
              '20000000-0000-4000-8000-000000000001',
              '20000000-0000-4000-8000-000000000002',
              '20000000-0000-4000-8000-000000000003',
            ],
          },
        },
        orderBy: { id: 'asc' },
        select: { displayName: true },
      }),
    ).resolves.toEqual([
      { displayName: '林老师' },
      { displayName: '周老师' },
      { displayName: '陈家长' },
    ]);
  });

  it('provides one scheduled east-campus lesson on the demo day', async () => {
    await seedTeacherCore(prisma);

    await expect(
      prisma.lessonSession.findUniqueOrThrow({
        where: { id: '70000000-0000-4000-8000-000000000002' },
        select: {
          startsAt: true,
          endsAt: true,
          status: true,
          classGroup: { select: { name: true, courseName: true } },
        },
      }),
    ).resolves.toEqual({
      startsAt: new Date('2026-08-30T14:00:00+08:00'),
      endsAt: new Date('2026-08-30T15:30:00+08:00'),
      status: 'SCHEDULED',
      classGroup: {
        name: '创意基础A班',
        courseName: '创意基础',
      },
    });
  });

  it('uses the configurable three-yuan per-present-attendee demo rule', async () => {
    await seedTeacherCore(prisma);

    await expect(
      prisma.teacherEarningRule.findFirstOrThrow({
        where: {
          scopeKey: 'campus:10000000-0000-4000-8000-000000000001:default',
          status: 'ACTIVE',
        },
        select: {
          basisType: true,
          unitAmountFen: true,
          countedAttendanceStatuses: true,
        },
      }),
    ).resolves.toEqual({
      basisType: 'PER_PRESENT_ATTENDEE',
      unitAmountFen: 300,
      countedAttendanceStatuses: ['PRESENT'],
    });
  });

  it('does not reactivate the demo rule after a newer version was activated', async () => {
    const scopeKey = 'campus:10000000-0000-4000-8000-000000000001:default';
    const demoRuleId = 'f0000000-0000-4000-8000-000000000002';
    const newerRuleId = 'f0000000-0000-4000-8000-000000000099';
    const newerEffectiveFrom = new Date('2026-09-02T00:00:00+08:00');

    await seedTeacherCore(prisma);
    await prisma.teacherEarningRule.update({
      where: { id: demoRuleId },
      data: { status: 'RETIRED', effectiveTo: newerEffectiveFrom },
    });
    await prisma.teacherEarningRule.upsert({
      where: { id: newerRuleId },
      update: {
        status: 'ACTIVE',
        effectiveTo: null,
      },
      create: {
        id: newerRuleId,
        campusId: '10000000-0000-4000-8000-000000000001',
        teacherProfileId: null,
        scopeKey,
        basisType: 'PER_PRESENT_ATTENDEE',
        unitAmountFen: 400,
        eligibleLessonKinds: ['REGULAR', 'MAKEUP'],
        countedAttendanceStatuses: ['PRESENT'],
        settlementDelayDays: 0,
        version: 99,
        status: 'ACTIVE',
        effectiveFrom: newerEffectiveFrom,
        effectiveTo: null,
        createdByUserId: '20000000-0000-4000-8000-000000000004',
      },
    });

    try {
      await seedTeacherCore(prisma);

      await expect(
        prisma.teacherEarningRule.findMany({
          where: { scopeKey, status: 'ACTIVE' },
          orderBy: { version: 'asc' },
          select: { id: true, version: true },
        }),
      ).resolves.toEqual([{ id: newerRuleId, version: 99 }]);
      await expect(
        prisma.teacherEarningRule.findUniqueOrThrow({
          where: { id: demoRuleId },
          select: { status: true, effectiveTo: true },
        }),
      ).resolves.toEqual({
        status: 'RETIRED',
        effectiveTo: newerEffectiveFrom,
      });
    } finally {
      await prisma.teacherEarningRule.deleteMany({
        where: { id: newerRuleId },
      });
      await prisma.teacherEarningRule.update({
        where: { id: demoRuleId },
        data: { status: 'ACTIVE', effectiveTo: null },
      });
    }
  });

  it('resets mutable demo lesson records before restoring scheduled fixtures', async () => {
    const lessonSessionId = '70000000-0000-4000-8000-000000000002';
    const completedAt = new Date();
    await seedTeacherCore(prisma);
    await prisma.lessonSession.update({
      where: { id: lessonSessionId },
      data: { status: 'COMPLETED', version: 2, completedAt },
    });
    await prisma.teachingRecord.upsert({
      where: { lessonSessionId },
      update: { status: 'COMPLETED', completedAt },
      create: {
        id: 'd0000000-0000-4000-8000-000000000001',
        campusId: '10000000-0000-4000-8000-000000000001',
        lessonSessionId,
        teacherId: '30000000-0000-4000-8000-000000000001',
        status: 'COMPLETED',
        attendeeCount: 2,
        lessonUnits: 100,
        recordedByUserId: '20000000-0000-4000-8000-000000000001',
        completedAt,
      },
    });

    await seedTeacherCore(prisma);

    await expect(
      prisma.lessonSession.findUniqueOrThrow({
        where: { id: lessonSessionId },
        select: { status: true, version: true },
      }),
    ).resolves.toEqual({ status: 'SCHEDULED', version: 1 });
    await expect(
      prisma.teachingRecord.count({ where: { lessonSessionId } }),
    ).resolves.toBe(0);
  });
});
