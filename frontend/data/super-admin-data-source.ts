import {
  SuperAdminAuditLog,
  SuperAdminCampus,
  SuperAdminCampusDetail,
  SuperAdminCampusCustomerServiceQr,
  SuperAdminCampusMapLocation,
  SuperAdminCampusMapLocationInput,
  SuperAdminCreateEarningRuleInput,
  SuperAdminCreatePartnerEarningRuleInput,
  SuperAdminCreateWithdrawalPolicyInput,
  SuperAdminCoursePackageValidityInput,
  SuperAdminCreateStaffAccountInput,
  SuperAdminDashboard,
  SuperAdminEarningRule,
  SuperAdminLessonAdjustmentInput,
  SuperAdminLessonLedgerEntry,
  SuperAdminPage,
  SuperAdminPageQuery,
  SuperAdminPartnerEarning,
  SuperAdminPartnerEarningQuery,
  SuperAdminPartnerEarningRule,
  SuperAdminPartnerEarningRuleQuery,
  SuperAdminProfile,
  SuperAdminRevenuePeriod,
  SuperAdminPayoutProof,
  SuperAdminRolePermission,
  SuperAdminSystemSettings,
  SuperAdminStudentDetail,
  SuperAdminStudentCoursePackage,
  SuperAdminStudentQuery,
  SuperAdminStudentSummary,
  SuperAdminStaffAccount,
  SuperAdminStaffAccountQuery,
  SuperAdminTeacherEarning,
  SuperAdminWithdrawal,
  SuperAdminWithdrawalPolicy,
  SuperAdminUnbindStaffWechatInput,
  SuperAdminUpdateStaffAccountStatusInput,
} from "../types/super-admin";
import {
  GroupCampaignMutationInput,
  GroupCampaignView,
  GroupOrderQuery,
  GroupOrderView,
  GroupPage,
  ManagementCourseProductQuery,
  ManagementCourseProductView,
  ManagementGroupCampaignQuery,
} from "../types/group-buying";

export interface SuperAdminDataSource {
  getDashboard(period?: SuperAdminRevenuePeriod): Promise<SuperAdminDashboard>;
  getProfile(): Promise<SuperAdminProfile>;
  listStaffAccounts(
    query: SuperAdminStaffAccountQuery,
  ): Promise<SuperAdminPage<SuperAdminStaffAccount>>;
  createStaffAccount(
    input: SuperAdminCreateStaffAccountInput,
    idempotencyKey: string,
  ): Promise<SuperAdminStaffAccount>;
  updateStaffAccountStatus(
    id: string,
    input: SuperAdminUpdateStaffAccountStatusInput,
    idempotencyKey: string,
  ): Promise<SuperAdminStaffAccount>;
  unbindStaffWechat(
    id: string,
    input: SuperAdminUnbindStaffWechatInput,
    idempotencyKey: string,
  ): Promise<SuperAdminStaffAccount>;
  listCampuses(
    query: SuperAdminPageQuery & { query?: string },
  ): Promise<SuperAdminPage<SuperAdminCampus>>;
  getCampus(id: string): Promise<SuperAdminCampusDetail>;
  updateCampusMapLocation(
    id: string,
    input: SuperAdminCampusMapLocationInput,
    idempotencyKey: string,
  ): Promise<SuperAdminCampusMapLocation>;
  uploadCampusCustomerServiceQr(
    id: string,
    filePath: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<SuperAdminCampusCustomerServiceQr>;
  listStudents(
    query: SuperAdminStudentQuery,
  ): Promise<SuperAdminPage<SuperAdminStudentSummary>>;
  getStudent(id: string): Promise<SuperAdminStudentDetail>;
  updateCoursePackageValidity(
    id: string,
    input: SuperAdminCoursePackageValidityInput,
    idempotencyKey: string,
  ): Promise<SuperAdminStudentCoursePackage>;
  listLessonLedger(
    query: SuperAdminPageQuery & { campusId?: string; entryType?: string },
  ): Promise<SuperAdminPage<SuperAdminLessonLedgerEntry>>;
  adjustLessonLedger(
    input: SuperAdminLessonAdjustmentInput,
    idempotencyKey: string,
  ): Promise<SuperAdminLessonLedgerEntry>;
  getSystemSettings(): Promise<SuperAdminSystemSettings>;
  getRolePermissions(): Promise<SuperAdminRolePermission[]>;
  listAuditLogs(
    query: SuperAdminPageQuery & { action?: string },
  ): Promise<SuperAdminPage<SuperAdminAuditLog>>;
  listEarningRules(
    query: SuperAdminPageQuery,
  ): Promise<SuperAdminPage<SuperAdminEarningRule>>;
  createEarningRule(
    input: SuperAdminCreateEarningRuleInput,
    idempotencyKey: string,
  ): Promise<SuperAdminEarningRule>;
  transitionEarningRule(
    id: string,
    action: "activate" | "retire",
    version: number,
    idempotencyKey: string,
  ): Promise<SuperAdminEarningRule>;
  listTeacherEarnings(
    query: SuperAdminPageQuery & { status?: string },
  ): Promise<SuperAdminPage<SuperAdminTeacherEarning>>;
  reviewTeacherEarning(
    id: string,
    action: "approve" | "reject",
    version: number,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<SuperAdminTeacherEarning>;
  listPartnerEarningRules(
    query: SuperAdminPartnerEarningRuleQuery,
  ): Promise<SuperAdminPage<SuperAdminPartnerEarningRule>>;
  createPartnerEarningRule(
    input: SuperAdminCreatePartnerEarningRuleInput,
    idempotencyKey: string,
  ): Promise<SuperAdminPartnerEarningRule>;
  transitionPartnerEarningRule(
    id: string,
    action: "activate" | "retire",
    version: number,
    idempotencyKey: string,
  ): Promise<SuperAdminPartnerEarningRule>;
  listPartnerEarnings(
    query: SuperAdminPartnerEarningQuery,
  ): Promise<SuperAdminPage<SuperAdminPartnerEarning>>;
  reviewPartnerEarning(
    id: string,
    action: "approve" | "reject",
    version: number,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<SuperAdminPartnerEarning>;
  listWithdrawalPolicies(
    query: SuperAdminPageQuery,
  ): Promise<SuperAdminPage<SuperAdminWithdrawalPolicy>>;
  createWithdrawalPolicy(
    input: SuperAdminCreateWithdrawalPolicyInput,
    idempotencyKey: string,
  ): Promise<SuperAdminWithdrawalPolicy>;
  transitionWithdrawalPolicy(
    id: string,
    action: "activate" | "retire",
    version: number,
    idempotencyKey: string,
  ): Promise<SuperAdminWithdrawalPolicy>;
  listWithdrawals(
    query: SuperAdminPageQuery & { status?: string },
  ): Promise<SuperAdminPage<SuperAdminWithdrawal>>;
  transitionWithdrawal(
    id: string,
    action: "approve" | "reject" | "mark-paying" | "mark-failed",
    version: number,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<SuperAdminWithdrawal>;
  uploadPayoutProof(filePath: string): Promise<SuperAdminPayoutProof>;
  markWithdrawalPaid(
    id: string,
    version: number,
    payoutReference: string,
    payoutProofFileId: string,
    idempotencyKey: string,
  ): Promise<SuperAdminWithdrawal>;
  listGroupCampaigns(
    query: ManagementGroupCampaignQuery,
  ): Promise<GroupPage<GroupCampaignView>>;
  listCourseProducts(
    query: ManagementCourseProductQuery,
  ): Promise<GroupPage<ManagementCourseProductView>>;
  createGroupCampaign(
    input: GroupCampaignMutationInput,
    idempotencyKey: string,
  ): Promise<GroupCampaignView>;
  updateGroupCampaign(
    id: string,
    input: GroupCampaignMutationInput,
    version: number,
    idempotencyKey: string,
  ): Promise<GroupCampaignView>;
  transitionGroupCampaign(
    id: string,
    action: "activate" | "close" | "cancel",
    version: number,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<GroupCampaignView>;
  uploadGroupCampaignPoster(
    id: string,
    filePath: string,
    version: number,
    idempotencyKey: string,
  ): Promise<GroupCampaignView>;
  reorderGroupCampaignPosters(
    id: string,
    posterIds: string[],
    version: number,
    idempotencyKey: string,
  ): Promise<GroupCampaignView>;
  detachGroupCampaignPoster(
    id: string,
    posterId: string,
    version: number,
    idempotencyKey: string,
  ): Promise<GroupCampaignView>;
  listGroupOrders(query: GroupOrderQuery): Promise<GroupPage<GroupOrderView>>;
  refundGroupOrder(
    id: string,
    version: number,
    reason: string,
    idempotencyKey: string,
  ): Promise<GroupOrderView>;
}

export class SuperAdminDataSourceError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SuperAdminDataSourceError";
  }
}
