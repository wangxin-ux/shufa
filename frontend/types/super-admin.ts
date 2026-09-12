export interface SuperAdminFeaturedCampus {
  id: string;
  name: string;
  activeStudentCount: number;
  monthCompletedLessonCount: number;
  attendanceRatePercent: number;
  warningStudentCount: number;
}

export type SuperAdminRevenuePeriod =
  "TODAY" | "LAST_7_DAYS" | "CURRENT_MONTH" | "HISTORY";

export interface SuperAdminRevenueCampusView {
  campusId: string;
  campusName: string;
  partnerCount: number;
  countedAttendeeCount: number;
  grossLessonRevenueFen: number;
  partnerEarningFen: number;
  headquartersRetainedFen: number;
}

export interface SuperAdminRevenueView {
  period: SuperAdminRevenuePeriod;
  periodLabel: string;
  partnerCount: number;
  countedAttendeeCount: number;
  grossLessonRevenueFen: number;
  partnerEarningFen: number;
  headquartersRetainedFen: number;
  currency: "CNY";
  campuses: SuperAdminRevenueCampusView[];
}

export interface SuperAdminDashboard {
  administrator: { displayName: string };
  reportingTimeZone: "Asia/Shanghai";
  campusCount: number;
  activeStudentCount: number;
  monthCompletedLessonCount: number;
  warningStudentCount: number;
  featuredCampus: SuperAdminFeaturedCampus | null;
  revenue: SuperAdminRevenueView;
  serverTime: string;
}

export interface SuperAdminProfile {
  displayName: string;
  roleCode: "SUPER_ADMIN";
  campusId: null;
  campusName: string;
}

export interface SuperAdminPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SuperAdminPage<T> {
  data: T[];
  meta: SuperAdminPageMeta;
}

export interface SuperAdminPageQuery {
  page: number;
  pageSize: number;
}

export type ManageableStaffRole = "TEACHER" | "CAMPUS_MANAGER" | "PARTNER" | "HR" | "FINANCE";
export type DirectlyCreatableStaffRole = "CAMPUS_MANAGER" | "PARTNER" | "HR" | "FINANCE";

export type StaffAccountStatus = "ACTIVE" | "DISABLED";
export type StaffBindingStatus = "BOUND" | "UNBOUND";

export interface SuperAdminStaffAccountQuery extends SuperAdminPageQuery {
  query?: string;
  roleCode?: ManageableStaffRole;
  campusId?: string;
  status?: StaffAccountStatus;
}

export interface SuperAdminStaffAccount {
  id: string;
  displayName: string;
  maskedPhone: string;
  roleCode: ManageableStaffRole;
  campusId: string | null;
  campusName: string;
  bindingStatus: StaffBindingStatus;
  status: StaffAccountStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SuperAdminCreateStaffAccountInput {
  displayName: string;
  phone: string;
  roleCode: DirectlyCreatableStaffRole;
  campusId: string | null;
}

export interface SuperAdminUpdateStaffAccountStatusInput {
  status: StaffAccountStatus;
  expectedVersion: number;
}

export interface SuperAdminUnbindStaffWechatInput {
  expectedVersion: number;
}

export interface SuperAdminCampus {
  id: string;
  code: string;
  name: string;
  timezone: string;
  contactPhone: string | null;
  address: string | null;
  lessonWarningThresholdUnits: number;
  activeStudentCount: number;
  teacherCount: number;
  classCount: number;
  warningStudentCount: number;
}

export interface SuperAdminCampusDetail extends SuperAdminCampus, LessonAvailability {
  monthCompletedLessonCount: number;
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  latitude: number | null;
  longitude: number | null;
  mapVisible: boolean;
  customerServiceQrCodeUrl: string | null;
  version: number;
}

export interface SuperAdminCampusMapLocationInput {
  address: string;
  latitude: number;
  longitude: number;
  mapVisible: boolean;
  expectedVersion: number;
}

export interface SuperAdminCampusMapLocation {
  id: string;
  address: string;
  latitude: number;
  longitude: number;
  mapVisible: boolean;
  version: number;
}

export interface SuperAdminCampusCustomerServiceQr {
  id: string;
  customerServiceQrCodeUrl: string;
  version: number;
}

export interface SuperAdminStudentQuery extends SuperAdminPageQuery {
  campusId?: string;
  query?: string;
}

export interface SuperAdminStudentSummary extends LessonAvailability {
  id: string;
  campusId: string;
  campusName: string;
  displayName: string;
  birthDate: string | null;
  classNames: string[];
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  totalBalanceUnits: number;
  warningThresholdUnits: number;
  lowBalance: boolean;
}

export type SuperAdminCoursePackageStatus =
  "ACTIVE" | "UPCOMING" | "EXPIRED" | "INACTIVE";

export interface SuperAdminStudentCoursePackage extends LessonAvailability {
  id: string;
  name: string;
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  totalBalanceUnits: number;
  validFrom: string;
  expiresAt: string | null;
  status: SuperAdminCoursePackageStatus;
  version: number;
}

export interface SuperAdminStudentDetail extends SuperAdminStudentSummary {
  coursePackages: SuperAdminStudentCoursePackage[];
}

export interface SuperAdminLessonLedgerEntry {
  id: string;
  campusId: string;
  campusName: string;
  studentId: string;
  studentName: string;
  coursePackageId: string;
  coursePackageName: string;
  lessonSessionId: string | null;
  entryType: "CONSUME" | "REVERSAL" | "ADJUSTMENT" | "REFUND" | "GRANT" | "CORRECTION";
  bucket: "MAIN" | "GIFT";
  deltaUnits: number;
  balanceBeforeUnits: number;
  balanceAfterUnits: number;
  reason: string | null;
  actorName: string;
  createdAt: string;
}

export interface SuperAdminLessonAdjustmentInput {
  coursePackageId: string;
  bucket: "MAIN" | "GIFT";
  deltaUnits: number;
  reason: string;
}

export interface SuperAdminCoursePackageValidityInput {
  validFrom: string;
  expiresAt: string | null;
  expectedVersion: number;
  reason: string;
}

export interface SuperAdminSystemSettings {
  reportingTimeZone: "Asia/Shanghai";
  paymentMode: string;
  payoutMode: string;
  fileStorageMode: string;
  realPaymentEnabled: false;
  automaticPayoutEnabled: false;
  automaticProfitSharingEnabled: false;
  roleCount: number;
}

export interface SuperAdminRolePermission {
  roleCode: string;
  roleLabel: string;
  permissions: string[];
}

export interface SuperAdminAuditLog {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: "SUCCESS" | "DENIED" | "FAILURE";
  details: Record<string, unknown>;
  actorName: string;
  campusName: string;
  createdAt: string;
}

export type ConfigurationStatus = "DRAFT" | "ACTIVE" | "RETIRED";
export type TeacherEarningStatus =
  "PENDING_REVIEW" | "AVAILABLE" | "REJECTED" | "REVERSED";

export interface SuperAdminEarningRule {
  id: string;
  campusId: string;
  teacherId: string | null;
  basisType: string;
  unitAmountFen: number;
  eligibleLessonKinds: string[];
  countedAttendanceStatuses: string[];
  settlementDelayDays: number;
  version: number;
  status: ConfigurationStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

export interface SuperAdminTeacherEarning {
  id: string;
  campusId: string;
  teacherId: string;
  teacherName: string;
  amountFen: number;
  status: TeacherEarningStatus;
  reviewableAt: string;
  reviewedAt: string | null;
  reviewReason: string | null;
  createdAt: string;
  version: number;
}

export interface SuperAdminWithdrawalPolicy {
  id: string;
  minimumAmountFen: number;
  dailyRequestLimit: number;
  version: number;
  status: ConfigurationStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

export interface SuperAdminCreateEarningRuleInput {
  campusId: string;
  teacherId: string | null;
  basisType:
    "PER_COMPLETED_SESSION" | "PER_LESSON_UNIT" | "PER_PRESENT_ATTENDEE";
  unitAmountFen: number;
  eligibleLessonKinds: Array<"REGULAR" | "MAKEUP" | "TRIAL">;
  countedAttendanceStatuses: Array<"PRESENT" | "LEAVE" | "ABSENT">;
  settlementDelayDays: number;
  effectiveFrom: string;
}

export interface SuperAdminCreateWithdrawalPolicyInput {
  minimumAmountFen: number;
  dailyRequestLimit: number;
  effectiveFrom: string;
}

export interface SuperAdminPayoutProof {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export type WithdrawalStatus =
  | "SUBMITTED"
  | "APPROVED"
  | "PAYING"
  | "PAID"
  | "CANCELLED"
  | "REJECTED"
  | "FAILED";

export interface SuperAdminWithdrawal {
  id: string;
  requestNo: string;
  campusId: string;
  teacherId: string;
  teacherName: string;
  amountFen: number;
  status: WithdrawalStatus;
  requestedAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
  rejectionReason: string | null;
  failureReason: string | null;
  payoutReference: string | null;
  payoutProofFileId: string | null;
  version: number;
}

export type PartnerEarningStatus =
  "PENDING_REVIEW" | "AVAILABLE" | "REJECTED" | "REVERSED";

export interface SuperAdminPartnerEarningRule {
  id: string;
  campusId: string;
  campusName: string;
  unitPriceFen: number;
  shareBasisPoints: number;
  eligibleLessonKinds: Array<"REGULAR" | "MAKEUP" | "TRIAL">;
  countedAttendanceStatuses: Array<"PRESENT" | "LEAVE" | "ABSENT">;
  settlementDelayDays: number;
  version: number;
  status: ConfigurationStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

export interface SuperAdminCreatePartnerEarningRuleInput {
  campusId: string;
  unitPriceFen: number;
  shareBasisPoints: number;
  eligibleLessonKinds: Array<"REGULAR" | "MAKEUP" | "TRIAL">;
  countedAttendanceStatuses: Array<"PRESENT" | "LEAVE" | "ABSENT">;
  settlementDelayDays: number;
  effectiveFrom: string;
}

export interface SuperAdminPartnerEarning {
  id: string;
  campusId: string;
  campusName: string;
  teachingRecordId: string;
  lessonSessionId: string;
  courseName: string;
  lessonStartsAt: string;
  completedAt: string;
  entryType: "ACCRUAL" | "REVERSAL";
  amountFen: number;
  status: PartnerEarningStatus;
  unitPriceFen: number;
  shareBasisPoints: number;
  actualAttendeeCount: number;
  countedAttendeeCount: number;
  perAttendeeAmountFen: number;
  reviewableAt: string;
  reviewedAt: string | null;
  reviewReason: string | null;
  createdAt: string;
  version: number;
}

export interface SuperAdminPartnerEarningRuleQuery extends SuperAdminPageQuery {
  campusId?: string;
  status?: ConfigurationStatus;
}

export interface SuperAdminPartnerEarningQuery extends SuperAdminPageQuery {
  campusId?: string;
  status?: PartnerEarningStatus;
}
export type {
  GroupCampaignMutationInput,
  GroupCampaignStatus,
  GroupCampaignView,
  GroupMemberStatus,
  GroupOrderQuery,
  GroupOrderView,
  ManagementGroupCampaignQuery,
} from "./group-buying";
import type { LessonAvailability } from '../services/lesson-availability';
