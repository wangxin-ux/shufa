import {
  PartnerAttendance,
  PartnerDashboard,
  PartnerEarningEntry,
  PartnerEarningRule,
  PartnerEarningSummary,
  PartnerLessonAccount,
  PartnerOperationsSummary,
  PartnerProfile,
  PartnerStudent,
  PartnerStudentDetail,
  PartnerTeacher,
  PartnerWarning,
} from '../../types/partner';

const campus = {
  id: '10000000-0000-4000-8000-000000000001',
  code: 'campus-demo-east',
  name: '启明东校区',
  timezone: 'Asia/Shanghai',
  lessonWarningThresholdUnits: 500,
};

export const PARTNER_WARNINGS_FIXTURE: PartnerWarning[] = [
  {
    studentId: 'partner-student-1',
    studentName: '林一诺',
    classNames: ['创意美术 A 班'],
    mainBalanceUnits: 300,
    giftBalanceUnits: 100,
    totalBalanceUnits: 400,
    thresholdUnits: 500,
  },
];

export const PARTNER_DASHBOARD_FIXTURE: PartnerDashboard = {
  partner: { displayName: '朱元璋' },
  campus,
  activeStudentCount: 106,
  activeClassCount: 12,
  activeTeacherCount: 8,
  remainingMainUnits: 3700,
  remainingGiftUnits: 1200,
  monthConsumedUnits: 7200,
  attendanceRateBasisPoints: 9600,
  highlight: PARTNER_WARNINGS_FIXTURE[0],
  serverTime: '2026-08-31T08:00:00+08:00',
};

export const PARTNER_PROFILE_FIXTURE: PartnerProfile = {
  displayName: '朱元璋',
  roleCode: 'PARTNER',
  campus: {
    ...campus,
    contactPhone: '0731-88886666',
    address: '长沙市岳麓区启明路 18 号',
  },
};

export const PARTNER_STUDENTS_FIXTURE: PartnerStudent[] = [
  {
    id: 'partner-student-1',
    displayName: '林一诺',
    birthDate: '2017-06-18',
    classNames: ['创意美术 A 班'],
    mainBalanceUnits: 300,
    giftBalanceUnits: 100,
    totalBalanceUnits: 400,
  },
  {
    id: 'partner-student-2',
    displayName: '陈晨',
    birthDate: '2018-03-12',
    classNames: ['创意基础班'],
    mainBalanceUnits: 900,
    giftBalanceUnits: 200,
    totalBalanceUnits: 1100,
  },
];

export const PARTNER_ATTENDANCE_FIXTURE: PartnerAttendance = {
  presentCount: 18,
  absentCount: 1,
  leaveCount: 1,
  recordedCount: 20,
  attendanceRateBasisPoints: 9000,
  items: [
    {
      id: 'partner-attendance-1',
      studentId: 'partner-student-1',
      studentName: '林一诺',
      courseName: '硬笔书法',
      teacherName: '王老师',
      startsAt: '2026-08-31T14:00:00+08:00',
      status: 'PRESENT',
      recordedAt: '2026-08-31T15:30:00+08:00',
    },
    {
      id: 'partner-attendance-2',
      studentId: 'partner-student-2',
      studentName: '陈晨',
      courseName: '创意基础',
      teacherName: '林老师',
      startsAt: '2026-08-30T14:00:00+08:00',
      status: 'LEAVE',
      recordedAt: '2026-08-30T15:30:00+08:00',
    },
  ],
  meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
};

export const PARTNER_TEACHERS_FIXTURE: PartnerTeacher[] = [
  {
    id: 'partner-teacher-1',
    displayName: '林老师',
    employeeCode: 'T-EAST-001',
    specialties: ['创意基础', '团体创意工坊'],
    classNames: ['创意基础班', '团体创意工坊'],
    activeStudentCount: 18,
    monthCompletedLessonCount: 32,
  },
  {
    id: 'partner-teacher-2',
    displayName: '王老师',
    employeeCode: 'T-EAST-002',
    specialties: ['硬笔书法'],
    classNames: ['硬笔书法 A 班'],
    activeStudentCount: 12,
    monthCompletedLessonCount: 28,
  },
];

export const PARTNER_LESSON_ACCOUNT_FIXTURE: PartnerLessonAccount = {
  mainBalanceUnits: 3700,
  giftBalanceUnits: 1200,
  totalBalanceUnits: 4900,
  items: [
    {
      id: 'partner-ledger-1',
      studentId: 'partner-student-1',
      studentName: '林一诺',
      packageName: '硬笔书法课包',
      entryType: 'CONSUME',
      bucket: 'MAIN',
      deltaUnits: -100,
      balanceBeforeUnits: 400,
      balanceAfterUnits: 300,
      reason: '课程完成扣课',
      createdAt: '2026-08-31T15:30:00+08:00',
    },
    {
      id: 'partner-ledger-2',
      studentId: 'partner-student-2',
      studentName: '陈晨',
      packageName: '创意基础课包',
      entryType: 'ADJUSTMENT',
      bucket: 'MAIN',
      deltaUnits: 4800,
      balanceBeforeUnits: 0,
      balanceAfterUnits: 4800,
      reason: '报名课包发放',
      createdAt: '2026-08-23T10:00:00+08:00',
    },
  ],
  meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
};

export const PARTNER_EARNING_SUMMARY_FIXTURE: PartnerEarningSummary = {
  estimatedTotalFen: 4000,
  pendingReviewFen: 4000,
  availableFen: 0,
  reversedNetFen: 0,
  currency: 'CNY',
};

export const PARTNER_EARNING_RULE_FIXTURE: PartnerEarningRule = {
  id: 'partner-rule-east-1',
  campusId: campus.id,
  campusName: campus.name,
  unitPriceFen: 1000,
  shareBasisPoints: 4000,
  eligibleLessonKinds: ['REGULAR', 'MAKEUP'],
  countedAttendanceStatuses: ['PRESENT'],
  settlementDelayDays: 0,
  version: 1,
  status: 'ACTIVE',
  effectiveFrom: '2026-09-01T00:00:00+08:00',
  effectiveTo: null,
  createdAt: '2026-09-01T00:00:00+08:00',
};

export const PARTNER_EARNINGS_FIXTURE: PartnerEarningEntry[] = [
  {
    id: 'partner-earning-east-1',
    campusId: campus.id,
    campusName: campus.name,
    teachingRecordId: 'partner-teaching-1',
    lessonSessionId: 'partner-lesson-1',
    courseName: '创意基础',
    lessonStartsAt: '2026-09-01T14:00:00+08:00',
    completedAt: '2026-09-01T15:30:00+08:00',
    entryType: 'ACCRUAL',
    amountFen: 4000,
    status: 'PENDING_REVIEW',
    unitPriceFen: 1000,
    shareBasisPoints: 4000,
    actualAttendeeCount: 10,
    countedAttendeeCount: 10,
    perAttendeeAmountFen: 400,
    reviewableAt: '2026-09-01T15:30:00+08:00',
    reviewedAt: null,
    reviewReason: null,
    createdAt: '2026-09-01T15:30:00+08:00',
    version: 1,
  },
];

export const PARTNER_STUDENT_DETAILS_FIXTURE: PartnerStudentDetail[] = [
  {
    ...PARTNER_STUDENTS_FIXTURE[0],
    classes: [
      {
        id: 'partner-class-1',
        className: '硬笔书法 A 班',
        courseName: '硬笔书法',
        teacherName: '王老师',
      },
    ],
    attendance: {
      presentCount: 1,
      absentCount: 0,
      leaveCount: 0,
      recordedCount: 1,
      attendanceRateBasisPoints: 10000,
    },
    recentAttendance: [PARTNER_ATTENDANCE_FIXTURE.items[0]],
    recentLessonLedger: [PARTNER_LESSON_ACCOUNT_FIXTURE.items[0]],
  },
  {
    ...PARTNER_STUDENTS_FIXTURE[1],
    classes: [
      {
        id: 'partner-class-2',
        className: '创意基础班',
        courseName: '创意基础',
        teacherName: '林老师',
      },
    ],
    attendance: {
      presentCount: 0,
      absentCount: 0,
      leaveCount: 1,
      recordedCount: 1,
      attendanceRateBasisPoints: 0,
    },
    recentAttendance: [PARTNER_ATTENDANCE_FIXTURE.items[1]],
    recentLessonLedger: [PARTNER_LESSON_ACCOUNT_FIXTURE.items[1]],
  },
];

export const PARTNER_OPERATIONS_SUMMARY_FIXTURE: PartnerOperationsSummary = {
  period: 'MONTH',
  anchorDate: '2026-09-01',
  rangeStart: '2026-08-31T16:00:00.000Z',
  rangeEnd: '2026-09-30T16:00:00.000Z',
  consumedLessonUnits: 7200,
  completedLessonCount: 32,
  presentCount: 96,
  absentCount: 2,
  leaveCount: 2,
  recordedCount: 100,
  attendanceRateBasisPoints: 9600,
  teacherMetrics: [
    {
      teacherId: 'partner-teacher-1',
      displayName: '林老师',
      completedLessonCount: 18,
      attendeeCount: 58,
    },
    {
      teacherId: 'partner-teacher-2',
      displayName: '王老师',
      completedLessonCount: 14,
      attendeeCount: 42,
    },
  ],
};
