import { Prisma } from '@prisma/client';
import { calculatePartnerEarning } from '../partner-earning/partner-earning-calculator';

const teachingSelect = {
  id: true,
  campusId: true,
  lessonSessionId: true,
  teacherId: true,
  lessonUnits: true,
  attendeeCount: true,
  status: true,
  completedAt: true,
  lessonSession: {
    select: {
      id: true,
      campusId: true,
      teacherId: true,
      kind: true,
      lessonUnits: true,
      status: true,
    },
  },
} satisfies Prisma.TeachingRecordSelect;

const basisSelect = {
  id: true,
  campusId: true,
  teachingRecordId: true,
  lessonSessionId: true,
  selectedRuleId: true,
  lessonKind: true,
  lessonUnits: true,
  actualAttendeeCount: true,
  countedAttendeeCount: true,
  attendanceSnapshot: true,
  completedAt: true,
  status: true,
  selectedRule: {
    select: {
      id: true,
      campusId: true,
      scopeKey: true,
      version: true,
      unitPriceFen: true,
      shareBasisPoints: true,
      eligibleLessonKinds: true,
      countedAttendanceStatuses: true,
      settlementDelayDays: true,
    },
  },
} satisfies Prisma.PartnerEarningBasisSelect;

const entrySelect = {
  id: true,
  campusId: true,
  earningBasisId: true,
  entryType: true,
  status: true,
  amountFen: true,
  reversalOfId: true,
  ruleSnapshot: true,
  reversedBy: {
    select: {
      id: true,
      campusId: true,
      earningBasisId: true,
      entryType: true,
      status: true,
      reversalOfId: true,
    },
  },
} satisfies Prisma.PartnerEarningEntrySelect;

type Teaching = Prisma.TeachingRecordGetPayload<{
  select: typeof teachingSelect;
}>;
type Basis = Prisma.PartnerEarningBasisGetPayload<{
  select: typeof basisSelect;
}>;
type Entry = Prisma.PartnerEarningEntryGetPayload<{
  select: typeof entrySelect;
}>;
type Rule = NonNullable<Basis['selectedRule']>;
type Contribution = { estimated: number; pending: number };

const nonnegative = (value: number) =>
  Number.isSafeInteger(value) && value >= 0;
const positive = (value: number) => nonnegative(value) && value > 0;
const statuses = ['PRESENT', 'LEAVE', 'ABSENT'];
const kinds = ['REGULAR', 'MAKEUP', 'TRIAL'];
const sameSet = (left: unknown, right: readonly string[]) =>
  Array.isArray(left) &&
  new Set(left).size === new Set(right).size &&
  left.every((item) => typeof item === 'string' && right.includes(item)) &&
  right.every((item) => left.includes(item));

function frequencies<T>(rows: T[], key: (row: T) => string) {
  const result = new Map<string, number>();
  for (const row of rows) result.set(key(row), (result.get(key(row)) ?? 0) + 1);
  return result;
}

function validTeaching(campusId: string, basis: Basis, teaching: Teaching) {
  const lesson = teaching.lessonSession;
  return (
    teaching.campusId === campusId &&
    basis.campusId === campusId &&
    lesson.campusId === campusId &&
    teaching.lessonSessionId === lesson.id &&
    basis.lessonSessionId === lesson.id &&
    teaching.teacherId === lesson.teacherId &&
    basis.lessonKind === lesson.kind &&
    kinds.includes(basis.lessonKind) &&
    positive(teaching.lessonUnits) &&
    basis.lessonUnits === teaching.lessonUnits &&
    lesson.lessonUnits === teaching.lessonUnits &&
    nonnegative(teaching.attendeeCount) &&
    Number.isFinite(teaching.completedAt.getTime()) &&
    teaching.completedAt.getTime() === basis.completedAt.getTime() &&
    ((teaching.status === 'COMPLETED' &&
      lesson.status === 'COMPLETED' &&
      (basis.status === 'PRICED' || basis.status === 'UNPRICED')) ||
      (teaching.status === 'REVERSED' &&
        lesson.status === 'REVERSED' &&
        basis.status === 'REVERSED'))
  );
}

function validRule(campusId: string, basis: Basis, rule: Rule) {
  return (
    rule.id === basis.selectedRuleId &&
    rule.campusId === campusId &&
    rule.scopeKey === `campus:${campusId}:partner` &&
    positive(rule.version)
  );
}

function attendanceCount(basis: Basis, teaching: Teaching, rule: Rule | null) {
  if (
    !Array.isArray(basis.attendanceSnapshot) ||
    !nonnegative(basis.actualAttendeeCount) ||
    !nonnegative(basis.countedAttendeeCount)
  )
    return null;
  const seen = new Set<string>();
  let actual = 0,
    counted = 0;
  for (const value of basis.attendanceSnapshot) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof value.studentId !== 'string' ||
      !value.studentId ||
      seen.has(value.studentId) ||
      typeof value.status !== 'string' ||
      !statuses.includes(value.status)
    )
      return null;
    seen.add(value.studentId);
    if (value.status === 'PRESENT') actual += 1;
    if (
      rule?.eligibleLessonKinds.includes(basis.lessonKind) &&
      rule.countedAttendanceStatuses.some((status) => status === value.status)
    )
      counted += 1;
  }
  return actual === basis.actualAttendeeCount &&
    actual === teaching.attendeeCount &&
    counted === basis.countedAttendeeCount
    ? counted
    : null;
}

function originalCalculation(basis: Basis, teaching: Teaching, rule: Rule) {
  if (
    !sameSet(
      rule.eligibleLessonKinds,
      kinds.filter((kind) =>
        rule.eligibleLessonKinds.some((item) => item === kind),
      ),
    ) ||
    !sameSet(
      rule.countedAttendanceStatuses,
      statuses.filter((status) =>
        rule.countedAttendanceStatuses.some((item) => item === status),
      ),
    ) ||
    rule.eligibleLessonKinds.length === 0 ||
    rule.countedAttendanceStatuses.length === 0 ||
    !nonnegative(rule.settlementDelayDays)
  )
    return null;
  const countedAttendeeCount = attendanceCount(basis, teaching, rule);
  if (countedAttendeeCount === null) return null;
  try {
    return calculatePartnerEarning({
      unitPriceFen: rule.unitPriceFen,
      shareBasisPoints: rule.shareBasisPoints,
      countedAttendeeCount,
    });
  } catch {
    return null;
  }
}

function validSnapshot(
  entry: Entry,
  basis: Basis,
  rule: Rule,
  calculation: { perAttendeeAmountFen: number; amountFen: number },
) {
  const value = entry.ruleSnapshot;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (
    value.ruleId === rule.id &&
    value.ruleVersion === rule.version &&
    value.unitPriceFen === rule.unitPriceFen &&
    value.shareBasisPoints === rule.shareBasisPoints &&
    sameSet(value.eligibleLessonKinds, rule.eligibleLessonKinds) &&
    sameSet(value.countedAttendanceStatuses, rule.countedAttendanceStatuses) &&
    value.settlementDelayDays === rule.settlementDelayDays &&
    value.lessonKind === basis.lessonKind &&
    value.lessonUnits === basis.lessonUnits &&
    value.actualAttendeeCount === basis.actualAttendeeCount &&
    value.countedAttendeeCount === basis.countedAttendeeCount &&
    value.perAttendeeAmountFen === calculation.perAttendeeAmountFen &&
    value.amountFen === calculation.amountFen
  );
}

function validInverseReference(entry: Entry, entries: Entry[]) {
  const reversal = entries.find((row) => row.reversalOfId === entry.id);
  const reference = entry.reversedBy;
  if (!reversal) return reference === null;
  return (
    entry.entryType === 'ACCRUAL' &&
    reversal.entryType === 'REVERSAL' &&
    reference !== null &&
    reference.id === reversal.id &&
    reference.campusId === reversal.campusId &&
    reference.earningBasisId === reversal.earningBasisId &&
    reference.entryType === reversal.entryType &&
    reference.status === reversal.status &&
    reference.reversalOfId === entry.id
  );
}

function contribution(
  campusId: string,
  basis: Basis,
  teaching: Teaching | undefined,
  entries: Entry[],
  unique: boolean,
): Contribution | null {
  if (
    !teaching ||
    !unique ||
    !validTeaching(campusId, basis, teaching) ||
    entries.some(
      (entry) =>
        entry.campusId !== campusId ||
        entry.earningBasisId !== basis.id ||
        !validInverseReference(entry, entries),
    )
  )
    return null;
  const rule = basis.selectedRule;
  if (!rule) {
    return basis.selectedRuleId === null &&
      basis.status !== 'PRICED' &&
      entries.length === 0 &&
      attendanceCount(basis, teaching, null) !== null &&
      basis.status === 'REVERSED'
      ? { estimated: 0, pending: 0 }
      : null;
  }
  if (!validRule(campusId, basis, rule) || basis.status === 'UNPRICED')
    return null;
  const accruals = entries.filter((entry) => entry.entryType === 'ACCRUAL');
  const reversals = entries.filter((entry) => entry.entryType === 'REVERSAL');
  if (
    entries.length !== accruals.length + reversals.length ||
    accruals.length > 1 ||
    reversals.length > 1
  )
    return null;
  const accrual = accruals[0];
  // Rejection excludes the original amount; it does not require repricing that amount.
  if (
    basis.status === 'PRICED' &&
    accrual?.status === 'REJECTED' &&
    accrual.reversalOfId === null &&
    entries.length === 1
  )
    return { estimated: 0, pending: 0 };
  const calculation = originalCalculation(basis, teaching, rule);
  if (!calculation) return null;
  if (calculation.amountFen === 0)
    return entries.length === 0 ? { estimated: 0, pending: 0 } : null;
  if (
    !accrual ||
    !positive(accrual.amountFen) ||
    accrual.amountFen !== calculation.amountFen ||
    accrual.reversalOfId !== null ||
    !validSnapshot(accrual, basis, rule, calculation)
  )
    return null;
  if (basis.status === 'REVERSED') {
    const reversal = reversals[0];
    if (
      entries.length !== 2 ||
      !reversal ||
      accrual.status !== 'REVERSED' ||
      reversal.status !== 'REVERSED' ||
      reversal.reversalOfId !== accrual.id ||
      reversal.amountFen !== -accrual.amountFen ||
      !validSnapshot(reversal, basis, rule, calculation)
    )
      return null;
    return { estimated: 0, pending: 0 };
  }
  if (
    entries.length !== 1 ||
    (accrual.status !== 'PENDING_REVIEW' && accrual.status !== 'AVAILABLE')
  )
    return null;
  return {
    estimated: accrual.amountFen,
    pending: accrual.status === 'PENDING_REVIEW' ? accrual.amountFen : 0,
  };
}

// Call only inside the caller's authorized campus snapshot. This function never writes facts.
export async function readOperatorInternalEarningSummary(
  tx: Prisma.TransactionClient,
  campusId: string,
) {
  if (typeof campusId !== 'string' || campusId.trim().length === 0)
    throw new Error('A campus scope is required for internal earning reads');
  const basisScope: Prisma.PartnerEarningBasisWhereInput = {
    OR: [
      { campusId },
      { teachingRecord: { campusId } },
      { lessonSession: { campusId } },
    ],
  };
  const teachings = await tx.teachingRecord.findMany({
    where: { OR: [{ campusId }, { lessonSession: { campusId } }] },
    select: teachingSelect,
  });
  const bases = await tx.partnerEarningBasis.findMany({
    where: basisScope,
    select: basisSelect,
  });
  const entries = await tx.partnerEarningEntry.findMany({
    where: { OR: [{ campusId }, { earningBasis: basisScope }] },
    select: entrySelect,
  });
  const teachingById = new Map(teachings.map((row) => [row.id, row]));
  const teachingIds = frequencies(teachings, (row) => row.id);
  const lessonIds = frequencies(teachings, (row) => row.lessonSessionId);
  const basisIds = frequencies(bases, (row) => row.id);
  const basisTeachingIds = frequencies(bases, (row) => row.teachingRecordId);
  const entryIds = frequencies(entries, (row) => row.id);
  const byBasis = new Map<string, Entry[]>();
  for (const entry of entries) {
    const group = byBasis.get(entry.earningBasisId) ?? [];
    group.push(entry);
    byBasis.set(entry.earningBasisId, group);
  }
  let estimated = 0n,
    pending = 0n,
    estimatedKnown = true,
    pendingKnown = true;
  const processed = new Set<Entry>();
  for (const basis of bases) {
    const group = byBasis.get(basis.id) ?? [];
    const teaching = teachingById.get(basis.teachingRecordId);
    const unique =
      basisIds.get(basis.id) === 1 &&
      basisTeachingIds.get(basis.teachingRecordId) === 1 &&
      teachingIds.get(basis.teachingRecordId) === 1 &&
      !!teaching &&
      lessonIds.get(teaching.lessonSessionId) === 1 &&
      group.every((entry) => entryIds.get(entry.id) === 1);
    const value = contribution(campusId, basis, teaching, group, unique);
    for (const entry of group) processed.add(entry);
    if (!value) {
      estimatedKnown = false;
      if (
        group.some(
          (entry) =>
            entry.campusId === campusId && entry.status === 'PENDING_REVIEW',
        )
      )
        pendingKnown = false;
    } else {
      estimated += BigInt(value.estimated);
      pending += BigInt(value.pending);
    }
  }
  for (const teaching of teachings)
    if (basisTeachingIds.get(teaching.id) !== 1) estimatedKnown = false;
  for (const entry of entries) {
    if (processed.has(entry)) continue;
    estimatedKnown = false;
    if (entry.campusId === campusId && entry.status === 'PENDING_REVIEW')
      pendingKnown = false;
  }
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  const number = (value: bigint, known: boolean) =>
    known && value >= -limit && value <= limit ? Number(value) : null;
  return {
    estimatedTotalFen: number(estimated, estimatedKnown),
    pendingReviewFen: number(pending, pendingKnown),
    currency: 'CNY' as const,
  };
}
