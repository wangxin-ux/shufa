import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const ids = {
  campuses: {
    east: '10000000-0000-4000-8000-000000000001',
    west: '10000000-0000-4000-8000-000000000002',
  },
  users: {
    eastTeacher: '20000000-0000-4000-8000-000000000001',
    westTeacher: '20000000-0000-4000-8000-000000000002',
    eastParent: '20000000-0000-4000-8000-000000000003',
    superAdmin: '20000000-0000-4000-8000-000000000004',
    eastCampusManager: '20000000-0000-4000-8000-000000000005',
    eastPartner: '20000000-0000-4000-8000-000000000006',
    westParent: '20000000-0000-4000-8000-000000000007',
    westCampusManager: '20000000-0000-4000-8000-000000000008',
    westPartner: '20000000-0000-4000-8000-000000000009',
  },
  authIdentities: {
    eastTeacher: '21000000-0000-4000-8000-000000000001',
    eastParent: '21000000-0000-4000-8000-000000000002',
    superAdmin: '21000000-0000-4000-8000-000000000003',
    eastCampusManager: '21000000-0000-4000-8000-000000000004',
    eastPartner: '21000000-0000-4000-8000-000000000005',
    westParent: '21000000-0000-4000-8000-000000000006',
    westTeacher: '21000000-0000-4000-8000-000000000007',
    westCampusManager: '21000000-0000-4000-8000-000000000008',
    westPartner: '21000000-0000-4000-8000-000000000009',
  },
  teachers: {
    east: '30000000-0000-4000-8000-000000000001',
    west: '30000000-0000-4000-8000-000000000002',
  },
  students: {
    eastA: '40000000-0000-4000-8000-000000000001',
    eastB: '40000000-0000-4000-8000-000000000002',
    westA: '40000000-0000-4000-8000-000000000003',
    westB: '40000000-0000-4000-8000-000000000004',
  },
  classes: {
    eastFoundations: '50000000-0000-4000-8000-000000000001',
    eastWorkshop: '50000000-0000-4000-8000-000000000002',
    westFoundations: '50000000-0000-4000-8000-000000000003',
  },
  members: {
    eastFoundationsA: '60000000-0000-4000-8000-000000000001',
    eastFoundationsB: '60000000-0000-4000-8000-000000000002',
    eastWorkshopA: '60000000-0000-4000-8000-000000000003',
    westFoundationsA: '60000000-0000-4000-8000-000000000004',
    westFoundationsB: '60000000-0000-4000-8000-000000000005',
  },
  sessions: {
    eastCompleted: '70000000-0000-4000-8000-000000000001',
    eastScheduled: '70000000-0000-4000-8000-000000000002',
    eastWorkshop: '70000000-0000-4000-8000-000000000003',
    westScheduled: '70000000-0000-4000-8000-000000000004',
  },
  packages: {
    eastA: '80000000-0000-4000-8000-000000000001',
    eastB: '80000000-0000-4000-8000-000000000002',
    westA: '80000000-0000-4000-8000-000000000003',
    westB: '80000000-0000-4000-8000-000000000004',
  },
  attendance: {
    eastA: '90000000-0000-4000-8000-000000000001',
    eastB: '90000000-0000-4000-8000-000000000002',
  },
  teachingRecord: 'a0000000-0000-4000-8000-000000000001',
  feedback: 'b0000000-0000-4000-8000-000000000001',
  ledger: {
    eastA: 'c0000000-0000-4000-8000-000000000001',
    eastB: 'c0000000-0000-4000-8000-000000000002',
  },
  roles: {
    eastTeacher: 'd0000000-0000-4000-8000-000000000001',
    westTeacher: 'd0000000-0000-4000-8000-000000000002',
    eastParent: 'd0000000-0000-4000-8000-000000000003',
    superAdmin: 'd0000000-0000-4000-8000-000000000004',
    eastCampusManager: 'd0000000-0000-4000-8000-000000000005',
    eastPartner: 'd0000000-0000-4000-8000-000000000006',
    westParent: 'd0000000-0000-4000-8000-000000000007',
    westCampusManager: 'd0000000-0000-4000-8000-000000000008',
    westPartner: 'd0000000-0000-4000-8000-000000000009',
  },
  parentBindings: {
    eastA: 'e0000000-0000-4000-8000-000000000001',
    westA: 'e0000000-0000-4000-8000-000000000002',
  },
  parentLeaveRequests: {
    eastPending: 'e1000000-0000-4000-8000-000000000001',
  },
  earningRules: {
    eastDefault: 'f0000000-0000-4000-8000-000000000001',
    eastPerAttendee: 'f0000000-0000-4000-8000-000000000002',
  },
  withdrawalPolicies: {
    default: 'f1000000-0000-4000-8000-000000000001',
  },
  earningBases: {
    eastCompleted: 'f2000000-0000-4000-8000-000000000001',
  },
  earningEntries: {
    eastCompleted: 'f3000000-0000-4000-8000-000000000001',
  },
  partnerEarningRules: {
    eastDefault: 'f4000000-0000-4000-8000-000000000001',
  },
  partnerEarningBases: {
    eastCompleted: 'f5000000-0000-4000-8000-000000000001',
  },
  partnerEarningEntries: {
    eastCompleted: 'f6000000-0000-4000-8000-000000000001',
  },
  courseProducts: {
    eastActive: 'a1000000-0000-4000-8000-000000000001',
    eastDraft: 'a1000000-0000-4000-8000-000000000002',
  },
  enrollmentOrders: {
    eastAwaitingProof: 'a2000000-0000-4000-8000-000000000001',
  },
  groupCampaigns: {
    eastDemo: 'a3000000-0000-4000-8000-000000000001',
  },
} as const;

const completedAt = new Date('2026-08-28T10:00:00+08:00');

async function resetMutableDemoLessons(prisma: PrismaClient): Promise<void> {
  const lessonSessionIds = [
    ids.sessions.eastScheduled,
    ids.sessions.eastWorkshop,
    ids.sessions.westScheduled,
  ];
  const feedbackResourceIds = lessonSessionIds.map((lessonSessionId) => ({
    resourceId: { startsWith: `${lessonSessionId}:` },
  }));
  const mutationRoutes = lessonSessionIds.map((lessonSessionId) => ({
    route: { startsWith: `/teachers/me/lesson-sessions/${lessonSessionId}/` },
  }));

  await prisma.$transaction(async (transaction) => {
    const allocations = await transaction.withdrawalAllocation.findMany({
      where: {
        earningEntry: {
          earningBasis: { lessonSessionId: { in: lessonSessionIds } },
        },
      },
      select: { withdrawalId: true },
    });
    const withdrawalIds = [
      ...new Set(allocations.map(({ withdrawalId }) => withdrawalId)),
    ];
    if (withdrawalIds.length > 0) {
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
    await transaction.auditLog.deleteMany({
      where: {
        OR: [{ resourceId: { in: lessonSessionIds } }, ...feedbackResourceIds],
      },
    });
    await transaction.idempotencyRecord.deleteMany({
      where: { OR: mutationRoutes },
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
  });
}

export async function seedTeacherCore(prisma: PrismaClient): Promise<void> {
  await resetMutableDemoLessons(prisma);

  await prisma.campus.upsert({
    where: { id: ids.campuses.east },
    update: {
      code: 'campus-demo-east',
      name: '启明东校区',
      timezone: 'Asia/Shanghai',
      contactPhone: '0731-88886666',
      customerServiceName: '启明课程顾问',
      address: '长沙市岳麓区启明路 18 号',
      latitude: 28.2282,
      longitude: 112.9388,
      mapVisible: true,
      lessonWarningThresholdUnits: 800,
      version: 1,
    },
    create: {
      id: ids.campuses.east,
      code: 'campus-demo-east',
      name: '启明东校区',
      timezone: 'Asia/Shanghai',
      contactPhone: '0731-88886666',
      customerServiceName: '启明课程顾问',
      address: '长沙市岳麓区启明路 18 号',
      latitude: 28.2282,
      longitude: 112.9388,
      mapVisible: true,
      lessonWarningThresholdUnits: 800,
      version: 1,
    },
  });
  await prisma.campus.upsert({
    where: { id: ids.campuses.west },
    update: {
      code: 'campus-demo-west',
      name: '启明西校区',
      timezone: 'Asia/Shanghai',
      contactPhone: '0731-88885555',
      address: '长沙市岳麓区枫林路 66 号',
      latitude: 28.2053,
      longitude: 112.8891,
      mapVisible: true,
      version: 1,
    },
    create: {
      id: ids.campuses.west,
      code: 'campus-demo-west',
      name: '启明西校区',
      timezone: 'Asia/Shanghai',
      contactPhone: '0731-88885555',
      address: '长沙市岳麓区枫林路 66 号',
      latitude: 28.2053,
      longitude: 112.8891,
      mapVisible: true,
      version: 1,
    },
  });

  await prisma.user.upsert({
    where: { id: ids.users.eastTeacher },
    update: {
      displayName: '林老师',
      staffPhone: '+8613800001001',
      status: 'ACTIVE',
    },
    create: {
      id: ids.users.eastTeacher,
      displayName: '林老师',
      staffPhone: '+8613800001001',
      accountVersion: 1,
      status: 'ACTIVE',
    },
  });

  await prisma.authIdentity.upsert({
    where: {
      userId_provider: {
        userId: ids.users.eastTeacher,
        provider: 'MOCK',
      },
    },
    update: { subject: 'mock-demo-east-teacher' },
    create: {
      id: ids.authIdentities.eastTeacher,
      userId: ids.users.eastTeacher,
      provider: 'MOCK',
      subject: 'mock-demo-east-teacher',
    },
  });
  await prisma.user.upsert({
    where: { id: ids.users.eastCampusManager },
    update: {
      displayName: '周园长',
      staffPhone: '+8613800001002',
      status: 'ACTIVE',
    },
    create: {
      id: ids.users.eastCampusManager,
      displayName: '周园长',
      staffPhone: '+8613800001002',
      accountVersion: 1,
      status: 'ACTIVE',
    },
  });
  await prisma.authIdentity.upsert({
    where: {
      userId_provider: {
        userId: ids.users.eastCampusManager,
        provider: 'MOCK',
      },
    },
    update: { subject: 'mock-demo-east-campus-manager' },
    create: {
      id: ids.authIdentities.eastCampusManager,
      userId: ids.users.eastCampusManager,
      provider: 'MOCK',
      subject: 'mock-demo-east-campus-manager',
    },
  });
  await prisma.user.upsert({
    where: { id: ids.users.eastPartner },
    update: {
      displayName: '朱元璋',
      staffPhone: '+8613800001003',
      status: 'ACTIVE',
    },
    create: {
      id: ids.users.eastPartner,
      displayName: '朱元璋',
      staffPhone: '+8613800001003',
      accountVersion: 1,
      status: 'ACTIVE',
    },
  });
  await prisma.authIdentity.upsert({
    where: {
      userId_provider: {
        userId: ids.users.eastPartner,
        provider: 'MOCK',
      },
    },
    update: { subject: 'mock-demo-east-partner' },
    create: {
      id: ids.authIdentities.eastPartner,
      userId: ids.users.eastPartner,
      provider: 'MOCK',
      subject: 'mock-demo-east-partner',
    },
  });
  const westAccounts = [
    {
      userId: ids.users.westParent,
      identityId: ids.authIdentities.westParent,
      displayName: '何家长',
      staffPhone: null,
      subject: 'mock-demo-west-parent',
    },
    {
      userId: ids.users.westTeacher,
      identityId: ids.authIdentities.westTeacher,
      displayName: '周老师',
      staffPhone: '+8613800000009',
      subject: 'mock-demo-west-teacher',
    },
    {
      userId: ids.users.westCampusManager,
      identityId: ids.authIdentities.westCampusManager,
      displayName: '赵园长',
      staffPhone: '+8613800000010',
      subject: 'mock-demo-west-campus-manager',
    },
    {
      userId: ids.users.westPartner,
      identityId: ids.authIdentities.westPartner,
      displayName: '孙经理',
      staffPhone: '+8613800000011',
      subject: 'mock-demo-west-partner',
    },
  ] as const;

  for (const account of westAccounts) {
    await prisma.user.upsert({
      where: { id: account.userId },
      update: {
        displayName: account.displayName,
        staffPhone: account.staffPhone,
        status: 'ACTIVE',
      },
      create: {
        id: account.userId,
        displayName: account.displayName,
        staffPhone: account.staffPhone,
        accountVersion: 1,
        status: 'ACTIVE',
      },
    });
    await prisma.authIdentity.upsert({
      where: {
        userId_provider: { userId: account.userId, provider: 'MOCK' },
      },
      update: { subject: account.subject },
      create: {
        id: account.identityId,
        userId: account.userId,
        provider: 'MOCK',
        subject: account.subject,
      },
    });
  }
  await prisma.user.upsert({
    where: { id: ids.users.eastParent },
    update: { displayName: '陈家长', status: 'ACTIVE' },
    create: {
      id: ids.users.eastParent,
      displayName: '陈家长',
      status: 'ACTIVE',
    },
  });
  await prisma.authIdentity.upsert({
    where: {
      userId_provider: {
        userId: ids.users.eastParent,
        provider: 'MOCK',
      },
    },
    update: { subject: 'mock-demo-east-parent' },
    create: {
      id: ids.authIdentities.eastParent,
      userId: ids.users.eastParent,
      provider: 'MOCK',
      subject: 'mock-demo-east-parent',
    },
  });
  await prisma.user.upsert({
    where: { id: ids.users.superAdmin },
    update: { displayName: '系统管理员', status: 'ACTIVE' },
    create: {
      id: ids.users.superAdmin,
      displayName: '系统管理员',
      status: 'ACTIVE',
    },
  });
  await prisma.authIdentity.upsert({
    where: {
      userId_provider: {
        userId: ids.users.superAdmin,
        provider: 'MOCK',
      },
    },
    update: { subject: 'mock-demo-super-admin' },
    create: {
      id: ids.authIdentities.superAdmin,
      userId: ids.users.superAdmin,
      provider: 'MOCK',
      subject: 'mock-demo-super-admin',
    },
  });

  await prisma.userRole.upsert({
    where: { id: ids.roles.eastTeacher },
    update: {
      userId: ids.users.eastTeacher,
      roleCode: 'TEACHER',
      campusId: ids.campuses.east,
    },
    create: {
      id: ids.roles.eastTeacher,
      userId: ids.users.eastTeacher,
      roleCode: 'TEACHER',
      campusId: ids.campuses.east,
    },
  });
  await prisma.userRole.upsert({
    where: { id: ids.roles.eastPartner },
    update: {
      userId: ids.users.eastPartner,
      roleCode: 'PARTNER',
      campusId: ids.campuses.east,
    },
    create: {
      id: ids.roles.eastPartner,
      userId: ids.users.eastPartner,
      roleCode: 'PARTNER',
      campusId: ids.campuses.east,
    },
  });
  await prisma.userRole.upsert({
    where: { id: ids.roles.eastCampusManager },
    update: {
      userId: ids.users.eastCampusManager,
      roleCode: 'CAMPUS_MANAGER',
      campusId: ids.campuses.east,
    },
    create: {
      id: ids.roles.eastCampusManager,
      userId: ids.users.eastCampusManager,
      roleCode: 'CAMPUS_MANAGER',
      campusId: ids.campuses.east,
    },
  });
  await prisma.userRole.upsert({
    where: { id: ids.roles.superAdmin },
    update: {
      userId: ids.users.superAdmin,
      roleCode: 'SUPER_ADMIN',
      campusId: null,
    },
    create: {
      id: ids.roles.superAdmin,
      userId: ids.users.superAdmin,
      roleCode: 'SUPER_ADMIN',
      campusId: null,
    },
  });
  await prisma.userRole.upsert({
    where: { id: ids.roles.westTeacher },
    update: {
      userId: ids.users.westTeacher,
      roleCode: 'TEACHER',
      campusId: ids.campuses.west,
    },
    create: {
      id: ids.roles.westTeacher,
      userId: ids.users.westTeacher,
      roleCode: 'TEACHER',
      campusId: ids.campuses.west,
    },
  });
  const westRoles = [
    [ids.roles.westParent, ids.users.westParent, 'PARENT'],
    [
      ids.roles.westCampusManager,
      ids.users.westCampusManager,
      'CAMPUS_MANAGER',
    ],
    [ids.roles.westPartner, ids.users.westPartner, 'PARTNER'],
  ] as const;

  for (const [id, userId, roleCode] of westRoles) {
    await prisma.userRole.upsert({
      where: { id },
      update: { userId, roleCode, campusId: ids.campuses.west },
      create: { id, userId, roleCode, campusId: ids.campuses.west },
    });
  }
  await prisma.userRole.upsert({
    where: { id: ids.roles.eastParent },
    update: {
      userId: ids.users.eastParent,
      roleCode: 'PARENT',
      campusId: ids.campuses.east,
    },
    create: {
      id: ids.roles.eastParent,
      userId: ids.users.eastParent,
      roleCode: 'PARENT',
      campusId: ids.campuses.east,
    },
  });

  await prisma.teacherProfile.upsert({
    where: { id: ids.teachers.east },
    update: {
      userId: ids.users.eastTeacher,
      campusId: ids.campuses.east,
      employeeCode: 'teacher-demo-east',
      specialties: ['创意基础', '团体创意工坊'],
      isActive: true,
    },
    create: {
      id: ids.teachers.east,
      userId: ids.users.eastTeacher,
      campusId: ids.campuses.east,
      employeeCode: 'teacher-demo-east',
      specialties: ['创意基础', '团体创意工坊'],
      isActive: true,
    },
  });
  await prisma.teacherProfile.upsert({
    where: { id: ids.teachers.west },
    update: {
      userId: ids.users.westTeacher,
      campusId: ids.campuses.west,
      employeeCode: 'teacher-demo-west',
      specialties: ['阅读基础'],
      isActive: true,
    },
    create: {
      id: ids.teachers.west,
      userId: ids.users.westTeacher,
      campusId: ids.campuses.west,
      employeeCode: 'teacher-demo-west',
      specialties: ['阅读基础'],
      isActive: true,
    },
  });

  const demoEarningScopeKey = `campus:${ids.campuses.east}:default`;
  const currentDemoEffectiveFrom = new Date('2026-09-01T00:00:00+08:00');
  const historicalDemoRule = {
    campusId: ids.campuses.east,
    teacherProfileId: null,
    scopeKey: demoEarningScopeKey,
    basisType: 'PER_COMPLETED_SESSION' as const,
    unitAmountFen: 10000,
    eligibleLessonKinds: ['REGULAR', 'MAKEUP'] as ('REGULAR' | 'MAKEUP')[],
    countedAttendanceStatuses: ['PRESENT'] as 'PRESENT'[],
    settlementDelayDays: 0,
    version: 1,
    status: 'RETIRED' as const,
    effectiveFrom: new Date('2026-08-01T00:00:00+08:00'),
    effectiveTo: new Date('2026-09-01T00:00:00+08:00'),
    createdByUserId: ids.users.superAdmin,
  };
  await prisma.teacherEarningRule.upsert({
    where: { id: ids.earningRules.eastDefault },
    update: historicalDemoRule,
    create: { id: ids.earningRules.eastDefault, ...historicalDemoRule },
  });

  const supersedingDemoRule = await prisma.teacherEarningRule.findFirst({
    where: {
      scopeKey: demoEarningScopeKey,
      version: { gt: 2 },
      status: { in: ['ACTIVE', 'RETIRED'] },
      effectiveFrom: { gt: currentDemoEffectiveFrom },
    },
    orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }],
    select: { effectiveFrom: true },
  });
  const currentDemoRule = {
    campusId: ids.campuses.east,
    teacherProfileId: null,
    scopeKey: demoEarningScopeKey,
    basisType: 'PER_PRESENT_ATTENDEE' as const,
    unitAmountFen: 300,
    eligibleLessonKinds: ['REGULAR', 'MAKEUP'] as ('REGULAR' | 'MAKEUP')[],
    countedAttendanceStatuses: ['PRESENT'] as 'PRESENT'[],
    settlementDelayDays: 0,
    version: 2,
    status: supersedingDemoRule ? ('RETIRED' as const) : ('ACTIVE' as const),
    effectiveFrom: currentDemoEffectiveFrom,
    effectiveTo: supersedingDemoRule?.effectiveFrom ?? null,
    createdByUserId: ids.users.superAdmin,
  };
  await prisma.teacherEarningRule.upsert({
    where: { id: ids.earningRules.eastPerAttendee },
    update: currentDemoRule,
    create: { id: ids.earningRules.eastPerAttendee, ...currentDemoRule },
  });

  const partnerDemoRuleData = {
    campusId: ids.campuses.east,
    scopeKey: `campus:${ids.campuses.east}:partner`,
    unitPriceFen: 1000,
    shareBasisPoints: 4000,
    eligibleLessonKinds: ['REGULAR', 'MAKEUP'] as ('REGULAR' | 'MAKEUP')[],
    countedAttendanceStatuses: ['PRESENT'] as 'PRESENT'[],
    settlementDelayDays: 0,
    version: 1,
    status: 'ACTIVE' as const,
    effectiveFrom: new Date('2026-08-01T00:00:00+08:00'),
    effectiveTo: null,
    createdByUserId: ids.users.superAdmin,
  };
  const partnerDemoRule = await prisma.partnerEarningRule.upsert({
    where: {
      scopeKey_version: {
        scopeKey: partnerDemoRuleData.scopeKey,
        version: partnerDemoRuleData.version,
      },
    },
    update: partnerDemoRuleData,
    create: {
      id: ids.partnerEarningRules.eastDefault,
      ...partnerDemoRuleData,
    },
  });

  const demoPolicy = {
    minimumAmountFen: 10000,
    dailyRequestLimit: 1,
    version: 1,
    status: 'ACTIVE' as const,
    effectiveFrom: new Date('2026-08-01T00:00:00+08:00'),
    effectiveTo: null,
    createdByUserId: ids.users.superAdmin,
  };
  await prisma.teacherWithdrawalPolicy.upsert({
    where: { id: ids.withdrawalPolicies.default },
    update: demoPolicy,
    create: { id: ids.withdrawalPolicies.default, ...demoPolicy },
  });

  const students = [
    {
      id: ids.students.eastA,
      campusId: ids.campuses.east,
      displayName: '陈晨',
      birthDate: new Date('2017-03-14T00:00:00.000Z'),
      profileAge: null,
      homeAddress: null,
      profileVersion: 1,
    },
    {
      id: ids.students.eastB,
      campusId: ids.campuses.east,
      displayName: '安然',
      birthDate: new Date('2016-11-20T00:00:00.000Z'),
      profileAge: null,
      homeAddress: null,
      profileVersion: 1,
    },
    {
      id: ids.students.westA,
      campusId: ids.campuses.west,
      displayName: '何嘉',
      birthDate: new Date('2017-06-09T00:00:00.000Z'),
      profileAge: null,
      homeAddress: null,
      profileVersion: 1,
    },
    {
      id: ids.students.westB,
      campusId: ids.campuses.west,
      displayName: '罗一诺',
      birthDate: new Date('2016-04-18T00:00:00.000Z'),
      profileAge: null,
      homeAddress: null,
      profileVersion: 1,
    },
  ] as const;

  for (const student of students) {
    await prisma.student.upsert({
      where: { id: student.id },
      update: {
        campusId: student.campusId,
        displayName: student.displayName,
        birthDate: student.birthDate,
        profileAge: student.profileAge,
        homeAddress: student.homeAddress,
        profileVersion: student.profileVersion,
        isActive: true,
      },
      create: { ...student, isActive: true },
    });
  }

  await prisma.parentStudentBinding.upsert({
    where: { id: ids.parentBindings.eastA },
    update: {
      campusId: ids.campuses.east,
      parentUserId: ids.users.eastParent,
      studentId: ids.students.eastA,
      isPrimary: true,
    },
    create: {
      id: ids.parentBindings.eastA,
      campusId: ids.campuses.east,
      parentUserId: ids.users.eastParent,
      studentId: ids.students.eastA,
      isPrimary: true,
    },
  });
  await prisma.parentStudentBinding.upsert({
    where: { id: ids.parentBindings.westA },
    update: {
      campusId: ids.campuses.west,
      parentUserId: ids.users.westParent,
      studentId: ids.students.westA,
      isPrimary: true,
    },
    create: {
      id: ids.parentBindings.westA,
      campusId: ids.campuses.west,
      parentUserId: ids.users.westParent,
      studentId: ids.students.westA,
      isPrimary: true,
    },
  });

  const classes = [
    {
      id: ids.classes.eastFoundations,
      campusId: ids.campuses.east,
      teacherId: ids.teachers.east,
      name: '创意基础A班',
      courseName: '创意基础',
    },
    {
      id: ids.classes.eastWorkshop,
      campusId: ids.campuses.east,
      teacherId: ids.teachers.east,
      name: '创意工坊A班',
      courseName: '团体创意工坊',
    },
    {
      id: ids.classes.westFoundations,
      campusId: ids.campuses.west,
      teacherId: ids.teachers.west,
      name: '阅读基础A班',
      courseName: '阅读基础',
    },
  ] as const;

  for (const classGroup of classes) {
    await prisma.classGroup.upsert({
      where: { id: classGroup.id },
      update: {
        ...classGroup,
        defaultLessonUnits: 100,
        status: 'ACTIVE',
      },
      create: {
        ...classGroup,
        defaultLessonUnits: 100,
        status: 'ACTIVE',
      },
    });
  }

  const members = [
    {
      id: ids.members.eastFoundationsA,
      campusId: ids.campuses.east,
      classGroupId: ids.classes.eastFoundations,
      studentId: ids.students.eastA,
    },
    {
      id: ids.members.eastFoundationsB,
      campusId: ids.campuses.east,
      classGroupId: ids.classes.eastFoundations,
      studentId: ids.students.eastB,
    },
    {
      id: ids.members.eastWorkshopA,
      campusId: ids.campuses.east,
      classGroupId: ids.classes.eastWorkshop,
      studentId: ids.students.eastA,
    },
    {
      id: ids.members.westFoundationsA,
      campusId: ids.campuses.west,
      classGroupId: ids.classes.westFoundations,
      studentId: ids.students.westA,
    },
    {
      id: ids.members.westFoundationsB,
      campusId: ids.campuses.west,
      classGroupId: ids.classes.westFoundations,
      studentId: ids.students.westB,
    },
  ] as const;

  for (const member of members) {
    await prisma.classMember.upsert({
      where: { id: member.id },
      update: { ...member, leftAt: null },
      create: member,
    });
  }

  const sessions = [
    {
      id: ids.sessions.eastCompleted,
      campusId: ids.campuses.east,
      classGroupId: ids.classes.eastFoundations,
      teacherId: ids.teachers.east,
      startsAt: new Date('2026-08-28T09:00:00+08:00'),
      endsAt: completedAt,
      status: 'COMPLETED' as const,
      completedAt,
    },
    {
      id: ids.sessions.eastScheduled,
      campusId: ids.campuses.east,
      classGroupId: ids.classes.eastFoundations,
      teacherId: ids.teachers.east,
      startsAt: new Date('2026-08-30T14:00:00+08:00'),
      endsAt: new Date('2026-08-30T15:30:00+08:00'),
      status: 'SCHEDULED' as const,
      completedAt: null,
    },
    {
      id: ids.sessions.eastWorkshop,
      campusId: ids.campuses.east,
      classGroupId: ids.classes.eastWorkshop,
      teacherId: ids.teachers.east,
      startsAt: new Date('2026-09-02T14:00:00+08:00'),
      endsAt: new Date('2026-09-02T15:30:00+08:00'),
      status: 'SCHEDULED' as const,
      completedAt: null,
    },
    {
      id: ids.sessions.westScheduled,
      campusId: ids.campuses.west,
      classGroupId: ids.classes.westFoundations,
      teacherId: ids.teachers.west,
      startsAt: new Date('2026-09-01T10:30:00+08:00'),
      endsAt: new Date('2026-09-01T11:30:00+08:00'),
      status: 'SCHEDULED' as const,
      completedAt: null,
    },
  ];

  for (const session of sessions) {
    await prisma.lessonSession.upsert({
      where: { id: session.id },
      update: {
        ...session,
        kind: 'REGULAR',
        lessonUnits: 100,
        version: session.status === 'COMPLETED' ? 2 : 1,
        reversedAt: null,
        reversalReason: null,
      },
      create: {
        ...session,
        kind: 'REGULAR',
        lessonUnits: 100,
        version: session.status === 'COMPLETED' ? 2 : 1,
      },
    });
  }

  await prisma.parentLeaveRequest.upsert({
    where: {
      parentUserId_studentId_lessonSessionId: {
        parentUserId: ids.users.eastParent,
        studentId: ids.students.eastA,
        lessonSessionId: ids.sessions.eastScheduled,
      },
    },
    update: {
      campusId: ids.campuses.east,
      parentUserId: ids.users.eastParent,
      studentId: ids.students.eastA,
      lessonSessionId: ids.sessions.eastScheduled,
      reason: '参加学校集体活动',
      status: 'PENDING',
      reviewerUserId: null,
      reviewedAt: null,
      reviewReason: null,
      version: 1,
    },
    create: {
      id: ids.parentLeaveRequests.eastPending,
      campusId: ids.campuses.east,
      parentUserId: ids.users.eastParent,
      studentId: ids.students.eastA,
      lessonSessionId: ids.sessions.eastScheduled,
      reason: '参加学校集体活动',
      status: 'PENDING',
      version: 1,
    },
  });

  const packages = [
    {
      id: ids.packages.eastA,
      campusId: ids.campuses.east,
      studentId: ids.students.eastA,
      name: '创意美术基础课包',
      mainBalanceUnits: 900,
      giftBalanceUnits: 200,
      paidAmountFen: 480000,
      validFrom: new Date('2026-08-23T00:00:00+08:00'),
      expiresAt: new Date('2027-08-23T23:59:59+08:00'),
    },
    {
      id: ids.packages.eastB,
      campusId: ids.campuses.east,
      studentId: ids.students.eastB,
      name: '创意美术基础课包',
      mainBalanceUnits: 700,
      giftBalanceUnits: 100,
      paidAmountFen: 360000,
      validFrom: new Date('2026-08-23T00:00:00+08:00'),
      expiresAt: new Date('2027-08-23T23:59:59+08:00'),
    },
    {
      id: ids.packages.westA,
      campusId: ids.campuses.west,
      studentId: ids.students.westA,
      name: '阅读基础课包',
      mainBalanceUnits: 1200,
      giftBalanceUnits: 300,
      paidAmountFen: 520000,
      validFrom: new Date('2026-08-23T00:00:00+08:00'),
      expiresAt: new Date('2027-08-23T23:59:59+08:00'),
    },
    {
      id: ids.packages.westB,
      campusId: ids.campuses.west,
      studentId: ids.students.westB,
      name: '阅读基础课包',
      mainBalanceUnits: 500,
      giftBalanceUnits: 200,
      paidAmountFen: 300000,
      validFrom: new Date('2026-08-23T00:00:00+08:00'),
      expiresAt: new Date('2027-08-23T23:59:59+08:00'),
    },
  ] as const;

  for (const coursePackage of packages) {
    await prisma.coursePackage.upsert({
      where: { id: coursePackage.id },
      update: { ...coursePackage, version: 1, isActive: true },
      create: { ...coursePackage, version: 1, isActive: true },
    });
  }

  await prisma.courseProduct.upsert({
    where: { id: ids.courseProducts.eastActive },
    update: {
      campusId: ids.campuses.east,
      name: '创意美术基础课',
      summary: '面向 7-10 岁学员的创意表达与造型基础课程。',
      priceFen: 480000,
      mainUnits: 1200,
      giftUnits: 200,
      validityDays: 365,
      status: 'ACTIVE',
      version: 1,
      createdByUserId: ids.users.superAdmin,
    },
    create: {
      id: ids.courseProducts.eastActive,
      campusId: ids.campuses.east,
      name: '创意美术基础课',
      summary: '面向 7-10 岁学员的创意表达与造型基础课程。',
      priceFen: 480000,
      mainUnits: 1200,
      giftUnits: 200,
      validityDays: 365,
      status: 'ACTIVE',
      version: 1,
      createdByUserId: ids.users.superAdmin,
    },
  });
  await prisma.courseProduct.upsert({
    where: { id: ids.courseProducts.eastDraft },
    update: {
      campusId: ids.campuses.east,
      name: '综合材料实验课',
      summary: '待总端确认后上架的课程商品。',
      priceFen: 320000,
      mainUnits: 800,
      giftUnits: 100,
      validityDays: 240,
      status: 'DRAFT',
      version: 1,
      createdByUserId: ids.users.superAdmin,
    },
    create: {
      id: ids.courseProducts.eastDraft,
      campusId: ids.campuses.east,
      name: '综合材料实验课',
      summary: '待总端确认后上架的课程商品。',
      priceFen: 320000,
      mainUnits: 800,
      giftUnits: 100,
      validityDays: 240,
      status: 'DRAFT',
      version: 1,
      createdByUserId: ids.users.superAdmin,
    },
  });
  await prisma.groupCampaign.upsert({
    where: { id: ids.groupCampaigns.eastDemo },
    update: {
      code: 'GROUP-1990-DEMO',
      campusId: ids.campuses.east,
      courseProductId: ids.courseProducts.eastActive,
      title: '19.9 元创意美术拼团课',
      description: '最多三人拼团，按最终已支付人数获得 1、3 或 5 次线下课程。',
      priceFen: 1990,
      maxPaidMembers: 3,
      startsAt: new Date('2026-09-01T00:00:00+08:00'),
      endsAt: new Date('2026-10-31T23:59:59+08:00'),
      status: 'ACTIVE',
      version: 1,
      createdByUserId: ids.users.superAdmin,
    },
    create: {
      id: ids.groupCampaigns.eastDemo,
      code: 'GROUP-1990-DEMO',
      campusId: ids.campuses.east,
      courseProductId: ids.courseProducts.eastActive,
      title: '19.9 元创意美术拼团课',
      description: '最多三人拼团，按最终已支付人数获得 1、3 或 5 次线下课程。',
      priceFen: 1990,
      maxPaidMembers: 3,
      startsAt: new Date('2026-09-01T00:00:00+08:00'),
      endsAt: new Date('2026-10-31T23:59:59+08:00'),
      status: 'ACTIVE',
      version: 1,
      createdByUserId: ids.users.superAdmin,
    },
  });
  await prisma.enrollmentOrder.upsert({
    where: { id: ids.enrollmentOrders.eastAwaitingProof },
    update: {
      orderNo: 'ENR-DEMO-20260831-001',
      parentUserId: ids.users.eastParent,
      studentId: ids.students.eastA,
      campusId: ids.campuses.east,
      courseProductId: ids.courseProducts.eastActive,
      productNameSnapshot: '创意美术基础课',
      priceFenSnapshot: 480000,
      mainUnitsSnapshot: 1200,
      giftUnitsSnapshot: 200,
      validityDaysSnapshot: 365,
      status: 'AWAITING_PROOF',
      version: 1,
      reviewedByUserId: null,
      reviewedAt: null,
      reviewReason: null,
      cancelledAt: null,
      voidedAt: null,
      voidReason: null,
    },
    create: {
      id: ids.enrollmentOrders.eastAwaitingProof,
      orderNo: 'ENR-DEMO-20260831-001',
      parentUserId: ids.users.eastParent,
      studentId: ids.students.eastA,
      campusId: ids.campuses.east,
      courseProductId: ids.courseProducts.eastActive,
      productNameSnapshot: '创意美术基础课',
      priceFenSnapshot: 480000,
      mainUnitsSnapshot: 1200,
      giftUnitsSnapshot: 200,
      validityDaysSnapshot: 365,
      status: 'AWAITING_PROOF',
      version: 1,
    },
  });

  await prisma.attendanceRecord.upsert({
    where: { id: ids.attendance.eastA },
    update: {
      campusId: ids.campuses.east,
      lessonSessionId: ids.sessions.eastCompleted,
      studentId: ids.students.eastA,
      status: 'PRESENT',
      recordedByUserId: ids.users.eastTeacher,
      recordedAt: completedAt,
    },
    create: {
      id: ids.attendance.eastA,
      campusId: ids.campuses.east,
      lessonSessionId: ids.sessions.eastCompleted,
      studentId: ids.students.eastA,
      status: 'PRESENT',
      recordedByUserId: ids.users.eastTeacher,
      recordedAt: completedAt,
    },
  });
  await prisma.attendanceRecord.upsert({
    where: { id: ids.attendance.eastB },
    update: {
      campusId: ids.campuses.east,
      lessonSessionId: ids.sessions.eastCompleted,
      studentId: ids.students.eastB,
      status: 'PRESENT',
      recordedByUserId: ids.users.eastTeacher,
      recordedAt: completedAt,
    },
    create: {
      id: ids.attendance.eastB,
      campusId: ids.campuses.east,
      lessonSessionId: ids.sessions.eastCompleted,
      studentId: ids.students.eastB,
      status: 'PRESENT',
      recordedByUserId: ids.users.eastTeacher,
      recordedAt: completedAt,
    },
  });

  await prisma.teachingRecord.upsert({
    where: { id: ids.teachingRecord },
    update: {
      campusId: ids.campuses.east,
      lessonSessionId: ids.sessions.eastCompleted,
      teacherId: ids.teachers.east,
      status: 'COMPLETED',
      attendeeCount: 2,
      lessonUnits: 100,
      recordedByUserId: ids.users.eastTeacher,
      completedAt,
      reversedAt: null,
      reversalReason: null,
    },
    create: {
      id: ids.teachingRecord,
      campusId: ids.campuses.east,
      lessonSessionId: ids.sessions.eastCompleted,
      teacherId: ids.teachers.east,
      status: 'COMPLETED',
      attendeeCount: 2,
      lessonUnits: 100,
      recordedByUserId: ids.users.eastTeacher,
      completedAt,
    },
  });

  await prisma.teacherEarningBasis.upsert({
    where: { id: ids.earningBases.eastCompleted },
    update: {
      campusId: ids.campuses.east,
      teacherProfileId: ids.teachers.east,
      teachingRecordId: ids.teachingRecord,
      lessonSessionId: ids.sessions.eastCompleted,
      selectedRuleId: ids.earningRules.eastDefault,
      lessonKind: 'REGULAR',
      lessonUnits: 100,
      attendeeCount: 2,
      attendanceSnapshot: [
        { studentId: ids.students.eastA, status: 'PRESENT' },
        { studentId: ids.students.eastB, status: 'PRESENT' },
      ],
      completedAt,
      status: 'PRICED',
    },
    create: {
      id: ids.earningBases.eastCompleted,
      campusId: ids.campuses.east,
      teacherProfileId: ids.teachers.east,
      teachingRecordId: ids.teachingRecord,
      lessonSessionId: ids.sessions.eastCompleted,
      selectedRuleId: ids.earningRules.eastDefault,
      lessonKind: 'REGULAR',
      lessonUnits: 100,
      attendeeCount: 2,
      attendanceSnapshot: [
        { studentId: ids.students.eastA, status: 'PRESENT' },
        { studentId: ids.students.eastB, status: 'PRESENT' },
      ],
      completedAt,
      status: 'PRICED',
      createdAt: completedAt,
    },
  });

  const demoRuleSnapshot = {
    ruleId: ids.earningRules.eastDefault,
    ruleVersion: 1,
    basisType: 'PER_COMPLETED_SESSION',
    unitAmountFen: 10000,
    lessonUnits: 100,
    attendeeCount: 2,
    eligibleLessonKinds: ['REGULAR', 'MAKEUP'],
    countedAttendanceStatuses: ['PRESENT'],
    settlementDelayDays: 0,
    calculation: '10000',
    amountFen: 10000,
  };
  await prisma.teacherEarningEntry.upsert({
    where: { id: ids.earningEntries.eastCompleted },
    update: {
      campusId: ids.campuses.east,
      teacherProfileId: ids.teachers.east,
      earningBasisId: ids.earningBases.eastCompleted,
      entryType: 'ACCRUAL',
      amountFen: 10000,
      status: 'AVAILABLE',
      ruleSnapshot: demoRuleSnapshot,
      reviewableAt: completedAt,
      reviewedByUserId: ids.users.superAdmin,
      reviewedAt: new Date('2026-08-28T10:05:00+08:00'),
      reviewReason: '演示收益审核通过',
      reversalOfId: null,
      version: 1,
    },
    create: {
      id: ids.earningEntries.eastCompleted,
      campusId: ids.campuses.east,
      teacherProfileId: ids.teachers.east,
      earningBasisId: ids.earningBases.eastCompleted,
      entryType: 'ACCRUAL',
      amountFen: 10000,
      status: 'AVAILABLE',
      ruleSnapshot: demoRuleSnapshot,
      reviewableAt: completedAt,
      reviewedByUserId: ids.users.superAdmin,
      reviewedAt: new Date('2026-08-28T10:05:00+08:00'),
      reviewReason: '演示收益审核通过',
      version: 1,
      createdAt: completedAt,
    },
  });

  await prisma.partnerEarningBasis.upsert({
    where: { id: ids.partnerEarningBases.eastCompleted },
    update: {
      campusId: ids.campuses.east,
      teachingRecordId: ids.teachingRecord,
      lessonSessionId: ids.sessions.eastCompleted,
      selectedRuleId: partnerDemoRule.id,
      lessonKind: 'REGULAR',
      lessonUnits: 100,
      actualAttendeeCount: 2,
      countedAttendeeCount: 2,
      attendanceSnapshot: [
        { studentId: ids.students.eastA, status: 'PRESENT' },
        { studentId: ids.students.eastB, status: 'PRESENT' },
      ],
      completedAt,
      status: 'PRICED',
    },
    create: {
      id: ids.partnerEarningBases.eastCompleted,
      campusId: ids.campuses.east,
      teachingRecordId: ids.teachingRecord,
      lessonSessionId: ids.sessions.eastCompleted,
      selectedRuleId: partnerDemoRule.id,
      lessonKind: 'REGULAR',
      lessonUnits: 100,
      actualAttendeeCount: 2,
      countedAttendeeCount: 2,
      attendanceSnapshot: [
        { studentId: ids.students.eastA, status: 'PRESENT' },
        { studentId: ids.students.eastB, status: 'PRESENT' },
      ],
      completedAt,
      status: 'PRICED',
      createdAt: completedAt,
    },
  });

  const partnerDemoRuleSnapshot = {
    ruleId: partnerDemoRule.id,
    version: 1,
    unitPriceFen: 1000,
    shareBasisPoints: 4000,
    eligibleLessonKinds: ['REGULAR', 'MAKEUP'],
    countedAttendanceStatuses: ['PRESENT'],
    settlementDelayDays: 0,
    lessonKind: 'REGULAR',
    lessonUnits: 100,
    actualAttendeeCount: 2,
    countedAttendeeCount: 2,
    perAttendeeAmountFen: 400,
    calculation: 'round(1000*4000/10000)*2',
    amountFen: 800,
  };
  await prisma.partnerEarningEntry.upsert({
    where: { id: ids.partnerEarningEntries.eastCompleted },
    update: {
      campusId: ids.campuses.east,
      earningBasisId: ids.partnerEarningBases.eastCompleted,
      entryType: 'ACCRUAL',
      amountFen: 800,
      status: 'AVAILABLE',
      ruleSnapshot: partnerDemoRuleSnapshot,
      reviewableAt: completedAt,
      reviewedByUserId: ids.users.superAdmin,
      reviewedAt: new Date('2026-08-28T10:05:00+08:00'),
      reviewReason: '演示合作方收益审核通过',
      reversalOfId: null,
      version: 1,
    },
    create: {
      id: ids.partnerEarningEntries.eastCompleted,
      campusId: ids.campuses.east,
      earningBasisId: ids.partnerEarningBases.eastCompleted,
      entryType: 'ACCRUAL',
      amountFen: 800,
      status: 'AVAILABLE',
      ruleSnapshot: partnerDemoRuleSnapshot,
      reviewableAt: completedAt,
      reviewedByUserId: ids.users.superAdmin,
      reviewedAt: new Date('2026-08-28T10:05:00+08:00'),
      reviewReason: '演示合作方收益审核通过',
      version: 1,
      createdAt: completedAt,
    },
  });

  const ledgerEntries = [
    {
      id: ids.ledger.eastA,
      campusId: ids.campuses.east,
      studentId: ids.students.eastA,
      coursePackageId: ids.packages.eastA,
      lessonSessionId: ids.sessions.eastCompleted,
      idempotencyKey: 'seed-complete-east-a',
      balanceBeforeUnits: 1000,
      balanceAfterUnits: 900,
    },
    {
      id: ids.ledger.eastB,
      campusId: ids.campuses.east,
      studentId: ids.students.eastB,
      coursePackageId: ids.packages.eastB,
      lessonSessionId: ids.sessions.eastCompleted,
      idempotencyKey: 'seed-complete-east-b',
      balanceBeforeUnits: 800,
      balanceAfterUnits: 700,
    },
  ] as const;

  for (const ledgerEntry of ledgerEntries) {
    await prisma.lessonLedgerEntry.upsert({
      where: { id: ledgerEntry.id },
      update: {
        ...ledgerEntry,
        entryType: 'CONSUME',
        bucket: 'MAIN',
        deltaUnits: -100,
        reversalOfId: null,
        actorUserId: ids.users.eastTeacher,
        reason: '演示课次初始化扣课',
        createdAt: completedAt,
      },
      create: {
        ...ledgerEntry,
        entryType: 'CONSUME',
        bucket: 'MAIN',
        deltaUnits: -100,
        actorUserId: ids.users.eastTeacher,
        reason: '演示课次初始化扣课',
        createdAt: completedAt,
      },
    });
  }

  await prisma.studentFeedback.upsert({
    where: { id: ids.feedback },
    update: {
      campusId: ids.campuses.east,
      lessonSessionId: ids.sessions.eastCompleted,
      studentId: ids.students.eastA,
      teacherId: ids.teachers.east,
      content: '课堂参与认真，已完成本节课练习。',
    },
    create: {
      id: ids.feedback,
      campusId: ids.campuses.east,
      lessonSessionId: ids.sessions.eastCompleted,
      studentId: ids.students.eastA,
      teacherId: ids.teachers.east,
      content: '课堂参与认真，已完成本节课练习。',
    },
  });
}

async function runSeed(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to seed teacher core data');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    await seedTeacherCore(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void runSeed().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
