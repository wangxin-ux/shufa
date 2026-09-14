import {
  calculateTeacherEarning,
  calculateTeacherEarningForRule,
} from './earning-calculator';

describe('teacher earning calculator', () => {
  it.each([
    ['PER_COMPLETED_SESSION', 10000],
    ['PER_LESSON_UNIT', 15000],
    ['PER_PRESENT_ATTENDEE', 24000],
  ] as const)('calculates %s using integer fen', (basisType, expected) => {
    expect(
      calculateTeacherEarning({
        basisType,
        unitAmountFen: basisType === 'PER_PRESENT_ATTENDEE' ? 8000 : 10000,
        lessonUnits: 150,
        attendeeCount: 3,
      }),
    ).toBe(expected);
  });

  it('floors fractional fen when lesson units are hundredths', () => {
    expect(
      calculateTeacherEarning({
        basisType: 'PER_LESSON_UNIT',
        unitAmountFen: 1,
        lessonUnits: 150,
        attendeeCount: 1,
      }),
    ).toBe(1);
  });

  it('returns zero for attendee pricing with no counted attendees', () => {
    expect(
      calculateTeacherEarning({
        basisType: 'PER_PRESENT_ATTENDEE',
        unitAmountFen: 8000,
        lessonUnits: 100,
        attendeeCount: 0,
      }),
    ).toBe(0);
  });

  it('does not price a lesson kind excluded by the rule', () => {
    expect(
      calculateTeacherEarningForRule({
        basisType: 'PER_COMPLETED_SESSION',
        unitAmountFen: 10000,
        lessonUnits: 100,
        lessonKind: 'TRIAL',
        eligibleLessonKinds: ['REGULAR', 'MAKEUP'],
        attendanceStatuses: ['PRESENT'],
        countedAttendanceStatuses: ['PRESENT'],
      }),
    ).toBe(0);
  });

  it('counts only attendance statuses selected by the rule', () => {
    expect(
      calculateTeacherEarningForRule({
        basisType: 'PER_PRESENT_ATTENDEE',
        unitAmountFen: 8000,
        lessonUnits: 100,
        lessonKind: 'REGULAR',
        eligibleLessonKinds: ['REGULAR'],
        attendanceStatuses: ['PRESENT', 'LEAVE', 'ABSENT'],
        countedAttendanceStatuses: ['PRESENT'],
      }),
    ).toBe(8000);
  });

  it('rejects arithmetic outside the safe integer range', () => {
    expect(() =>
      calculateTeacherEarning({
        basisType: 'PER_PRESENT_ATTENDEE',
        unitAmountFen: Number.MAX_SAFE_INTEGER,
        lessonUnits: 100,
        attendeeCount: 2,
      }),
    ).toThrow(RangeError);
  });
});
