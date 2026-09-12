import {
  PartnerAttendance,
  PartnerDashboard,
  PartnerEarningEntry,
  PartnerEarningPeriodQuery,
  PartnerEarningQuery,
  PartnerEarningRule,
  PartnerEarningSummary,
  PartnerLessonAccount,
  PartnerOperationsSummary,
  PartnerPage,
  PartnerPageMeta,
  PartnerPageQuery,
  PartnerProfile,
  PartnerPeriodQuery,
  PartnerSearchQuery,
  PartnerStudent,
  PartnerStudentDetail,
  PartnerTeacher,
  PartnerWarning,
} from '../types/partner';
import {
  GroupPage,
  GroupPromotionCampaignQuery,
  GroupPromotionCampaignView,
} from '../types/group-buying';
import {
  PartnerDataSource,
  PartnerDataSourceError,
} from './partner-data-source';

export interface PartnerHttpResponse {
  statusCode: number;
  data: unknown;
}

export interface PartnerHttpRequestOptions {
  url: string;
  method: 'GET';
  header: Record<string, string>;
  success(response: PartnerHttpResponse): void;
  fail(error: unknown): void;
}

export type PartnerHttpRequest = (
  options: PartnerHttpRequestOptions,
) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const defaultRequest: PartnerHttpRequest = (options) =>
  wx.request({
    url: options.url,
    method: options.method,
    header: options.header,
    success: (response) =>
      options.success({ statusCode: response.statusCode, data: response.data }),
    fail: options.fail,
  });

export class ApiPartnerDataSource implements PartnerDataSource {
  private readonly baseUrl: string;
  private readonly accessToken: () => string;
  private readonly request: PartnerHttpRequest;

  constructor(options: {
    baseUrl: string;
    accessToken: string | (() => string);
    request?: PartnerHttpRequest;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.accessToken =
      typeof options.accessToken === 'function'
        ? options.accessToken
        : () => options.accessToken as string;
    this.request = options.request ?? defaultRequest;
  }

  getDashboard(): Promise<PartnerDashboard> {
    return this.envelope('/partners/me/dashboard');
  }

  getProfile(): Promise<PartnerProfile> {
    return this.envelope('/partners/me/profile');
  }

  listGroupPromotionCampaigns(
    query: GroupPromotionCampaignQuery,
  ): Promise<GroupPage<GroupPromotionCampaignView>> {
    return this.page<
      GroupPromotionCampaignView,
      GroupPromotionCampaignQuery
    >(
      '/partners/me/group-campaigns',
      query,
    ).then((page) => ({
      ...page,
      data: page.data.map((campaign) =>
        this.mapGroupPromotionCampaign(campaign),
      ),
    }));
  }

  getGroupPromotionCampaign(id: string): Promise<GroupPromotionCampaignView> {
    return this.envelope<GroupPromotionCampaignView>(
      `/partners/me/group-campaigns/${encodeURIComponent(id)}`,
    ).then((campaign) => this.mapGroupPromotionCampaign(campaign));
  }

  listStudents(
    query: PartnerSearchQuery,
  ): Promise<PartnerPage<PartnerStudent>> {
    return this.page('/partners/me/students', query);
  }

  getStudent(studentId: string): Promise<PartnerStudentDetail> {
    return this.envelope(
      `/partners/me/students/${encodeURIComponent(studentId)}`,
    );
  }

  getOperationsSummary(
    query: PartnerPeriodQuery,
  ): Promise<PartnerOperationsSummary> {
    return this.envelope(
      `/partners/me/operations-summary${this.query(query)}`,
    );
  }

  listWarnings(
    query: PartnerSearchQuery,
  ): Promise<PartnerPage<PartnerWarning>> {
    return this.page('/partners/me/warnings', query);
  }

  getAttendance(query: PartnerPageQuery): Promise<PartnerAttendance> {
    return this.envelope(`/partners/me/attendance${this.query(query)}`);
  }

  listTeachers(
    query: PartnerSearchQuery,
  ): Promise<PartnerPage<PartnerTeacher>> {
    return this.page('/partners/me/teachers', query);
  }

  getLessonAccount(query: PartnerPageQuery): Promise<PartnerLessonAccount> {
    return this.envelope(`/partners/me/lesson-account${this.query(query)}`);
  }

  getEarningSummary(
    query: PartnerEarningPeriodQuery = {},
  ): Promise<PartnerEarningSummary> {
    return this.envelope(
      `/partners/me/earnings/summary${this.query(query)}`,
    );
  }

  getCurrentEarningRule(): Promise<PartnerEarningRule | null> {
    return this.envelope('/partners/me/earning-rule');
  }

  listEarnings(
    query: PartnerEarningQuery,
  ): Promise<PartnerPage<PartnerEarningEntry>> {
    return this.page('/partners/me/earnings', query);
  }

  private page<T, Q extends object>(
    path: string,
    query: Q,
  ): Promise<PartnerPage<T>> {
    return new Promise((resolve, reject) => {
      this.request({
        url: `${this.baseUrl}${path}${this.query(query)}`,
        method: 'GET',
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
              meta: response.data.meta as unknown as PartnerPageMeta,
            });
            return;
          }
          reject(this.toError(response.statusCode, response.data));
        },
        fail: (error) => reject(this.networkError(error)),
      });
    });
  }

  private envelope<T>(path: string): Promise<T> {
    return new Promise((resolve, reject) => {
      this.request({
        url: `${this.baseUrl}${path}`,
        method: 'GET',
        header: { Authorization: `Bearer ${this.accessToken()}` },
        success: (response) => {
          if (
            response.statusCode >= 200 &&
            response.statusCode < 300 &&
            isRecord(response.data) &&
            'data' in response.data
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
      .filter((entry): entry is [string, string | number] =>
        entry[1] !== undefined,
      )
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
      );
    return entries.length ? `?${entries.join('&')}` : '';
  }

  private mapGroupPromotionCampaign(
    campaign: GroupPromotionCampaignView,
  ): GroupPromotionCampaignView {
    return {
      ...campaign,
      posterImages: campaign.posterImages.map((poster) => ({
        ...poster,
        accessUrl: /^https?:\/\//.test(poster.accessUrl)
          ? poster.accessUrl
          : `${this.baseUrl}${poster.accessUrl.startsWith('/') ? '' : '/'}${poster.accessUrl}`,
      })),
      customerService: {
        ...campaign.customerService,
        qrCodeUrl: campaign.customerService.qrCodeUrl
          ? /^https?:\/\//.test(campaign.customerService.qrCodeUrl)
            ? campaign.customerService.qrCodeUrl
            : `${this.baseUrl}${campaign.customerService.qrCodeUrl.startsWith('/') ? '' : '/'}${campaign.customerService.qrCodeUrl}`
          : null,
      },
    };
  }

  private networkError(error: unknown): Error {
    return new Error(
      error instanceof Error ? error.message : '网络请求失败，请稍后重试',
    );
  }

  private toError(statusCode: number, body: unknown): PartnerDataSourceError {
    const code =
      isRecord(body) && typeof body.code === 'string'
        ? body.code
        : 'UNKNOWN_ERROR';
    const message =
      statusCode === 401
        ? '合作方端登录已失效'
        : statusCode === 403
          ? '当前账号无合作方端访问权限'
          : statusCode >= 500
            ? '服务器处理失败，请稍后重试'
            : isRecord(body) && typeof body.message === 'string'
              ? body.message
              : '请求失败，请稍后重试';
    const details =
      isRecord(body) && isRecord(body.details) ? body.details : {};
    return new PartnerDataSourceError(statusCode, code, message, details);
  }
}
