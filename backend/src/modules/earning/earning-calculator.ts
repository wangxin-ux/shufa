export type TeacherEarningBasisType =
  'PER_COMPLETED_SESSION' | 'PER_LESSON_UNIT' | 'PER_PRESENT_ATTENDEE';

export type LessonKind = 'REGULAR' | 'MAKEUP' | 'TRIAL';
export type AttendanceStatus = 'PRESENT' | 'LEAVE' | 'ABSENT';

export interface CalculateTeacherEarningInput {
  basisType: TeacherEarningBasisType;
  unitAmountFen: number;
  lessonUnits: number;
  attendeeCount: number;
}

export interface CalculateTeacherEarningForRuleInput extends Omit<
  CalculateTeacherEarningInput,
  'attendeeCount'
> {
  lessonKind: LessonKind;
  eligibleLessonKinds: readonly LessonKind[];
  attendanceStatuses: readonly AttendanceStatus[];
  countedAttendanceStatuses: readonly AttendanceStatus[];
}

export function calculateTeacherEarning(
  input: CalculateTeacherEarningInput,
): number {
  assertSafePositiveInteger(input.unitAmountFen, 'unitAmountFen');
  assertSafePositiveInteger(input.lessonUnits, 'lessonUnits');
  assertSafeNonNegativeInteger(input.attendeeCount, 'attendeeCount');

  let amount: number;
  switch (input.basisType) {
    case 'PER_COMPLETED_SESSION':
      amount = input.unitAmountFen;
      break;
    case 'PER_LESSON_UNIT': {
      const scaledAmount = input.unitAmountFen * input.lessonUnits;
      if (!Number.isSafeInteger(scaledAmount)) {
        throw new RangeError('Invalid earning amount');
      }
      amount = Math.floor(scaledAmount / 100);
      break;
    }
    case 'PER_PRESENT_ATTENDEE':
      amount = input.unitAmountFen * input.attendeeCount;
      break;
    default:
      throw new RangeError('Unsupported earning basis type');
  }

  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError('Invalid earning amount');
  }
  return amount;
}

export function calculateTeacherEarningForRule(
  input: CalculateTeacherEarningForRuleInput,
): number {
  if (!input.eligibleLessonKinds.includes(input.lessonKind)) {
    return 0;
  }

  const countedStatuses = new Set(input.countedAttendanceStatuses);
  const attendeeCount = input.attendanceStatuses.filter((status) =>
    countedStatuses.has(status),
  ).length;

  return calculateTeacherEarning({
    basisType: input.basisType,
    unitAmountFen: input.unitAmountFen,
    lessonUnits: input.lessonUnits,
    attendeeCount,
  });
}

function assertSafePositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive safe integer`);
  }
}

function assertSafeNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer`);
  }
}
