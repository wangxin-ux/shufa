import {
  OperatorCreateStudentInput,
  OperatorCampusSettings,
  OperatorDashboard,
  OperatorLessonQuery,
  OperatorLessonSession,
  OperatorLeaveQuery,
  OperatorLeaveRequest,
  OperatorPage,
  OperatorPageMeta,
  OperatorProfile,
  OperatorSchedulingOptions,
  OperatorScheduleInput,
  OperatorStudent,
  OperatorStudentDetail,
  OperatorStudentQuery,
  OperatorStudentArchive,
  OperatorStudentGrowth,
  OperatorTeacherArchive,
  OperatorTeacherPerformance,
  OperatorTeacherEvaluation,
  OperatorTeacherEvaluationRevision,
  OperatorTeacherHistoryQuery,
  OperatorUpdateScheduleInput,
  OperatorUpdateSettingsInput,
  OperatorWarning,
  OperatorWarningQuery,
} from "../types/operator";
import {
  OperatorDataSource,
  OperatorDataSourceError,
} from "./operator-data-source";
import type { OperatorRankingPage, OperatorRankingQuery } from '../types/operator-ranking';
import { parseOperatorRankingEnvelope, validateOperatorRankingQuery } from './operator-ranking-codec';
import type { OperatorAccount, OperatorAccountQuery, OperatorAccountSubjects, OperatorAccountSubjectQuery } from '../types/operator-account';
import {
  parseOperatorAccountEnvelope, parseOperatorAccountSubjectsEnvelope,
  validateOperatorAccountQuery, validateOperatorAccountSubjectQuery,
} from './operator-account-codec';
import type { OperatorEarningEntries, OperatorEarningQuery, OperatorEarningSummary } from '../types/operator-earning';
import { parseOperatorEarningSummaryEnvelope, parseOperatorEarningEntriesEnvelope, validateOperatorEarningQuery } from './operator-earning-codec';
import type { OperatorLessonRoster } from '../types/operator-lesson-members';
import { operatorMemberId, parseOperatorLessonRoster, validateOperatorMemberWrite } from './operator-lesson-members-codec';
import type {
  OperatorSeriesPattern, OperatorSeriesCreateInput, OperatorCancellationMode,
  OperatorCancellationInput, OperatorCancellationPreview,
} from "../types/operator";
import {
  validateSeriesPattern, validateCancellation, parseSeriesPreview, parseSeriesCreated,
  parseCancellationPreview, parseSeriesCancelled, parseSchedulePage, validateScheduleLesson,
  seriesUuid, seriesVersion, seriesFailure,
} from "../services/operator-lesson-series.presenter";

export interface OperatorHttpResponse {
  statusCode: number;
  data: unknown;
}

export interface OperatorHttpRequestOptions {
  url: string;
  method: "GET" | "POST" | "PATCH";
  header: Record<string, string>;
  data?: unknown;
  success(response: OperatorHttpResponse): void;
  fail(error: unknown): void;
}

export type OperatorHttpRequest = (
  options: OperatorHttpRequestOptions,
) => unknown;

export interface ApiOperatorDataSourceOptions {
  baseUrl: string;
  accessToken: string | (() => string);
  request?: OperatorHttpRequest;
}

interface SuccessEnvelope<T> {
  data: T;
  requestId: string;
}

interface PageEnvelope<T> extends SuccessEnvelope<T[]> {
  meta: OperatorPageMeta;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const defaultRequest: OperatorHttpRequest = (options) =>
  wx.request({
    url: options.url,
    method: options.method as WechatMiniprogram.RequestOption["method"],
    header: options.header,
    data: options.data as
      string | WechatMiniprogram.IAnyObject | ArrayBuffer | undefined,
    success: (response) =>
      options.success({
        statusCode: response.statusCode,
        data: response.data,
      }),
    fail: options.fail,
  });

export class ApiOperatorDataSource implements OperatorDataSource {
  private readonly baseUrl: string;
  private readonly accessToken: () => string;
  private readonly request: OperatorHttpRequest;

  constructor(options: ApiOperatorDataSourceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.accessToken =
      typeof options.accessToken === "function"
        ? options.accessToken
        : () => options.accessToken as string;
    this.request = options.request ?? defaultRequest;
  }

  async previewLessonSeries(input: OperatorSeriesPattern) {
    validateSeriesPattern(input);
    return parseSeriesPreview(await this.send<unknown>("POST", "/operators/me/lesson-series/preview", input), input);
  }
  async createLessonSeries(input: OperatorSeriesCreateInput, key: string) {
    validateSeriesPattern(input, true);
    if (typeof key !== "string" || !key.trim()) seriesFailure("幂等标识不能为空");
    return parseSeriesCreated(await this.send<unknown>("POST", "/operators/me/lesson-series", input, key), input);
  }
  async previewLessonCancellation(id: string, mode: OperatorCancellationMode) {
    validateCancellation(id, mode);
    return parseCancellationPreview(await this.send<unknown>("POST",
      `/operators/me/lesson-sessions/${encodeURIComponent(id)}/cancellation-preview`, { mode }), id, mode);
  }
  async cancelLessonSelection(id: string, input: OperatorCancellationInput, expected: OperatorCancellationPreview, key: string) {
    if (!input || typeof input !== "object" || !expected || typeof expected !== "object" ||
      Object.keys(input).length !== 2 || !("mode" in input) || !("previewHash" in input))
      seriesFailure("请重新核对取消范围");
    validateCancellation(id, input.mode, input.previewHash, key);
    if (input.previewHash !== expected.previewHash)
      seriesFailure("请重新核对取消范围");
    return parseSeriesCancelled(await this.send<unknown>("POST",
      `/operators/me/lesson-sessions/${encodeURIComponent(id)}/cancel-selection`, input, key), expected);
  }

  getLessonMembers(id: string): Promise<OperatorLessonRoster> {
    if (!operatorMemberId(id)) return Promise.reject(new OperatorDataSourceError(400, 'BAD_REQUEST', '课次名单请求无效'));
    return this.lessonMembersRequest(id);
  }

  addLessonMember(id: string, studentId: string, version: number, key: string): Promise<OperatorLessonRoster> {
    validateOperatorMemberWrite(id, version, key, studentId);
    return this.lessonMembersRequest(id, 'POST', { studentId, version }, key);
  }

  removeLessonMember(id: string, studentId: string, version: number, key: string): Promise<OperatorLessonRoster> {
    validateOperatorMemberWrite(id, version, key, studentId);
    return this.lessonMembersRequest(id, 'POST', { version }, key, `/${encodeURIComponent(studentId)}/remove`);
  }

  private async lessonMembersRequest(id: string, method: 'GET' | 'POST' = 'GET',
    data?: unknown, key?: string, suffix = ''): Promise<OperatorLessonRoster> {
    try {
      return parseOperatorLessonRoster(await this.send<unknown>(
        method, `/operators/me/lesson-sessions/${encodeURIComponent(id)}/members${suffix}`, data, key,
      ), id);
    } catch (error) {
      if (error instanceof OperatorDataSourceError) {
        const message = error.statusCode === 409
          ? error.code === 'INSUFFICIENT_LESSON_BALANCE'
            ? '可用课时余额不足，不能加入本课' : '课次或名单已变化，请核对最新名单'
          : error.statusCode === 404 ? '未找到本校区课次或学员'
          : error.statusCode === 400 ? '课次名单请求无效' : error.message;
        throw new OperatorDataSourceError(error.statusCode, error.code, message, error.details);
      }
      throw error;
    }
  }

  async getEarningSummary(): Promise<OperatorEarningSummary> {
    return parseOperatorEarningSummaryEnvelope(await this.send<unknown>('GET', '/operators/me/earnings/summary'));
  }

  async listEarningEntries(query: OperatorEarningQuery): Promise<OperatorEarningEntries> {
    validateOperatorEarningQuery(query);
    const search = this.query([['page', query.page], ['pageSize', query.pageSize], ['status', query.status], ['entryType', query.entryType]]);
    return parseOperatorEarningEntriesEnvelope(await this.send<unknown>('GET', `/operators/me/earnings${search}`), query);
  }

  async getLessonAccount(query: OperatorAccountQuery): Promise<OperatorAccount> {
    validateOperatorAccountQuery(query);
    const search = this.query([['page', query.page], ['pageSize', query.pageSize],
      ['entryType', query.entryType], ['subjectId', query.subjectId]]);
    return parseOperatorAccountEnvelope(await this.send<unknown>('GET', `/operators/me/lesson-account${search}`), query);
  }

  async listAccountSubjects(query: OperatorAccountSubjectQuery): Promise<OperatorAccountSubjects> {
    validateOperatorAccountSubjectQuery(query);
    const search = this.query([['page', query.page], ['pageSize', query.pageSize], ['query', query.query]]);
    return parseOperatorAccountSubjectsEnvelope(await this.send<unknown>('GET', `/operators/me/subjects${search}`), query);
  }

  async listRankings(query: OperatorRankingQuery): Promise<OperatorRankingPage> {
    validateOperatorRankingQuery(query);
    const search = this.query([
      ['metric', query.metric], ['month', query.month], ['page', query.page],
      ['pageSize', query.pageSize], ['revisionId', query.revisionId],
    ]);
    const response = await this.send<unknown>('GET', `/operators/me/rankings${search}`);
    return parseOperatorRankingEnvelope(response, query);
  }

  getDashboard(): Promise<OperatorDashboard> {
    return this.envelope("/operators/me/dashboard");
  }

  getProfile(): Promise<OperatorProfile> {
    return this.envelope("/operators/me/profile");
  }

  listTeacherArchives(query: OperatorStudentQuery): Promise<OperatorPage<OperatorTeacherArchive>> {
    return this.page<OperatorTeacherArchive>('/operators/me/teacher-archives',
      this.query([['page', query.page], ['pageSize', query.pageSize], ['query', query.query]]),
    ).then((result) => ({
      ...result,
      data: result.data.map((teacher) => ({
        id: teacher.id, displayName: teacher.displayName, specialties: teacher.specialties,
        classes: teacher.classes.map(({ id, className, courseName }) => ({ id, className, courseName })),
      })),
    }));
  }

  getTeacherPerformance(teacherId: string, month?: string): Promise<OperatorTeacherPerformance> {
    return this.envelope<OperatorTeacherPerformance>(
      `/operators/me/teacher-archives/${encodeURIComponent(teacherId)}/performance${this.query([['month', month]])}`,
    ).then((item) => {
      if (item.teacherId !== teacherId || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(item.periodMonth) ||
          (month !== undefined && item.periodMonth !== month) ||
          (item.evaluation !== null && (item.evaluation.teacherId !== teacherId ||
            item.evaluation.periodMonth !== item.periodMonth || item.evaluation.canEdit !== false))) {
        throw new OperatorDataSourceError(0, 'INVALID_TEACHER_ARCHIVE_RESPONSE', '教师档案返回内容不一致，请重试');
      }
      const evaluation = item.evaluation;
      return {
        teacherId: item.teacherId, periodMonth: item.periodMonth, timezone: item.timezone, asOf: item.asOf,
        scheduledLessonCount: item.scheduledLessonCount, completedLessonCount: item.completedLessonCount,
        completionRateBasisPoints: item.completionRateBasisPoints,
        evaluation: evaluation === null ? null : {
          ...this.teacherEvaluationFields(evaluation),
          id: evaluation.id, teacherId: evaluation.teacherId, canEdit: false,
          createdAt: evaluation.createdAt, updatedAt: evaluation.updatedAt,
        },
      };
    });
  }

  getTeacherEvaluationHistory(teacherId: string, query: OperatorTeacherHistoryQuery): Promise<OperatorPage<OperatorTeacherEvaluationRevision>> {
    return this.page<OperatorTeacherEvaluationRevision>(
      `/operators/me/teacher-archives/${encodeURIComponent(teacherId)}/evaluation-history`,
      this.query([['month', query.month], ['page', query.page], ['pageSize', query.pageSize]]),
    ).then((result) => {
      if (query.month !== undefined && result.data.some((item) => item.periodMonth !== query.month)) {
        throw new OperatorDataSourceError(0, 'INVALID_TEACHER_ARCHIVE_RESPONSE', '评价历史月份不一致，请重试');
      }
      return { ...result, data: result.data.map((item) => ({
        ...this.teacherEvaluationFields(item), savedAt: item.savedAt,
      })) };
    });
  }

  private teacherEvaluationFields(item: OperatorTeacherEvaluation | OperatorTeacherEvaluationRevision) {
    return {
      periodMonth: item.periodMonth, version: item.version, guidance: item.guidance, authorName: item.authorName,
      teachingRating: item.teachingRating, communicationRating: item.communicationRating,
      attendanceRating: item.attendanceRating, overallRating: item.overallRating,
    };
  }

  listStudents(
    query: OperatorStudentQuery,
  ): Promise<OperatorPage<OperatorStudent>> {
    return this.page<OperatorStudent>(
      "/operators/me/students",
      this.query([
        ["page", query.page],
        ["pageSize", query.pageSize],
        ["query", query.query],
      ]),
    ).then((result) => ({ ...result, data: result.data.map((item) => this.studentSummary(item)) }));
  }

  getStudent(id: string): Promise<OperatorStudentDetail> {
    return this.envelope<OperatorStudentDetail>(
      `/operators/me/students/${encodeURIComponent(id)}`,
    ).then((item) => ({
      ...this.studentSummary(item),
      mainBalanceUnits: item.mainBalanceUnits, giftBalanceUnits: item.giftBalanceUnits,
      recentAttendanceCount: item.recentAttendanceCount, recentConsumedUnits: item.recentConsumedUnits,
      mainAvailableUnits: item.mainAvailableUnits, giftAvailableUnits: item.giftAvailableUnits,
      availableTotalUnits: item.availableTotalUnits, mainReservedUnits: item.mainReservedUnits,
      giftReservedUnits: item.giftReservedUnits, reservedTotalUnits: item.reservedTotalUnits,
    }));
  }

  getStudentArchive(id: string): Promise<OperatorStudentArchive> {
    return this.envelope(`/operators/me/students/${encodeURIComponent(id)}/archive`);
  }

  getStudentGrowth(id: string, query: { page: number; pageSize: number }): Promise<OperatorPage<OperatorStudentGrowth>> {
    const suffix = this.query([['page', query.page], ['pageSize', query.pageSize]]);
    return this.send<SuccessEnvelope<{ items: OperatorStudentGrowth[] }> & { meta: OperatorPageMeta }>(
      'GET', `/operators/me/students/${encodeURIComponent(id)}/archive/growth${suffix}`,
    ).then(({ data, meta }) => ({ data: data.items, meta }));
  }

  getSchedulingOptions(): Promise<OperatorSchedulingOptions> {
    return this.envelope("/operators/me/scheduling-options");
  }

  createStudent(
    input: OperatorCreateStudentInput,
    idempotencyKey: string,
  ): Promise<OperatorStudent> {
    return this.envelope<OperatorStudent>(
      "/operators/me/students",
      "POST",
      input,
      idempotencyKey,
    ).then((item) => this.studentSummary(item));
  }

  private studentSummary(item: OperatorStudent): OperatorStudent {
    return {
      id: item.id, campusId: item.campusId, displayName: item.displayName,
      ageYears: Number.isSafeInteger(item.ageYears) && item.ageYears! >= 0 ? item.ageYears : null,
      classNames: item.classNames,
    };
  }

  listLessonSessions(
    query: OperatorLessonQuery,
  ): Promise<OperatorPage<OperatorLessonSession>> {
    return this.page<OperatorLessonSession>(
      "/operators/me/lesson-sessions",
      this.query([
        ["page", query.page],
        ["pageSize", query.pageSize],
        ["from", query.from],
        ["to", query.to],
        ["status", query.status],
      ]),
    ).then(value => parseSchedulePage(value, query));
  }

  createLessonSession(
    input: OperatorScheduleInput,
    idempotencyKey: string,
  ): Promise<OperatorLessonSession> {
    if (!seriesUuid(input.classGroupId)) return Promise.reject(new OperatorDataSourceError(400, "BAD_REQUEST", "班级编号无效"));
    return this.envelope<OperatorLessonSession>(
      "/operators/me/lesson-sessions",
      "POST",
      input,
      idempotencyKey,
    ).then(value => { validateScheduleLesson(value); return value; });
  }

  updateLessonSession(
    lessonSessionId: string,
    input: OperatorUpdateScheduleInput,
    idempotencyKey: string,
  ): Promise<OperatorLessonSession> {
    if (!seriesUuid(lessonSessionId) || !seriesVersion(input.version))
      return Promise.reject(new OperatorDataSourceError(400, "BAD_REQUEST", "课次编号或版本无效"));
    return this.envelope<OperatorLessonSession>(
      `/operators/me/lesson-sessions/${encodeURIComponent(lessonSessionId)}`,
      "PATCH",
      input,
      idempotencyKey,
    ).then(value => { validateScheduleLesson(value); return value; });
  }

  cancelLessonSession(
    lessonSessionId: string,
    version: number,
    idempotencyKey: string,
  ): Promise<OperatorLessonSession> {
    return this.envelope(
      `/operators/me/lesson-sessions/${encodeURIComponent(lessonSessionId)}/cancel`,
      "POST",
      { version },
      idempotencyKey,
    );
  }

  listLeaveRequests(
    query: OperatorLeaveQuery,
  ): Promise<OperatorPage<OperatorLeaveRequest>> {
    return this.page(
      "/operators/me/leave-requests",
      this.query([
        ["page", query.page],
        ["pageSize", query.pageSize],
        ["status", query.status],
        ["reviewedOnly", query.reviewedOnly],
      ]),
    );
  }

  approveLeaveRequest(
    leaveRequestId: string,
    version: number,
    reviewReason: string | undefined,
    idempotencyKey: string,
  ): Promise<OperatorLeaveRequest> {
    return this.envelope(
      `/operators/me/leave-requests/${encodeURIComponent(leaveRequestId)}/approve`,
      "POST",
      { version, ...(reviewReason ? { reviewReason } : {}) },
      idempotencyKey,
    );
  }

  rejectLeaveRequest(
    leaveRequestId: string,
    version: number,
    reviewReason: string,
    idempotencyKey: string,
  ): Promise<OperatorLeaveRequest> {
    return this.envelope(
      `/operators/me/leave-requests/${encodeURIComponent(leaveRequestId)}/reject`,
      "POST",
      { version, reviewReason },
      idempotencyKey,
    );
  }

  listWarnings(
    query: OperatorWarningQuery,
  ): Promise<OperatorPage<OperatorWarning>> {
    return this.page(
      "/operators/me/warnings",
      this.query([
        ["page", query.page],
        ["pageSize", query.pageSize],
        ["query", query.query],
      ]),
    );
  }

  getCampusSettings(): Promise<OperatorCampusSettings> {
    return this.envelope("/operators/me/campus");
  }

  updateCampusSettings(
    input: OperatorUpdateSettingsInput,
    idempotencyKey: string,
  ): Promise<OperatorCampusSettings> {
    return this.envelope(
      "/operators/me/campus",
      "PATCH",
      input,
      idempotencyKey,
    );
  }

  private envelope<T>(
    path: string,
    method: "GET" | "POST" | "PATCH" = "GET",
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

  private page<T>(path: string, query: string): Promise<OperatorPage<T>> {
    return this.send<PageEnvelope<T>>("GET", `${path}${query}`).then(
      ({ data, meta }) => ({ data, meta }),
    );
  }

  private send<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    data?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const accessToken = this.accessToken().trim();
    if (!accessToken) {
      return Promise.reject(
        new OperatorDataSourceError(
          401,
          "UNAUTHORIZED",
          "运营登录已失效",
        ),
      );
    }
    const header: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    if (idempotencyKey) {
      header["Idempotency-Key"] = idempotencyKey;
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
            new OperatorDataSourceError(
              0,
              "NETWORK_ERROR",
              error instanceof Error
                ? error.message
                : "网络请求失败，请稍后重试",
            ),
          ),
      });
    });
  }

  private query(
    entries: ReadonlyArray<[string, string | number | boolean | undefined]>,
  ): string {
    const encoded = entries
      .filter(
        (entry): entry is [string, string | number | boolean] => entry[1] !== undefined,
      )
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
      );
    return encoded.length > 0 ? `?${encoded.join("&")}` : "";
  }

  private toError(
    statusCode: number,
    body: unknown,
  ): OperatorDataSourceError {
    const code =
      isRecord(body) && typeof body.code === "string"
        ? body.code
        : "UNKNOWN_ERROR";
    const messages: Record<number, string> = {
      401: "运营登录已失效",
      403: "当前账号无运营端访问权限",
      409: "数据已更新，请刷新后重试",
    };
    const message =
      messages[statusCode] ??
      (statusCode >= 500 || code === "INTERNAL_SERVER_ERROR"
        ? "服务器处理失败，请稍后重试"
        : isRecord(body) && typeof body.message === "string"
          ? body.message
          : "请求失败，请稍后重试");
    const details =
      isRecord(body) && isRecord(body.details) ? body.details : {};
    return new OperatorDataSourceError(statusCode, code, message, details);
  }
}
