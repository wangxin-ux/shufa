import {
  buildTeacherHomePageModel,
  resolveTeacherHomeAction,
} from '../services/teacher-home.presenter';
import { TeacherDashboard } from '../types/teacher';

const dashboard: TeacherDashboard = {
  teacher: {
    displayName: '林老师',
    subjectLabel: '创意美术与综合材料课程',
    campusName: '城东青少年成长中心旗舰校区',
  },
  nextLesson: {
    id: 'lesson/with space',
    version: 1,
    className: '创意基础 A 班',
    courseName: '专业美术与综合材料创作长课程名',
    campusName: '城东青少年成长中心旗舰校区',
    startsAt: '2026-09-01T09:05:00+08:00',
    endsAt: '2026-09-01T10:35:00+08:00',
    lessonUnits: 100,
    status: 'SCHEDULED',
    studentCount: 18,
  },
  todayPendingCount: 12,
  todayCompletedCount: 105,
  responsibleStudentCount: 128,
  serverTime: '2026-08-29T08:00:00+08:00',
};

describe('teacher home presenter', () => {
  it('formats the next lesson and keeps dynamic long labels intact', () => {
    const model = buildTeacherHomePageModel(dashboard);

    expect(model.teacher).toEqual(dashboard.teacher);
    expect(model.nextLesson).toEqual({
      id: 'lesson/with space',
      time: '09:05',
      weekday: '周二',
      campusName: '城东青少年成长中心旗舰校区',
      courseName: '专业美术与综合材料创作长课程名',
      statusPrefix: '课时预警/',
      statusLabel: '待上课',
      statusTone: 'success',
    });
  });

  it('formats API UTC timestamps in the campus timezone', () => {
    const model = buildTeacherHomePageModel({
      ...dashboard,
      nextLesson: dashboard.nextLesson
        ? {
            ...dashboard.nextLesson,
            startsAt: '2026-08-30T06:00:00.000Z',
            endsAt: '2026-08-30T07:30:00.000Z',
          }
        : null,
    });

    expect(model.nextLesson).toMatchObject({
      time: '14:00',
      weekday: '周日',
    });
  });

  it('keeps two and three digit statistics inside a stable model', () => {
    expect(buildTeacherHomePageModel(dashboard).stats).toEqual([
      { key: 'pending', value: '12', unit: '节', label: '今日待上课', compact: false },
      { key: 'completed', value: '105', unit: '节', label: '已完成', compact: true },
      { key: 'students', value: '128', unit: '人', label: '负责学生', compact: true },
    ]);
  });

  it('represents an empty dashboard without inventing lesson data', () => {
    const model = buildTeacherHomePageModel({ ...dashboard, nextLesson: null });

    expect(model.nextLesson).toBeNull();
    expect(model.emptyMessage).toBe('今日暂无待上课程');
  });

  it('maps every home command to its intended teacher route', () => {
    expect(resolveTeacherHomeAction('more')).toEqual({
      kind: 'navigate',
      url: '/pages/teacher/group-campaigns/index',
    });
    expect(resolveTeacherHomeAction('schedule')).toEqual({
      kind: 'navigate',
      url: '/pages/teacher/schedule/index',
    });
    expect(resolveTeacherHomeAction('students')).toEqual({
      kind: 'navigate',
      url: '/pages/teacher/students/index',
    });
    expect(resolveTeacherHomeAction('records')).toEqual({
      kind: 'navigate',
      url: '/pages/teacher/records/index',
    });
    expect(resolveTeacherHomeAction('profile')).toEqual({
      kind: 'navigate',
      url: '/pages/teacher/profile/index',
    });
    expect(resolveTeacherHomeAction('confirm', dashboard.nextLesson?.id)).toEqual({
      kind: 'navigate',
      url: '/pages/teacher/lesson/index?id=lesson%2Fwith%20space',
    });
    expect(resolveTeacherHomeAction('confirm', null)).toEqual({
      kind: 'unavailable',
      message: '今日暂无可确认课次',
    });
  });
});
