import { MockTeacherDataSource } from '../data/mock-teacher-data-source';
import { TeacherDataSourceError } from '../data/teacher-data-source';
import { TeacherService } from '../services/teacher.service';

const scheduledLessonId = '70000000-0000-4000-8000-000000000002';
const completedLessonId = '70000000-0000-4000-8000-000000000001';

describe('teacher mock data boundary', () => {
  it('returns isolated deterministic fixtures for every instance', async () => {
    const first = new MockTeacherDataSource();
    const dashboard = await first.getDashboard();
    expect(dashboard).toMatchObject({
      teacher: {
        displayName: '王老师',
        subjectLabel: '美术老师',
        campusName: '启明成长中心',
      },
      nextLesson: {
        courseName: '专业美术A',
        campusName: '启明成长中心',
        startsAt: '2026-08-30T14:00:00+08:00',
      },
      todayPendingCount: 1,
    });
    if (dashboard.nextLesson) {
      dashboard.nextLesson.courseName = 'mutated by caller';
    }
    expect((await first.getDashboard()).nextLesson?.courseName).toBe(
      '专业美术A',
    );
    expect(
      (await first.getLessonSession(scheduledLessonId)).students.map(
        ({ displayName }) => displayName,
      ),
    ).toEqual(['陈晨', '安然']);

    await first.completeLesson(
      {
        lessonSessionId: scheduledLessonId,
        lessonVersion: 1,
        attendance: [
          {
            studentId: '40000000-0000-4000-8000-000000000001',
            status: 'PRESENT',
          },
          {
            studentId: '40000000-0000-4000-8000-000000000002',
            status: 'LEAVE',
          },
        ],
      },
      'mock-complete-key-0001',
    );
    expect((await first.getLessonSession(scheduledLessonId)).status).toBe(
      'COMPLETED',
    );
    expect(
      (await new MockTeacherDataSource().getLessonSession(scheduledLessonId))
        .status,
    ).toBe('SCHEDULED');
  });

  it('exposes empty, error, and conflict scenarios as request states', async () => {
    const empty = new TeacherService(
      new MockTeacherDataSource({ scenario: 'empty' }),
    );
    const failed = new TeacherService(
      new MockTeacherDataSource({ scenario: 'error' }),
    );
    const conflict = new MockTeacherDataSource({ scenario: 'conflict' });

    expect((await empty.loadLessonSessions({ page: 1, pageSize: 20 })).status).toBe(
      'empty',
    );
    expect(await failed.loadDashboard()).toEqual({
      status: 'error',
      message: '教师端 Mock 请求失败',
    });
    await expect(
      conflict.completeLesson(
        {
          lessonSessionId: scheduledLessonId,
          lessonVersion: 1,
          attendance: [],
        },
        'mock-conflict-key-0001',
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'LESSON_VERSION_CONFLICT',
    });
  });

  it('replays completion and reversal results for repeated keys', async () => {
    const source = new MockTeacherDataSource();
    const completionInput = {
      lessonSessionId: scheduledLessonId,
      lessonVersion: 1,
      attendance: [
        {
          studentId: '40000000-0000-4000-8000-000000000001',
          status: 'PRESENT' as const,
        },
        {
          studentId: '40000000-0000-4000-8000-000000000002',
          status: 'LEAVE' as const,
        },
      ],
    };
    const first = await source.completeLesson(
      completionInput,
      'mock-complete-key-0002',
    );
    const replay = await source.completeLesson(
      completionInput,
      'mock-complete-key-0002',
    );
    expect(replay).toEqual(first);

    const reversalInput = {
      lessonSessionId: scheduledLessonId,
      lessonVersion: 2,
      reason: 'Correct attendance',
    };
    const reversed = await source.reverseLesson(
      reversalInput,
      'mock-reverse-key-0001',
    );
    expect(
      await source.reverseLesson(reversalInput, 'mock-reverse-key-0001'),
    ).toEqual(reversed);
    expect(reversed.status).toBe('REVERSED');
  });

  it('keeps completed fixture records available for read pages', async () => {
    const source = new MockTeacherDataSource();
    expect((await source.getLessonSession(completedLessonId)).status).toBe(
      'COMPLETED',
    );
    expect((await source.listTeachingRecords({ page: 1, pageSize: 20 })).data)
      .toHaveLength(1);
    expect((await source.listLessonLedger({ page: 1, pageSize: 20 })).data)
      .toHaveLength(2);
  });

  it('uses a typed status-preserving error', () => {
    const error = new TeacherDataSourceError(
      403,
      'FORBIDDEN',
      'Not allowed',
      {},
    );
    expect(error).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('returns deterministic internal earning, rule, and withdrawal fixtures', async () => {
    const source = new MockTeacherDataSource();

    expect(await source.getEarningSummary()).toEqual({
      todayEstimatedFen: 10000,
      weekEstimatedFen: 20000,
      monthEstimatedFen: 20000,
      estimatedTotalFen: 20000,
      pendingReviewFen: 10000,
      availableFen: 10000,
      withdrawingFen: 0,
      currency: 'CNY',
    });
    expect(await source.getCurrentEarningRule()).toMatchObject({
      basisType: 'PER_COMPLETED_SESSION',
      unitAmountFen: 10000,
      teacherId: null,
    });
    expect(
      (await source.getEarnings({ page: 1, pageSize: 1 })).meta,
    ).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    expect(
      (await source.getWithdrawals({ page: 1, pageSize: 20 })).data[0],
    ).toMatchObject({
      teacherName: '王老师',
      status: 'PAID',
      amountFen: 10000,
    });
  });

  it('replays create and cancel withdrawal commands without double reservation', async () => {
    const source = new MockTeacherDataSource();
    const created = await source.createWithdrawal(
      10000,
      'create-withdrawal-mock-0001',
    );
    expect(
      await source.createWithdrawal(10000, 'create-withdrawal-mock-0001'),
    ).toEqual(created);
    expect(await source.getEarningSummary()).toMatchObject({
      availableFen: 0,
      withdrawingFen: 10000,
    });

    const cancelled = await source.cancelWithdrawal(
      created.id,
      created.version,
      'cancel-withdrawal-mock-0001',
    );
    expect(
      await source.cancelWithdrawal(
        created.id,
        created.version,
        'cancel-withdrawal-mock-0001',
      ),
    ).toEqual(cancelled);
    expect(cancelled.status).toBe('CANCELLED');
    expect(await source.getEarningSummary()).toMatchObject({
      availableFen: 10000,
      withdrawingFen: 0,
    });
  });
});
