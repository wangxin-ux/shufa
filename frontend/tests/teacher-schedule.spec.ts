import * as fs from 'fs';
import * as path from 'path';
import {
  buildTeacherSchedulePageModel,
  buildTeacherScheduleQuery,
  mergeTeacherScheduleItems,
  resolveTeacherScheduleNavigation,
} from '../services/teacher-schedule.presenter';
import { TeacherLessonSession } from '../types/teacher';

const lesson = (overrides: Partial<TeacherLessonSession> = {}): TeacherLessonSession => ({
  id: 'lesson-1',
  version: 1,
  className: '创意基础 A 班',
  courseName: '综合材料创作课程',
  campusName: '城东青少年成长中心',
  startsAt: '2026-09-01T09:00:00+08:00',
  endsAt: '2026-09-01T10:30:00+08:00',
  lessonUnits: 100,
  status: 'SCHEDULED',
  studentCount: 18,
  ...overrides,
});

describe('teacher schedule presenter', () => {
  it('builds explicit date and status filters for the API', () => {
    expect(
      buildTeacherScheduleQuery({
        date: '2026-09-01',
        status: 'SCHEDULED',
        page: 2,
        pageSize: 10,
      }),
    ).toEqual({
      page: 2,
      pageSize: 10,
      from: '2026-09-01T00:00:00+08:00',
      to: '2026-09-02T00:00:00+08:00',
      status: 'SCHEDULED',
    });

    expect(
      buildTeacherScheduleQuery({ date: '', status: 'ALL', page: 1, pageSize: 10 }),
    ).toEqual({ page: 1, pageSize: 10 });
  });

  it('formats lessons and disables terminal-state confirmation actions', () => {
    const model = buildTeacherSchedulePageModel([
      lesson(),
      lesson({ id: 'lesson-2', status: 'COMPLETED' }),
      lesson({ id: 'lesson-3', status: 'REVERSED' }),
      lesson({ id: 'lesson-4', status: 'CANCELLED' }),
    ]);

    expect(model[0]).toMatchObject({
      dateLabel: '9月1日 周二',
      timeLabel: '09:00-10:30',
      statusLabel: '待上课',
      actionDisabled: false,
    });
    expect(model.slice(1).map(({ actionDisabled }) => actionDisabled)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('formats API UTC timestamps in the campus timezone', () => {
    const [model] = buildTeacherSchedulePageModel([
      lesson({
        startsAt: '2026-08-30T06:00:00.000Z',
        endsAt: '2026-08-30T07:30:00.000Z',
      }),
    ]);

    expect(model).toMatchObject({
      dateLabel: '8月30日 周日',
      timeLabel: '14:00-15:30',
    });
  });

  it('appends pages without duplicating a repeated lesson', () => {
    const first = buildTeacherSchedulePageModel([lesson()]);
    const second = buildTeacherSchedulePageModel([
      lesson(),
      lesson({ id: 'lesson-2', startsAt: '2026-09-02T11:00:00+08:00' }),
    ]);

    expect(mergeTeacherScheduleItems(first, second, 2).map(({ id }) => id)).toEqual([
      'lesson-1',
      'lesson-2',
    ]);
    expect(mergeTeacherScheduleItems(first, second, 1)).toEqual(second);
  });

  it('navigates only actionable lessons to their encoded detail route', () => {
    expect(resolveTeacherScheduleNavigation('lesson/one', false)).toEqual({
      kind: 'navigate',
      url: '/pages/teacher/lesson/index?id=lesson%2Fone',
    });
    expect(resolveTeacherScheduleNavigation('lesson-2', true)).toEqual({
      kind: 'disabled',
    });
  });

  it('keeps empty, error and retry states in the schedule page', () => {
    const root = path.resolve(__dirname, '..');
    const markup = fs.readFileSync(
      path.join(root, 'pages/teacher/schedule/index.wxml'),
      'utf8',
    );
    const logic = fs.readFileSync(
      path.join(root, 'pages/teacher/schedule/index.ts'),
      'utf8',
    );
    expect(markup).toContain("viewState === 'empty'");
    expect(markup).toContain("viewState === 'error'");
    expect(logic).toMatch(/onRetry\(\)\s*\{\s*void this\.loadSchedule\(true\)/s);
  });

  it('presents lesson time as a dedicated visual block instead of muted metadata', () => {
    const root = path.resolve(__dirname, '..');
    const markup = fs.readFileSync(
      path.join(root, 'pages/teacher/schedule/index.wxml'),
      'utf8',
    );
    const styles = fs.readFileSync(
      path.join(root, 'pages/teacher/schedule/index.wxss'),
      'utf8',
    );

    expect(markup).toContain('class="lesson-row__time"');
    expect(markup).toContain('class="lesson-row__time-icon"');
    expect(markup).toContain('{{item.timeLabel}}');
    expect(styles).toMatch(
      /\.lesson-row__time\s*\{[^}]*display:\s*flex[^}]*background:/s,
    );
    expect(styles).toMatch(/\.lesson-row__time-value\s*\{[^}]*font-weight:\s*700/s);
  });
});
