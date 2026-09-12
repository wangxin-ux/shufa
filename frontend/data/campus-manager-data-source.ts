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

export class CampusManagerDataSourceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = CampusManagerDataSourceError.name;
  }
}

export interface CampusManagerDataSource {
  getDashboard(): Promise<CampusManagerDashboard>;
  getProfile(): Promise<CampusManagerProfile>;
  listStudents(
    query: CampusManagerStudentQuery,
  ): Promise<CampusManagerPage<CampusManagerStudent>>;
  getStudent(id: string): Promise<CampusManagerStudentDetail>;
  getSchedulingOptions(): Promise<CampusManagerSchedulingOptions>;
  createStudent(
    input: CampusManagerCreateStudentInput,
    idempotencyKey: string,
  ): Promise<CampusManagerStudent>;
  listLessonSessions(
    query: CampusManagerLessonQuery,
  ): Promise<CampusManagerPage<CampusManagerLessonSession>>;
  createLessonSession(
    input: CampusManagerScheduleInput,
    idempotencyKey: string,
  ): Promise<CampusManagerLessonSession>;
  updateLessonSession(
    lessonSessionId: string,
    input: CampusManagerUpdateScheduleInput,
    idempotencyKey: string,
  ): Promise<CampusManagerLessonSession>;
  cancelLessonSession(
    lessonSessionId: string,
    version: number,
    idempotencyKey: string,
  ): Promise<CampusManagerLessonSession>;
  listLeaveRequests(
    query: CampusManagerLeaveQuery,
  ): Promise<CampusManagerPage<CampusManagerLeaveRequest>>;
  approveLeaveRequest(
    leaveRequestId: string,
    version: number,
    reviewReason: string | undefined,
    idempotencyKey: string,
  ): Promise<CampusManagerLeaveRequest>;
  rejectLeaveRequest(
    leaveRequestId: string,
    version: number,
    reviewReason: string,
    idempotencyKey: string,
  ): Promise<CampusManagerLeaveRequest>;
  listWarnings(
    query: CampusManagerWarningQuery,
  ): Promise<CampusManagerPage<CampusManagerWarning>>;
  getCampusSettings(): Promise<CampusManagerCampusSettings>;
  updateCampusSettings(
    input: CampusManagerUpdateSettingsInput,
    idempotencyKey: string,
  ): Promise<CampusManagerCampusSettings>;
}
