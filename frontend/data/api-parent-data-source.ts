import {
  LeaveDraft,
  LeavePageView,
  LeaveRecord,
  LeaveStatus,
  ParentHomeSummary,
  ParentCampusLocation,
  ParentCampusPage,
  ParentCampusQuery,
  ParentCourseCatalogQuery,
  ParentCourseCatalogPage,
  ParentFeedbackImage,
  ParentHoursView,
  ParentHoursQuery,
  ParentProfileView,
  ParentProfileUpdateInput,
  ParentUpdatesView,
  ParentGrowthStudent,
  ParentReviewDraft,
  ParentLessonReview,
  ParentPhotoUpload,
  ParentProfileSetupView,
  ParentProfileSetupInput,
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
  uploadFile?: ParentUploadFile;
}

export type ParentUploadFile = (options: {
  url: string; filePath: string; name: string; header: Record<string, string>;
  success(response: { statusCode: number; data: string }): void;
  fail(error: unknown): void;
}) => unknown;

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
  STUDENT_PHOTO_INVALID: '照片不可用，请重新选择 JPEG 或 PNG 图片',
  PARENT_REVIEW_NOT_ALLOWED: '该课次当前不可评价，请刷新后查看',
  PARENT_REVIEW_ALREADY_EXISTS: '这节课已经评价，请刷新后查看',
  PARENT_PROFILE_ALREADY_COMPLETED: '孩子资料已完善',
  VALIDATION_FAILED: '资料格式不正确，请检查后重试',
};

interface ApiHomeView {
  profileSetupRequired?: boolean;
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
  teachers: NonNullable<ParentHomeSummary['teachers']>;
  reminders: Array<NonNullable<ApiHomeView['nextLesson']>>;
}

interface ApiHoursView {
  grantedMainUnits?: number | null;
  grantedGiftUnits?: number | null;
  courseNames?: string[];
  meta?: ParentHoursView['meta'];
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
  contactWarning?: LeaveRecord['contactWarning'];
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
  weeklyWarnings?: LeavePageView['weeklyWarnings'];
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

function formatHoursSummary(entry: ApiHoursView['entries'][number]): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric',
  }).formatToParts(new Date(entry.occurredAt));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dateLabel = `${values.month}月${values.day}日`;
  const typeLabels: Record<string, string> = {
    GRANT: '课时发放',
    CONSUME: '课时扣除',
    REVERSAL: '撤销扣课',
    ADJUSTMENT: '课时调整',
    REFUND: '退费扣课',
    CORRECTION: '课时纠错',
  };
  const typeLabel = typeLabels[entry.entryType] ?? '课时变动';
  const context = entry.lessonSessionId
    ? entry.entryType === 'CONSUME' ? entry.teacherName : `${typeLabel} ${entry.teacherName}`
    : typeLabel;
  return `${dateLabel} ${formatLessonTime(entry.occurredAt)} ${context}`;
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
    ...(record.contactWarning === undefined ? {} : { contactWarning: record.contactWarning }),
  };
}

export class ApiParentDataSource implements ParentDataSource {
  private readonly baseUrl: string;
  private readonly accessToken: () => string;
  private readonly request: ParentHttpRequest;
  private readonly uploadFile: ParentUploadFile;

  constructor(options: ApiParentDataSourceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.accessToken =
      typeof options.accessToken === 'function'
        ? options.accessToken
        : () => options.accessToken as string;
    this.request = options.request ?? defaultRequest;
    this.uploadFile = options.uploadFile ?? ((input) => wx.uploadFile(input));
  }

  async getHomeSummary(): Promise<ParentHomeSummary> {
    const data = await this.envelope<ApiHomeView>('GET', '/parents/me/home');
    return {
      profileSetupRequired: data.profileSetupRequired ?? false,
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
      teachers: data.teachers ?? [],
      reminders: (data.reminders ?? []).map((lesson) => ({
        id: lesson.id,
        dateLabel: formatLessonDate(lesson.startsAt),
        timeLabel: `${formatLessonTime(lesson.startsAt)}-${formatLessonTime(lesson.endsAt)}`,
        campusName: lesson.campusName,
        courseName: lesson.courseName,
        teacherName: lesson.teacherName,
      })),
    };
  }

  listCampuses(query: ParentCampusQuery): Promise<ParentCampusPage> {
    return this.page<ParentCampusLocation>('/parents/me/campuses', query);
  }

  listCourseCatalog(query: ParentCourseCatalogQuery): Promise<ParentCourseCatalogPage> {
    return this.page('/parents/me/course-catalog', query);
  }

  async getHoursView(query?: ParentHoursQuery): Promise<ParentHoursView> {
    const data = await this.envelope<ApiHoursView>('GET', '/parents/me/hours', query);
    return {
      grantedPaidHours: data.grantedMainUnits == null ? null : unitsToHours(data.grantedMainUnits),
      grantedGiftHours: data.grantedGiftUnits == null ? null : unitsToHours(data.grantedGiftUnits),
      courseNames: data.courseNames ?? [],
      meta: data.meta,
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
        summaryLabel: formatHoursSummary(entry),
        delta: unitsToHours(entry.deltaUnits),
        courseName: entry.lessonSessionId ? entry.courseName : '未分类',
      })),
    };
  }

  async getLeavePage(studentId?: string): Promise<LeavePageView> {
    const data = await this.envelope<ApiLeavePage>('GET', '/parents/me/leave', studentId ? { studentId } : undefined);
    return { ...data, weeklyWarnings: data.weeklyWarnings ?? [], records: data.records.map(mapLeaveRecord) };
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

  getProfileSetup(): Promise<ParentProfileSetupView> {
    return this.envelope<ParentProfileSetupView>('GET', '/parents/me/profile-setup')
      .then((view) => this.mapSetupView(view));
  }

  completeProfileSetup(studentId: string, input: ParentProfileSetupInput, key: string): Promise<ParentProfileSetupView> {
    return this.envelope<ParentProfileSetupView>('PUT',
      `/parents/me/students/${encodeURIComponent(studentId)}/profile-setup`, input, key)
      .then((view) => this.mapSetupView(view));
  }

  private mapSetupView(view: ParentProfileSetupView): ParentProfileSetupView {
    return { ...view, student: view.student ? { ...view.student,
      photo: view.student.photo ? this.mapFeedbackImage(view.student.photo) : null } : null };
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
        ...view,
        ...(view.student ? { student: { ...view.student, photo: view.student.photo ? this.mapFeedbackImage(view.student.photo) : null } } : {}),
        records: view.records.map((record) => ({
          ...record,
          feedbackImages: record.feedbackImages.map((image) =>
            this.mapFeedbackImage(image),
          ),
        })),
      }),
    );
  }

  uploadStudentPhoto(studentId: string, filePath: string): Promise<ParentPhotoUpload> {
    const token = this.accessToken().trim();
    if (!token) return Promise.reject(new ParentDataSourceError(401, 'UNAUTHORIZED', '登录已失效，请重新登录'));
    return new Promise((resolve, reject) => this.uploadFile({
      url: `${this.baseUrl}/parents/me/students/${encodeURIComponent(studentId)}/photo-files`,
      filePath, name: 'file', header: { Authorization: `Bearer ${token}` },
      success: (response) => {
        let body: unknown;
        try { body = JSON.parse(response.data); } catch {
          reject(new ParentDataSourceError(0, 'INVALID_RESPONSE', '照片上传响应异常')); return;
        }
        if (response.statusCode >= 200 && response.statusCode < 300 && isRecord(body) && isRecord(body.data)) {
          resolve(body.data as unknown as ParentPhotoUpload);
        } else reject(this.toError(response.statusCode, body));
      },
      fail: () => reject(new ParentDataSourceError(0, 'NETWORK_ERROR', '照片上传失败，请重试')),
    }));
  }

  replaceStudentPhoto(studentId: string, input: { fileId: string; expectedVersion: number }, key: string): Promise<ParentGrowthStudent> {
    return this.envelope<ParentGrowthStudent>('PUT', `/parents/me/students/${encodeURIComponent(studentId)}/photo`, input, key)
      .then((student) => ({ ...student, photo: student.photo ? this.mapFeedbackImage(student.photo) : null }));
  }

  submitLessonReview(lessonId: string, studentId: string, draft: ParentReviewDraft, key: string): Promise<ParentLessonReview> {
    return this.envelope('POST',
      `/parents/me/lesson-sessions/${encodeURIComponent(lessonId)}/students/${encodeURIComponent(studentId)}/review`, draft, key);
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
