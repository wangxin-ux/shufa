import * as fs from 'fs';
import * as path from 'path';
import {
  buildTeacherFeedbackPageModel,
  buildTeacherFeedbackStudentModels,
  mergeTeacherFeedbackItems,
  resolveTeacherFeedbackNavigation,
} from '../services/teacher-feedback.presenter';
import { TeachingRecord, TeacherLessonDetail } from '../types/teacher';

const record = (overrides: Partial<TeachingRecord> = {}): TeachingRecord => ({
  id: 'record-1',
  lessonSessionId: 'lesson-1',
  className: '创意基础A班',
  courseName: '创意基础',
  startsAt: '2026-08-28T01:00:00.000Z',
  endsAt: '2026-08-28T02:00:00.000Z',
  attendeeCount: 2,
  lessonUnits: 100,
  feedbackCompletedCount: 0,
  feedbackRequiredCount: 2,
  status: 'COMPLETED',
  ...overrides,
});

const completedDetail: TeacherLessonDetail = {
  id: 'lesson-1',
  version: 2,
  className: '创意基础A班',
  courseName: '创意基础',
  campusName: '启明东校区',
  startsAt: '2026-08-28T01:00:00.000Z',
  endsAt: '2026-08-28T02:00:00.000Z',
  lessonUnits: 100,
  status: 'COMPLETED',
  studentCount: 2,
  attendancePolicy: {
    PRESENT: { consumesLessonUnits: true },
    LEAVE: { consumesLessonUnits: false },
    ABSENT: { consumesLessonUnits: false },
  },
  students: [
    {
      id: 'student-1',
      displayName: '陈晨',
      attendanceStatus: 'PRESENT',
      expectedConsumeUnits: 100,
      feedback: '观察认真，构图完整',
      feedbackImages: [
        {
          id: 'image-1',
          mimeType: 'image/png',
          sizeBytes: 128,
          accessUrl: 'https://example.test/image-1',
          accessUrlExpiresAt: '2026-08-31T10:00:00.000Z',
        },
      ],
    },
    {
      id: 'student-2',
      displayName: '安然',
      attendanceStatus: 'LEAVE',
      expectedConsumeUnits: 0,
      feedback: null,
      feedbackImages: [],
    },
  ],
  canComplete: false,
  canReverse: true,
};

describe('teacher feedback module', () => {
  it('presents pending, partial, completed, and reversed lesson progress', () => {
    const items = buildTeacherFeedbackPageModel([
      record(),
      record({ id: 'record-2', feedbackCompletedCount: 1 }),
      record({ id: 'record-3', feedbackCompletedCount: 2 }),
      record({ id: 'record-4', status: 'REVERSED', feedbackCompletedCount: 1 }),
    ]);

    expect(items.map(({ statusLabel, progressLabel, actionLabel }) => ({
      statusLabel,
      progressLabel,
      actionLabel,
    }))).toEqual([
      { statusLabel: '待填写', progressLabel: '已反馈 0/2 人', actionLabel: '填写反馈' },
      { statusLabel: '部分完成', progressLabel: '已反馈 1/2 人', actionLabel: '继续填写' },
      { statusLabel: '已完成', progressLabel: '已反馈 2/2 人', actionLabel: '查看反馈' },
      { statusLabel: '已撤销', progressLabel: '已反馈 1/2 人', actionLabel: '查看反馈' },
    ]);
  });

  it('builds editable completed students and read-only reversed students', () => {
    expect(buildTeacherFeedbackStudentModels(completedDetail)).toEqual([
      expect.objectContaining({
        id: 'student-1',
        attendanceLabel: '到课',
        feedbackDraft: '观察认真，构图完整',
        feedbackImages: [expect.objectContaining({ id: 'image-1' })],
        hasFeedback: true,
      }),
      expect.objectContaining({
        id: 'student-2',
        attendanceLabel: '请假',
        feedbackDraft: '',
        hasFeedback: false,
      }),
    ]);
    expect(
      buildTeacherFeedbackStudentModels({
        ...completedDetail,
        status: 'REVERSED',
        canReverse: false,
      })[0].readOnly,
    ).toBe(true);
  });

  it('navigates to the independent detail and deduplicates appended pages', () => {
    expect(resolveTeacherFeedbackNavigation('lesson-1')).toEqual({
      kind: 'navigate',
      url: '/pages/teacher/feedback-detail/index?id=lesson-1',
    });
    const item = buildTeacherFeedbackPageModel([record()])[0];
    expect(
      mergeTeacherFeedbackItems([item], [item, { ...item, id: 'record-2' }], 2),
    ).toHaveLength(2);
  });

  it('removes the inline editor from attendance and provides a separate command', () => {
    const root = path.resolve(__dirname, '..');
    const lessonMarkup = fs.readFileSync(
      path.join(root, 'pages/teacher/lesson/index.wxml'),
      'utf8',
    );
    expect(lessonMarkup).not.toContain('feedback-editor');
    expect(lessonMarkup).not.toContain('onSaveFeedback');
    expect(lessonMarkup).toContain('onFeedbackTap');
    expect(lessonMarkup).toContain('去填写课堂反馈');
  });
});
