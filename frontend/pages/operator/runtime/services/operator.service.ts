import { OperatorDataSource } from "../data/operator-data-source";
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
import { loadRequestState, RequestState } from "../../../../utils/request-state";
import type { OperatorRankingPage, OperatorRankingQuery } from '../types/operator-ranking';
import type { OperatorAccount, OperatorAccountQuery, OperatorAccountSubjects, OperatorAccountSubjectQuery } from '../types/operator-account';
import type { OperatorEarningEntries, OperatorEarningQuery, OperatorEarningSummary } from '../types/operator-earning';
import type { OperatorLessonRoster } from '../types/operator-lesson-members';
import type {
  OperatorSeriesPattern, OperatorSeriesCreateInput, OperatorCancellationMode,
  OperatorCancellationInput, OperatorCancellationPreview,
} from "../types/operator";

export class OperatorService {
  constructor(private readonly dataSource: OperatorDataSource) {}

  previewLessonSeries(input: OperatorSeriesPattern) {
    return loadRequestState(() => this.dataSource.previewLessonSeries(input));
  }
  createLessonSeries(input: OperatorSeriesCreateInput, key: string) {
    return loadRequestState(() => this.dataSource.createLessonSeries(input, key));
  }
  previewLessonCancellation(id: string, mode: OperatorCancellationMode) {
    return loadRequestState(() => this.dataSource.previewLessonCancellation(id, mode));
  }
  cancelLessonSelection(id: string, input: OperatorCancellationInput, expected: OperatorCancellationPreview, key: string) {
    return loadRequestState(() => this.dataSource.cancelLessonSelection(id, input, expected, key));
  }

  loadLessonMembers(id: string): Promise<RequestState<OperatorLessonRoster>> {
    return loadRequestState(() => this.dataSource.getLessonMembers(id));
  }

  addLessonMember(id: string, studentId: string, version: number, key: string): Promise<RequestState<OperatorLessonRoster>> {
    return loadRequestState(() => this.dataSource.addLessonMember(id, studentId, version, key));
  }

  removeLessonMember(id: string, studentId: string, version: number, key: string): Promise<RequestState<OperatorLessonRoster>> {
    return loadRequestState(() => this.dataSource.removeLessonMember(id, studentId, version, key));
  }

  loadEarningSummary(): Promise<RequestState<OperatorEarningSummary>> {
    return loadRequestState(() => this.dataSource.getEarningSummary());
  }

  loadEarningEntries(query: OperatorEarningQuery): Promise<RequestState<OperatorEarningEntries>> {
    return loadRequestState(() => this.dataSource.listEarningEntries(query), result => result.data.length === 0);
  }

  loadLessonAccount(query: OperatorAccountQuery): Promise<RequestState<OperatorAccount>> {
    return loadRequestState(() => this.dataSource.getLessonAccount(query));
  }

  loadAccountSubjects(query: OperatorAccountSubjectQuery): Promise<RequestState<OperatorAccountSubjects>> {
    return loadRequestState(() => this.dataSource.listAccountSubjects(query));
  }

  loadRankings(query: OperatorRankingQuery): Promise<RequestState<OperatorRankingPage>> {
    return loadRequestState(() => this.dataSource.listRankings(query));
  }

  loadDashboard(): Promise<RequestState<OperatorDashboard>> {
    return loadRequestState(
      () => this.dataSource.getDashboard(),
      (data) =>
        data.activeStudentCount === 0 &&
        data.todayLessonCount === 0 &&
        data.pendingLeaveCount === 0,
    );
  }

  loadProfile(): Promise<RequestState<OperatorProfile>> {
    return loadRequestState(() => this.dataSource.getProfile());
  }

  loadTeacherArchives(query: OperatorStudentQuery): Promise<RequestState<OperatorPage<OperatorTeacherArchive>>> {
    return loadRequestState(() => this.dataSource.listTeacherArchives(query), (data) => data.data.length === 0);
  }

  loadTeacherPerformance(teacherId: string, month?: string): Promise<RequestState<OperatorTeacherPerformance>> {
    return loadRequestState(() => this.dataSource.getTeacherPerformance(teacherId, month));
  }

  loadTeacherEvaluationHistory(teacherId: string, query: OperatorTeacherHistoryQuery): Promise<RequestState<OperatorPage<OperatorTeacherEvaluationRevision>>> {
    return loadRequestState(() => this.dataSource.getTeacherEvaluationHistory(teacherId, query), (data) => data.data.length === 0);
  }

  loadStudents(
    query: OperatorStudentQuery,
  ): Promise<RequestState<OperatorPage<OperatorStudent>>> {
    return loadRequestState(
      () => this.dataSource.listStudents(query),
      (data) => data.data.length === 0,
    );
  }

  loadStudent(id: string): Promise<RequestState<OperatorStudentDetail>> {
    return loadRequestState(() => this.dataSource.getStudent(id));
  }

  loadStudentArchive(id: string): Promise<RequestState<OperatorStudentArchive>> {
    return loadRequestState(() => this.dataSource.getStudentArchive(id));
  }

  loadStudentGrowth(id: string, query: { page: number; pageSize: number }): Promise<RequestState<OperatorPage<OperatorStudentGrowth>>> {
    return loadRequestState(() => this.dataSource.getStudentGrowth(id, query), (data) => data.data.length === 0);
  }

  loadSchedulingOptions(): Promise<
    RequestState<OperatorSchedulingOptions>
  > {
    return loadRequestState(
      () => this.dataSource.getSchedulingOptions(),
      (data) => data.classes.length === 0,
    );
  }

  createStudent(
    input: OperatorCreateStudentInput,
    idempotencyKey: string,
  ): Promise<RequestState<OperatorStudent>> {
    return loadRequestState(() =>
      this.dataSource.createStudent(input, idempotencyKey),
    );
  }

  loadLessonSessions(
    query: OperatorLessonQuery,
  ): Promise<RequestState<OperatorPage<OperatorLessonSession>>> {
    return loadRequestState(
      () => this.dataSource.listLessonSessions(query),
      (data) => data.data.length === 0,
    );
  }

  createLessonSession(
    input: OperatorScheduleInput,
    idempotencyKey: string,
  ): Promise<RequestState<OperatorLessonSession>> {
    return loadRequestState(() =>
      this.dataSource.createLessonSession(input, idempotencyKey),
    );
  }

  updateLessonSession(
    lessonSessionId: string,
    input: OperatorUpdateScheduleInput,
    idempotencyKey: string,
  ): Promise<RequestState<OperatorLessonSession>> {
    return loadRequestState(() =>
      this.dataSource.updateLessonSession(
        lessonSessionId,
        input,
        idempotencyKey,
      ),
    );
  }

  cancelLessonSession(
    lessonSessionId: string,
    version: number,
    idempotencyKey: string,
  ): Promise<RequestState<OperatorLessonSession>> {
    return loadRequestState(() =>
      this.dataSource.cancelLessonSession(
        lessonSessionId,
        version,
        idempotencyKey,
      ),
    );
  }

  loadLeaveRequests(
    query: OperatorLeaveQuery,
  ): Promise<RequestState<OperatorPage<OperatorLeaveRequest>>> {
    return loadRequestState(
      () => this.dataSource.listLeaveRequests(query),
      (data) => data.data.length === 0,
    );
  }

  approveLeaveRequest(
    leaveRequestId: string,
    version: number,
    reviewReason: string | undefined,
    idempotencyKey: string,
  ): Promise<RequestState<OperatorLeaveRequest>> {
    return loadRequestState(() =>
      this.dataSource.approveLeaveRequest(
        leaveRequestId,
        version,
        reviewReason,
        idempotencyKey,
      ),
    );
  }

  rejectLeaveRequest(
    leaveRequestId: string,
    version: number,
    reviewReason: string,
    idempotencyKey: string,
  ): Promise<RequestState<OperatorLeaveRequest>> {
    return loadRequestState(() =>
      this.dataSource.rejectLeaveRequest(
        leaveRequestId,
        version,
        reviewReason,
        idempotencyKey,
      ),
    );
  }

  loadWarnings(
    query: OperatorWarningQuery,
  ): Promise<RequestState<OperatorPage<OperatorWarning>>> {
    return loadRequestState(
      () => this.dataSource.listWarnings(query),
      (data) => data.data.length === 0,
    );
  }

  loadCampusSettings(): Promise<RequestState<OperatorCampusSettings>> {
    return loadRequestState(() => this.dataSource.getCampusSettings());
  }

  updateCampusSettings(
    input: OperatorUpdateSettingsInput,
    idempotencyKey: string,
  ): Promise<RequestState<OperatorCampusSettings>> {
    return loadRequestState(() =>
      this.dataSource.updateCampusSettings(input, idempotencyKey),
    );
  }
}
