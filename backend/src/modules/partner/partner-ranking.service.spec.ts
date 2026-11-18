import { rankCampusValues, rankingMonthRange } from './partner-ranking.service';

describe('partner monthly ranking rules', () => {
  it('uses dense ranks and a stable campus id order without leaking the internal value', () => {
    const rows = rankCampusValues([
      { campusId: 'b', campusName: '乙校区', value: 30n },
      { campusId: 'a', campusName: '甲校区', value: 30n },
      { campusId: 'c', campusName: '丙校区', value: -10n },
    ]);
    expect(rows.map(({ campusId, rank }) => ({ campusId, rank }))).toEqual([
      { campusId: 'a', rank: 1 },
      { campusId: 'b', rank: 1 },
      { campusId: 'c', rank: 2 },
    ]);
  });

  it('does not round different bigint totals into a false tie', () => {
    const rows = rankCampusValues([
      { campusId: 'a', campusName: '甲', value: 9007199254740992n },
      { campusId: 'b', campusName: '乙', value: 9007199254740993n },
    ]);
    expect(rows.map((row) => row.campusId)).toEqual(['b', 'a']);
    expect(rows.map((row) => row.rank)).toEqual([1, 2]);
  });

  it('uses Beijing month boundaries across years and rejects impossible or future months', () => {
    const now = new Date('2026-10-15T02:00:00Z');
    expect(rankingMonthRange('2026-01', now)).toEqual({
      start: new Date('2025-12-31T16:00:00Z'),
      end: new Date('2026-01-31T16:00:00Z'),
      previousMonth: '2025-12',
      current: false,
    });
    expect(rankingMonthRange('2026-10', now).current).toBe(true);
    for (const month of ['2026-00', '2026-13', '2026-1', '2026-11']) {
      expect(() => rankingMonthRange(month, now)).toThrow();
    }
  });
});
