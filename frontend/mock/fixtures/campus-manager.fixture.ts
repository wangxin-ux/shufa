import {
  CampusManagerDashboard,
  CampusManagerCampusSettings,
  CampusManagerLessonSession,
  CampusManagerLeaveRequest,
  CampusManagerProfile,
  CampusManagerSchedulingOptions,
  CampusManagerStudent,
  CampusManagerWarning,
} from "../../types/campus-manager";

export interface CampusManagerFixture {
  dashboard: CampusManagerDashboard;
  profile: CampusManagerProfile;
  students: CampusManagerStudent[];
  schedulingOptions: CampusManagerSchedulingOptions;
  lessonSessions: CampusManagerLessonSession[];
  leaveRequests: CampusManagerLeaveRequest[];
  warnings: CampusManagerWarning[];
  campusSettings: CampusManagerCampusSettings;
}

const campus = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "启明东校区",
};

const manager = {
  displayName: "周园长",
};

export const NORMAL_CAMPUS_MANAGER_FIXTURE: CampusManagerFixture = {
  dashboard: {
    manager,
    campus,
    activeStudentCount: 106,
    todayLessonCount: 12,
    pendingLeaveCount: 2,
    latestPendingLeave: {
      id: "51000000-0000-4000-8000-000000000001",
      studentName: "王同学",
      courseName: "创意基础",
      startsAt: "2026-08-30T14:00:00+08:00",
    },
    serverTime: "2026-08-30T08:00:00+08:00",
  },
  profile: {
    displayName: manager.displayName,
    roleCode: "CAMPUS_MANAGER",
    campusId: campus.id,
    campusName: campus.name,
  },
  students: [
    {
      id: "40000000-0000-4000-8000-000000000001",
      campusId: campus.id,
      displayName: "陈晨",
      birthDate: "2017-04-12",
      classNames: ["创意基础A班", "创意工坊A班"],
    },
    {
      id: "40000000-0000-4000-8000-000000000002",
      campusId: campus.id,
      displayName: "安然",
      birthDate: "2018-09-03",
      classNames: ["创意基础A班"],
    },
    {
      id: "40000000-0000-4000-8000-000000000004",
      campusId: campus.id,
      displayName: "王同学",
      birthDate: null,
      classNames: [],
    },
  ],
  schedulingOptions: {
    classes: [
      {
        classGroupId: "50000000-0000-4000-8000-000000000001",
        className: "创意基础A班",
        courseName: "创意基础",
        teacherId: "30000000-0000-4000-8000-000000000001",
        teacherName: "王老师",
        defaultLessonUnits: 100,
      },
      {
        classGroupId: "50000000-0000-4000-8000-000000000002",
        className: "创意工坊A班",
        courseName: "创意工坊",
        teacherId: "30000000-0000-4000-8000-000000000001",
        teacherName: "王老师",
        defaultLessonUnits: 100,
      },
    ],
  },
  lessonSessions: [
    {
      id: "70000000-0000-4000-8000-000000000002",
      campusId: campus.id,
      classGroupId: "50000000-0000-4000-8000-000000000001",
      className: "创意基础A班",
      courseName: "创意基础",
      teacherId: "30000000-0000-4000-8000-000000000001",
      teacherName: "王老师",
      startsAt: "2026-09-01T06:00:00.000Z",
      endsAt: "2026-09-01T07:30:00.000Z",
      kind: "REGULAR",
      lessonUnits: 100,
      status: "SCHEDULED",
      version: 1,
    },
    {
      id: "70000000-0000-4000-8000-000000000003",
      campusId: campus.id,
      classGroupId: "50000000-0000-4000-8000-000000000002",
      className: "创意工坊A班",
      courseName: "创意工坊",
      teacherId: "30000000-0000-4000-8000-000000000001",
      teacherName: "王老师",
      startsAt: "2026-09-02T06:00:00.000Z",
      endsAt: "2026-09-02T07:30:00.000Z",
      kind: "MAKEUP",
      lessonUnits: 100,
      status: "SCHEDULED",
      version: 1,
    },
  ],
  leaveRequests: [
    {
      id: "51000000-0000-4000-8000-000000000001",
      studentId: "40000000-0000-4000-8000-000000000001",
      studentName: "陈晨",
      lessonSessionId: "70000000-0000-4000-8000-000000000002",
      courseName: "创意基础",
      startsAt: "2026-09-01T06:00:00.000Z",
      reason: "参加学校集体活动",
      status: "PENDING",
      reviewerName: null,
      reviewedAt: null,
      reviewReason: null,
      version: 1,
      createdAt: "2026-08-30T00:00:00.000Z",
    },
    {
      id: "51000000-0000-4000-8000-000000000002",
      studentId: "40000000-0000-4000-8000-000000000004",
      studentName: "王同学",
      lessonSessionId: "70000000-0000-4000-8000-000000000003",
      courseName: "创意工坊",
      startsAt: "2026-09-02T06:00:00.000Z",
      reason: "参加学校运动会",
      status: "PENDING",
      reviewerName: null,
      reviewedAt: null,
      reviewReason: null,
      version: 1,
      createdAt: "2026-08-30T01:00:00.000Z",
    },
    {
      id: "51000000-0000-4000-8000-000000000003",
      studentId: "40000000-0000-4000-8000-000000000002",
      studentName: "安然",
      lessonSessionId: "70000000-0000-4000-8000-000000000002",
      courseName: "创意基础",
      startsAt: "2026-08-29T06:00:00.000Z",
      reason: "身体不适",
      status: "APPROVED",
      reviewerName: manager.displayName,
      reviewedAt: "2026-08-28T09:00:00.000Z",
      reviewReason: "已与家长确认",
      version: 2,
      createdAt: "2026-08-28T08:00:00.000Z",
    },
  ],
  warnings: [
    {
      studentId: "40000000-0000-4000-8000-000000000001",
      studentName: "陈晨",
      classNames: ["创意基础A班", "创意工坊A班"],
      mainBalanceUnits: 300,
      giftBalanceUnits: 200,
      totalBalanceUnits: 500,
      thresholdUnits: 500,
    },
    {
      studentId: "40000000-0000-4000-8000-000000000004",
      studentName: "王同学",
      classNames: [],
      mainBalanceUnits: 0,
      giftBalanceUnits: 0,
      totalBalanceUnits: 0,
      thresholdUnits: 500,
    },
  ],
  campusSettings: {
    id: campus.id,
    code: "campus-demo-east",
    name: campus.name,
    timezone: "Asia/Shanghai",
    contactPhone: "0731-88886666",
    address: "长沙市岳麓区启明路 18 号",
    lessonWarningThresholdUnits: 500,
    version: 1,
  },
};

export const EMPTY_CAMPUS_MANAGER_FIXTURE: CampusManagerFixture = {
  dashboard: {
    ...NORMAL_CAMPUS_MANAGER_FIXTURE.dashboard,
    activeStudentCount: 0,
    todayLessonCount: 0,
    pendingLeaveCount: 0,
    latestPendingLeave: null,
  },
  profile: NORMAL_CAMPUS_MANAGER_FIXTURE.profile,
  students: [],
  schedulingOptions: NORMAL_CAMPUS_MANAGER_FIXTURE.schedulingOptions,
  lessonSessions: [],
  leaveRequests: [],
  warnings: [],
  campusSettings: NORMAL_CAMPUS_MANAGER_FIXTURE.campusSettings,
};
