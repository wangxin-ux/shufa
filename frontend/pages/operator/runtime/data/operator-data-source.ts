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
import type { OperatorRankingPage, OperatorRankingQuery } from '../types/operator-ranking';
import type { OperatorAccount, OperatorAccountQuery, OperatorAccountSubjects, OperatorAccountSubjectQuery } from '../types/operator-account';
import type { OperatorEarningEntries, OperatorEarningQuery, OperatorEarningSummary } from '../types/operator-earning';
import type { OperatorLessonRoster } from '../types/operator-lesson-members';
import type {
  OperatorSeriesPattern, OperatorSeriesPreview, OperatorSeriesCreateInput, OperatorSeriesCreated,
  OperatorCancellationMode, OperatorCancellationInput, OperatorCancellationPreview, OperatorSeriesCancelled,
} from "../types/operator";

export class OperatorDataSourceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = OperatorDataSourceError.name;
  }
}

export interface OperatorDataSource {
  previewLessonSeries(input: OperatorSeriesPattern): Promise<OperatorSeriesPreview>;
  createLessonSeries(input: OperatorSeriesCreateInput, key: string): Promise<OperatorSeriesCreated>;
  previewLessonCancellation(id: string, mode: OperatorCancellationMode): Promise<OperatorCancellationPreview>;
  cancelLessonSelection(id: string, input: OperatorCancellationInput, expected: OperatorCancellationPreview,
    key: string): Promise<OperatorSeriesCancelled>;
  getLessonMembers(lessonSessionId: string): Promise<OperatorLessonRoster>;
  addLessonMember(lessonSessionId: string, studentId: string, version: number, key: string): Promise<OperatorLessonRoster>;
  removeLessonMember(lessonSessionId: string, studentId: string, version: number, key: string): Promise<OperatorLessonRoster>;
  getEarningSummary(): Promise<OperatorEarningSummary>;
  listEarningEntries(query: OperatorEarningQuery): Promise<OperatorEarningEntries>;
  getLessonAccount(query: OperatorAccountQuery): Promise<OperatorAccount>;
  listAccountSubjects(query: OperatorAccountSubjectQuery): Promise<OperatorAccountSubjects>;
  listRankings(query: OperatorRankingQuery): Promise<OperatorRankingPage>;
  getDashboard(): Promise<OperatorDashboard>;
  getProfile(): Promise<OperatorProfile>;
  listTeacherArchives(query: OperatorStudentQuery): Promise<OperatorPage<OperatorTeacherArchive>>;
  getTeacherPerformance(teacherId: string, month?: string): Promise<OperatorTeacherPerformance>;
  getTeacherEvaluationHistory(teacherId: string, query: OperatorTeacherHistoryQuery): Promise<OperatorPage<OperatorTeacherEvaluationRevision>>;
  listStudents(
    query: OperatorStudentQuery,
  ): Promise<OperatorPage<OperatorStudent>>;
  getStudent(id: string): Promise<OperatorStudentDetail>;
  getStudentArchive(id: string): Promise<OperatorStudentArchive>;
  getStudentGrowth(id: string, query: { page: number; pageSize: number }): Promise<OperatorPage<OperatorStudentGrowth>>;
  getSchedulingOptions(): Promise<OperatorSchedulingOptions>;
  createStudent(
    input: OperatorCreateStudentInput,
    idempotencyKey: string,
  ): Promise<OperatorStudent>;
  listLessonSessions(
    query: OperatorLessonQuery,
  ): Promise<OperatorPage<OperatorLessonSession>>;
  createLessonSession(
    input: OperatorScheduleInput,
    idempotencyKey: string,
  ): Promise<OperatorLessonSession>;
  updateLessonSession(
    lessonSessionId: string,
    input: OperatorUpdateScheduleInput,
    idempotencyKey: string,
  ): Promise<OperatorLessonSession>;
  cancelLessonSession(
    lessonSessionId: string,
    version: number,
    idempotencyKey: string,
  ): Promise<OperatorLessonSession>;
  listLeaveRequests(
    query: OperatorLeaveQuery,
  ): Promise<OperatorPage<OperatorLeaveRequest>>;
  approveLeaveRequest(
    leaveRequestId: string,
    version: number,
    reviewReason: string | undefined,
    idempotencyKey: string,
  ): Promise<OperatorLeaveRequest>;
  rejectLeaveRequest(
    leaveRequestId: string,
    version: number,
    reviewReason: string,
    idempotencyKey: string,
  ): Promise<OperatorLeaveRequest>;
  listWarnings(
    query: OperatorWarningQuery,
  ): Promise<OperatorPage<OperatorWarning>>;
  getCampusSettings(): Promise<OperatorCampusSettings>;
  updateCampusSettings(
    input: OperatorUpdateSettingsInput,
    idempotencyKey: string,
  ): Promise<OperatorCampusSettings>;
}
