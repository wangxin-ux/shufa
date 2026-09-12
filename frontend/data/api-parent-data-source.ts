import {
  LeaveDraft,
  LeavePageView,
  LeaveRecord,
  LeaveStatus,
  ParentHomeSummary,
  ParentCampusLocation,
  ParentCampusPage,
  ParentCampusQuery,
  ParentFeedbackImage,
  ParentHoursView,
  ParentProfileView,
  ParentProfileUpdateInput,
  ParentUpdatesView,
} from '../types/parent';
import {
  GroupCampaignView,
  GroupJoinInput,
  GroupJoinView,
  GroupOrderQuery,
  GroupOrderView,
  GroupPage,
  GroupPrepayView,
  ParentGroupCampaignQuery,
} from '../types/group-buying';
import { formatDateTimeLabel } from '../utils/format';
import {
  ParentDataSource,
  ParentDataSourceError,
} from './parent-data-source';

export interface ParentHttpResponse {
  statusCode: number;
  data: unknown;
}

export interface ParentHttpRequestOptions {
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  header: Record<string, string>;
  data?: unknown;
  success(response: ParentHttpResponse): void;
  fail(error: unknown): void;
}

export type ParentHttpRequest = (options: ParentHttpRequestOptions) => unknown;

export interface ApiParentDataSourceOptions {
  baseUrl: string;
  accessToken: string | (() => string);
  request?: ParentHttpRequest;
}

interface SuccessEnvelope<T> {
  data: T;
  requestId: string;
}

const PARENT_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: '登录已失效，请重新登录',
  GROUP_ALREADY_JOINED: '该学员已参加本活动',
  GROUP_CAMPAIGN_NOT_ACTIVE: '该拼团活动当前不可参与',
  GROUP_MEMBER_STATUS_CONFLICT: '拼团状态已更新，请刷新后重试',
  GROUP_TEAM_FULL: '该拼团队伍人数已满',
  PAYMENT_PROVIDER_UNAVAILABLE: '支付服务暂不可用，请稍后重试',
  STUDENT_PROFILE_VERSION_CONFLICT: '资料已更新，请刷新后重试',
};

interface ApiHomeView {
  student: ParentHomeSummary['student'] | null;
  nextLesson: null | {
    id: string;
    startsAt: string;
    endsAt: string;
    campusName: string;
    courseName: string;
    teacherName: string;
  };
  remainingUnits: number;
  attendanceRatePercent: number | null;
}

interface ApiHoursView {
  availableTotalUnits?: number;
  mainAvailableUnits?: number;
  giftAvailableUnits?: number;
  mainReservedUnits?: number;
  giftReservedUnits?: number;
  remainingTotalUnits: number;
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  paidAmountFen: number;
  validUntil: string | null;
  entries: Array<{
    id: string;
    lessonSessionId: string | null;
    courseName: string;
    teacherName: string;
    attendanceStatus: string | null;
    entryType: string;
    deltaUnits: number;
    occurredAt: string;
    reason: string | null;
  }>;
}

interface ApiLeaveRecord {
  id: string;
  courseName: string;
  lessonStartsAt: string;
  reason: string;
  status: string;
  reviewerName?: string | null;
  reviewedAt?: string | null;
  reviewReason?: string | null;
}

interface ApiLeavePage {
  students: LeavePageView['students'];
  lessons: LeavePageView['lessons'];
  records: ApiLeaveRecord[];
  cutoffHours: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const defaultRequest: ParentHttpRequest = (options) =>
  wx.request({
    url: options.url,
    method: options.method,
    header: options.header,
    data: options.data as
      | string
      | WechatMiniprogram.IAnyObject
      | ArrayBuffer
      | undefined,
    success: (response) =>
      options.success({ statusCode: response.statusCode, data: response.data }),
    fail: options.fail,
  });

function unitsToHours(units: number): number {
  return units / 100;
}

function formatUnits(units: number): string {
  return String(unitsToHours(units));
}

function formatLessonDate(value: string): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.month}月${values.day}日 ${values.weekday}`;
}

function formatLessonTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

function attendanceLabel(status: string | null): string {
  return {
    PRESENT: '正常上课',
    LEAVE: '请假',
    ABSENT: '缺勤',
  }[status ?? ''] ?? '未记录出勤';
}

function mapLeaveStatus(status: string): LeaveStatus {
  const normalized = status.toLowerCase();
  if (normalized === 'approved' || normalized === 'rejected') {
    return normalized;
  }
  return 'pending';
}

function mapLeaveRecord(record: ApiLeaveRecord): LeaveRecord {
  return {
    id: record.id,
    courseName: record.courseName,
    lessonTimeLabel: formatDateTimeLabel(record.lessonStartsAt),
    reason: record.reason,
    status: mapLeaveStatus(record.status),
    reviewerName: record.reviewerName ?? null,
    reviewedAt: record.reviewedAt ?? null,
    reviewReason: record.reviewReason ?? null,
  };
}

export class ApiParentDataSource implements ParentDataSource {
  private readonly baseUrl: string;
  private readonly accessToken: () => string;
  private readonly request: ParentHttpRequest;

  constructor(options: ApiParentDataSourceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.accessToken =
      typeof options.accessToken === 'function'
        ? options.accessToken
        : () => options.accessToken as string;
    this.request = options.request ?? defaultRequest;
  }

  async getHomeSummary(): Promise<ParentHomeSummary> {
    const data = await this.envelope<ApiHomeView>('GET', '/parents/me/home');
    return {
      student: data.student ?? { id: '', name: '', age: 0 },
      nextLesson: data.nextLesson
        ? {
            id: data.nextLesson.id,
            dateLabel: formatLessonDate(data.nextLesson.startsAt),
            timeLabel: `${formatLessonTime(data.nextLesson.startsAt)}-${formatLessonTime(
              data.nextLesson.endsAt,
            )}`,
            campusName: data.nextLesson.campusName,
            courseName: data.nextLesson.courseName,
            teacherName: data.nextLesson.teacherName,
          }
        : null,
      remainingHoursLabel: formatUnits(data.remainingUnits),
      attendanceRateLabel:
        data.attendanceRatePercent === null
          ? '--'
          : `${data.attendanceRatePercent}%`,
    };
  }

  listCampuses(query: ParentCampusQuery): Promise<ParentCampusPage> {
    return this.page<ParentCampusLocation>('/parents/me/campuses', query);
  }

  async getHoursView(): Promise<ParentHoursView> {
    const data = await this.envelope<ApiHoursView>('GET', '/parents/me/hours');
    return {
      remainingTotal: unitsToHours(data.availableTotalUnits ?? data.remainingTotalUnits),
      paidHours: unitsToHours(data.mainAvailableUnits ?? data.mainBalanceUnits),
      giftHours: unitsToHours(data.giftAvailableUnits ?? data.giftBalanceUnits),
      grossTotal: unitsToHours(data.remainingTotalUnits),
      reservedPaidHours: unitsToHours(data.mainReservedUnits ?? 0),
      reservedGiftHours: unitsToHours(data.giftReservedUnits ?? 0),
      paidAmountFen: data.paidAmountFen,
      validUntil: data.validUntil ?? '',
      entries: data.entries.map((entry) => ({
        id: entry.id,
        title: entry.courseName,
        occurredAtLabel: formatDateTimeLabel(entry.occurredAt),
        detailLabel: entry.reason
          ? `${entry.teacherName} · ${entry.reason}`
          : `${entry.teacherName} · ${attendanceLabel(entry.attendanceStatus)}`,
        delta: unitsToHours(entry.deltaUnits),
      })),
    };
  }

  async getLeavePage(): Promise<LeavePageView> {
    const data = await this.envelope<ApiLeavePage>('GET', '/parents/me/leave');
    return { ...data, records: data.records.map(mapLeaveRecord) };
  }

  async submitLeave(
    draft: LeaveDraft,
    idempotencyKey: string,
  ): Promise<LeaveRecord> {
    const data = await this.envelope<ApiLeaveRecord>(
      'POST',
      '/parents/me/leave-requests',
      {
        studentId: draft.studentId,
        lessonSessionId: draft.lessonId,
        reason: draft.reason,
      },
      idempotencyKey,
    );
    return mapLeaveRecord(data);
  }

  getProfile(): Promise<ParentProfileView> {
    return this.envelope('GET', '/parents/me/profile');
  }

  updateProfile(
    input: ParentProfileUpdateInput,
    idempotencyKey: string,
  ): Promise<ParentProfileView> {
    return this.envelope(
      'PUT',
      '/parents/me/profile',
      input,
      idempotencyKey,
    );
  }

  getUpdates(): Promise<ParentUpdatesView> {
    return this.envelope<ParentUpdatesView>('GET', '/parents/me/updates').then(
      (view) => ({
        records: view.records.map((record) => ({
          ...record,
          feedbackImages: record.feedbackImages.map((image) =>
            this.mapFeedbackImage(image),
          ),
        })),
      }),
    );
  }

  listGroupCampaigns(
    query: ParentGroupCampaignQuery,
  ): Promise<GroupPage<GroupCampaignView>> {
    return this.page<GroupCampaignView>('/parents/me/group-campaigns', query).then(
      (page) => ({
        ...page,
        data: page.data.map((campaign) => this.mapGroupCampaign(campaign)),
      }),
    );
  }

  getGroupCampaign(campaignId: string, teamId?: string): Promise<GroupCampaignView> {
    const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
    return this.envelope<GroupCampaignView>(
      'GET',
      `/parents/me/group-campaigns/${encodeURIComponent(campaignId)}${query}`,
    ).then((campaign) => this.mapGroupCampaign(campaign));
  }

  listGroupOrders(query: GroupOrderQuery): Promise<GroupPage<GroupOrderView>> {
    return this.page('/parents/me/group-orders', query);
  }

  createGroupTeam(
    input: GroupJoinInput,
    idempotencyKey: string,
  ): Promise<GroupJoinView> {
    return this.envelope(
      'POST',
      '/parents/me/group-teams',
      input,
      idempotencyKey,
    );
  }

  joinGroupTeam(
    teamId: string,
    studentId: string,
    idempotencyKey: string,
  ): Promise<GroupJoinView> {
    return this.envelope(
      'POST',
      `/parents/me/group-teams/${encodeURIComponent(teamId)}/members`,
      { studentId },
      idempotencyKey,
    );
  }

  retryGroupPrepay(
    memberId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<GroupPrepayView> {
    return this.envelope(
      'POST',
      `/parents/me/group-members/${encodeURIComponent(memberId)}/prepay`,
      { expectedVersion },
      idempotencyKey,
    );
  }

  confirmMockGroupPayment(
    memberId: string,
    outTradeNo: string,
    idempotencyKey: string,
  ): Promise<GroupOrderView> {
    return this.envelope(
      'POST',
      `/parents/me/group-members/${encodeURIComponent(memberId)}/mock-payment-confirmation`,
      { outTradeNo },
      idempotencyKey,
    );
  }

  private page<T>(path: string, query: object): Promise<GroupPage<T>> {
    const entries = Object.entries(query as Record<string, unknown>)
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    const suffix = entries.length ? `?${entries.join('&')}` : '';
    return this.send<GroupPage<T>>('GET', `${path}${suffix}`);
  }

  private envelope<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    data?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    return this.send<SuccessEnvelope<T>>(method, path, data, idempotencyKey).then(
      (response) => response.data,
    );
  }

  private send<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    data?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const accessToken = this.accessToken().trim();
    if (!accessToken) {
      return Promise.reject(
        new ParentDataSourceError(401, 'UNAUTHORIZED', '家长登录已失效'),
      );
    }
    const header: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    if (idempotencyKey) {
      header['Idempotency-Key'] = idempotencyKey;
    }

    return new Promise<T>((resolve, reject) => {
      this.request({
        url: `${this.baseUrl}${path}`,
        method,
        header,
        ...(data === undefined ? {} : { data }),
        success: (response) => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(response.data as T);
            return;
          }
          reject(this.toError(response.statusCode, response.data));
        },
        fail: (error) =>
          reject(
            new ParentDataSourceError(
              0,
              'NETWORK_ERROR',
              error instanceof Error ? error.message : '网络请求失败',
            ),
          ),
      });
    });
  }

  private toError(statusCode: number, body: unknown): ParentDataSourceError {
    const code =
      isRecord(body) && typeof body.code === 'string'
        ? body.code
        : 'UNKNOWN_ERROR';
    const message =
      PARENT_ERROR_MESSAGES[code] ??
      (statusCode >= 500 || code === 'INTERNAL_SERVER_ERROR'
        ? '服务器处理失败，请稍后重试'
        : isRecord(body) && typeof body.message === 'string'
          ? body.message
          : '请求失败，请稍后重试');
    const details =
      isRecord(body) && isRecord(body.details) ? body.details : {};
    return new ParentDataSourceError(statusCode, code, message, details);
  }

  private mapFeedbackImage(image: ParentFeedbackImage): ParentFeedbackImage {
    return {
      ...image,
      accessUrl: /^https?:\/\//.test(image.accessUrl)
        ? image.accessUrl
        : `${this.baseUrl}${image.accessUrl.startsWith('/') ? '' : '/'}${image.accessUrl}`,
    };
  }

  private mapGroupCampaign(campaign: GroupCampaignView): GroupCampaignView {
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
}
