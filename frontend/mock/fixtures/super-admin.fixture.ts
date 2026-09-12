import {
  SuperAdminDashboard,
  SuperAdminPartnerEarning,
  SuperAdminPartnerEarningRule,
  SuperAdminProfile,
} from "../../types/super-admin";

export const SUPER_ADMIN_DASHBOARD_FIXTURE: SuperAdminDashboard = {
  administrator: { displayName: "系统管理员" },
  reportingTimeZone: "Asia/Shanghai",
  campusCount: 3,
  activeStudentCount: 106,
  monthCompletedLessonCount: 72,
  warningStudentCount: 18,
  featuredCampus: {
    id: "10000000-0000-4000-8000-000000000001",
    name: "启明东校区",
    activeStudentCount: 103,
    monthCompletedLessonCount: 93,
    attendanceRatePercent: 96,
    warningStudentCount: 6,
  },
  revenue: {
    period: "TODAY",
    periodLabel: "今日",
    partnerCount: 1,
    countedAttendeeCount: 10,
    grossLessonRevenueFen: 10000,
    partnerEarningFen: 4000,
    headquartersRetainedFen: 6000,
    currency: "CNY",
    campuses: [
      {
        campusId: "10000000-0000-4000-8000-000000000001",
        campusName: "启明东校区",
        partnerCount: 1,
        countedAttendeeCount: 10,
        grossLessonRevenueFen: 10000,
        partnerEarningFen: 4000,
        headquartersRetainedFen: 6000,
      },
      {
        campusId: "10000000-0000-4000-8000-000000000002",
        campusName: "启明西校区",
        partnerCount: 0,
        countedAttendeeCount: 0,
        grossLessonRevenueFen: 0,
        partnerEarningFen: 0,
        headquartersRetainedFen: 0,
      },
    ],
  },
  serverTime: "2026-08-31T08:00:00+08:00",
};

export const SUPER_ADMIN_PROFILE_FIXTURE: SuperAdminProfile = {
  displayName: "系统管理员",
  roleCode: "SUPER_ADMIN",
  campusId: null,
  campusName: "全部校区",
};

export const SUPER_ADMIN_PARTNER_EARNING_RULE_FIXTURE: SuperAdminPartnerEarningRule =
  {
    id: "partner-rule-east-1",
    campusId: "10000000-0000-4000-8000-000000000001",
    campusName: "启明东校区",
    unitPriceFen: 1000,
    shareBasisPoints: 4000,
    eligibleLessonKinds: ["REGULAR", "MAKEUP"],
    countedAttendanceStatuses: ["PRESENT"],
    settlementDelayDays: 0,
    version: 1,
    status: "ACTIVE",
    effectiveFrom: "2026-09-01T00:00:00+08:00",
    effectiveTo: null,
    createdAt: "2026-09-01T00:00:00+08:00",
  };

export const SUPER_ADMIN_PARTNER_EARNING_FIXTURE: SuperAdminPartnerEarning = {
  id: "partner-earning-east-1",
  campusId: "10000000-0000-4000-8000-000000000001",
  campusName: "启明东校区",
  teachingRecordId: "partner-teaching-1",
  lessonSessionId: "partner-lesson-1",
  courseName: "创意基础",
  lessonStartsAt: "2026-09-01T14:00:00+08:00",
  completedAt: "2026-09-01T15:30:00+08:00",
  entryType: "ACCRUAL",
  amountFen: 4000,
  status: "PENDING_REVIEW",
  unitPriceFen: 1000,
  shareBasisPoints: 4000,
  actualAttendeeCount: 10,
  countedAttendeeCount: 10,
  perAttendeeAmountFen: 400,
  reviewableAt: "2026-09-01T15:30:00+08:00",
  reviewedAt: null,
  reviewReason: null,
  createdAt: "2026-09-01T15:30:00+08:00",
  version: 1,
};
