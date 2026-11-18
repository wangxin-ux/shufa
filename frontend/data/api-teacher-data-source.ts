import type * as T from '../types/teacher';
import type * as G from '../types/group-buying';
import {
  TeacherDataSource,
  TeacherDataSourceError,
} from './teacher-data-source';
import type * as R from '../types/teacher-rankings';

export interface TeacherHttpResponse {
  statusCode: number;
  data: unknown;
}

export interface TeacherHttpRequestOptions {
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  header: Record<string, string>;
  data?: unknown;
  success(response: TeacherHttpResponse): void;
  fail(error: unknown): void;
}

export type TeacherHttpRequest = (
  options: TeacherHttpRequestOptions,
) => unknown;

export interface ApiTeacherDataSourceOptions {
  baseUrl: string;
  accessToken: string | (() => string);
  request?: TeacherHttpRequest;
  uploadFile?: TeacherUploadFile;
}

export interface TeacherUploadFileOptions {
  url: string;
  filePath: string;
  name: 'file';
  header: Record<string, string>;
  success(response: { statusCode: number; data: string }): void;
  fail(error: unknown): void;
}

export type TeacherUploadFile = (options: TeacherUploadFileOptions) => unknown;

interface SuccessEnvelope<T> {
  data: T;
  requestId: string;
}

interface PageEnvelope<T> extends SuccessEnvelope<T[]> {
  meta: T.PageMeta;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const defaultRequest: TeacherHttpRequest = (options) =>
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
      options.success({
        statusCode: response.statusCode,
        data: response.data,
      }),
    fail: options.fail,
  });

const defaultUploadFile: TeacherUploadFile = (options) =>
  wx.uploadFile({
    url: options.url,
    filePath: options.filePath,
    name: options.name,
    header: options.header,
    success: options.success,
    fail: options.fail,
  });

export class ApiTeacherDataSource implements TeacherDataSource {
  private readonly baseUrl: string;
  private readonly accessToken: () => string;
  private readonly request: TeacherHttpRequest;
  private readonly uploadFile: TeacherUploadFile;

  constructor(options: ApiTeacherDataSourceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.accessToken =
      typeof options.accessToken === 'function'
        ? options.accessToken
        : () => options.accessToken as string;
    this.request = options.request ?? defaultRequest;
    this.uploadFile = options.uploadFile ?? defaultUploadFile;
  }

  getDashboard(): Promise<T.TeacherDashboard> {
    return this.envelope('GET', '/teachers/me/dashboard');
  }

  getProfile(): Promise<T.TeacherProfile> {
    return this.envelope('GET', '/teachers/me/profile');
  }

  listGroupPromotionCampaigns(
    query: G.GroupPromotionCampaignQuery,
  ): Promise<G.GroupPage<G.GroupPromotionCampaignView>> {
    return this.page<G.GroupPromotionCampaignView>(
      '/teachers/me/group-campaigns',
      this.query([
        ['page', query.page],
        ['pageSize', query.pageSize],
      ]),
    ).then((page) => ({
      ...page,
      data: page.data.map((campaign) =>
        this.mapGroupPromotionCampaign(campaign),
      ),
    }));
  }

  getGroupPromotionCampaign(id: string): Promise<G.GroupPromotionCampaignView> {
    return this.envelope<G.GroupPromotionCampaignView>(
      'GET',
      `/teachers/me/group-campaigns/${encodeURIComponent(id)}`,
    ).then((campaign) => this.mapGroupPromotionCampaign(campaign));
  }

  listLessonSessions(
    query: T.LessonSessionQuery,
  ): Promise<T.Page<T.TeacherLessonSession>> {
    return this.page(
      '/teachers/me/lesson-sessions',
      this.query([
        ['page', query.page],
        ['pageSize', query.pageSize],
        ['from', query.from],
        ['to', query.to],
        ['status', query.status],
      ]),
    );
  }

  getLessonSession(id: string): Promise<T.TeacherLessonDetail> {
    return this.envelope<T.TeacherLessonDetail>(
      'GET',
      `/teachers/me/lesson-sessions/${encodeURIComponent(id)}`,
    ).then((detail) => this.mapLessonDetail(detail));
  }

  listStudents(query: T.TeacherStudentQuery): Promise<T.Page<T.TeacherStudent>> {
    return this.page(
      '/teachers/me/students',
      this.query([
        ['page', query.page],
        ['pageSize', query.pageSize],
        ['query', query.query],
      ]),
    );
  }

  getStudent(id: string, query?: T.TeacherStudentDetailQuery): Promise<T.TeacherStudentDetail> {
    return this.envelope<T.TeacherStudentDetail>(
      'GET',
      `/teachers/me/students/${encodeURIComponent(id)}${this.query([
        ['feedbackPage', query?.feedbackPage],
        ['feedbackPageSize', query?.feedbackPageSize],
      ])}`,
    ).then((student) => ({
      ...student,
      ...(student.archive ? { archive: {
        ...student.archive,
        photo: student.archive.photo ? this.mapFeedbackImage(student.archive.photo) : null,
      } } : {}),
      ...(student.feedbackHistory ? { feedbackHistory: {
        ...student.feedbackHistory,
        data: student.feedbackHistory.data.map((feedback) => ({
          ...feedback, images: feedback.images.map((image) => this.mapFeedbackImage(image)),
        })),
      } } : {}),
    }));
  }

  saveAttendance(
    input: T.AttendanceDraft,
    idempotencyKey: string,
  ): Promise<T.TeacherLessonDetail> {
    const { lessonSessionId, ...body } = input;
    return this.envelope<T.TeacherLessonDetail>(
      'PUT',
      `/teachers/me/lesson-sessions/${encodeURIComponent(
        lessonSessionId,
      )}/attendance`,
      body,
      idempotencyKey,
    ).then((detail) => this.mapLessonDetail(detail));
  }

  completeLesson(
    input: T.CompleteLessonDraft,
    idempotencyKey: string,
  ): Promise<T.CompleteLessonResult> {
    const { lessonSessionId, ...body } = input;
    return this.envelope(
      'POST',
      `/teachers/me/lesson-sessions/${encodeURIComponent(
        lessonSessionId,
      )}/complete`,
      body,
      idempotencyKey,
    );
  }

  reverseLesson(
    input: T.ReverseLessonDraft,
    idempotencyKey: string,
  ): Promise<T.CompleteLessonResult> {
    const { lessonSessionId, ...body } = input;
    return this.envelope(
      'POST',
      `/teachers/me/lesson-sessions/${encodeURIComponent(
        lessonSessionId,
      )}/reverse`,
      body,
      idempotencyKey,
    );
  }

  saveFeedback(
    input: T.FeedbackDraft,
    idempotencyKey: string,
  ): Promise<T.StudentFeedback> {
    const { lessonSessionId, studentId, ...body } = input;
    return this.envelope<T.StudentFeedback>(
      'PUT',
      `/teachers/me/lesson-sessions/${encodeURIComponent(
        lessonSessionId,
      )}/students/${encodeURIComponent(studentId)}/feedback`,
      body,
      idempotencyKey,
    ).then((feedback) => ({
      ...feedback,
      images: feedback.images.map((image) => this.mapFeedbackImage(image)),
    }));
  }

  uploadFeedbackImage(input: T.FeedbackImageUploadDraft): Promise<T.FeedbackImage> {
    const accessToken = this.accessToken().trim();
    if (!accessToken) {
      return Promise.reject(
        new TeacherDataSourceError(401, 'UNAUTHORIZED', '教师登录已失效'),
      );
    }
    return new Promise<T.FeedbackImage>((resolve, reject) => {
      this.uploadFile({
        url: `${this.baseUrl}/teachers/me/lesson-sessions/${encodeURIComponent(
          input.lessonSessionId,
        )}/students/${encodeURIComponent(input.studentId)}/feedback-images`,
        filePath: input.filePath,
        name: 'file',
        header: { Authorization: `Bearer ${accessToken}` },
        success: (response) => {
          let body: unknown;
          try {
            body = JSON.parse(response.data) as unknown;
          } catch {
            reject(
              new TeacherDataSourceError(0, 'INVALID_RESPONSE', '图片上传响应异常'),
            );
            return;
          }
          if (
            response.statusCode >= 200 &&
            response.statusCode < 300 &&
            isRecord(body) &&
            isRecord(body.data)
          ) {
            resolve(this.mapFeedbackImage(body.data as unknown as T.FeedbackImage));
            return;
          }
          reject(this.toError(response.statusCode, body));
        },
        fail: (error) =>
          reject(
            new TeacherDataSourceError(
              0,
              'NETWORK_ERROR',
              error instanceof Error ? error.message : '图片上传失败',
            ),
          ),
      });
    });
  }

  listTeachingRecords(query: T.DatePageQuery): Promise<T.Page<T.TeachingRecord>> {
    return this.page(
      '/teachers/me/teaching-records',
      this.datePageQuery(query),
    );
  }

  listLessonLedger(
    query: T.DatePageQuery,
  ): Promise<T.Page<T.TeacherLedgerRecord>> {
    return this.page('/teachers/me/lesson-ledger', this.datePageQuery(query));
  }

  getEarningSummary(): Promise<T.TeacherEarningSummary> {
    return this.envelope('GET', '/teachers/me/earnings/summary');
  }

  getRankings(query: R.TeacherRankingQuery): Promise<R.TeacherRankingPage> {
    return this.envelope('GET', `/teachers/me/rankings${this.query([
      ['metric', query.metric], ['month', query.month], ['page', query.page],
      ['pageSize', query.pageSize], ['revision', query.revision],
    ])}`);
  }

  getCurrentEarningRule(): Promise<T.TeacherEarningRuleView | null> {
    return this.envelope('GET', '/teachers/me/earning-rule');
  }

  getEarnings(query: T.TeacherEarningQuery): Promise<T.Page<T.TeacherEarningEntry>> {
    return this.page(
      '/teachers/me/earnings',
      this.query([
        ['page', query.page],
        ['pageSize', query.pageSize],
        ['from', query.from],
        ['to', query.to],
        ['status', query.status],
      ]),
    );
  }

  getWithdrawals(
    query: T.TeacherWithdrawalQuery,
  ): Promise<T.Page<T.TeacherWithdrawal>> {
    return this.page(
      '/teachers/me/withdrawals',
      this.query([
        ['page', query.page],
        ['pageSize', query.pageSize],
        ['status', query.status],
      ]),
    );
  }

  createWithdrawal(
    amountFen: number,
    idempotencyKey: string,
  ): Promise<T.TeacherWithdrawal> {
    return this.envelope(
      'POST',
      '/teachers/me/withdrawals',
      { amountFen },
      idempotencyKey,
    );
  }

  cancelWithdrawal(
    id: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<T.TeacherWithdrawal> {
    return this.envelope(
      'POST',
      `/teachers/me/withdrawals/${encodeURIComponent(id)}/cancel`,
      { expectedVersion },
      idempotencyKey,
    );
  }

  private envelope<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    data?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    return this.send<SuccessEnvelope<T>>(
      method,
      path,
      data,
      idempotencyKey,
    ).then((response) => response.data);
  }

  private page<T>(path: string, query: string): Promise<T.Page<T>> {
    return this.send<PageEnvelope<T>>(
      'GET',
      `${path}${query}`,
    ).then(({ data, meta }) => ({ data, meta }));
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
        new TeacherDataSourceError(401, 'UNAUTHORIZED', '教师登录已失效'),
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
            new TeacherDataSourceError(
              0,
              'NETWORK_ERROR',
              error instanceof Error ? error.message : '网络请求失败',
            ),
          ),
      });
    });
  }

  private toError(statusCode: number, body: unknown): TeacherDataSourceError {
    const code =
      isRecord(body) && typeof body.code === 'string'
        ? body.code
        : 'UNKNOWN_ERROR';
    const message =
      statusCode >= 500 || code === 'INTERNAL_SERVER_ERROR'
        ? '服务器处理失败，请稍后重试'
        : isRecord(body) && typeof body.message === 'string'
          ? body.message
          : '请求失败';
    const details =
      isRecord(body) && isRecord(body.details) ? body.details : {};
    return new TeacherDataSourceError(statusCode, code, message, details);
  }

  private mapLessonDetail(detail: T.TeacherLessonDetail): T.TeacherLessonDetail {
    return {
      ...detail,
      students: detail.students.map((student) => ({
        ...student,
        photo: student.photo ? this.mapFeedbackImage(student.photo) : null,
        feedbackImages: student.feedbackImages.map((image) =>
          this.mapFeedbackImage(image),
        ),
      })),
    };
  }

  private mapFeedbackImage(image: T.FeedbackImage): T.FeedbackImage {
    return {
      ...image,
      accessUrl: /^https?:\/\//.test(image.accessUrl)
        ? image.accessUrl
        : `${this.baseUrl}${image.accessUrl.startsWith('/') ? '' : '/'}${image.accessUrl}`,
    };
  }

  private mapGroupPromotionCampaign(
    campaign: G.GroupPromotionCampaignView,
  ): G.GroupPromotionCampaignView {
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

  private datePageQuery(query: T.DatePageQuery): string {
    return this.query([
      ['page', query.page],
      ['pageSize', query.pageSize],
      ['from', query.from],
      ['to', query.to],
    ]);
  }

  private query(
    entries: ReadonlyArray<[string, string | number | undefined]>,
  ): string {
    const encoded = entries
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
      );
    return encoded.length > 0 ? `?${encoded.join('&')}` : '';
  }
}
