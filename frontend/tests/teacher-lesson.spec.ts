import { TeacherLessonWorkflow, validateFeedback, validateLessonAttendance } from '../services/teacher-lesson.workflow';
import { TeacherLessonDetail } from '../types/teacher';
import { RequestState } from '../utils/request-state';

type WorkflowService = ConstructorParameters<typeof TeacherLessonWorkflow>[0];

const detail: TeacherLessonDetail = {
  id: 'lesson-1',
  version: 1,
  className: '创意基础 A 班',
  courseName: '综合材料创作',
  campusName: '城东校区',
  startsAt: '2026-09-01T09:00:00+08:00',
  endsAt: '2026-09-01T10:00:00+08:00',
  lessonUnits: 100,
  status: 'SCHEDULED',
  studentCount: 2,
  attendancePolicy: {
    PRESENT: { consumesLessonUnits: true },
    LEAVE: { consumesLessonUnits: false },
    ABSENT: { consumesLessonUnits: false },
  },
  students: [
    { id: 'student-1', displayName: '林同学', attendanceStatus: null, expectedConsumeUnits: 0, feedback: null, feedbackImages: [] },
    { id: 'student-2', displayName: '安同学', attendanceStatus: null, expectedConsumeUnits: 0, feedback: null, feedbackImages: [] },
  ],
  canComplete: true,
  canReverse: false,
};

const attendance = [
  { studentId: 'student-1', status: 'PRESENT' as const },
  { studentId: 'student-2', status: 'LEAVE' as const },
];

const completedResult = {
  lessonSessionId: 'lesson-1',
  lessonVersion: 2,
  status: 'COMPLETED' as const,
  teachingRecordId: 'record-1',
  consumed: [{ studentId: 'student-1', mainUnits: 100, giftUnits: 0 }],
};

function service(overrides: Record<string, jest.Mock> = {}): WorkflowService {
  return {
    saveAttendance: jest.fn(),
    completeLesson: jest.fn(async () => ({ status: 'success', data: completedResult })),
    reverseLesson: jest.fn(async () => ({ status: 'success', data: { ...completedResult, status: 'REVERSED' } })),
    saveFeedback: jest.fn(async () => ({
      status: 'success',
      data: { lessonSessionId: 'lesson-1', studentId: 'student-1', content: '进步明显', updatedAt: '2026-09-01T10:05:00+08:00' },
    })),
    loadLessonSession: jest.fn(async () => ({ status: 'success', data: { ...detail, status: 'COMPLETED', version: 2 } })),
    ...overrides,
  } as unknown as WorkflowService;
}

describe('teacher lesson workflow', () => {
  it('requires the exact active roster before submission', () => {
    expect(validateLessonAttendance(detail, attendance)).toBeNull();
    expect(validateLessonAttendance(detail, attendance.slice(0, 1))).toBe(
      '请为全部学员选择出勤状态',
    );
    expect(
      validateLessonAttendance(detail, [
        ...attendance,
        { studentId: 'outside', status: 'ABSENT' },
      ]),
    ).toBe('点名名单与当前课次不一致');
  });

  it('reuses one in-flight completion for a double tap', async () => {
    let release: (value: RequestState<typeof completedResult>) => void = () => undefined;
    const completeLesson = jest.fn(
      () => new Promise<RequestState<typeof completedResult>>((resolve) => { release = resolve; }),
    );
    const source = service({ completeLesson });
    const workflow = new TeacherLessonWorkflow(source, { createIdempotencyKey: () => 'complete-key-1' });

    const first = workflow.complete(detail, attendance);
    const repeated = workflow.complete(detail, attendance);
    expect(repeated).toBe(first);
    expect(completeLesson).toHaveBeenCalledTimes(1);
    release({ status: 'success', data: completedResult });
    await first;
  });

  it('reuses the same key after failure and refreshes after success', async () => {
    const completeLesson = jest
      .fn()
      .mockResolvedValueOnce({ status: 'error', message: '网络不可用' })
      .mockResolvedValueOnce({ status: 'success', data: completedResult });
    const source = service({ completeLesson });
    const createIdempotencyKey = jest.fn(() => 'stable-key');
    const workflow = new TeacherLessonWorkflow(source, { createIdempotencyKey });

    expect(await workflow.complete(detail, attendance)).toMatchObject({ status: 'error' });
    expect(await workflow.complete(detail, attendance)).toMatchObject({ status: 'success' });
    expect(completeLesson.mock.calls.map((call) => call[1])).toEqual(['stable-key', 'stable-key']);
    expect(createIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(source.loadLessonSession).toHaveBeenCalledWith('lesson-1');
  });

  it('maps forbidden, stale-version and insufficient-balance failures without dropping the draft', async () => {
    const cases = [
      {
        state: { status: 'error', message: '无权限', statusCode: 403, code: 'FORBIDDEN' },
        expected: { status: 'forbidden' },
      },
      {
        state: { status: 'error', message: '版本冲突', statusCode: 409, code: 'LESSON_VERSION_CONFLICT' },
        expected: { status: 'conflict', code: 'LESSON_VERSION_CONFLICT' },
      },
      {
        state: {
          status: 'error',
          message: '余额不足',
          statusCode: 409,
          code: 'INSUFFICIENT_LESSON_BALANCE',
          details: { insufficientStudents: [{ studentId: 'student-2', displayName: '安同学' }] },
        },
        expected: { status: 'conflict', insufficientStudents: [{ studentId: 'student-2', displayName: '安同学' }] },
      },
    ] as const;

    for (const item of cases) {
      const source = service({ completeLesson: jest.fn(async () => item.state) });
      const outcome = await new TeacherLessonWorkflow(source).complete(detail, attendance);
      expect(outcome).toMatchObject(item.expected);
      expect(outcome.draft).toEqual(attendance);
    }
  });

  it('allows reversal only when the server detail permits it and maps expiry', async () => {
    const completedDetail = { ...detail, status: 'COMPLETED' as const, version: 2, canComplete: false, canReverse: true };
    const source = service();
    const workflow = new TeacherLessonWorkflow(source);
    expect(await workflow.reverse(completedDetail, ' 点名修正 ')).toMatchObject({ status: 'success' });
    expect(source.reverseLesson).toHaveBeenCalledWith(
      { lessonSessionId: 'lesson-1', lessonVersion: 2, reason: '点名修正' },
      expect.any(String),
    );

    const expired = service({
      reverseLesson: jest.fn(async () => ({
        status: 'error',
        statusCode: 409,
        code: 'LESSON_REVERSAL_WINDOW_EXPIRED',
        message: '撤销窗口已过期',
      })),
    });
    expect(await new TeacherLessonWorkflow(expired).reverse(completedDetail, '修正')).toMatchObject({
      status: 'conflict',
      code: 'LESSON_REVERSAL_WINDOW_EXPIRED',
    });
  });

  it('validates feedback and retries a failed save with the same key', async () => {
    expect(validateFeedback('   ')).toBe('请填写课堂反馈');
    expect(validateFeedback('评'.repeat(1001))).toBe('课堂反馈不能超过 1000 字');
    expect(validateFeedback(' 有进步 ')).toBeNull();

    const saveFeedback = jest
      .fn()
      .mockResolvedValueOnce({ status: 'error', message: '网络不可用' })
      .mockResolvedValueOnce({
        status: 'success',
        data: { lessonSessionId: 'lesson-1', studentId: 'student-1', content: '有进步', updatedAt: '2026-09-01T10:05:00+08:00' },
      });
    const source = service({ saveFeedback });
    const workflow = new TeacherLessonWorkflow(source, { createIdempotencyKey: () => 'feedback-key' });
    expect(await workflow.feedback({ ...detail, status: 'COMPLETED' }, 'student-1', ' 有进步 ')).toMatchObject({ status: 'error' });
    expect(await workflow.feedback({ ...detail, status: 'COMPLETED' }, 'student-1', ' 有进步 ')).toMatchObject({ status: 'success' });
    expect(saveFeedback.mock.calls.map((call) => call[1])).toEqual(['feedback-key', 'feedback-key']);
  });
});
