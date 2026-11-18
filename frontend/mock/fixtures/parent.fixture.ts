import {
  LeavePageView,
  ParentHomeSummary,
  ParentHoursView,
  ParentProfileView,
  ParentUpdatesView,
} from '../../types/parent';

export interface ParentFixture {
  home: ParentHomeSummary;
  hours: ParentHoursView;
  leave: LeavePageView;
  profile: ParentProfileView;
  updates: ParentUpdatesView;
}

const NORMAL_NEXT_LESSON: NonNullable<ParentHomeSummary['nextLesson']> = {
  id: 'lesson-writing-001',
  dateLabel: '8月29日 周六',
  timeLabel: '14:00-15:30',
  campusName: '启明成长中心',
  courseName: '创意书写',
  teacherName: '林老师',
};

export const NORMAL_PARENT_FIXTURE: ParentFixture = {
  home: {
    student: { id: 'student-lin-xiao-he', name: '林小禾', age: 9 },
    nextLesson: NORMAL_NEXT_LESSON,
    remainingHoursLabel: '37',
    attendanceRateLabel: '98%',
    teachers: [{ id: 'teacher-lin', name: '林老师', specialties: ['创意书写'] }],
    reminders: [NORMAL_NEXT_LESSON],
  },
  hours: {
    remainingTotal: 37,
    paidHours: 37,
    giftHours: 0,
    grantedPaidHours: 48,
    grantedGiftHours: 12,
    paidAmountFen: 480000,
    validUntil: '2027-08-23',
    entries: [
      {
        id: 'hours-entry-001',
        courseName: '创意书写',
        title: '创意书写',
        occurredAtLabel: '2026-08-22 14:00',
        detailLabel: '林老师 · 正常上课',
        summaryLabel: '8月22日 14:00 林老师',
        delta: -1,
      },
      {
        id: 'hours-entry-002',
        courseName: '未分类',
        title: '续费报名',
        occurredAtLabel: '2026-08-18 10:30',
        detailLabel: '购买课时',
        summaryLabel: '8月18日 10:30 课时发放',
        delta: 48,
      },
      {
        id: 'hours-entry-003',
        courseName: '专业美术 A',
        title: '专业美术 A',
        occurredAtLabel: '2026-08-15 15:30',
        detailLabel: '赵老师 · 正常上课',
        summaryLabel: '8月15日 15:30 赵老师',
        delta: -1,
      },
    ],
  },
  leave: {
    students: [{ id: 'student-lin-xiao-he', name: '林小禾' }],
    lessons: [
      {
        id: 'lesson-writing-001',
        title: '创意书写',
        startsAt: '2026-08-29T06:00:00.000Z',
      },
    ],
    records: [
      {
        id: 'leave-record-001',
        courseName: '创意书写',
        lessonTimeLabel: '2026-08-15 14:00',
        reason: '家庭行程冲突',
        status: 'approved',
      },
    ],
    cutoffHours: 2,
  },
  profile: {
    student: {
      id: 'student-lin-xiao-he',
      name: '林小禾',
      age: 9,
      homeAddress: '长沙市岳麓区启明路 18 号',
      profileVersion: 1,
    },
    unreadMessageCount: 2,
  },
  updates: {
    student: { id: 'student-lin-xiao-he', name: '林小禾', age: 9, profileVersion: 1, photo: null },
    records: [
      {
        lessonSessionId: 'lesson-writing-completed-001',
        studentId: 'student-lin-xiao-he',
        campusName: '启明成长中心',
        canReview: true,
        review: null,
        performanceRating: 9,
        courseName: '创意书写',
        teacherName: '林老师',
        startsAt: '2026-08-22T06:00:00.000Z',
        lessonStatus: 'COMPLETED',
        attendanceStatus: 'PRESENT',
        feedback: '课堂参与认真，书写节奏稳定。',
        feedbackImages: [],
      },
    ],
  },
};

export const EMPTY_PARENT_FIXTURE: ParentFixture = {
  home: {
    student: { id: 'student-unbound', name: '', age: 0 },
    nextLesson: null,
    remainingHoursLabel: '0',
    attendanceRateLabel: '--',
    teachers: [],
    reminders: [],
  },
  hours: {
    remainingTotal: 0,
    paidHours: 0,
    giftHours: 0,
    paidAmountFen: 0,
    validUntil: '',
    entries: [],
  },
  leave: {
    students: [],
    lessons: [],
    records: [],
    cutoffHours: 2,
  },
  profile: {
    student: null,
    unreadMessageCount: 0,
  },
  updates: { student: null, records: [] },
};
