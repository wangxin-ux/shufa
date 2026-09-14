import { TeacherMockScenario } from '../config/teacher-env';
import {
  EMPTY_TEACHER_FIXTURE,
  NORMAL_TEACHER_FIXTURE,
  TeacherFixture,
} from '../mock/fixtures/teacher.fixture';
import {
  AttendanceDraft,
  CompleteLessonDraft,
  CompleteLessonResult,
  DatePageQuery,
  FeedbackDraft,
  FeedbackImage,
  FeedbackImageUploadDraft,
  LessonSessionQuery,
  Page,
  ReverseLessonDraft,
  StudentFeedback,
  TeacherDashboard,
  TeacherEarningEntry,
  TeacherEarningQuery,
  TeacherEarningRuleView,
  TeacherEarningSummary,
  TeacherLedgerRecord,
  TeacherLessonDetail,
  TeacherLessonSession,
  TeacherProfile,
  TeacherStudent,
  TeacherStudentDetail,
  TeacherStudentQuery,
  TeacherWithdrawal,
  TeacherWithdrawalQuery,
  TeachingRecord,
} from '../types/teacher';
import {
  GroupPage,
  GroupPromotionCampaignQuery,
  GroupPromotionCampaignView,
} from '../types/group-buying';
import { GROUP_PROMOTION_CAMPAIGN_FIXTURE } from '../mock/fixtures/group-promotion.fixture';
import {
  TeacherDataSource,
  TeacherDataSourceError,
} from './teacher-data-source';

export interface MockTeacherDataSourceOptions {
  scenario?: TeacherMockScenario;
}

const MOCK_ERROR_MESSAGE = '教师端 Mock 请求失败';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MockTeacherDataSource implements TeacherDataSource {
  private readonly scenario: TeacherMockScenario;
  private readonly fixture: TeacherFixture;
  private readonly mutationResults = new Map<
    string,
    | TeacherLessonDetail
    | CompleteLessonResult
    | StudentFeedback
    | TeacherWithdrawal
  >();
  private teachingSequence = 1;
  private withdrawalSequence = 2;
  private feedbackImageSequence = 1;
  private readonly feedbackImages = new Map<string, FeedbackImage>();

  constructor(options: MockTeacherDataSourceOptions = {}) {
    this.scenario = options.scenario ?? 'normal';
    this.fixture = clone(
      this.scenario === 'empty'
        ? EMPTY_TEACHER_FIXTURE
        : NORMAL_TEACHER_FIXTURE,
    );
  }

  async getDashboard(): Promise<TeacherDashboard> {
    this.assertAvailable();
    return clone(this.fixture.dashboard);
  }

  async getProfile(): Promise<TeacherProfile> {
    this.assertAvailable();
    return clone(this.fixture.profile);
  }

  async listGroupPromotionCampaigns(
    query: GroupPromotionCampaignQuery,
  ): Promise<GroupPage<GroupPromotionCampaignView>> {
    this.assertAvailable();
    return this.page(
      this.scenario === 'empty' ? [] : [GROUP_PROMOTION_CAMPAIGN_FIXTURE],
      query.page,
      query.pageSize,
    );
  }

  async getGroupPromotionCampaign(
    id: string,
  ): Promise<GroupPromotionCampaignView> {
    this.assertAvailable();
    if (this.scenario === 'empty' || id !== GROUP_PROMOTION_CAMPAIGN_FIXTURE.id) {
      throw new TeacherDataSourceError(
        404,
        'RESOURCE_NOT_FOUND',
        '未找到拼团活动',
      );
    }
    return clone(GROUP_PROMOTION_CAMPAIGN_FIXTURE);
  }

  async listLessonSessions(
    query: LessonSessionQuery,
  ): Promise<Page<TeacherLessonSession>> {
    this.assertAvailable();
    const filtered = this.fixture.lessonSessions.filter(
      (lesson) =>
        (!query.status || lesson.status === query.status) &&
        (!query.from || lesson.startsAt >= query.from) &&
        (!query.to || lesson.startsAt < query.to),
    );
    return this.page(filtered, query.page, query.pageSize);
  }

  async getLessonSession(id: string): Promise<TeacherLessonDetail> {
    this.assertAvailable();
    const lesson = this.fixture.lessonDetails[id];
    if (!lesson) {
      throw new TeacherDataSourceError(
        404,
        'RESOURCE_NOT_FOUND',
        '未找到课次',
      );
    }
    return clone(lesson);
  }

  async listStudents(
    query: TeacherStudentQuery,
  ): Promise<Page<TeacherStudent>> {
    this.assertAvailable();
    const keyword = query.query?.trim().toLocaleLowerCase();
    return this.page(
      this.fixture.students.filter(
        (student) =>
          !keyword || student.displayName.toLocaleLowerCase().includes(keyword),
      ),
      query.page,
      query.pageSize,
    );
  }

  async getStudent(id: string): Promise<TeacherStudentDetail> {
    this.assertAvailable();
    const student = this.fixture.students.find((item) => item.id === id);
    if (!student) {
      throw new TeacherDataSourceError(403, 'FORBIDDEN', '当前教师无权查看该学员');
    }
    const recentAttendance = Object.values(this.fixture.lessonDetails)
      .filter((lesson) => lesson.students.some((item) => item.id === id))
      .flatMap((lesson) => {
        const lessonStudent = lesson.students.find((item) => item.id === id);
        return lessonStudent?.attendanceStatus
          ? [{
              id: `${lesson.id}-${id}`,
              courseName: lesson.courseName,
              startsAt: lesson.startsAt,
              status: lessonStudent.attendanceStatus,
            }]
          : [];
      })
      .sort((left, right) => right.startsAt.localeCompare(left.startsAt))
      .slice(0, 5);
    const presentCount = recentAttendance.filter(({ status }) => status === 'PRESENT').length;
    const leaveCount = recentAttendance.filter(({ status }) => status === 'LEAVE').length;
    const absentCount = recentAttendance.filter(({ status }) => status === 'ABSENT').length;
    const recordedCount = presentCount + leaveCount + absentCount;
    const nextLesson = this.fixture.lessonSessions
      .filter(
        (lesson) =>
          ['SCHEDULED', 'IN_PROGRESS'].includes(lesson.status) &&
          this.fixture.lessonDetails[lesson.id]?.students.some((item) => item.id === id),
      )
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt))[0];
    const latestFeedbackLesson = Object.values(this.fixture.lessonDetails)
      .filter((lesson) => lesson.students.some((item) => item.id === id && item.feedback))
      .sort((left, right) => right.startsAt.localeCompare(left.startsAt))[0];
    const latestFeedback = latestFeedbackLesson?.students.find((item) => item.id === id)?.feedback;

    return clone({
      ...student,
      classes: student.classNames.map((className, index) => ({
        id: `${id}-class-${index + 1}`,
        className,
        courseName: className.replace(/班$/, ''),
      })),
      nextLesson: nextLesson
        ? {
            id: nextLesson.id,
            className: nextLesson.className,
            courseName: nextLesson.courseName,
            startsAt: nextLesson.startsAt,
            endsAt: nextLesson.endsAt,
          }
        : null,
      attendance: {
        presentCount,
        leaveCount,
        absentCount,
        recordedCount,
        attendanceRateBasisPoints:
          recordedCount === 0 ? 0 : Math.round((presentCount / recordedCount) * 10_000),
      },
      recentAttendance,
      latestFeedback:
        latestFeedbackLesson && latestFeedback
          ? {
              content: latestFeedback,
              courseName: latestFeedbackLesson.courseName,
              updatedAt: latestFeedbackLesson.endsAt,
            }
          : null,
    });
  }

  async saveAttendance(
    input: AttendanceDraft,
    idempotencyKey: string,
  ): Promise<TeacherLessonDetail> {
    this.assertMutationAvailable();
    const replay = this.replay<TeacherLessonDetail>(
      'attendance',
      idempotencyKey,
    );
    if (replay) {
      return replay;
    }
    const lesson = this.mutableLesson(input.lessonSessionId);
    this.assertVersion(lesson, input.lessonVersion);
    this.assertCompleteRoster(lesson, input.attendance.map(({ studentId }) => studentId));
    const statusByStudent = new Map(
      input.attendance.map(({ studentId, status }) => [studentId, status]),
    );
    lesson.students = lesson.students.map((student) => {
      const attendanceStatus = statusByStudent.get(student.id) ?? null;
      return {
        ...student,
        attendanceStatus,
        expectedConsumeUnits:
          attendanceStatus === 'PRESENT' ? lesson.lessonUnits : 0,
      };
    });
    return this.remember('attendance', idempotencyKey, lesson);
  }

  async completeLesson(
    input: CompleteLessonDraft,
    idempotencyKey: string,
  ): Promise<CompleteLessonResult> {
    this.assertMutationAvailable();
    const replay = this.replay<CompleteLessonResult>(
      'complete',
      idempotencyKey,
    );
    if (replay) {
      return replay;
    }
    const lesson = this.mutableLesson(input.lessonSessionId);
    if (!lesson.canComplete || lesson.status === 'COMPLETED') {
      throw new TeacherDataSourceError(
        409,
        'LESSON_ALREADY_COMPLETED',
        '课次已经完成',
      );
    }
    this.assertVersion(lesson, input.lessonVersion);
    this.assertCompleteRoster(lesson, input.attendance.map(({ studentId }) => studentId));
    await this.saveAttendance(
      input,
      `${idempotencyKey}:attendance-snapshot`,
    );
    lesson.status = 'COMPLETED';
    lesson.version += 1;
    lesson.canComplete = false;
    lesson.canReverse = true;
    this.updateLessonSummary(lesson);
    const result: CompleteLessonResult = {
      lessonSessionId: lesson.id,
      lessonVersion: lesson.version,
      status: 'COMPLETED',
      teachingRecordId: `mock-teaching-${String(
        this.teachingSequence,
      ).padStart(3, '0')}`,
      consumed: lesson.students.map((student) => ({
        studentId: student.id,
        mainUnits: student.attendanceStatus === 'PRESENT' ? lesson.lessonUnits : 0,
        giftUnits: 0,
      })),
    };
    this.teachingSequence += 1;
    return this.remember('complete', idempotencyKey, result);
  }

  async reverseLesson(
    input: ReverseLessonDraft,
    idempotencyKey: string,
  ): Promise<CompleteLessonResult> {
    this.assertMutationAvailable();
    const replay = this.replay<CompleteLessonResult>('reverse', idempotencyKey);
    if (replay) {
      return replay;
    }
    const lesson = this.mutableLesson(input.lessonSessionId);
    this.assertVersion(lesson, input.lessonVersion);
    if (!lesson.canReverse || lesson.status !== 'COMPLETED') {
      throw new TeacherDataSourceError(
        409,
        'LESSON_REVERSAL_WINDOW_EXPIRED',
        '当前课次不可撤销',
      );
    }
    lesson.status = 'REVERSED';
    lesson.version += 1;
    lesson.canReverse = false;
    this.updateLessonSummary(lesson);
    const completion = [...this.mutationResults.entries()]
      .filter(([key]) => key.startsWith('complete:'))
      .map(([, value]) => value)
      .find(
        (value): value is CompleteLessonResult =>
          'lessonSessionId' in value &&
          value.lessonSessionId === input.lessonSessionId &&
          'teachingRecordId' in value,
      );
    const result: CompleteLessonResult = {
      lessonSessionId: lesson.id,
      lessonVersion: lesson.version,
      status: 'REVERSED',
      teachingRecordId: completion?.teachingRecordId ?? 'mock-teaching-seeded',
      consumed:
        completion?.consumed ??
        lesson.students.map((student) => ({
          studentId: student.id,
          mainUnits:
            student.attendanceStatus === 'PRESENT' ? lesson.lessonUnits : 0,
          giftUnits: 0,
        })),
    };
    return this.remember('reverse', idempotencyKey, result);
  }

  async saveFeedback(
    input: FeedbackDraft,
    idempotencyKey: string,
  ): Promise<StudentFeedback> {
    this.assertMutationAvailable();
    const replay = this.replay<StudentFeedback>('feedback', idempotencyKey);
    if (replay) {
      return replay;
    }
    const lesson = this.mutableLesson(input.lessonSessionId);
    const content = input.content.trim();
    const student = lesson.students.find(({ id }) => id === input.studentId);
    if (!student || lesson.status !== 'COMPLETED') {
      throw new TeacherDataSourceError(
        409,
        'FEEDBACK_NOT_ALLOWED',
        '当前课次不可填写反馈',
      );
    }
    student.feedback = content;
    student.feedbackImages = input.imageFileIds.flatMap((id) => {
      const image = this.feedbackImages.get(id);
      return image ? [clone(image)] : [];
    });
    const teachingRecord = this.fixture.teachingRecords.find(
      ({ lessonSessionId }) => lessonSessionId === lesson.id,
    );
    if (teachingRecord) {
      teachingRecord.feedbackCompletedCount = lesson.students.filter(
        ({ feedback }) => Boolean(feedback?.trim()),
      ).length;
      teachingRecord.feedbackRequiredCount = lesson.students.length;
    }
    return this.remember('feedback', idempotencyKey, {
      lessonSessionId: lesson.id,
      studentId: student.id,
      content,
      images: clone(student.feedbackImages),
      updatedAt: '2026-08-29T08:30:00+08:00',
    });
  }

  async uploadFeedbackImage(
    input: FeedbackImageUploadDraft,
  ): Promise<FeedbackImage> {
    this.assertMutationAvailable();
    const lesson = this.mutableLesson(input.lessonSessionId);
    if (
      lesson.status !== 'COMPLETED' ||
      !lesson.students.some(({ id }) => id === input.studentId)
    ) {
      throw new TeacherDataSourceError(
        409,
        'FEEDBACK_NOT_ALLOWED',
        '当前课次不可上传反馈图片',
      );
    }
    const id = `mock-feedback-image-${this.feedbackImageSequence}`;
    this.feedbackImageSequence += 1;
    const image: FeedbackImage = {
      id,
      mimeType: input.filePath.toLowerCase().endsWith('.png')
        ? 'image/png'
        : 'image/jpeg',
      sizeBytes: 1,
      accessUrl: input.filePath,
      accessUrlExpiresAt: '2099-12-31T23:59:59.000Z',
    };
    this.feedbackImages.set(id, clone(image));
    return clone(image);
  }

  async listTeachingRecords(
    query: DatePageQuery,
  ): Promise<Page<TeachingRecord>> {
    this.assertAvailable();
    return this.page(this.fixture.teachingRecords, query.page, query.pageSize);
  }

  async listLessonLedger(
    query: DatePageQuery,
  ): Promise<Page<TeacherLedgerRecord>> {
    this.assertAvailable();
    return this.page(this.fixture.lessonLedger, query.page, query.pageSize);
  }

  async getEarningSummary(): Promise<TeacherEarningSummary> {
    this.assertAvailable();
    return clone(this.fixture.earningSummary);
  }

  async getCurrentEarningRule(): Promise<TeacherEarningRuleView | null> {
    this.assertAvailable();
    return clone(this.fixture.earningRule);
  }

  async getEarnings(
    query: TeacherEarningQuery,
  ): Promise<Page<TeacherEarningEntry>> {
    this.assertAvailable();
    const filtered = this.fixture.earnings.filter(
      (entry) =>
        (!query.status || entry.status === query.status) &&
        (!query.from || entry.createdAt >= query.from) &&
        (!query.to || entry.createdAt < query.to),
    );
    return this.page(filtered, query.page, query.pageSize);
  }

  async getWithdrawals(
    query: TeacherWithdrawalQuery,
  ): Promise<Page<TeacherWithdrawal>> {
    this.assertAvailable();
    const filtered = this.fixture.withdrawals.filter(
      (withdrawal) => !query.status || withdrawal.status === query.status,
    );
    return this.page(filtered, query.page, query.pageSize);
  }

  async createWithdrawal(
    amountFen: number,
    idempotencyKey: string,
  ): Promise<TeacherWithdrawal> {
    this.assertMutationAvailable();
    const replay = this.replay<TeacherWithdrawal>(
      'create-withdrawal',
      idempotencyKey,
    );
    if (replay) {
      return replay;
    }
    if (!Number.isSafeInteger(amountFen) || amountFen <= 0) {
      throw new TeacherDataSourceError(
        400,
        'VALIDATION_ERROR',
        '提现金额必须是正整数分',
      );
    }
    if (amountFen < 10000) {
      throw new TeacherDataSourceError(
        400,
        'WITHDRAWAL_AMOUNT_INVALID',
        '演示环境最低提现金额为 100 元',
        { minimumAmountFen: 10000 },
      );
    }
    if (amountFen > this.fixture.earningSummary.availableFen) {
      throw new TeacherDataSourceError(
        409,
        'WITHDRAWAL_BALANCE_INSUFFICIENT',
        '可提现余额不足',
        { availableFen: this.fixture.earningSummary.availableFen },
      );
    }

    const sequence = String(this.withdrawalSequence).padStart(4, '0');
    const withdrawal: TeacherWithdrawal = {
      id: `83000000-0000-4000-8000-${sequence.padStart(12, '0')}`,
      requestNo: `TX20260830${sequence}`,
      campusId: '10000000-0000-4000-8000-000000000001',
      teacherId: '30000000-0000-4000-8000-000000000001',
      teacherName: this.fixture.profile.displayName,
      amountFen,
      status: 'SUBMITTED',
      requestedAt: '2026-08-30T09:00:00+08:00',
      reviewedAt: null,
      paidAt: null,
      rejectionReason: null,
      failureReason: null,
      payoutReference: null,
      payoutProofFileId: null,
      version: 1,
    };
    this.withdrawalSequence += 1;
    this.fixture.withdrawals.unshift(withdrawal);
    this.fixture.earningSummary.availableFen -= amountFen;
    this.fixture.earningSummary.withdrawingFen += amountFen;
    return this.remember('create-withdrawal', idempotencyKey, withdrawal);
  }

  async cancelWithdrawal(
    id: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<TeacherWithdrawal> {
    this.assertMutationAvailable();
    const replay = this.replay<TeacherWithdrawal>(
      'cancel-withdrawal',
      idempotencyKey,
    );
    if (replay) {
      return replay;
    }
    const withdrawal = this.fixture.withdrawals.find((item) => item.id === id);
    if (!withdrawal) {
      throw new TeacherDataSourceError(
        404,
        'RESOURCE_NOT_FOUND',
        '未找到提现申请',
      );
    }
    if (
      withdrawal.status !== 'SUBMITTED' ||
      withdrawal.version !== expectedVersion
    ) {
      throw new TeacherDataSourceError(
        409,
        'WITHDRAWAL_STATUS_CONFLICT',
        '提现状态已变化，请刷新后重试',
        { currentVersion: withdrawal.version },
      );
    }
    withdrawal.status = 'CANCELLED';
    withdrawal.version += 1;
    this.fixture.earningSummary.availableFen += withdrawal.amountFen;
    this.fixture.earningSummary.withdrawingFen -= withdrawal.amountFen;
    return this.remember('cancel-withdrawal', idempotencyKey, withdrawal);
  }

  private assertAvailable(): void {
    if (this.scenario === 'error') {
      throw new Error(MOCK_ERROR_MESSAGE);
    }
  }

  private assertMutationAvailable(): void {
    this.assertAvailable();
    if (this.scenario === 'conflict') {
      throw new TeacherDataSourceError(
        409,
        'LESSON_VERSION_CONFLICT',
        '课次状态已变化，请刷新后重试',
        { currentVersion: 2 },
      );
    }
  }

  private mutableLesson(id: string): TeacherLessonDetail {
    const lesson = this.fixture.lessonDetails[id];
    if (!lesson) {
      throw new TeacherDataSourceError(
        404,
        'RESOURCE_NOT_FOUND',
        '未找到课次',
      );
    }
    return lesson;
  }

  private assertVersion(
    lesson: TeacherLessonDetail,
    requestedVersion: number,
  ): void {
    if (lesson.version !== requestedVersion) {
      throw new TeacherDataSourceError(
        409,
        'LESSON_VERSION_CONFLICT',
        '课次状态已变化，请刷新后重试',
        { currentVersion: lesson.version },
      );
    }
  }

  private assertCompleteRoster(
    lesson: TeacherLessonDetail,
    requestedIds: string[],
  ): void {
    const unique = new Set(requestedIds);
    if (
      unique.size !== requestedIds.length ||
      unique.size !== lesson.students.length ||
      lesson.students.some(({ id }) => !unique.has(id))
    ) {
      throw new TeacherDataSourceError(
        400,
        'ATTENDANCE_INCOMPLETE',
        '请为全部学员选择出勤状态',
      );
    }
  }

  private updateLessonSummary(detail: TeacherLessonDetail): void {
    const index = this.fixture.lessonSessions.findIndex(
      ({ id }) => id === detail.id,
    );
    if (index >= 0) {
      this.fixture.lessonSessions[index] = {
        id: detail.id,
        version: detail.version,
        className: detail.className,
        courseName: detail.courseName,
        campusName: detail.campusName,
        startsAt: detail.startsAt,
        endsAt: detail.endsAt,
        lessonUnits: detail.lessonUnits,
        status: detail.status,
        studentCount: detail.studentCount,
      };
    }
  }

  private replay<T>(operation: string, key: string): T | undefined {
    this.assertKey(key);
    const value = this.mutationResults.get(`${operation}:${key.trim()}`);
    return value === undefined ? undefined : clone(value as T);
  }

  private remember<T extends
    | TeacherLessonDetail
    | CompleteLessonResult
    | StudentFeedback
    | TeacherWithdrawal>(
    operation: string,
    key: string,
    value: T,
  ): T {
    this.mutationResults.set(`${operation}:${key.trim()}`, clone(value));
    return clone(value);
  }

  private assertKey(key: string): void {
    if (!key.trim()) {
      throw new Error('幂等标识不能为空');
    }
  }

  private page<T>(items: readonly T[], page: number, pageSize: number): Page<T> {
    const total = items.length;
    const start = (page - 1) * pageSize;
    return {
      data: clone(items.slice(start, start + pageSize)),
      meta: {
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }
}
