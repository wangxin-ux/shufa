import { ParentFeedbackImage, ParentUpdateRecord } from '../../types/parent';
import { NORMAL_PARENT_FIXTURE, ParentFixture } from './parent.fixture';

const student = { id: 'visual-student', name: '林小禾', age: 9 };
const nextLesson = {
  id: 'visual-next-lesson',
  dateLabel: '8月29日 周六',
  timeLabel: '14:00-15:30',
  campusName: '上谷校区',
  courseName: '专业美术B',
  teacherName: '林老师',
};
const photo = (name: 'student' | 'classroom'): ParentFeedbackImage => ({
  id: `visual-${name}-photo`,
  mimeType: 'image/png',
  sizeBytes: name === 'student' ? 5195 : 5004,
  accessUrl: `/pages/parent/assets/visual-${name}.png`,
  accessUrlExpiresAt: '2099-01-01T00:00:00Z',
});
const record: ParentUpdateRecord = {
  lessonSessionId: 'visual-lesson-unreviewed',
  studentId: student.id,
  courseName: '专业美术B',
  campusName: '京南一品校区',
  teacherName: '赵老师',
  startsAt: '2026-08-26T06:00:00Z',
  lessonStatus: 'COMPLETED',
  attendanceStatus: 'PRESENT',
  feedback: '本节课林小禾同学表现很棒，课堂上专注认真，能够跟着老师思路，大胆表达自己的绘画想法。画面构图饱满，色彩搭配富有想象力，敢于尝试不同笔触，看得出用心投入。遇到难点时愿意耐心调整，动手能力很不错。继续保持这份对美术的热爱，期待下次更精彩的作品！',
  feedbackImages: [photo('classroom')],
  performanceRating: 9,
  canReview: true,
  review: null,
};

// Isolated mock content for visual review, never an API fallback or a seed.
export const VISUAL_PARENT_FIXTURE: ParentFixture = {
  home: {
    ...NORMAL_PARENT_FIXTURE.home,
    student,
    nextLesson,
    attendanceRateLabel: '100%',
    reminders: [nextLesson],
  },
  hours: {
    ...NORMAL_PARENT_FIXTURE.hours,
    entries: [
      { id: 'visual-hours-debit', title: '书法课', courseName: '书法课',
        occurredAtLabel: '2026-08-26 14:00', detailLabel: '林老师 · 正常上课',
        summaryLabel: '8月26日 14:00 林老师', delta: -1 },
      { id: 'visual-hours-paid', title: '报名课时', courseName: '专业美术B',
        occurredAtLabel: '2026-08-22 14:00', detailLabel: '购买课时',
        summaryLabel: '8月22日 14:00 课时发放', delta: 48 },
      { id: 'visual-hours-gift', title: '赠送课时', courseName: '专业美术B',
        occurredAtLabel: '2026-08-22 14:00', detailLabel: '赠送课时',
        summaryLabel: '8月22日 14:00 课时发放', delta: 12 },
    ],
  },
  leave: {
    ...NORMAL_PARENT_FIXTURE.leave,
    students: [{ id: student.id, name: student.name }],
    lessons: [{ id: nextLesson.id, title: nextLesson.courseName, startsAt: '2026-08-29T06:00:00Z' }],
    records: [
      { id: 'visual-leave-1', courseName: '专业美术B', lessonTimeLabel: '2026-08-26 14:00',
        reason: '家庭临时有事', status: 'approved' },
      { id: 'visual-leave-2', courseName: '书法课', lessonTimeLabel: '2026-08-22 14:00',
        reason: '家庭行程冲突', status: 'approved' },
    ],
  },
  profile: {
    ...NORMAL_PARENT_FIXTURE.profile,
    student: { ...NORMAL_PARENT_FIXTURE.profile.student!, ...student },
  },
  updates: {
    student: { ...student, profileVersion: 1, photo: photo('student') },
    records: [
      record,
      { ...record, lessonSessionId: 'visual-lesson-reviewed', startsAt: '2026-08-22T06:00:00Z',
        canReview: false,
        review: { id: 'visual-review', lessonSessionId: 'visual-lesson-reviewed', studentId: student.id,
          teaching: 9, communication: 8, environment: 10, overall: 9,
          note: '老师认真负责，孩子上课很专注。', createdAt: '2026-08-22T09:00:00Z', valid: true } },
    ],
  },
};
