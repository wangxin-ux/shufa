import {
  buildTeacherRecordPageModel,
  mergeTeacherRecordItems,
} from '../services/teacher-records.presenter';

describe('teacher records presenter', () => {
  it('formats completed and reversed server summaries', () => {
    const model = buildTeacherRecordPageModel([
      {
        id: 'record-1', lessonSessionId: 'lesson-1', className: 'A 班', courseName: '创意课程',
        startsAt: '2026-09-01T01:00:00.000Z', endsAt: '2026-09-01T02:00:00.000Z',
        attendeeCount: 12, lessonUnits: 100, feedbackCompletedCount: 12,
        feedbackRequiredCount: 12, status: 'COMPLETED',
      },
      {
        id: 'record-2', lessonSessionId: 'lesson-2', className: 'B 班', courseName: '材料课程',
        startsAt: '2026-09-02T14:00:00+08:00', endsAt: '2026-09-02T15:30:00+08:00',
        attendeeCount: 8, lessonUnits: 100, feedbackCompletedCount: 5,
        feedbackRequiredCount: 8, status: 'REVERSED',
      },
    ]);
    expect(model[0]).toMatchObject({ timeLabel: '9月1日 09:00-10:00', attendeeLabel: '12 人到课', statusLabel: '已完成' });
    expect(model[1]).toMatchObject({ statusLabel: '已撤销' });
  });

  it('deduplicates appended pages', () => {
    const item = { id: 'record-1', lessonSessionId: 'lesson-1', courseName: '课程', className: 'A', timeLabel: '', attendeeLabel: '', statusLabel: '已完成', statusTone: 'success' as const };
    expect(mergeTeacherRecordItems([item], [item, { ...item, id: 'record-2' }], 2)).toHaveLength(2);
  });
});
