import {
  buildTeacherLedgerPageModel,
  mergeTeacherLedgerItems,
} from '../services/teacher-ledger.presenter';

describe('teacher ledger presenter', () => {
  it('formats immutable server entries without calculating balances', () => {
    const model = buildTeacherLedgerPageModel([
      {
        id: 'entry-1', lessonSessionId: 'lesson-1', studentId: 'student-1', studentName: '林同学',
        occurredAt: '2026-09-01T02:00:00.000Z', entryType: 'CONSUME', bucket: 'MAIN', deltaUnits: -100,
      },
      {
        id: 'entry-2', lessonSessionId: 'lesson-1', studentId: 'student-1', studentName: '林同学',
        occurredAt: '2026-09-01T10:05:00+08:00', entryType: 'REVERSAL', bucket: 'MAIN', deltaUnits: 100,
      },
    ]);
    expect(model[0]).toMatchObject({ typeLabel: '扣课', bucketLabel: '主课时', deltaLabel: '-100', tone: 'negative' });
    expect(model[0].occurredAtLabel).toBe('9月1日 10:00');
    expect(model[1]).toMatchObject({ typeLabel: '撤销返还', deltaLabel: '+100', tone: 'positive' });
    expect(Object.keys(model[0])).not.toContain('balance');
  });

  it('deduplicates appended ledger pages', () => {
    const item = { id: 'entry-1', lessonSessionId: 'lesson-1', studentName: '林同学', occurredAtLabel: '', typeLabel: '扣课', bucketLabel: '主课时', deltaLabel: '-100', tone: 'negative' as const };
    expect(mergeTeacherLedgerItems([item], [item, { ...item, id: 'entry-2' }], 2)).toHaveLength(2);
  });
});
