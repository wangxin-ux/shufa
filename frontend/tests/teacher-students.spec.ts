import * as fs from 'fs';
import * as path from 'path';
import {
  buildTeacherStudentPageModel,
  buildTeacherStudentQuery,
  mergeTeacherStudentItems,
  TeacherStudentSearchDebouncer,
} from '../services/teacher-students.presenter';
import { TeacherStudent } from '../types/teacher';

const student = (overrides: Partial<TeacherStudent> = {}): TeacherStudent => ({
  id: 'student-1',
  displayName: '姓名很长但必须保持可读的学员同学',
  classNames: ['创意基础 A 班', '周末综合材料班'],
  nextLessonAt: '2026-09-01T01:00:00.000Z',
  latestFeedbackAt: '2026-08-28T02:00:00.000Z',
  ...overrides,
});

describe('teacher students presenter', () => {
  afterEach(() => jest.useRealTimers());

  it('debounces trimmed search input and uses only the latest value', () => {
    jest.useFakeTimers();
    const callback = jest.fn();
    const debouncer = new TeacherStudentSearchDebouncer(callback, 300);

    debouncer.schedule(' 林 ');
    jest.advanceTimersByTime(200);
    debouncer.schedule(' 林小禾 ');
    jest.advanceTimersByTime(299);
    expect(callback).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('林小禾');
    debouncer.cancel();
  });

  it('omits an empty search from the API query', () => {
    expect(buildTeacherStudentQuery('   ', 1, 20)).toEqual({ page: 1, pageSize: 20 });
    expect(buildTeacherStudentQuery(' 林 ', 2, 20)).toEqual({
      page: 2,
      pageSize: 20,
      query: '林',
    });
  });

  it('keeps long names and exposes only minimum student fields', () => {
    const [model] = buildTeacherStudentPageModel([student()]);

    expect(model).toEqual({
      id: 'student-1',
      displayName: '姓名很长但必须保持可读的学员同学',
      classLabel: '创意基础 A 班、周末综合材料班',
      nextLessonLabel: '9月1日 周二 09:00',
      latestFeedbackLabel: '8月28日 10:00',
    });
    expect(Object.keys(model)).not.toEqual(
      expect.arrayContaining(['phone', 'mobile', 'phoneNumber']),
    );
  });

  it('appends paged students without duplicates and replaces page one', () => {
    const first = buildTeacherStudentPageModel([student()]);
    const next = buildTeacherStudentPageModel([
      student(),
      student({ id: 'student-2', displayName: '安同学' }),
    ]);

    expect(mergeTeacherStudentItems(first, next, 2).map(({ id }) => id)).toEqual([
      'student-1',
      'student-2',
    ]);
    expect(mergeTeacherStudentItems(first, next, 1)).toEqual(next);
  });

  it('keeps phone fields and error handling out of the page UI', () => {
    const root = path.resolve(__dirname, '..');
    const markup = fs.readFileSync(
      path.join(root, 'pages/teacher/students/index.wxml'),
      'utf8',
    );
    const logic = fs.readFileSync(
      path.join(root, 'pages/teacher/students/index.ts'),
      'utf8',
    );
    expect(`${markup}\n${logic}`).not.toMatch(/phone|mobile|手机号|电话/i);
    expect(markup).toContain("viewState === 'empty'");
    expect(markup).toContain("viewState === 'error'");
    expect(logic).toMatch(/onRetry\(\)\s*\{\s*void this\.loadStudents\(true\)/s);
  });

  it('opens a scoped read-only teaching detail from each student card', () => {
    const root = path.resolve(__dirname, '..');
    const listMarkup = fs.readFileSync(
      path.join(root, 'pages/teacher/students/index.wxml'),
      'utf8',
    );
    const listLogic = fs.readFileSync(
      path.join(root, 'pages/teacher/students/index.ts'),
      'utf8',
    );
    const detailDir = path.join(root, 'pages/teacher/student-detail');
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')) as {
      subPackages: Array<{ root: string; pages: string[] }>;
    };

    expect(listMarkup).toContain('bindtap="onStudentTap"');
    expect(listLogic).toContain('/pages/teacher/student-detail/index?id=');
    expect(fs.existsSync(detailDir)).toBe(true);
    if (!fs.existsSync(detailDir)) return;

    const detailSource = ['index.ts', 'index.wxml', 'index.wxss']
      .map((name) => fs.readFileSync(path.join(detailDir, name), 'utf8'))
      .join('\n');
    expect(detailSource).toContain('teacherService.loadStudent');
    expect(detailSource).toContain('下一次课程');
    expect(detailSource).toContain('近期出勤');
    expect(detailSource).toContain('最近反馈');
    expect(detailSource).not.toMatch(/phone|mobile|手机号|电话|住址|课时余额|报名金额/i);
    expect(
      app.subPackages.find(({ root: packageRoot }) => packageRoot === 'pages/teacher')
        ?.pages,
    ).toContain('student-detail/index');
  });

  it('builds a teaching-only student detail model without sensitive fields', () => {
    const presenter = require('../services/teacher-students.presenter') as Record<
      string,
      unknown
    >;
    const buildDetail = presenter.buildTeacherStudentDetailPageModel;
    expect(typeof buildDetail).toBe('function');
    if (typeof buildDetail !== 'function') return;

    const model = buildDetail({
      ...student(),
      classes: [
        { id: 'class-1', className: '创意基础 A 班', courseName: '创意基础' },
      ],
      nextLesson: {
        id: 'lesson-2',
        className: '创意基础 A 班',
        courseName: '创意基础',
        startsAt: '2026-09-01T01:00:00.000Z',
        endsAt: '2026-09-01T02:30:00.000Z',
      },
      attendance: {
        presentCount: 8,
        leaveCount: 1,
        absentCount: 1,
        recordedCount: 10,
        attendanceRateBasisPoints: 8000,
      },
      recentAttendance: [
        {
          id: 'attendance-1',
          courseName: '创意基础',
          startsAt: '2026-08-28T01:00:00.000Z',
          status: 'PRESENT',
        },
      ],
      latestFeedback: {
        content: '本节课构图完整，课堂参与积极。',
        courseName: '创意基础',
        updatedAt: '2026-08-28T02:00:00.000Z',
      },
    });

    expect(model).toMatchObject({
      displayName: '姓名很长但必须保持可读的学员同学',
      nextLessonTitle: '创意基础',
      nextLessonTime: '9月1日 周二 09:00-10:30',
      attendanceSummary: '出勤 8 次 · 请假 1 次 · 缺勤 1 次',
      attendanceRateLabel: '80%',
      latestFeedbackContent: '本节课构图完整，课堂参与积极。',
    });
    expect(JSON.stringify(model)).not.toMatch(/phone|mobile|address|balance/i);
  });
});
