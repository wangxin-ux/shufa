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
  SuperAdminPageMeta,
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
import {
  SuperAdminDataSource,
  SuperAdminDataSourceError,
} from "./super-admin-data-source";

export interface SuperAdminHttpResponse {
  statusCode: number;
  data: unknown;
}

export interface SuperAdminHttpRequestOptions {
  url: string;
  method: "GET" | "POST" | "PATCH";
  header: Record<string, string>;
  data?: unknown;
  success(response: SuperAdminHttpResponse): void;
  fail(error: unknown): void;
}

export type SuperAdminHttpRequest = (
  options: SuperAdminHttpRequestOptions,
) => unknown;

export interface SuperAdminUploadFileOptions {
  url: string;
  filePath: string;
  name: string;
  header: Record<string, string>;
  formData?: Record<string, string>;
  success(response: { statusCode: number; data: string }): void;
  fail(error: unknown): void;
}

export type SuperAdminUploadFile = (
  options: SuperAdminUploadFileOptions,
) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const defaultRequest: SuperAdminHttpRequest = (options) =>
  wx.request({
    url: options.url,
    method: options.method as WechatMiniprogram.RequestOption["method"],
    header: options.header,
    data: options.data as WechatMiniprogram.IAnyObject | undefined,
    success: (response) =>
      options.success({ statusCode: response.statusCode, data: response.data }),
    fail: options.fail,
  });

const defaultUploadFile: SuperAdminUploadFile = (options) =>
  wx.uploadFile({
    url: options.url,
    filePath: options.filePath,
    name: options.name,
    header: options.header,
    formData: options.formData,
    success: options.success,
    fail: options.fail,
  });

export class ApiSuperAdminDataSource implements SuperAdminDataSource {
  private readonly baseUrl: string;
  private readonly accessToken: () => string;
  private readonly request: SuperAdminHttpRequest;
  private readonly uploadFile: SuperAdminUploadFile;

  constructor(options: {
    baseUrl: string;
    accessToken: string | (() => string);
    request?: SuperAdminHttpRequest;
    uploadFile?: SuperAdminUploadFile;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.accessToken =
      typeof options.accessToken === "function"
        ? options.accessToken
        : () => options.accessToken as string;
    this.request = options.request ?? defaultRequest;
    this.uploadFile = options.uploadFile ?? defaultUploadFile;
  }

  getDashboard(
    period: SuperAdminRevenuePeriod = "TODAY",
  ): Promise<SuperAdminDashboard> {
    return this.envelope(
      `/management/dashboard${this.query({ revenuePeriod: period })}`,
    );
  }

  getProfile(): Promise<SuperAdminProfile> {
    return this.envelope("/management/profile");
  }

  listStaffAccounts(
    query: SuperAdminStaffAccountQuery,
  ): Promise<SuperAdminPage<SuperAdminStaffAccount>> {
    return this.page("/management/staff-accounts", query);
  }

  createStaffAccount(
    input: SuperAdminCreateStaffAccountInput,
    idempotencyKey: string,
  ): Promise<SuperAdminStaffAccount> {
    return this.envelope(
      "/management/staff-accounts",
      "POST",
      input,
      idempotencyKey,
    );
  }

  updateStaffAccountStatus(
    id: string,
    input: SuperAdminUpdateStaffAccountStatusInput,
    idempotencyKey: string,
  ): Promise<SuperAdminStaffAccount> {
    return this.envelope(
      `/management/staff-accounts/${encodeURIComponent(id)}/status`,
      "PATCH",
      input,
      idempotencyKey,
    );
  }

  unbindStaffWechat(
    id: string,
    input: SuperAdminUnbindStaffWechatInput,
    idempotencyKey: string,
  ): Promise<SuperAdminStaffAccount> {
    return this.envelope(
      `/management/staff-accounts/${encodeURIComponent(id)}/unbind-wechat`,
      "POST",
      input,
      idempotencyKey,
    );
  }

  listCampuses(
    query: SuperAdminPageQuery & { query?: string },
  ): Promise<SuperAdminPage<SuperAdminCampus>> {
    return this.page("/management/campuses", query);
  }

  getCampus(id: string): Promise<SuperAdminCampusDetail> {
    return this.envelope(`/management/campuses/${encodeURIComponent(id)}`);
  }

  updateCampusMapLocation(
    id: string,
    input: SuperAdminCampusMapLocationInput,
    idempotencyKey: string,
  ): Promise<SuperAdminCampusMapLocation> {
    return this.envelope(
      `/management/campuses/${encodeURIComponent(id)}/map-location`,
      "PATCH",
      input,
      idempotencyKey,
    );
  }

  uploadCampusCustomerServiceQr(
    id: string,
    filePath: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<SuperAdminCampusCustomerServiceQr> {
    return new Promise((resolve, reject) => {
      this.uploadFile({
        url: `${this.baseUrl}/management/campuses/${encodeURIComponent(id)}/customer-service-qr`,
        filePath,
        name: "file",
        header: {
          Authorization: `Bearer ${this.accessToken()}`,
          "Idempotency-Key": idempotencyKey,
        },
        formData: { expectedVersion: String(expectedVersion) },
        success: (response) => {
          try {
            const body = JSON.parse(response.data) as unknown;
            if (
              response.statusCode >= 200 &&
              response.statusCode < 300 &&
              isRecord(body) &&
              "data" in body
            ) {
              const data = body.data as SuperAdminCampusCustomerServiceQr;
              resolve({
                ...data,
                customerServiceQrCodeUrl: this.absoluteUrl(
                  data.customerServiceQrCodeUrl,
                ),
              });
              return;
            }
            reject(this.toError(response.statusCode, body));
          } catch {
            reject(new Error("客服二维码响应格式无效"));
          }
        },
        fail: (error) => reject(this.networkError(error)),
      });
    });
  }

  listStudents(
    query: SuperAdminStudentQuery,
  ): Promise<SuperAdminPage<SuperAdminStudentSummary>> {
    return this.page("/management/students", query);
  }

  getStudent(id: string): Promise<SuperAdminStudentDetail> {
    return this.envelope(`/management/students/${encodeURIComponent(id)}`);
  }

  updateCoursePackageValidity(
    id: string,
    input: SuperAdminCoursePackageValidityInput,
    idempotencyKey: string,
  ): Promise<SuperAdminStudentCoursePackage> {
    return this.envelope(
      `/management/course-packages/${encodeURIComponent(id)}/validity`,
      "PATCH",
      input,
      idempotencyKey,
    );
  }

  listLessonLedger(
    query: SuperAdminPageQuery & { campusId?: string; entryType?: string },
  ): Promise<SuperAdminPage<SuperAdminLessonLedgerEntry>> {
    return this.page("/management/lesson-ledger", query);
  }

  adjustLessonLedger(
    input: SuperAdminLessonAdjustmentInput,
    idempotencyKey: string,
  ): Promise<SuperAdminLessonLedgerEntry> {
    return this.envelope(
      "/management/lesson-ledger/adjustments",
      "POST",
      input,
      idempotencyKey,
    );
  }

  getSystemSettings(): Promise<SuperAdminSystemSettings> {
    return this.envelope("/management/system-settings");
  }

  getRolePermissions(): Promise<SuperAdminRolePermission[]> {
    return this.envelope("/management/role-permissions");
  }

  listAuditLogs(
    query: SuperAdminPageQuery & { action?: string },
  ): Promise<SuperAdminPage<SuperAdminAuditLog>> {
    return this.page("/management/audit-logs", query);
  }

  listEarningRules(
    query: SuperAdminPageQuery,
  ): Promise<SuperAdminPage<SuperAdminEarningRule>> {
    return this.page("/management/earning-rules", query);
  }

  createEarningRule(
    input: SuperAdminCreateEarningRuleInput,
    idempotencyKey: string,
  ): Promise<SuperAdminEarningRule> {
    return this.envelope(
      "/management/earning-rules",
      "POST",
      input,
      idempotencyKey,
    );
  }

  transitionEarningRule(
    id: string,
    action: "activate" | "retire",
    version: number,
    idempotencyKey: string,
  ): Promise<SuperAdminEarningRule> {
    const data =
      action === "activate"
        ? { expectedVersion: version }
        : { expectedVersion: version, effectiveTo: new Date().toISOString() };
    return this.envelope(
      `/management/earning-rules/${encodeURIComponent(id)}/${action}`,
      "POST",
      data,
      idempotencyKey,
    );
  }

  listTeacherEarnings(
    query: SuperAdminPageQuery & { status?: string },
  ): Promise<SuperAdminPage<SuperAdminTeacherEarning>> {
    return this.page("/management/teacher-earnings", query);
  }

  reviewTeacherEarning(
    id: string,
    action: "approve" | "reject",
    version: number,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<SuperAdminTeacherEarning> {
    return this.envelope(
      `/management/teacher-earnings/${encodeURIComponent(id)}/${action}`,
      "POST",
      { expectedVersion: version, ...(reason ? { reason } : {}) },
      idempotencyKey,
    );
  }

  listPartnerEarningRules(
    query: SuperAdminPartnerEarningRuleQuery,
  ): Promise<SuperAdminPage<SuperAdminPartnerEarningRule>> {
    return this.page("/management/partner-earning-rules", query);
  }

  createPartnerEarningRule(
    input: SuperAdminCreatePartnerEarningRuleInput,
    idempotencyKey: string,
  ): Promise<SuperAdminPartnerEarningRule> {
    return this.envelope(
      "/management/partner-earning-rules",
      "POST",
      input,
      idempotencyKey,
    );
  }

  transitionPartnerEarningRule(
    id: string,
    action: "activate" | "retire",
    version: number,
    idempotencyKey: string,
  ): Promise<SuperAdminPartnerEarningRule> {
    return this.envelope(
      `/management/partner-earning-rules/${encodeURIComponent(id)}/${action}`,
      "POST",
      { expectedVersion: version },
      idempotencyKey,
    );
  }

  listPartnerEarnings(
    query: SuperAdminPartnerEarningQuery,
  ): Promise<SuperAdminPage<SuperAdminPartnerEarning>> {
    return this.page("/management/partner-earnings", query);
  }

  reviewPartnerEarning(
    id: string,
    action: "approve" | "reject",
    version: number,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<SuperAdminPartnerEarning> {
    return this.envelope(
      `/management/partner-earnings/${encodeURIComponent(id)}/${action}`,
      "POST",
      { expectedVersion: version, ...(reason ? { reason } : {}) },
      idempotencyKey,
    );
  }

  listWithdrawalPolicies(
    query: SuperAdminPageQuery,
  ): Promise<SuperAdminPage<SuperAdminWithdrawalPolicy>> {
    return this.page("/management/teacher-withdrawal-policies", query);
  }

  createWithdrawalPolicy(
    input: SuperAdminCreateWithdrawalPolicyInput,
    idempotencyKey: string,
  ): Promise<SuperAdminWithdrawalPolicy> {
    return this.envelope(
      "/management/teacher-withdrawal-policies",
      "POST",
      input,
      idempotencyKey,
    );
  }

  transitionWithdrawalPolicy(
    id: string,
    action: "activate" | "retire",
    version: number,
    idempotencyKey: string,
  ): Promise<SuperAdminWithdrawalPolicy> {
    const data =
      action === "activate"
        ? { expectedVersion: version }
        : { expectedVersion: version, effectiveTo: new Date().toISOString() };
    return this.envelope(
      `/management/teacher-withdrawal-policies/${encodeURIComponent(id)}/${action}`,
      "POST",
      data,
      idempotencyKey,
    );
  }

  listWithdrawals(
    query: SuperAdminPageQuery & { status?: string },
  ): Promise<SuperAdminPage<SuperAdminWithdrawal>> {
    return this.page("/management/withdrawals", query);
  }

  transitionWithdrawal(
    id: string,
    action: "approve" | "reject" | "mark-paying" | "mark-failed",
    version: number,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<SuperAdminWithdrawal> {
    return this.envelope(
      `/management/withdrawals/${encodeURIComponent(id)}/${action}`,
      "POST",
      { expectedVersion: version, ...(reason ? { reason } : {}) },
      idempotencyKey,
    );
  }

  uploadPayoutProof(filePath: string): Promise<SuperAdminPayoutProof> {
    return new Promise((resolve, reject) => {
      this.uploadFile({
        url: `${this.baseUrl}/management/payout-proofs`,
        filePath,
        name: "file",
        header: { Authorization: `Bearer ${this.accessToken()}` },
        success: (response) => {
          try {
            const body = JSON.parse(response.data) as unknown;
            if (
              response.statusCode >= 200 &&
              response.statusCode < 300 &&
              isRecord(body) &&
              "data" in body
            ) {
              resolve(body.data as SuperAdminPayoutProof);
              return;
            }
            reject(this.toError(response.statusCode, body));
          } catch {
            reject(new Error("打款凭证响应格式无效"));
          }
        },
        fail: (error) => reject(this.networkError(error)),
      });
    });
  }

  private absoluteUrl(value: string): string {
    return /^https?:\/\//.test(value)
      ? value
      : `${this.baseUrl}${value.startsWith("/") ? "" : "/"}${value}`;
  }

  markWithdrawalPaid(
    id: string,
    version: number,
    payoutReference: string,
    payoutProofFileId: string,
    idempotencyKey: string,
  ): Promise<SuperAdminWithdrawal> {
    return this.envelope(
      `/management/withdrawals/${encodeURIComponent(id)}/mark-paid`,
      "POST",
      { expectedVersion: version, payoutReference, payoutProofFileId },
      idempotencyKey,
    );
  }

  listGroupCampaigns(
    query: ManagementGroupCampaignQuery,
  ): Promise<GroupPage<GroupCampaignView>> {
    return this.page<GroupCampaignView, ManagementGroupCampaignQuery>(
      "/management/group-campaigns",
      query,
    ).then((page) => ({
      ...page,
      data: page.data.map((campaign) => this.mapGroupCampaign(campaign)),
    }));
  }

  listCourseProducts(
    query: ManagementCourseProductQuery,
  ): Promise<GroupPage<ManagementCourseProductView>> {
    return this.page<ManagementCourseProductView, ManagementCourseProductQuery>(
      "/management/course-products",
      query,
    );
  }

  createGroupCampaign(
    input: GroupCampaignMutationInput,
    idempotencyKey: string,
  ): Promise<GroupCampaignView> {
    return this.envelope<GroupCampaignView>(
      "/management/group-campaigns",
      "POST",
      input,
      idempotencyKey,
    ).then((campaign) => this.mapGroupCampaign(campaign));
  }

  updateGroupCampaign(
    id: string,
    input: GroupCampaignMutationInput,
    version: number,
    idempotencyKey: string,
  ): Promise<GroupCampaignView> {
    return this.envelope<GroupCampaignView>(
      `/management/group-campaigns/${encodeURIComponent(id)}`,
      "PATCH",
      { ...input, expectedVersion: version },
      idempotencyKey,
    ).then((campaign) => this.mapGroupCampaign(campaign));
  }

  transitionGroupCampaign(
    id: string,
    action: "activate" | "close" | "cancel",
    version: number,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<GroupCampaignView> {
    return this.envelope<GroupCampaignView>(
      `/management/group-campaigns/${encodeURIComponent(id)}/${action}`,
      "POST",
      action === "cancel"
        ? { expectedVersion: version, reason: reason ?? "总端取消活动" }
        : { expectedVersion: version },
      idempotencyKey,
    ).then((campaign) => this.mapGroupCampaign(campaign));
  }

  uploadGroupCampaignPoster(
    id: string,
    filePath: string,
    version: number,
    idempotencyKey: string,
  ): Promise<GroupCampaignView> {
    return new Promise((resolve, reject) => {
      this.uploadFile({
        url: `${this.baseUrl}/management/group-campaigns/${encodeURIComponent(id)}/posters`,
        filePath,
        name: "file",
        header: {
          Authorization: `Bearer ${this.accessToken()}`,
          "Idempotency-Key": idempotencyKey,
        },
        formData: { expectedVersion: String(version) },
        success: (response) => {
          try {
            const body = JSON.parse(response.data) as unknown;
            if (
              response.statusCode >= 200 &&
              response.statusCode < 300 &&
              isRecord(body) &&
              "data" in body
            ) {
              resolve(this.mapGroupCampaign(body.data as GroupCampaignView));
              return;
            }
            reject(this.toError(response.statusCode, body));
          } catch {
            reject(new Error("活动海报响应格式无效"));
          }
        },
        fail: (error) => reject(this.networkError(error)),
      });
    });
  }

  reorderGroupCampaignPosters(
    id: string,
    posterIds: string[],
    version: number,
    idempotencyKey: string,
  ): Promise<GroupCampaignView> {
    return this.envelope<GroupCampaignView>(
      `/management/group-campaigns/${encodeURIComponent(id)}/posters/reorder`,
      "POST",
      { expectedVersion: version, posterIds },
      idempotencyKey,
    ).then((campaign) => this.mapGroupCampaign(campaign));
  }

  detachGroupCampaignPoster(
    id: string,
    posterId: string,
    version: number,
    idempotencyKey: string,
  ): Promise<GroupCampaignView> {
    return this.envelope<GroupCampaignView>(
      `/management/group-campaigns/${encodeURIComponent(id)}/posters/${encodeURIComponent(posterId)}/detach`,
      "POST",
      { expectedVersion: version },
      idempotencyKey,
    ).then((campaign) => this.mapGroupCampaign(campaign));
  }

  listGroupOrders(query: GroupOrderQuery): Promise<GroupPage<GroupOrderView>> {
    return this.page("/management/group-orders", query);
  }

  refundGroupOrder(
    id: string,
    version: number,
    reason: string,
    idempotencyKey: string,
  ): Promise<GroupOrderView> {
    return this.envelope(
      `/management/group-orders/${encodeURIComponent(id)}/refund`,
      "POST",
      { expectedVersion: version, reason },
      idempotencyKey,
    );
  }

  private page<T, Q extends object>(
    path: string,
    query: Q,
  ): Promise<SuperAdminPage<T>> {
    const suffix = this.query(query);
    return new Promise((resolve, reject) => {
      this.request({
        url: `${this.baseUrl}${path}${suffix}`,
        method: "GET",
        header: { Authorization: `Bearer ${this.accessToken()}` },
        success: (response) => {
          if (
            response.statusCode >= 200 &&
            response.statusCode < 300 &&
            isRecord(response.data) &&
            Array.isArray(response.data.data) &&
            isRecord(response.data.meta)
          ) {
            resolve({
              data: response.data.data as T[],
              meta: response.data.meta as unknown as SuperAdminPageMeta,
            });
            return;
          }
          reject(this.toError(response.statusCode, response.data));
        },
        fail: (error) => reject(this.networkError(error)),
      });
    });
  }

  private envelope<T>(
    path: string,
    method: "GET" | "POST" | "PATCH" = "GET",
    data?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.request({
        url: `${this.baseUrl}${path}`,
        method,
        header: {
          Authorization: `Bearer ${this.accessToken()}`,
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        data,
        success: (response) => {
          if (
            response.statusCode >= 200 &&
            response.statusCode < 300 &&
            isRecord(response.data) &&
            "data" in response.data
          ) {
            resolve(response.data.data as T);
            return;
          }
          reject(this.toError(response.statusCode, response.data));
        },
        fail: (error) => reject(this.networkError(error)),
      });
    });
  }

  private query(values: object): string {
    const entries = Object.entries(values as Record<string, unknown>)
      .filter(
        (entry): entry is [string, string | number] => entry[1] !== undefined,
      )
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
      );
    return entries.length ? `?${entries.join("&")}` : "";
  }

  private mapGroupCampaign(campaign: GroupCampaignView): GroupCampaignView {
    return {
      ...campaign,
      posterImages: campaign.posterImages.map((poster) => ({
        ...poster,
        accessUrl: this.absoluteMediaUrl(poster.accessUrl),
      })),
    };
  }

  private absoluteMediaUrl(url: string): string {
    return /^https?:\/\//.test(url)
      ? url
      : `${this.baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
  }

  private networkError(error: unknown): Error {
    return new Error(
      error instanceof Error ? error.message : "网络请求失败，请稍后重试",
    );
  }

  private toError(statusCode: number, body: unknown) {
    const code =
      isRecord(body) && typeof body.code === "string"
        ? body.code
        : "UNKNOWN_ERROR";
    const stableMessage: Partial<Record<string, string>> = {
      STAFF_PHONE_ALREADY_EXISTS: "该手机号已创建工作人员账号",
      STAFF_ACCOUNT_UNAVAILABLE: "工作人员账号不存在或当前不可用",
      STAFF_ACCOUNT_VERSION_CONFLICT: "账号状态已更新，请刷新后重试",
      WECHAT_IDENTITY_CONFLICT: "该账号或微信已绑定，请联系管理员处理",
    };
    const message =
      statusCode === 401
        ? "总端登录已失效"
        : statusCode === 403
          ? "当前账号无总端访问权限"
          : stableMessage[code]
            ? (stableMessage[code] as string)
            : statusCode >= 500
              ? "服务器处理失败，请稍后重试"
              : isRecord(body) && typeof body.message === "string"
                ? body.message
                : "请求失败，请稍后重试";
    return new SuperAdminDataSourceError(statusCode, code, message);
  }
}
