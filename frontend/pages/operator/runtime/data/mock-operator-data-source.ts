import { OperatorMockScenario } from "../config/operator-env";
import {
  EMPTY_OPERATOR_FIXTURE,
  NORMAL_OPERATOR_FIXTURE,
} from "../mock/fixtures/operator.fixture";
import {
  OperatorCreateStudentInput,
  OperatorCampusSettings,
  OperatorDashboard,
  OperatorLessonQuery,
  OperatorLessonSession,
  OperatorLeaveQuery,
  OperatorLeaveRequest,
  OperatorPage,
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
import { OPERATOR_TEACHER_ARCHIVES, mockTeacherPerformance, mockTeacherRevisions } from '../mock/fixtures/operator-teacher-archives.fixture';
import { currentOperatorRankingMonth, type OperatorRankingPage, type OperatorRankingQuery, type OperatorRankingRow } from '../types/operator-ranking';
import { parseOperatorRankingEnvelope, validateOperatorRankingQuery } from './operator-ranking-codec';
import type { OperatorAccount, OperatorAccountQuery, OperatorAccountSubjects, OperatorAccountSubjectQuery } from '../types/operator-account';
import { parseOperatorAccountEnvelope, parseOperatorAccountSubjectsEnvelope,
  validateOperatorAccountQuery, validateOperatorAccountSubjectQuery } from './operator-account-codec';
import { mockOperatorAccount, OPERATOR_ACCOUNT_SUBJECTS } from '../mock/fixtures/operator-account.fixture';
import type { OperatorEarningEntries, OperatorEarningQuery, OperatorEarningSummary } from '../types/operator-earning';
import { OPERATOR_EARNING_ENTRIES, OPERATOR_EARNING_SUMMARY } from '../mock/fixtures/operator-earning.fixture';
import { parseOperatorEarningEntriesEnvelope, parseOperatorEarningSummaryEnvelope, validateOperatorEarningQuery } from './operator-earning-codec';
import type { OperatorLessonRoster } from '../types/operator-lesson-members';
import type {
  OperatorSeriesPattern, OperatorSeriesCreateInput, OperatorSeriesPreview, OperatorSeriesCreated,
  OperatorCancellationMode, OperatorCancellationInput, OperatorCancellationPreview, OperatorSeriesCancelled,
} from "../types/operator";
import {
  validateSeriesPattern, validateCancellation, parseSeriesPreview, parseSeriesCreated,
  parseCancellationPreview, parseSeriesCancelled,
} from "../services/operator-lesson-series.presenter";

export interface MockOperatorDataSourceOptions {
  scenario?: OperatorMockScenario;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MockOperatorDataSource implements OperatorDataSource {
  private readonly scenario: OperatorMockScenario;
  private readonly fixture: typeof NORMAL_OPERATOR_FIXTURE;
  private readonly studentMutationResults = new Map<
    string,
    { signature: string; result: OperatorStudent }
  >();
  private readonly scheduleMutationResults = new Map<
    string,
    { signature: string; result: OperatorLessonSession }
  >();
  private readonly leaveMutationResults = new Map<
    string,
    { signature: string; result: OperatorLeaveRequest }
  >();
  private readonly settingsMutationResults = new Map<
    string,
    { signature: string; result: OperatorCampusSettings }
  >();
  private studentSequence = 1;
  private lessonSequence = 1;
  private readonly rankingSnapshots = new Map<string, OperatorRankingPage>();
  private readonly temporaryMembers = new Map<string, Set<string>>();
  private readonly memberResults = new Map<string, { signature: string; result: OperatorLessonRoster }>();
  private readonly seriesResults = new Map<string, { signature: string; result: OperatorSeriesCreated | OperatorSeriesCancelled }>();
  private seriesSequence = 1;

  async previewLessonSeries(input: OperatorSeriesPattern): Promise<OperatorSeriesPreview> {
    return this.seriesPreview(input);
  }
  private seriesPreview(input: OperatorSeriesPattern): OperatorSeriesPreview {
    this.assertAvailable();
    validateSeriesPattern(input);
    const group = this.fixture.schedulingOptions.classes.find(row => row.classGroupId === input.classGroupId);
    if (!group) throw new OperatorDataSourceError(404, "RESOURCE_NOT_FOUND", "所选班级当前不可用");
    const start = Date.parse(input.startDate), end = Date.parse(input.endDate);
    const monday = start - ((new Date(start).getUTCDay() + 6) % 7) * 86400000;
    const sessions: OperatorSeriesPreview["sessions"] = [];
    for (let day = start; day <= end; day += 86400000) {
      if (!input.weekdays.includes(((new Date(day).getUTCDay() + 6) % 7) + 1) ||
        Math.floor((day - monday) / (7 * 86400000)) % input.intervalWeeks) continue;
      const date = new Date(day).toISOString().slice(0, 10);
      const startsAt = `${date}T${input.startTime}:00+08:00`, endsAt = `${date}T${input.endTime}:00+08:00`;
      if (Date.parse(startsAt) <= Date.now()) throw new OperatorDataSourceError(400, "BAD_REQUEST", "只能安排未来课次");
      sessions.push({ date, startsAt, endsAt });
      if (sessions.length > 50) throw new OperatorDataSourceError(400, "BAD_REQUEST", "最多50节，请缩小范围");
    }
    if (!sessions.length) throw new OperatorDataSourceError(400, "BAD_REQUEST", "所选范围没有上课日期");
    const conflictDates = sessions.filter(row => this.scheduleConflicts(group.classGroupId,
      group.teacherId, row.startsAt, row.endsAt)).map(row => row.date);
    const previewHash = this.seriesFingerprint({ ...input, weekdays: [...input.weekdays].sort(), group, sessions, conflictDates });
    return parseSeriesPreview({ data: { timezone: "Asia/Shanghai", previewHash, sessions, conflictDates } }, input);
  }

  async createLessonSeries(input: OperatorSeriesCreateInput, key: string): Promise<OperatorSeriesCreated> {
    this.assertAvailable();
    validateSeriesPattern(input, true);
    const pattern = { ...input } as OperatorSeriesCreateInput;
    delete (pattern as Partial<OperatorSeriesCreateInput>).previewHash;
    const replay = this.seriesReplay("create", key, input);
    if (replay) return clone(replay as OperatorSeriesCreated);
    const current = this.seriesPreview(pattern);
    if (current.previewHash !== input.previewHash || current.conflictDates.length)
      throw new OperatorDataSourceError(409, "CONFLICT", "排课条件或冲突已变化，请重新预览", { conflictDates: current.conflictDates });
    const group = this.fixture.schedulingOptions.classes.find(row => row.classGroupId === input.classGroupId)!;
    const seriesId = `78000000-0000-4000-8000-${String(this.seriesSequence++).padStart(12, "0")}`;
    const rows = current.sessions.map(row => ({
      id: `79000000-0000-4000-8000-${String(this.lessonSequence++).padStart(12, "0")}`,
      seriesId, campusId: this.fixture.profile.campusId, classGroupId: group.classGroupId,
      className: group.className, courseName: group.courseName, teacherId: group.teacherId, teacherName: group.teacherName,
      startsAt: row.startsAt, endsAt: row.endsAt, kind: input.kind,
      lessonUnits: group.defaultLessonUnits, status: "SCHEDULED" as const, version: 1,
    }));
    const result = parseSeriesCreated({ data: { seriesId, version: 1, sessions: rows.map(row => ({
      id: row.id, version: row.version, startsAt: row.startsAt, endsAt: row.endsAt,
    })) } }, input);
    this.fixture.lessonSessions.push(...rows);
    this.seriesResults.set(`create:${key}`, { signature: JSON.stringify(input), result: clone(result) });
    return clone(result);
  }

  async previewLessonCancellation(id: string, mode: OperatorCancellationMode): Promise<OperatorCancellationPreview> {
    return this.cancellationPreview(id, mode);
  }
  private cancellationPreview(id: string, mode: OperatorCancellationMode): OperatorCancellationPreview {
    this.assertAvailable();
    validateCancellation(id, mode);
    const target = this.findLesson(id);
    if (target.status !== "SCHEDULED" || Date.parse(target.startsAt) <= Date.now() ||
      (mode === "FOLLOWING" && !target.seriesId))
      throw new OperatorDataSourceError(409, "CONFLICT", "只能取消尚未开始的待上课课次");
    const rows = this.fixture.lessonSessions.filter(row => mode === "THIS" ? row.id === id :
      row.seriesId === target.seriesId && row.status === "SCHEDULED" &&
      Date.parse(row.startsAt) > Date.now() && Date.parse(row.startsAt) >= Date.parse(target.startsAt))
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id))
      .map(row => ({ id: row.id, version: row.version, startsAt: row.startsAt, endsAt: row.endsAt }));
    return parseCancellationPreview({ data: { seriesId: target.seriesId ?? null,
      previewHash: this.seriesFingerprint({ id, mode, rows }), sessions: rows } }, id, mode);
  }

  async cancelLessonSelection(id: string, input: OperatorCancellationInput, expected: OperatorCancellationPreview,
    key: string): Promise<OperatorSeriesCancelled> {
    this.assertAvailable();
    validateCancellation(id, input.mode, input.previewHash, key);
    const operation = `cancel:${id}`;
    const replay = this.seriesReplay(operation, key, input);
    if (replay) return clone(replay as OperatorSeriesCancelled);
    const current = this.cancellationPreview(id, input.mode);
    if (current.previewHash !== input.previewHash) throw new OperatorDataSourceError(409, "CONFLICT", "取消范围已变化，请重新核对");
    const result = parseSeriesCancelled({ data: { seriesId: current.seriesId, sessions: current.sessions.map(row => ({
      ...row, version: row.version + 1, status: "CANCELLED",
    })) } }, expected);
    for (const row of result.sessions) Object.assign(this.findLesson(row.id), { status: row.status, version: row.version });
    this.seriesResults.set(`${operation}:${key}`, { signature: JSON.stringify(input), result: clone(result) });
    return clone(result);
  }

  private seriesReplay(operation: string, key: string, input: unknown) {
    if (!key?.trim()) throw new OperatorDataSourceError(400, "BAD_REQUEST", "幂等标识不能为空");
    const replay = this.seriesResults.get(`${operation}:${key}`);
    if (replay && replay.signature !== JSON.stringify(input))
      throw new OperatorDataSourceError(409, "CONFLICT", "原操作内容已变化");
    return replay?.result;
  }
  private seriesFingerprint(input: unknown): string {
    // Deterministic synthetic fingerprint only; not a cryptographic authorization mechanism.
    const text = JSON.stringify(input);
    return Array.from({ length: 8 }, (_, salt) => {
      let value = 2166136261 + salt;
      for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
      return (value >>> 0).toString(16).padStart(8, "0");
    }).join("");
  }
  private scheduleConflicts(classId: string, teacherId: string, start: string, end: string, excluding = "") {
    return this.fixture.lessonSessions.some(row => row.id !== excluding && row.status !== "CANCELLED" &&
      (row.classGroupId === classId || row.teacherId === teacherId) &&
      Date.parse(row.startsAt) < Date.parse(end) && Date.parse(row.endsAt) > Date.parse(start));
  }

  async getLessonMembers(id: string): Promise<OperatorLessonRoster> {
    this.assertAvailable();
    const lesson = this.findLesson(id);
    if (lesson.status === 'COMPLETED' || lesson.status === 'REVERSED')
      throw new OperatorDataSourceError(404, 'RESOURCE_NOT_FOUND', '当前模拟课次未提供历史名单');
    const canChange = lesson.status === 'SCHEDULED' && Date.parse(lesson.startsAt) > Date.now();
    const temporary = this.temporaryMembers.get(id) ?? new Set<string>();
    return clone({
      lessonSessionId: id, lessonVersion: lesson.version, status: lesson.status,
      startsAt: lesson.startsAt, canChange, serverTime: new Date().toISOString(),
      members: this.fixture.students.filter((student) =>
        student.classNames.includes(lesson.className) || temporary.has(student.id)).map((student) => ({
          studentId: student.id, displayName: student.displayName,
          source: student.classNames.includes(lesson.className) ? 'CLASS' : 'TEMPORARY',
          canRemove: canChange && !student.classNames.includes(lesson.className),
        })),
    });
  }

  addLessonMember(id: string, studentId: string, version: number, key: string) {
    return this.changeLessonMember('add', id, studentId, version, key);
  }

  removeLessonMember(id: string, studentId: string, version: number, key: string) {
    return this.changeLessonMember('remove', id, studentId, version, key);
  }

  private async changeLessonMember(operation: 'add' | 'remove', id: string, studentId: string,
    version: number, key: string): Promise<OperatorLessonRoster> {
    this.assertAvailable();
    const signature = JSON.stringify({ operation, id, studentId, version });
    const replay = this.memberResults.get(key);
    if (replay) {
      if (replay.signature !== signature) throw new OperatorDataSourceError(409, 'CONFLICT', '操作内容已变化');
      return clone(replay.result);
    }
    const lesson = this.findLesson(id);
    this.assertScheduledVersion(lesson, version);
    if (Date.parse(lesson.startsAt) <= Date.now())
      throw new OperatorDataSourceError(409, 'CONFLICT', '当前课次已开始');
    const student = this.fixture.students.find((row) => row.id === studentId);
    if (!student || student.campusId !== lesson.campusId)
      throw new OperatorDataSourceError(404, 'RESOURCE_NOT_FOUND', '未找到本校区学员');
    const regular = student.classNames.includes(lesson.className);
    const temporary = this.temporaryMembers.get(id) ?? new Set<string>();
    if (operation === 'remove' && regular)
      throw new OperatorDataSourceError(409, 'CONFLICT', '常规学员不能从本课移除');
    if (operation === 'add' && !regular && !temporary.has(studentId)) {
      // This uses the existing deterministic demo balance; no package is created or consumed.
      const available = (await this.getStudentArchive(studentId)).availableTotalUnits;
      if (available < lesson.lessonUnits)
        throw new OperatorDataSourceError(409, 'INSUFFICIENT_LESSON_BALANCE', '可用课时余额不足，不能加入本课');
      temporary.add(studentId);
      lesson.version += 1;
    } else if (operation === 'remove' && temporary.delete(studentId)) lesson.version += 1;
    this.temporaryMembers.set(id, temporary);
    const result = await this.getLessonMembers(id);
    this.memberResults.set(key, { signature, result: clone(result) });
    return result;
  }

  constructor(options: MockOperatorDataSourceOptions = {}) {
    this.scenario = options.scenario ?? "normal";
    this.fixture = clone(
      this.scenario === "empty"
        ? EMPTY_OPERATOR_FIXTURE
        : NORMAL_OPERATOR_FIXTURE,
    );
  }

  async getEarningSummary(): Promise<OperatorEarningSummary> {
    this.assertAvailable();
    return parseOperatorEarningSummaryEnvelope({ data: { ...OPERATOR_EARNING_SUMMARY,
      ...(this.scenario === 'empty' ? { estimatedTotalFen: 0, pendingReviewFen: 0 } : {}),
    } });
  }

  async listEarningEntries(query: OperatorEarningQuery): Promise<OperatorEarningEntries> {
    this.assertAvailable();
    validateOperatorEarningQuery(query);
    const rows = (this.scenario === 'empty' ? [] : OPERATOR_EARNING_ENTRIES).filter(item =>
      (!query.status || item.status === query.status) && (!query.entryType || item.entryType === query.entryType));
    return parseOperatorEarningEntriesEnvelope({ data: {
      data: clone(rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)),
      meta: { page: query.page, pageSize: query.pageSize, total: rows.length, totalPages: Math.ceil(rows.length / query.pageSize) },
      serverTime: OPERATOR_EARNING_SUMMARY.serverTime, timezone: OPERATOR_EARNING_SUMMARY.timezone,
    } }, query);
  }

  async getLessonAccount(query: OperatorAccountQuery): Promise<OperatorAccount> {
    this.assertAvailable();
    validateOperatorAccountQuery(query);
    const account = mockOperatorAccount(this.scenario === 'empty');
    const items = account.items.filter(item => (!query.entryType || item.entryType === query.entryType) &&
      (!query.subjectId || (query.subjectId === 'UNCLASSIFIED' ? item.subject === null :
        item.subject?.id.toLowerCase() === query.subjectId.toLowerCase())));
    return parseOperatorAccountEnvelope({ data: { ...account,
      items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
      meta: { total: items.length, totalPages: Math.ceil(items.length / query.pageSize),
        page: query.page, pageSize: query.pageSize },
    } }, query);
  }

  async listAccountSubjects(query: OperatorAccountSubjectQuery): Promise<OperatorAccountSubjects> {
    this.assertAvailable();
    validateOperatorAccountSubjectQuery(query);
    const data = (this.scenario === 'empty' ? [] : OPERATOR_ACCOUNT_SUBJECTS)
      .filter(item => !query.query || item.name.includes(query.query));
    return parseOperatorAccountSubjectsEnvelope({ data: {
      data: clone(data.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)),
      meta: { page: query.page, pageSize: query.pageSize, total: data.length, totalPages: Math.ceil(data.length / query.pageSize) },
      serverTime: '2026-10-28T09:30:00Z', timezone: 'Asia/Shanghai',
    } }, query);
  }

  async getDashboard(): Promise<OperatorDashboard> {
    this.assertAvailable();
    const pending = this.fixture.leaveRequests.filter(
      (item) => item.status === "PENDING" && item.canReview === true,
    );
    const latest = pending.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0];
    return clone({
      ...this.fixture.dashboard,
      pendingLeaveCount: pending.length,
      latestPendingLeave: latest ? {
        id: latest.id, studentName: latest.studentName,
        courseName: latest.courseName, startsAt: latest.startsAt,
      } : null,
    });
  }

  async getProfile(): Promise<OperatorProfile> {
    this.assertAvailable();
    return clone(this.fixture.profile);
  }

  async listRankings(query: OperatorRankingQuery): Promise<OperatorRankingPage> {
    this.assertAvailable();
    validateOperatorRankingQuery(query);
    const key = JSON.stringify([query.metric, query.month]);
    let snapshot = this.rankingSnapshots.get(key);
    if (query.revisionId && query.revisionId !== snapshot?.revisionId) {
      throw new OperatorDataSourceError(404, 'RESOURCE_NOT_FOUND', '月榜修订不存在，请刷新');
    }
    if (!snapshot) {
      const available = query.month === currentOperatorRankingMonth();
      const offset = query.metric === 'STUDENTS' ? 0 : query.metric === 'PARTNER_EARNINGS' ? 7 : 14;
      const rows: OperatorRankingRow[] = !available || this.scenario === 'empty' ? [] :
        Array.from({ length: 21 }, (_, index) => {
          const campus = (index + offset) % 21;
          return {
            campusName: campus === 20 ? this.fixture.profile.campusName : `示例校区${campus + 1}`,
            rank: index < 2 ? 1 : index, rankDelta: index === 0 ? null : index % 3 - 1,
            isOwnCampus: campus === 20,
          };
        });
      snapshot = {
        metric: query.metric, month: query.month, timezone: 'Asia/Shanghai',
        asOf: new Date().toISOString(), calculationVersion: 'operator-mock-monthly-v1',
        availability: available ? 'LIVE' : 'UNAVAILABLE',
        unavailableReason: available ? null : 'HISTORY_UNAVAILABLE',
        revisionId: available ? `a3000000-0000-4000-8000-${String(this.rankingSnapshots.size + 1).padStart(12, '0')}` : null,
        data: rows, ownCampus: rows.find((item) => item.isOwnCampus) ?? null,
        meta: { page: 1, pageSize: query.pageSize, total: rows.length, totalPages: Math.ceil(rows.length / query.pageSize) },
      };
      this.rankingSnapshots.set(key, snapshot);
    }
    const page = {
      ...snapshot, data: snapshot.data.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
      meta: { page: query.page, pageSize: query.pageSize, total: snapshot.meta.total, totalPages: Math.ceil(snapshot.meta.total / query.pageSize) },
    };
    return parseOperatorRankingEnvelope({ data: clone(page) }, query);
  }

  async listTeacherArchives(query: OperatorStudentQuery): Promise<OperatorPage<OperatorTeacherArchive>> {
    this.assertAvailable();
    const keyword = query.query?.trim() ?? '';
    const items = (this.scenario === 'empty' ? [] : [...OPERATOR_TEACHER_ARCHIVES])
      .filter((item) => item.displayName.includes(keyword))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN') || a.id.localeCompare(b.id));
    return this.teacherPage(items, query);
  }

  async getTeacherPerformance(teacherId: string, month?: string): Promise<OperatorTeacherPerformance> {
    this.assertTeacherArchive(teacherId);
    return clone(mockTeacherPerformance(teacherId, month));
  }

  async getTeacherEvaluationHistory(teacherId: string, query: OperatorTeacherHistoryQuery): Promise<OperatorPage<OperatorTeacherEvaluationRevision>> {
    this.assertTeacherArchive(teacherId);
    return this.teacherPage(mockTeacherRevisions(teacherId, query.month), query);
  }

  private assertTeacherArchive(id: string): void {
    this.assertAvailable();
    if (this.scenario === 'empty' || !OPERATOR_TEACHER_ARCHIVES.some((item) => item.id === id)) {
      throw new OperatorDataSourceError(404, 'RESOURCE_NOT_FOUND', '未找到本校区教师档案');
    }
  }

  private teacherPage<T>(items: readonly T[], query: { page: number; pageSize: number }): OperatorPage<T> {
    const start = (query.page - 1) * query.pageSize;
    return {
      data: clone(items.slice(start, start + query.pageSize)),
      meta: { page: query.page, pageSize: query.pageSize, total: items.length, totalPages: Math.ceil(items.length / query.pageSize) },
    };
  }

  async listStudents(
    query: OperatorStudentQuery,
  ): Promise<OperatorPage<OperatorStudent>> {
    this.assertAvailable();
    const keyword = query.query?.trim().toLocaleLowerCase();
    const students = this.fixture.students
      .filter(
        (student) =>
          !keyword || student.displayName.toLocaleLowerCase().includes(keyword),
      )
      .sort((left, right) =>
        left.displayName === right.displayName
          ? left.id.localeCompare(right.id)
          : left.displayName < right.displayName
            ? -1
            : 1,
      );
    const total = students.length;
    const start = (query.page - 1) * query.pageSize;
    return {
      data: clone(students.slice(start, start + query.pageSize)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  async getStudent(id: string): Promise<OperatorStudentDetail> {
    this.assertAvailable();
    const student = this.fixture.students.find((item) => item.id === id);
    if (!student) {
      throw new OperatorDataSourceError(
        404,
        "RESOURCE_NOT_FOUND",
        "未找到本校区学员",
      );
    }
    return {
      ...clone(student),
      mainBalanceUnits: student.id.includes("000000000001") ? 1000 : 0,
      giftBalanceUnits: student.id.includes("000000000001") ? 100 : 0,
      recentAttendanceCount: student.id.includes("000000000001") ? 8 : 0,
      recentConsumedUnits: student.id.includes("000000000001") ? 800 : 0,
    };
  }

  async getStudentArchive(id: string): Promise<OperatorStudentArchive> {
    this.assertAvailable();
    const student = this.fixture.students.find((item) => item.id === id);
    if (!student) throw new OperatorDataSourceError(404, 'RESOURCE_NOT_FOUND', '未找到本校区学员');
    const primary = id === NORMAL_OPERATOR_FIXTURE.students[0].id;
    return {
      id, displayName: student.displayName, ageYears: student.ageYears, photo: null,
      classes: this.fixture.schedulingOptions.classes.filter((item) => student.classNames.includes(item.className))
        .map((item) => ({ id: item.classGroupId, className: item.className, courseName: item.courseName, teacherName: item.teacherName })),
      enrollmentSummary: primary
        ? { receivedAmountFen: 320000, refundedAmountFen: 0, initialMainUnits: 2000, initialGiftUnits: 200, pendingIssuanceCount: 0 }
        : { receivedAmountFen: null, refundedAmountFen: null, initialMainUnits: null, initialGiftUnits: null, pendingIssuanceCount: 0 },
      mainBalanceUnits: primary ? 1000 : 0, giftBalanceUnits: primary ? 100 : 0,
      totalBalanceUnits: primary ? 1100 : 0, mainAvailableUnits: primary ? 1000 : 0,
      giftAvailableUnits: primary ? 100 : 0, availableTotalUnits: primary ? 1100 : 0,
      mainReservedUnits: 0, giftReservedUnits: 0, reservedTotalUnits: 0,
      warningThresholdUnits: this.fixture.campusSettings.lessonWarningThresholdUnits,
      lowBalance: (primary ? 1100 : 0) <= this.fixture.campusSettings.lessonWarningThresholdUnits,
      attendance: { presentCount: primary ? 8 : 0, absentCount: 0, leaveCount: 0,
        recordedCount: primary ? 8 : 0, attendanceRateBasisPoints: primary ? 10000 : null },
      serverTime: this.fixture.dashboard.serverTime,
    };
  }

  async getStudentGrowth(id: string, query: { page: number; pageSize: number }): Promise<OperatorPage<OperatorStudentGrowth>> {
    await this.getStudentArchive(id);
    const records: OperatorStudentGrowth[] = id === NORMAL_OPERATOR_FIXTURE.students[0].id ? [{
      lessonSessionId: '70000000-0000-4000-8000-000000000001', studentId: id,
      courseName: '创意基础', campusName: this.fixture.profile.campusName, teacherName: '王老师',
      startsAt: '2026-08-29T06:00:00Z', lessonStatus: 'COMPLETED', attendanceStatus: 'PRESENT',
      feedback: '能够独立完成作品，乐于交流创作想法。', performanceRating: null,
      teacherRatings: { classroomPerformance: 8, workCompletion: 9, communication: null, overall: 9 },
      feedbackVersion: 1, feedbackAuthorName: '王老师', feedbackValid: true,
      review: null, reviewAuthorName: null, feedbackImages: [], feedbackUpdatedAt: '2026-08-29T08:00:00Z',
    }] : [];
    const start = (query.page - 1) * query.pageSize;
    return { data: clone(records.slice(start, start + query.pageSize)),
      meta: { page: query.page, pageSize: query.pageSize, total: records.length, totalPages: Math.ceil(records.length / query.pageSize) } };
  }

  async getSchedulingOptions(): Promise<OperatorSchedulingOptions> {
    this.assertAvailable();
    return clone(this.fixture.schedulingOptions);
  }

  async createStudent(
    input: OperatorCreateStudentInput,
    idempotencyKey: string,
  ): Promise<OperatorStudent> {
    this.assertAvailable();
    const key = idempotencyKey.trim();
    if (!key) {
      throw new Error("幂等标识不能为空");
    }
    const signature = JSON.stringify(input);
    const replay = this.studentMutationResults.get(key);
    if (replay) {
      if (replay.signature !== signature) {
        throw new OperatorDataSourceError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "提交内容已变化，请重新提交",
        );
      }
      return clone(replay.result);
    }
    const selectedClass = input.classGroupId
      ? this.fixture.schedulingOptions.classes.find(
          (item) => item.classGroupId === input.classGroupId,
        )
      : null;
    if (input.classGroupId && !selectedClass) {
      throw new OperatorDataSourceError(
        404,
        "RESOURCE_NOT_FOUND",
        "所选班级当前不可用",
      );
    }
    const sequence = String(this.studentSequence).padStart(12, "0");
    const student: OperatorStudent = {
      id: `49000000-0000-4000-8000-${sequence}`,
      campusId: this.fixture.profile.campusId,
      displayName: input.displayName,
      ageYears: input.birthDate ? this.ageAtFixtureTime(input.birthDate) : null,
      classNames: selectedClass ? [selectedClass.className] : [],
    };
    this.studentSequence += 1;
    this.fixture.students.push(student);
    this.studentMutationResults.set(key, {
      signature,
      result: clone(student),
    });
    return clone(student);
  }

  private ageAtFixtureTime(birthDate: string): number {
    const [year, month, day] = birthDate.split("-").map(Number);
    const [nowYear, nowMonth, nowDay] = this.fixture.dashboard.serverTime.slice(0, 10).split("-").map(Number);
    return nowYear - year - (nowMonth < month || (nowMonth === month && nowDay < day) ? 1 : 0);
  }

  async listLessonSessions(
    query: OperatorLessonQuery,
  ): Promise<OperatorPage<OperatorLessonSession>> {
    this.assertAvailable();
    const from = query.from ? Date.parse(query.from) : null;
    const to = query.to ? Date.parse(query.to) : null;
    const lessons = this.fixture.lessonSessions
      .filter((lesson) => {
        const startsAt = Date.parse(lesson.startsAt);
        return (
          (!query.status || lesson.status === query.status) &&
          (from === null || startsAt >= from) &&
          (to === null || startsAt < to)
        );
      })
      .sort((left, right) =>
        left.startsAt === right.startsAt
          ? left.id.localeCompare(right.id)
          : left.startsAt < right.startsAt
            ? -1
            : 1,
      );
    const total = lessons.length;
    const start = (query.page - 1) * query.pageSize;
    return {
      data: clone(lessons.slice(start, start + query.pageSize)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  async createLessonSession(
    input: OperatorScheduleInput,
    idempotencyKey: string,
  ): Promise<OperatorLessonSession> {
    this.assertAvailable();
    const route = "/operators/me/lesson-sessions";
    const replay = this.getScheduleReplay(route, idempotencyKey, input);
    if (replay) {
      return replay;
    }
    const classGroup = this.fixture.schedulingOptions.classes.find(
      (item) => item.classGroupId === input.classGroupId,
    );
    if (!classGroup) {
      throw new OperatorDataSourceError(
        404,
        "RESOURCE_NOT_FOUND",
        "所选班级当前不可用",
      );
    }
    this.assertScheduleRange(input.startsAt, input.endsAt);
    if (this.scheduleConflicts(classGroup.classGroupId, classGroup.teacherId, input.startsAt, input.endsAt))
      throw new OperatorDataSourceError(409, "CONFLICT", "班级或教师时间冲突", {
        conflictDates: [new Date(Date.parse(input.startsAt) + 8 * 3600000).toISOString().slice(0, 10)],
      });
    const sequence = String(this.lessonSequence).padStart(12, "0");
    const lesson: OperatorLessonSession = {
      id: `79000000-0000-4000-8000-${sequence}`,
      campusId: this.fixture.profile.campusId,
      classGroupId: classGroup.classGroupId,
      className: classGroup.className,
      courseName: classGroup.courseName,
      teacherId: classGroup.teacherId,
      teacherName: classGroup.teacherName,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      kind: input.kind,
      lessonUnits: classGroup.defaultLessonUnits,
      status: "SCHEDULED",
      version: 1,
    };
    this.lessonSequence += 1;
    this.fixture.lessonSessions.push(lesson);
    this.saveScheduleReplay(route, idempotencyKey, input, lesson);
    return clone(lesson);
  }

  async updateLessonSession(
    lessonSessionId: string,
    input: OperatorUpdateScheduleInput,
    idempotencyKey: string,
  ): Promise<OperatorLessonSession> {
    this.assertAvailable();
    const route = `/operators/me/lesson-sessions/${lessonSessionId}`;
    const replay = this.getScheduleReplay(route, idempotencyKey, input);
    if (replay) {
      return replay;
    }
    const lesson = this.findLesson(lessonSessionId);
    this.assertScheduledVersion(lesson, input.version);
    this.assertScheduleRange(input.startsAt, input.endsAt);
    if (this.scheduleConflicts(lesson.classGroupId, lesson.teacherId, input.startsAt, input.endsAt, lesson.id))
      throw new OperatorDataSourceError(409, "CONFLICT", "班级或教师时间冲突", {
        conflictDates: [new Date(Date.parse(input.startsAt) + 8 * 3600000).toISOString().slice(0, 10)],
      });
    lesson.startsAt = input.startsAt;
    lesson.endsAt = input.endsAt;
    lesson.kind = input.kind;
    lesson.version += 1;
    this.saveScheduleReplay(route, idempotencyKey, input, lesson);
    return clone(lesson);
  }

  async cancelLessonSession(
    lessonSessionId: string,
    version: number,
    idempotencyKey: string,
  ): Promise<OperatorLessonSession> {
    this.assertAvailable();
    const route = `/operators/me/lesson-sessions/${lessonSessionId}/cancel`;
    const input = { version };
    const replay = this.getScheduleReplay(route, idempotencyKey, input);
    if (replay) {
      return replay;
    }
    const lesson = this.findLesson(lessonSessionId);
    this.assertScheduledVersion(lesson, version);
    lesson.status = "CANCELLED";
    lesson.version += 1;
    this.saveScheduleReplay(route, idempotencyKey, input, lesson);
    return clone(lesson);
  }

  async listLeaveRequests(
    query: OperatorLeaveQuery,
  ): Promise<OperatorPage<OperatorLeaveRequest>> {
    this.assertAvailable();
    if (query.reviewedOnly !== undefined &&
      (typeof query.reviewedOnly !== "boolean" || query.status !== undefined)) {
      throw new OperatorDataSourceError(400, "BAD_REQUEST", "审批历史筛选无效，请重新选择");
    }
    const requests = this.fixture.leaveRequests
      .filter((request) => query.reviewedOnly
        ? request.status === "APPROVED" || request.status === "REJECTED"
        : !query.status || request.status === query.status)
      .sort((left, right) => {
        if (query.reviewedOnly) {
          if (left.reviewedAt === null) return right.reviewedAt === null ? right.id.localeCompare(left.id) : 1;
          if (right.reviewedAt === null) return -1;
          return Date.parse(right.reviewedAt) - Date.parse(left.reviewedAt) || right.id.localeCompare(left.id);
        }
        return left.createdAt === right.createdAt
          ? right.id.localeCompare(left.id)
          : left.createdAt > right.createdAt
            ? -1
            : 1;
      });
    const total = requests.length;
    const start = (query.page - 1) * query.pageSize;
    return {
      data: clone(requests.slice(start, start + query.pageSize)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  approveLeaveRequest(
    leaveRequestId: string,
    version: number,
    reviewReason: string | undefined,
    idempotencyKey: string,
  ): Promise<OperatorLeaveRequest> {
    return this.reviewLeave(
      leaveRequestId,
      version,
      "APPROVED",
      reviewReason,
      idempotencyKey,
    );
  }

  rejectLeaveRequest(
    leaveRequestId: string,
    version: number,
    reviewReason: string,
    idempotencyKey: string,
  ): Promise<OperatorLeaveRequest> {
    const reason = reviewReason.trim();
    if (!reason) {
      return Promise.reject(
        new OperatorDataSourceError(
          400,
          "VALIDATION_FAILED",
          "请填写驳回原因",
        ),
      );
    }
    return this.reviewLeave(
      leaveRequestId,
      version,
      "REJECTED",
      reason,
      idempotencyKey,
    );
  }

  async listWarnings(
    query: OperatorWarningQuery,
  ): Promise<OperatorPage<OperatorWarning>> {
    this.assertAvailable();
    const keyword = query.query?.trim().toLocaleLowerCase();
    const warnings = this.fixture.warnings.filter(
      (warning) =>
        !keyword || warning.studentName.toLocaleLowerCase().includes(keyword),
    );
    const total = warnings.length;
    const start = (query.page - 1) * query.pageSize;
    return {
      data: clone(warnings.slice(start, start + query.pageSize)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  async getCampusSettings(): Promise<OperatorCampusSettings> {
    this.assertAvailable();
    return clone(this.fixture.campusSettings);
  }

  async updateCampusSettings(
    input: OperatorUpdateSettingsInput,
    idempotencyKey: string,
  ): Promise<OperatorCampusSettings> {
    this.assertAvailable();
    const key = idempotencyKey.trim();
    if (!key) {
      throw new Error("幂等标识不能为空");
    }
    const signature = JSON.stringify(input);
    const replay = this.settingsMutationResults.get(key);
    if (replay) {
      if (replay.signature !== signature) {
        throw new OperatorDataSourceError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "提交内容已变化，请重新提交",
        );
      }
      return clone(replay.result);
    }
    if (this.fixture.campusSettings.version !== input.version) {
      throw new OperatorDataSourceError(
        409,
        "CONFLICT",
        "数据已更新，请刷新后重试",
        { currentVersion: this.fixture.campusSettings.version },
      );
    }
    const result: OperatorCampusSettings = {
      ...this.fixture.campusSettings,
      name: input.name,
      contactPhone: input.contactPhone,
      address: input.address,
      lessonWarningThresholdUnits: input.lessonWarningThresholdUnits,
      version: input.version + 1,
    };
    this.fixture.campusSettings = clone(result);
    this.fixture.profile.campusName = result.name;
    this.fixture.dashboard.campus.name = result.name;
    this.fixture.warnings = this.fixture.warnings.map((warning) => ({
      ...warning,
      thresholdUnits: result.lessonWarningThresholdUnits,
    }));
    this.settingsMutationResults.set(key, { signature, result: clone(result) });
    return clone(result);
  }

  private async reviewLeave(
    leaveRequestId: string,
    version: number,
    status: "APPROVED" | "REJECTED",
    reviewReason: string | undefined,
    idempotencyKey: string,
  ): Promise<OperatorLeaveRequest> {
    this.assertAvailable();
    const route = `/operators/me/leave-requests/${leaveRequestId}/${status === "APPROVED" ? "approve" : "reject"}`;
    const key = idempotencyKey.trim();
    if (!key) {
      throw new Error("幂等标识不能为空");
    }
    const mutationKey = `${route}:${key}`;
    const input = {
      version,
      ...(reviewReason ? { reviewReason: reviewReason.trim() } : {}),
    };
    const signature = JSON.stringify(input);
    const replay = this.leaveMutationResults.get(mutationKey);
    if (replay) {
      if (replay.signature !== signature) {
        throw new OperatorDataSourceError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "提交内容已变化，请重新提交",
        );
      }
      return clone(replay.result);
    }
    const request = this.fixture.leaveRequests.find(
      (item) => item.id === leaveRequestId,
    );
    if (!request) {
      throw new OperatorDataSourceError(
        404,
        "RESOURCE_NOT_FOUND",
        "未找到本校区请假申请",
      );
    }
    if (request.status !== "PENDING") {
      throw new OperatorDataSourceError(
        409,
        "CONFLICT",
        "该请假申请已完成审批",
        { currentStatus: request.status },
      );
    }
    if (request.canReview !== true) {
      throw new OperatorDataSourceError(409, "CONFLICT", "当前不可审批");
    }
    if (request.version !== version) {
      throw new OperatorDataSourceError(
        409,
        "CONFLICT",
        "数据已更新，请刷新后重试",
        { currentVersion: request.version },
      );
    }
    request.status = status;
    request.canReview = false;
    request.reviewerName = this.fixture.profile.displayName;
    request.reviewedAt = new Date().toISOString();
    request.reviewReason = reviewReason?.trim() || null;
    request.version += 1;
    const result = clone(request);
    this.leaveMutationResults.set(mutationKey, { signature, result });
    return clone(result);
  }

  private getScheduleReplay(
    route: string,
    idempotencyKey: string,
    input: unknown,
  ): OperatorLessonSession | null {
    const key = idempotencyKey.trim();
    if (!key) {
      throw new Error("幂等标识不能为空");
    }
    const mutationKey = `${route}:${key}`;
    const signature = JSON.stringify(input);
    const replay = this.scheduleMutationResults.get(mutationKey);
    if (!replay) {
      return null;
    }
    if (replay.signature !== signature) {
      throw new OperatorDataSourceError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "提交内容已变化，请重新提交",
      );
    }
    return clone(replay.result);
  }

  private saveScheduleReplay(
    route: string,
    idempotencyKey: string,
    input: unknown,
    result: OperatorLessonSession,
  ): void {
    this.scheduleMutationResults.set(`${route}:${idempotencyKey.trim()}`, {
      signature: JSON.stringify(input),
      result: clone(result),
    });
  }

  private findLesson(lessonSessionId: string): OperatorLessonSession {
    const lesson = this.fixture.lessonSessions.find(
      (item) => item.id === lessonSessionId,
    );
    if (!lesson) {
      throw new OperatorDataSourceError(
        404,
        "RESOURCE_NOT_FOUND",
        "未找到本校区课次",
      );
    }
    return lesson;
  }

  private assertScheduledVersion(
    lesson: OperatorLessonSession,
    version: number,
  ): void {
    if (lesson.status !== "SCHEDULED") {
      throw new OperatorDataSourceError(
        409,
        "CONFLICT",
        "当前课次状态不可修改",
        { currentStatus: lesson.status },
      );
    }
    if (lesson.version !== version) {
      throw new OperatorDataSourceError(
        409,
        "LESSON_VERSION_CONFLICT",
        "数据已更新，请刷新后重试",
        { currentVersion: lesson.version },
      );
    }
  }

  private assertScheduleRange(startsAt: string, endsAt: string): void {
    if (Date.parse(startsAt) >= Date.parse(endsAt)) {
      throw new OperatorDataSourceError(
        400,
        "BAD_REQUEST",
        "结束时间必须晚于开始时间",
      );
    }
  }

  private assertAvailable(): void {
    if (this.scenario === "error") {
      throw new Error("运营端数据加载失败，请稍后重试");
    }
  }
}
