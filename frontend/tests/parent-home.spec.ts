import {
  buildParentHomePageModel,
  resolveParentHomeAction,
} from '../services/parent-home.presenter';
import { ParentHomeSummary } from '../types/parent';

const homeSummary: ParentHomeSummary = {
  student: { id: 'student-1', name: '林小禾', age: 9 },
  nextLesson: {
    id: 'lesson-1',
    dateLabel: '8月29日 周六',
    timeLabel: '14:00-15:30',
    campusName: '启明成长中心',
    courseName: '创意书写',
    teacherName: '林老师',
  },
  remainingHoursLabel: '37',
  attendanceRateLabel: '98%',
};

describe('parent home page model', () => {
  it('maps the home summary to the P2 visual fields', () => {
    const model = buildParentHomePageModel(homeSummary);

    expect(model.course).toEqual({
      day: '29',
      weekday: 'Saturday',
      campus: '启明成长中心',
      name: '创意书写',
      time: '14:00-15:30',
      teacher: '林老师',
    });
    expect(model.student).toEqual(homeSummary.student);
    expect(model.metrics).toEqual([
      { label: '剩余课时', value: '37', unit: '节', sub: '实时更新' },
      { label: '下次上课', value: '周六', unit: '14:00', sub: '实时更新' },
      { label: '出勤率', value: '98', unit: '%', sub: '实时更新' },
    ]);
  });

  it('keeps an empty lesson representable without inventing course data', () => {
    const model = buildParentHomePageModel({
      ...homeSummary,
      nextLesson: null,
      remainingHoursLabel: '0',
      attendanceRateLabel: '--',
    });

    expect(model.course).toBeNull();
    expect(model.metrics[1]).toMatchObject({ value: '--', unit: '' });
    expect(model.metrics[2]).toMatchObject({ value: '--', unit: '' });
  });

  it('resolves only enabled quick actions to parent routes', () => {
    expect(resolveParentHomeAction('leave')).toEqual({
      type: 'navigate',
      url: '/pages/parent/leave/index',
    });
    expect(resolveParentHomeAction('hours')).toEqual({
      type: 'navigate',
      url: '/pages/parent/hours/index',
    });
    expect(resolveParentHomeAction('campuses')).toEqual({
      type: 'navigate',
      url: '/pages/parent/campuses/index',
    });
    expect(resolveParentHomeAction('team')).toEqual({
      type: 'unavailable',
      message: '本轮暂未开放',
    });
  });
});
