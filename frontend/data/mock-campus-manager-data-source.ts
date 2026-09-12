import { CampusManagerMockScenario } from "../config/campus-manager-env";
import {
  EMPTY_CAMPUS_MANAGER_FIXTURE,
  NORMAL_CAMPUS_MANAGER_FIXTURE,
} from "../mock/fixtures/campus-manager.fixture";
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
import {
  CampusManagerDataSource,
  CampusManagerDataSourceError,
} from "./campus-manager-data-source";

export interface MockCampusManagerDataSourceOptions {
  scenario?: CampusManagerMockScenario;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MockCampusManagerDataSource implements CampusManagerDataSource {
  private readonly scenario: CampusManagerMockScenario;
  private readonly fixture: typeof NORMAL_CAMPUS_MANAGER_FIXTURE;
  private readonly studentMutationResults = new Map<
    string,
    { signature: string; result: CampusManagerStudent }
  >();
  private readonly scheduleMutationResults = new Map<
    string,
    { signature: string; result: CampusManagerLessonSession }
  >();
  private readonly leaveMutationResults = new Map<
    string,
    { signature: string; result: CampusManagerLeaveRequest }
  >();
  private readonly settingsMutationResults = new Map<
    string,
    { signature: string; result: CampusManagerCampusSettings }
  >();
  private studentSequence = 1;
  private lessonSequence = 1;

  constructor(options: MockCampusManagerDataSourceOptions = {}) {
    this.scenario = options.scenario ?? "normal";
    this.fixture = clone(
      this.scenario === "empty"
        ? EMPTY_CAMPUS_MANAGER_FIXTURE
        : NORMAL_CAMPUS_MANAGER_FIXTURE,
    );
  }

  async getDashboard(): Promise<CampusManagerDashboard> {
    this.assertAvailable();
    return clone(this.fixture.dashboard);
  }

  async getProfile(): Promise<CampusManagerProfile> {
    this.assertAvailable();
    return clone(this.fixture.profile);
  }

  async listStudents(
    query: CampusManagerStudentQuery,
  ): Promise<CampusManagerPage<CampusManagerStudent>> {
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

  async getStudent(id: string): Promise<CampusManagerStudentDetail> {
    this.assertAvailable();
    const student = this.fixture.students.find((item) => item.id === id);
    if (!student) {
      throw new CampusManagerDataSourceError(
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

  async getSchedulingOptions(): Promise<CampusManagerSchedulingOptions> {
    this.assertAvailable();
    return clone(this.fixture.schedulingOptions);
  }

  async createStudent(
    input: CampusManagerCreateStudentInput,
    idempotencyKey: string,
  ): Promise<CampusManagerStudent> {
    this.assertAvailable();
    const key = idempotencyKey.trim();
    if (!key) {
      throw new Error("幂等标识不能为空");
    }
    const signature = JSON.stringify(input);
    const replay = this.studentMutationResults.get(key);
    if (replay) {
      if (replay.signature !== signature) {
        throw new CampusManagerDataSourceError(
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
      throw new CampusManagerDataSourceError(
        404,
        "RESOURCE_NOT_FOUND",
        "所选班级当前不可用",
      );
    }
    const sequence = String(this.studentSequence).padStart(12, "0");
    const student: CampusManagerStudent = {
      id: `49000000-0000-4000-8000-${sequence}`,
      campusId: this.fixture.profile.campusId,
      displayName: input.displayName,
      birthDate: input.birthDate,
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

  async listLessonSessions(
    query: CampusManagerLessonQuery,
  ): Promise<CampusManagerPage<CampusManagerLessonSession>> {
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
    input: CampusManagerScheduleInput,
    idempotencyKey: string,
  ): Promise<CampusManagerLessonSession> {
    this.assertAvailable();
    const route = "/campus-managers/me/lesson-sessions";
    const replay = this.getScheduleReplay(route, idempotencyKey, input);
    if (replay) {
      return replay;
    }
    const classGroup = this.fixture.schedulingOptions.classes.find(
      (item) => item.classGroupId === input.classGroupId,
    );
    if (!classGroup) {
      throw new CampusManagerDataSourceError(
        404,
        "RESOURCE_NOT_FOUND",
        "所选班级当前不可用",
      );
    }
    this.assertScheduleRange(input.startsAt, input.endsAt);
    const sequence = String(this.lessonSequence).padStart(12, "0");
    const lesson: CampusManagerLessonSession = {
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
    input: CampusManagerUpdateScheduleInput,
    idempotencyKey: string,
  ): Promise<CampusManagerLessonSession> {
    this.assertAvailable();
    const route = `/campus-managers/me/lesson-sessions/${lessonSessionId}`;
    const replay = this.getScheduleReplay(route, idempotencyKey, input);
    if (replay) {
      return replay;
    }
    const lesson = this.findLesson(lessonSessionId);
    this.assertScheduledVersion(lesson, input.version);
    this.assertScheduleRange(input.startsAt, input.endsAt);
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
  ): Promise<CampusManagerLessonSession> {
    this.assertAvailable();
    const route = `/campus-managers/me/lesson-sessions/${lessonSessionId}/cancel`;
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
    query: CampusManagerLeaveQuery,
  ): Promise<CampusManagerPage<CampusManagerLeaveRequest>> {
    this.assertAvailable();
    const requests = this.fixture.leaveRequests
      .filter((request) => !query.status || request.status === query.status)
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? right.id.localeCompare(left.id)
          : left.createdAt > right.createdAt
            ? -1
            : 1,
      );
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
  ): Promise<CampusManagerLeaveRequest> {
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
  ): Promise<CampusManagerLeaveRequest> {
    const reason = reviewReason.trim();
    if (!reason) {
      return Promise.reject(
        new CampusManagerDataSourceError(
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
    query: CampusManagerWarningQuery,
  ): Promise<CampusManagerPage<CampusManagerWarning>> {
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

  async getCampusSettings(): Promise<CampusManagerCampusSettings> {
    this.assertAvailable();
    return clone(this.fixture.campusSettings);
  }

  async updateCampusSettings(
    input: CampusManagerUpdateSettingsInput,
    idempotencyKey: string,
  ): Promise<CampusManagerCampusSettings> {
    this.assertAvailable();
    const key = idempotencyKey.trim();
    if (!key) {
      throw new Error("幂等标识不能为空");
    }
    const signature = JSON.stringify(input);
    const replay = this.settingsMutationResults.get(key);
    if (replay) {
      if (replay.signature !== signature) {
        throw new CampusManagerDataSourceError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "提交内容已变化，请重新提交",
        );
      }
      return clone(replay.result);
    }
    if (this.fixture.campusSettings.version !== input.version) {
      throw new CampusManagerDataSourceError(
        409,
        "CONFLICT",
        "数据已更新，请刷新后重试",
        { currentVersion: this.fixture.campusSettings.version },
      );
    }
    const result: CampusManagerCampusSettings = {
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
  ): Promise<CampusManagerLeaveRequest> {
    this.assertAvailable();
    const route = `/campus-managers/me/leave-requests/${leaveRequestId}/${status === "APPROVED" ? "approve" : "reject"}`;
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
        throw new CampusManagerDataSourceError(
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
      throw new CampusManagerDataSourceError(
        404,
        "RESOURCE_NOT_FOUND",
        "未找到本校区请假申请",
      );
    }
    if (request.status !== "PENDING") {
      throw new CampusManagerDataSourceError(
        409,
        "CONFLICT",
        "该请假申请已完成审批",
        { currentStatus: request.status },
      );
    }
    if (request.version !== version) {
      throw new CampusManagerDataSourceError(
        409,
        "CONFLICT",
        "数据已更新，请刷新后重试",
        { currentVersion: request.version },
      );
    }
    request.status = status;
    request.reviewerName = this.fixture.profile.displayName;
    request.reviewedAt = new Date().toISOString();
    request.reviewReason = reviewReason?.trim() || null;
    request.version += 1;
    this.fixture.dashboard.pendingLeaveCount = Math.max(
      0,
      this.fixture.dashboard.pendingLeaveCount - 1,
    );
    const result = clone(request);
    this.leaveMutationResults.set(mutationKey, { signature, result });
    return clone(result);
  }

  private getScheduleReplay(
    route: string,
    idempotencyKey: string,
    input: unknown,
  ): CampusManagerLessonSession | null {
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
      throw new CampusManagerDataSourceError(
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
    result: CampusManagerLessonSession,
  ): void {
    this.scheduleMutationResults.set(`${route}:${idempotencyKey.trim()}`, {
      signature: JSON.stringify(input),
      result: clone(result),
    });
  }

  private findLesson(lessonSessionId: string): CampusManagerLessonSession {
    const lesson = this.fixture.lessonSessions.find(
      (item) => item.id === lessonSessionId,
    );
    if (!lesson) {
      throw new CampusManagerDataSourceError(
        404,
        "RESOURCE_NOT_FOUND",
        "未找到本校区课次",
      );
    }
    return lesson;
  }

  private assertScheduledVersion(
    lesson: CampusManagerLessonSession,
    version: number,
  ): void {
    if (lesson.status !== "SCHEDULED") {
      throw new CampusManagerDataSourceError(
        409,
        "CONFLICT",
        "当前课次状态不可修改",
        { currentStatus: lesson.status },
      );
    }
    if (lesson.version !== version) {
      throw new CampusManagerDataSourceError(
        409,
        "LESSON_VERSION_CONFLICT",
        "数据已更新，请刷新后重试",
        { currentVersion: lesson.version },
      );
    }
  }

  private assertScheduleRange(startsAt: string, endsAt: string): void {
    if (Date.parse(startsAt) >= Date.parse(endsAt)) {
      throw new CampusManagerDataSourceError(
        400,
        "BAD_REQUEST",
        "结束时间必须晚于开始时间",
      );
    }
  }

  private assertAvailable(): void {
    if (this.scenario === "error") {
      throw new Error("管理员端数据加载失败，请稍后重试");
    }
  }
}
