import { CampusManagerDataSource } from "../data/campus-manager-data-source";
import {
  CampusManagerCreateStudentInput,
  CampusManagerCampusSettings,
  CampusManagerDashboard,
  CampusManagerLessonQuery,
  CampusManagerLessonSession,
  CampusManagerLeaveQuery,
  CampusManagerLeaveRequest,
  CampusManagerPage,
  CampusManagerProfile,
  CampusManagerSchedulingOptions,
  CampusManagerScheduleInput,
  CampusManagerStudent,
  CampusManagerStudentDetail,
  CampusManagerStudentQuery,
  CampusManagerUpdateScheduleInput,
  CampusManagerUpdateSettingsInput,
  CampusManagerWarning,
  CampusManagerWarningQuery,
} from "../types/campus-manager";
import { loadRequestState, RequestState } from "../utils/request-state";

export class CampusManagerService {
  constructor(private readonly dataSource: CampusManagerDataSource) {}

  loadDashboard(): Promise<RequestState<CampusManagerDashboard>> {
    return loadRequestState(
      () => this.dataSource.getDashboard(),
      (data) =>
        data.activeStudentCount === 0 &&
        data.todayLessonCount === 0 &&
        data.pendingLeaveCount === 0,
    );
  }

  loadProfile(): Promise<RequestState<CampusManagerProfile>> {
    return loadRequestState(() => this.dataSource.getProfile());
  }

  loadStudents(
    query: CampusManagerStudentQuery,
  ): Promise<RequestState<CampusManagerPage<CampusManagerStudent>>> {
    return loadRequestState(
      () => this.dataSource.listStudents(query),
      (data) => data.data.length === 0,
    );
  }

  loadStudent(id: string): Promise<RequestState<CampusManagerStudentDetail>> {
    return loadRequestState(() => this.dataSource.getStudent(id));
  }

  loadSchedulingOptions(): Promise<
    RequestState<CampusManagerSchedulingOptions>
  > {
    return loadRequestState(
      () => this.dataSource.getSchedulingOptions(),
      (data) => data.classes.length === 0,
    );
  }

  createStudent(
    input: CampusManagerCreateStudentInput,
    idempotencyKey: string,
  ): Promise<RequestState<CampusManagerStudent>> {
    return loadRequestState(() =>
      this.dataSource.createStudent(input, idempotencyKey),
    );
  }

  loadLessonSessions(
    query: CampusManagerLessonQuery,
  ): Promise<RequestState<CampusManagerPage<CampusManagerLessonSession>>> {
    return loadRequestState(
      () => this.dataSource.listLessonSessions(query),
      (data) => data.data.length === 0,
    );
  }

  createLessonSession(
    input: CampusManagerScheduleInput,
    idempotencyKey: string,
  ): Promise<RequestState<CampusManagerLessonSession>> {
    return loadRequestState(() =>
      this.dataSource.createLessonSession(input, idempotencyKey),
    );
  }

  updateLessonSession(
    lessonSessionId: string,
    input: CampusManagerUpdateScheduleInput,
    idempotencyKey: string,
  ): Promise<RequestState<CampusManagerLessonSession>> {
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
  ): Promise<RequestState<CampusManagerLessonSession>> {
    return loadRequestState(() =>
      this.dataSource.cancelLessonSession(
        lessonSessionId,
        version,
        idempotencyKey,
      ),
    );
  }

  loadLeaveRequests(
    query: CampusManagerLeaveQuery,
  ): Promise<RequestState<CampusManagerPage<CampusManagerLeaveRequest>>> {
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
  ): Promise<RequestState<CampusManagerLeaveRequest>> {
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
  ): Promise<RequestState<CampusManagerLeaveRequest>> {
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
    query: CampusManagerWarningQuery,
  ): Promise<RequestState<CampusManagerPage<CampusManagerWarning>>> {
    return loadRequestState(
      () => this.dataSource.listWarnings(query),
      (data) => data.data.length === 0,
    );
  }

  loadCampusSettings(): Promise<RequestState<CampusManagerCampusSettings>> {
    return loadRequestState(() => this.dataSource.getCampusSettings());
  }

  updateCampusSettings(
    input: CampusManagerUpdateSettingsInput,
    idempotencyKey: string,
  ): Promise<RequestState<CampusManagerCampusSettings>> {
    return loadRequestState(() =>
      this.dataSource.updateCampusSettings(input, idempotencyKey),
    );
  }
}
