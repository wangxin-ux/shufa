import {
  TeacherDashboard,
  TeacherEarningEntry,
  TeacherEarningRuleView,
  TeacherEarningSummary,
  TeacherLedgerRecord,
  TeacherLessonDetail,
  TeacherLessonSession,
  TeacherProfile,
  TeacherStudent,
  TeacherWithdrawal,
  TeachingRecord,
} from '../../types/teacher';

export interface TeacherFixture {
  dashboard: TeacherDashboard;
  profile: TeacherProfile;
  lessonSessions: TeacherLessonSession[];
  lessonDetails: Record<string, TeacherLessonDetail>;
  students: TeacherStudent[];
  teachingRecords: TeachingRecord[];
  lessonLedger: TeacherLedgerRecord[];
  earningSummary: TeacherEarningSummary;
  earningRule: TeacherEarningRuleView | null;
  earnings: TeacherEarningEntry[];
  withdrawals: TeacherWithdrawal[];
}

const teacher = {
  displayName: '王老师',
  subjectLabel: '美术老师',
  campusName: '启明成长中心',
};

const completedLesson: TeacherLessonSession = {
  id: '70000000-0000-4000-8000-000000000001',
  version: 2,
  className: '专业美术A班',
  courseName: '专业美术A',
  campusName: teacher.campusName,
  startsAt: '2026-08-28T09:00:00+08:00',
  endsAt: '2026-08-28T10:00:00+08:00',
  lessonUnits: 100,
  status: 'COMPLETED',
  studentCount: 2,
};

const scheduledLesson: TeacherLessonSession = {
  id: '70000000-0000-4000-8000-000000000002',
  version: 1,
  className: '专业美术A班',
  courseName: '专业美术A',
  campusName: teacher.campusName,
  startsAt: '2026-08-30T14:00:00+08:00',
  endsAt: '2026-08-30T15:30:00+08:00',
  lessonUnits: 100,
  status: 'SCHEDULED',
  studentCount: 2,
};

const attendancePolicy = {
  PRESENT: { consumesLessonUnits: true as const },
  LEAVE: { consumesLessonUnits: false },
  ABSENT: { consumesLessonUnits: false },
};

export const NORMAL_TEACHER_FIXTURE: TeacherFixture = {
  dashboard: {
    teacher,
    nextLesson: scheduledLesson,
    todayPendingCount: 1,
    todayCompletedCount: 5,
    responsibleStudentCount: 20,
    serverTime: '2026-08-30T08:00:00+08:00',
  },
  profile: {
    ...teacher,
    responsibleStudentCount: 20,
    roleCode: 'TEACHER',
  },
  lessonSessions: [scheduledLesson, completedLesson],
  lessonDetails: {
    [scheduledLesson.id]: {
      ...scheduledLesson,
      attendancePolicy,
      students: [
        {
          id: '40000000-0000-4000-8000-000000000001',
          displayName: '陈晨',
          attendanceStatus: null,
          expectedConsumeUnits: 0,
          feedback: null,
          feedbackImages: [],
        },
        {
          id: '40000000-0000-4000-8000-000000000002',
          displayName: '安然',
          attendanceStatus: null,
          expectedConsumeUnits: 0,
          feedback: null,
          feedbackImages: [],
        },
      ],
      canComplete: true,
      canReverse: false,
    },
    [completedLesson.id]: {
      ...completedLesson,
      attendancePolicy,
      students: [
        {
          id: '40000000-0000-4000-8000-000000000001',
          displayName: '陈晨',
          attendanceStatus: 'PRESENT',
          expectedConsumeUnits: 100,
          feedback:
            '课堂参与认真，已完成本节课练习。',
          feedbackImages: [],
        },
        {
          id: '40000000-0000-4000-8000-000000000002',
          displayName: '安然',
          attendanceStatus: 'PRESENT',
          expectedConsumeUnits: 100,
          feedback: null,
          feedbackImages: [],
        },
      ],
      canComplete: false,
      canReverse: true,
    },
  },
  students: [
    {
      id: '40000000-0000-4000-8000-000000000001',
      displayName: '陈晨',
      classNames: ['专业美术A班', '创意工坊A班'],
      nextLessonAt: scheduledLesson.startsAt,
      latestFeedbackAt: '2026-08-28T10:00:00+08:00',
    },
    {
      id: '40000000-0000-4000-8000-000000000002',
      displayName: '安然',
      classNames: ['专业美术A班'],
      nextLessonAt: scheduledLesson.startsAt,
      latestFeedbackAt: null,
    },
  ],
  teachingRecords: [
    {
      id: 'a0000000-0000-4000-8000-000000000001',
      lessonSessionId: completedLesson.id,
      className: completedLesson.className,
      courseName: completedLesson.courseName,
      startsAt: completedLesson.startsAt,
      endsAt: completedLesson.endsAt,
      attendeeCount: 2,
      lessonUnits: 100,
      feedbackCompletedCount: 1,
      feedbackRequiredCount: 2,
      status: 'COMPLETED',
    },
  ],
  lessonLedger: [
    {
      id: 'c0000000-0000-4000-8000-000000000001',
      lessonSessionId: completedLesson.id,
      studentId: '40000000-0000-4000-8000-000000000001',
      studentName: '陈晨',
      occurredAt: '2026-08-28T10:00:00+08:00',
      entryType: 'CONSUME',
      bucket: 'MAIN',
      deltaUnits: -100,
    },
    {
      id: 'c0000000-0000-4000-8000-000000000002',
      lessonSessionId: completedLesson.id,
      studentId: '40000000-0000-4000-8000-000000000002',
      studentName: '安然',
      occurredAt: '2026-08-28T10:00:00+08:00',
      entryType: 'CONSUME',
      bucket: 'MAIN',
      deltaUnits: -100,
    },
  ],
  earningSummary: {
    todayEstimatedFen: 10000,
    weekEstimatedFen: 20000,
    monthEstimatedFen: 20000,
    estimatedTotalFen: 20000,
    pendingReviewFen: 10000,
    availableFen: 10000,
    withdrawingFen: 0,
    currency: 'CNY',
  },
  earningRule: {
    id: '81000000-0000-4000-8000-000000000001',
    campusId: '10000000-0000-4000-8000-000000000001',
    teacherId: null,
    basisType: 'PER_COMPLETED_SESSION',
    unitAmountFen: 10000,
    eligibleLessonKinds: ['REGULAR'],
    countedAttendanceStatuses: ['PRESENT'],
    settlementDelayDays: 1,
    version: 1,
    status: 'ACTIVE',
    effectiveFrom: '2026-08-30T00:00:00+08:00',
    effectiveTo: null,
    createdAt: '2026-08-29T08:00:00+08:00',
  },
  earnings: [
    {
      id: '82000000-0000-4000-8000-000000000001',
      campusId: '10000000-0000-4000-8000-000000000001',
      teacherId: '30000000-0000-4000-8000-000000000001',
      teacherName: '王老师',
      teachingRecordId: 'a0000000-0000-4000-8000-000000000001',
      lessonSessionId: completedLesson.id,
      courseName: completedLesson.courseName,
      lessonStartsAt: completedLesson.startsAt,
      entryType: 'ACCRUAL',
      amountFen: 10000,
      status: 'AVAILABLE',
      basisType: 'PER_COMPLETED_SESSION',
      unitAmountFen: 10000,
      lessonUnits: 100,
      attendeeCount: 2,
      reviewableAt: '2026-08-29T10:00:00+08:00',
      reviewedAt: '2026-08-29T11:00:00+08:00',
      rejectionReason: null,
      createdAt: '2026-08-28T10:00:00+08:00',
      version: 2,
    },
    {
      id: '82000000-0000-4000-8000-000000000002',
      campusId: '10000000-0000-4000-8000-000000000001',
      teacherId: '30000000-0000-4000-8000-000000000001',
      teacherName: '王老师',
      teachingRecordId: 'a0000000-0000-4000-8000-000000000002',
      lessonSessionId: '70000000-0000-4000-8000-000000000003',
      courseName: '创意美术进阶',
      lessonStartsAt: '2026-08-29T14:00:00+08:00',
      entryType: 'ACCRUAL',
      amountFen: 10000,
      status: 'PENDING_REVIEW',
      basisType: 'PER_COMPLETED_SESSION',
      unitAmountFen: 10000,
      lessonUnits: 100,
      attendeeCount: 3,
      reviewableAt: '2026-08-30T15:30:00+08:00',
      reviewedAt: null,
      rejectionReason: null,
      createdAt: '2026-08-29T15:30:00+08:00',
      version: 1,
    },
  ],
  withdrawals: [
    {
      id: '83000000-0000-4000-8000-000000000001',
      requestNo: 'TX202608200001',
      campusId: '10000000-0000-4000-8000-000000000001',
      teacherId: '30000000-0000-4000-8000-000000000001',
      teacherName: '王老师',
      amountFen: 10000,
      status: 'PAID',
      requestedAt: '2026-08-20T09:00:00+08:00',
      reviewedAt: '2026-08-20T10:00:00+08:00',
      paidAt: '2026-08-20T16:00:00+08:00',
      rejectionReason: null,
      failureReason: null,
      payoutReference: 'MANUAL-20260820-001',
      payoutProofFileId: '84000000-0000-4000-8000-000000000001',
      version: 4,
    },
  ],
};

export const EMPTY_TEACHER_FIXTURE: TeacherFixture = {
  dashboard: {
    teacher,
    nextLesson: null,
    todayPendingCount: 0,
    todayCompletedCount: 0,
    responsibleStudentCount: 0,
    serverTime: '2026-08-30T08:00:00+08:00',
  },
  profile: {
    ...teacher,
    responsibleStudentCount: 0,
    roleCode: 'TEACHER',
  },
  lessonSessions: [],
  lessonDetails: {},
  students: [],
  teachingRecords: [],
  lessonLedger: [],
  earningSummary: {
    todayEstimatedFen: 0,
    weekEstimatedFen: 0,
    monthEstimatedFen: 0,
    estimatedTotalFen: 0,
    pendingReviewFen: 0,
    availableFen: 0,
    withdrawingFen: 0,
    currency: 'CNY',
  },
  earningRule: null,
  earnings: [],
  withdrawals: [],
};
