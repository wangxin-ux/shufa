import { selectTeacherEarningRule } from './earning-rule.service';

const teacherId = '30000000-0000-4000-8000-000000000001';

describe('teacher earning rule selection', () => {
  it('prefers one teacher-specific rule over the campus default', () => {
    expect(
      selectTeacherEarningRule(
        [
          ruleFixture('campus-default', null),
          ruleFixture('teacher-override', teacherId),
        ],
        teacherId,
      )?.id,
    ).toBe('teacher-override');
  });

  it('rejects overlapping rules in the selected scope', () => {
    expect(() =>
      selectTeacherEarningRule(
        [ruleFixture('first', teacherId), ruleFixture('second', teacherId)],
        teacherId,
      ),
    ).toThrow('Overlapping teacher earning rules');
  });

  it('returns null when no rule applies', () => {
    expect(selectTeacherEarningRule([], teacherId)).toBeNull();
  });
});

function ruleFixture(id: string, teacherProfileId: string | null) {
  return {
    id,
    campusId: '10000000-0000-4000-8000-000000000001',
    teacherProfileId,
    basisType: 'PER_COMPLETED_SESSION' as const,
    unitAmountFen: 10000,
    eligibleLessonKinds: ['REGULAR'] as const,
    countedAttendanceStatuses: ['PRESENT'] as const,
    settlementDelayDays: 0,
    version: 1,
    status: 'ACTIVE' as const,
    effectiveFrom: new Date('2026-08-01T00:00:00Z'),
    effectiveTo: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
  };
}
