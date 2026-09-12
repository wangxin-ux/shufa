import { SuperAdminDataSource } from "../data/super-admin-data-source";
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
  ManagementGroupCampaignQuery,
} from "../types/group-buying";
import { loadRequestState, RequestState } from "../utils/request-state";

export class SuperAdminService {
  constructor(private readonly dataSource: SuperAdminDataSource) {}

  loadDashboard(
    period: SuperAdminRevenuePeriod = "TODAY",
  ): Promise<RequestState<SuperAdminDashboard>> {
    return loadRequestState(
      () => this.dataSource.getDashboard(period),
      (data) => data.campusCount === 0,
    );
  }

  loadProfile(): Promise<RequestState<SuperAdminProfile>> {
    return loadRequestState(() => this.dataSource.getProfile());
  }

  loadStaffAccounts(
    query: SuperAdminStaffAccountQuery,
  ): Promise<RequestState<SuperAdminPage<SuperAdminStaffAccount>>> {
    return loadRequestState(
      () => this.dataSource.listStaffAccounts(query),
      (data) => data.data.length === 0,
    );
  }

  createStaffAccount(
    input: SuperAdminCreateStaffAccountInput,
    idempotencyKey: string,
  ): Promise<RequestState<SuperAdminStaffAccount>> {
    return loadRequestState(() =>
      this.dataSource.createStaffAccount(input, idempotencyKey),
    );
  }

  updateStaffAccountStatus(
    id: string,
    input: SuperAdminUpdateStaffAccountStatusInput,
    idempotencyKey: string,
  ): Promise<RequestState<SuperAdminStaffAccount>> {
    return loadRequestState(() =>
      this.dataSource.updateStaffAccountStatus(id, input, idempotencyKey),
    );
  }

  unbindStaffWechat(
    id: string,
    input: SuperAdminUnbindStaffWechatInput,
    idempotencyKey: string,
  ): Promise<RequestState<SuperAdminStaffAccount>> {
    return loadRequestState(() =>
      this.dataSource.unbindStaffWechat(id, input, idempotencyKey),
    );
  }

  loadCampuses(
    query: SuperAdminPageQuery & { query?: string },
  ): Promise<RequestState<SuperAdminPage<SuperAdminCampus>>> {
    return loadRequestState(
      () => this.dataSource.listCampuses(query),
      (data) => data.data.length === 0,
    );
  }

  loadCampus(id: string): Promise<RequestState<SuperAdminCampusDetail>> {
    return loadRequestState(() => this.dataSource.getCampus(id));
  }

  updateCampusMapLocation(
    id: string,
    input: SuperAdminCampusMapLocationInput,
    idempotencyKey: string,
  ): Promise<RequestState<SuperAdminCampusMapLocation>> {
    return loadRequestState(() =>
      this.dataSource.updateCampusMapLocation(id, input, idempotencyKey),
    );
  }

  uploadCampusCustomerServiceQr(
    id: string,
    filePath: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<RequestState<SuperAdminCampusCustomerServiceQr>> {
    return loadRequestState(() =>
      this.dataSource.uploadCampusCustomerServiceQr(
        id,
        filePath,
        expectedVersion,
        idempotencyKey,
      ),
    );
  }

  loadStudents(
    query: SuperAdminStudentQuery,
  ): Promise<RequestState<SuperAdminPage<SuperAdminStudentSummary>>> {
    return loadRequestState(
      () => this.dataSource.listStudents(query),
      (data) => data.data.length === 0,
    );
  }

  loadStudent(id: string): Promise<RequestState<SuperAdminStudentDetail>> {
    return loadRequestState(() => this.dataSource.getStudent(id));
  }

  updateCoursePackageValidity(
    id: string,
    input: SuperAdminCoursePackageValidityInput,
    idempotencyKey: string,
  ): Promise<RequestState<SuperAdminStudentCoursePackage>> {
    return loadRequestState(() =>
      this.dataSource.updateCoursePackageValidity(id, input, idempotencyKey),
    );
  }

  loadLessonLedger(
    query: SuperAdminPageQuery & { campusId?: string; entryType?: string },
  ): Promise<RequestState<SuperAdminPage<SuperAdminLessonLedgerEntry>>> {
    return loadRequestState(
      () => this.dataSource.listLessonLedger(query),
      (data) => data.data.length === 0,
    );
  }

  adjustLessonLedger(
    input: SuperAdminLessonAdjustmentInput,
    idempotencyKey: string,
  ): Promise<RequestState<SuperAdminLessonLedgerEntry>> {
    return loadRequestState(() =>
      this.dataSource.adjustLessonLedger(input, idempotencyKey),
    );
  }

  loadSystemSettings(): Promise<RequestState<SuperAdminSystemSettings>> {
    return loadRequestState(() => this.dataSource.getSystemSettings());
  }

  loadRolePermissions(): Promise<RequestState<SuperAdminRolePermission[]>> {
    return loadRequestState(
      () => this.dataSource.getRolePermissions(),
      (data) => data.length === 0,
    );
  }

  loadAuditLogs(
    query: SuperAdminPageQuery & { action?: string },
  ): Promise<RequestState<SuperAdminPage<SuperAdminAuditLog>>> {
    return loadRequestState(
      () => this.dataSource.listAuditLogs(query),
      (data) => data.data.length === 0,
    );
  }

  loadEarningRules(
    query: SuperAdminPageQuery,
  ): Promise<RequestState<SuperAdminPage<SuperAdminEarningRule>>> {
    return loadRequestState(
      () => this.dataSource.listEarningRules(query),
      (data) => data.data.length === 0,
    );
  }

  createEarningRule(
    input: SuperAdminCreateEarningRuleInput,
    idempotencyKey: string,
  ): Promise<RequestState<SuperAdminEarningRule>> {
    return loadRequestState(() =>
      this.dataSource.createEarningRule(input, idempotencyKey),
    );
  }

  transitionEarningRule(
    id: string,
    action: "activate" | "retire",
    version: number,
    idempotencyKey: string,
  ): Promise<RequestState<SuperAdminEarningRule>> {
    return loadRequestState(() =>
      this.dataSource.transitionEarningRule(
        id,
        action,
        version,
        idempotencyKey,
      ),
    );
  }

  loadTeacherEarnings(
    query: SuperAdminPageQuery & { status?: string },
  ): Promise<RequestState<SuperAdminPage<SuperAdminTeacherEarning>>> {
    return loadRequestState(
      () => this.dataSource.listTeacherEarnings(query),
      (data) => data.data.length === 0,
    );
  }

  reviewTeacherEarning(
    id: string,
    action: "approve" | "reject",
    version: number,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<RequestState<SuperAdminTeacherEarning>> {
    return loadRequestState(() =>
      this.dataSource.reviewTeacherEarning(
        id,
        action,
        version,
        reason,
        idempotencyKey,
      ),
    );
  }

  loadPartnerEarningRules(
    query: SuperAdminPartnerEarningRuleQuery,
  ): Promise<RequestState<SuperAdminPage<SuperAdminPartnerEarningRule>>> {
    return loadRequestState(
      () => this.dataSource.listPartnerEarningRules(query),
      (data) => data.data.length === 0,
    );
  }

  createPartnerEarningRule(
    input: SuperAdminCreatePartnerEarningRuleInput,
    idempotencyKey: string,
  ): Promise<RequestState<SuperAdminPartnerEarningRule>> {
    return loadRequestState(() =>
      this.dataSource.createPartnerEarningRule(input, idempotencyKey),
    );
  }

  transitionPartnerEarningRule(
    id: string,
    action: "activate" | "retire",
    version: number,
    idempotencyKey: string,
  ): Promise<RequestState<SuperAdminPartnerEarningRule>> {
    return loadRequestState(() =>
      this.dataSource.transitionPartnerEarningRule(
        id,
        action,
        version,
        idempotencyKey,
      ),
    );
  }

  loadPartnerEarnings(
    query: SuperAdminPartnerEarningQuery,
  ): Promise<RequestState<SuperAdminPage<SuperAdminPartnerEarning>>> {
    return loadRequestState(
      () => this.dataSource.listPartnerEarnings(query),
      (data) => data.data.length === 0,
    );
  }

  reviewPartnerEarning(
    id: string,
    action: "approve" | "reject",
    version: number,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<RequestState<SuperAdminPartnerEarning>> {
    return loadRequestState(() =>
      this.dataSource.reviewPartnerEarning(
        id,
        action,
        version,
        reason,
        idempotencyKey,
      ),
    );
  }

  loadWithdrawalPolicies(
    query: SuperAdminPageQuery,
  ): Promise<RequestState<SuperAdminPage<SuperAdminWithdrawalPolicy>>> {
    return loadRequestState(
      () => this.dataSource.listWithdrawalPolicies(query),
      (data) => data.data.length === 0,
    );
  }

  createWithdrawalPolicy(
    input: SuperAdminCreateWithdrawalPolicyInput,
    idempotencyKey: string,
  ): Promise<RequestState<SuperAdminWithdrawalPolicy>> {
    return loadRequestState(() =>
      this.dataSource.createWithdrawalPolicy(input, idempotencyKey),
    );
  }

  transitionWithdrawalPolicy(
    id: string,
    action: "activate" | "retire",
    version: number,
    idempotencyKey: string,
  ): Promise<RequestState<SuperAdminWithdrawalPolicy>> {
    return loadRequestState(() =>
      this.dataSource.transitionWithdrawalPolicy(
        id,
        action,
        version,
        idempotencyKey,
      ),
    );
  }

  loadWithdrawals(
    query: SuperAdminPageQuery & { status?: string },
  ): Promise<RequestState<SuperAdminPage<SuperAdminWithdrawal>>> {
    return loadRequestState(
      () => this.dataSource.listWithdrawals(query),
      (data) => data.data.length === 0,
    );
  }

  transitionWithdrawal(
    id: string,
    action: "approve" | "reject" | "mark-paying" | "mark-failed",
    version: number,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<RequestState<SuperAdminWithdrawal>> {
    return loadRequestState(() =>
      this.dataSource.transitionWithdrawal(
        id,
        action,
        version,
        reason,
        idempotencyKey,
      ),
    );
  }

  uploadPayoutProof(
    filePath: string,
  ): Promise<RequestState<SuperAdminPayoutProof>> {
    return loadRequestState(() => this.dataSource.uploadPayoutProof(filePath));
  }

  markWithdrawalPaid(
    id: string,
    version: number,
    payoutReference: string,
    payoutProofFileId: string,
    idempotencyKey: string,
  ): Promise<RequestState<SuperAdminWithdrawal>> {
    return loadRequestState(() =>
      this.dataSource.markWithdrawalPaid(
        id,
        version,
        payoutReference,
        payoutProofFileId,
        idempotencyKey,
      ),
    );
  }

  loadGroupCampaigns(
    query: ManagementGroupCampaignQuery,
  ): Promise<RequestState<GroupPage<GroupCampaignView>>> {
    return loadRequestState(
      () => this.dataSource.listGroupCampaigns(query),
      (data) => data.data.length === 0,
    );
  }

  loadCourseProducts(
    query: Parameters<SuperAdminDataSource["listCourseProducts"]>[0],
  ): Promise<
    RequestState<
      Awaited<ReturnType<SuperAdminDataSource["listCourseProducts"]>>
    >
  > {
    return loadRequestState(
      () => this.dataSource.listCourseProducts(query),
      (data) => data.data.length === 0,
    );
  }

  createGroupCampaign(
    input: GroupCampaignMutationInput,
    idempotencyKey: string,
  ): Promise<RequestState<GroupCampaignView>> {
    return loadRequestState(() =>
      this.dataSource.createGroupCampaign(input, idempotencyKey),
    );
  }

  updateGroupCampaign(
    id: string,
    input: GroupCampaignMutationInput,
    version: number,
    idempotencyKey: string,
  ): Promise<RequestState<GroupCampaignView>> {
    return loadRequestState(() =>
      this.dataSource.updateGroupCampaign(id, input, version, idempotencyKey),
    );
  }

  transitionGroupCampaign(
    id: string,
    action: "activate" | "close" | "cancel",
    version: number,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<RequestState<GroupCampaignView>> {
    return loadRequestState(() =>
      this.dataSource.transitionGroupCampaign(
        id,
        action,
        version,
        reason,
        idempotencyKey,
      ),
    );
  }

  uploadGroupCampaignPoster(
    id: string,
    filePath: string,
    version: number,
    idempotencyKey: string,
  ): Promise<RequestState<GroupCampaignView>> {
    return loadRequestState(() =>
      this.dataSource.uploadGroupCampaignPoster(
        id,
        filePath,
        version,
        idempotencyKey,
      ),
    );
  }

  reorderGroupCampaignPosters(
    id: string,
    posterIds: string[],
    version: number,
    idempotencyKey: string,
  ): Promise<RequestState<GroupCampaignView>> {
    return loadRequestState(() =>
      this.dataSource.reorderGroupCampaignPosters(
        id,
        posterIds,
        version,
        idempotencyKey,
      ),
    );
  }

  detachGroupCampaignPoster(
    id: string,
    posterId: string,
    version: number,
    idempotencyKey: string,
  ): Promise<RequestState<GroupCampaignView>> {
    return loadRequestState(() =>
      this.dataSource.detachGroupCampaignPoster(
        id,
        posterId,
        version,
        idempotencyKey,
      ),
    );
  }

  loadGroupOrders(
    query: GroupOrderQuery,
  ): Promise<RequestState<GroupPage<GroupOrderView>>> {
    return loadRequestState(
      () => this.dataSource.listGroupOrders(query),
      (data) => data.data.length === 0,
    );
  }

  refundGroupOrder(
    id: string,
    version: number,
    reason: string,
    idempotencyKey: string,
  ): Promise<RequestState<GroupOrderView>> {
    return loadRequestState(() =>
      this.dataSource.refundGroupOrder(id, version, reason, idempotencyKey),
    );
  }
}
