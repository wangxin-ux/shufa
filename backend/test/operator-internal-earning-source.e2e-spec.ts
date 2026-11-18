import { Prisma } from '@prisma/client';
import { readOperatorInternalEarningSummary } from '../src/modules/operator/operator-internal-earning-source';

const campusId = '11111111-1111-4111-8111-111111111111';
const outsideCampusId = '22222222-2222-4222-8222-222222222222';
const completedAt = new Date('2026-10-10T00:00:00.000Z');

function fixture() {
  const rule = {
    id: 'rule-1',
    campusId,
    scopeKey: `campus:${campusId}:partner`,
    version: 1,
    unitPriceFen: 1000,
    shareBasisPoints: 4000,
    eligibleLessonKinds: ['REGULAR'],
    countedAttendanceStatuses: ['PRESENT'],
    settlementDelayDays: 0,
  };
  const teaching = {
    id: 'teaching-1',
    campusId,
    lessonSessionId: 'lesson-1',
    teacherId: 'teacher-1',
    lessonUnits: 100,
    attendeeCount: 1,
    status: 'COMPLETED',
    completedAt,
    lessonSession: {
      id: 'lesson-1',
      campusId,
      teacherId: 'teacher-1',
      kind: 'REGULAR',
      lessonUnits: 100,
      status: 'COMPLETED',
      teacher: { campusId },
      classGroup: { campusId },
    },
  };
  const basis = {
    id: 'basis-1',
    campusId,
    teachingRecordId: teaching.id,
    lessonSessionId: teaching.lessonSessionId,
    selectedRuleId: rule.id as string | null,
    lessonKind: 'REGULAR',
    lessonUnits: 100,
    actualAttendeeCount: 1,
    countedAttendeeCount: 1,
    attendanceSnapshot: [{ studentId: 'student-1', status: 'PRESENT' }],
    completedAt,
    status: 'PRICED',
    selectedRule: rule as typeof rule | null,
  };
  const snapshot = {
    ruleId: rule.id,
    ruleVersion: rule.version,
    unitPriceFen: rule.unitPriceFen,
    shareBasisPoints: rule.shareBasisPoints,
    eligibleLessonKinds: rule.eligibleLessonKinds,
    countedAttendanceStatuses: rule.countedAttendanceStatuses,
    settlementDelayDays: 0,
    lessonKind: 'REGULAR',
    lessonUnits: 100,
    actualAttendeeCount: 1,
    countedAttendeeCount: 1,
    perAttendeeAmountFen: 400,
    amountFen: 400,
  };
  const entry = {
    id: 'entry-1',
    campusId,
    earningBasisId: basis.id,
    entryType: 'ACCRUAL',
    amountFen: 400,
    status: 'PENDING_REVIEW',
    reversalOfId: null as string | null,
    reversedBy: null as {
      id: string;
      campusId: string;
      earningBasisId: string;
      entryType: string;
      status: string;
      reversalOfId: string | null;
    } | null,
    ruleSnapshot: snapshot,
  };
  return { rule, teaching, basis, entry };
}

type Fixture = ReturnType<typeof fixture>;
function reader(
  teachings: Fixture['teaching'][] = [],
  bases: Fixture['basis'][] = [],
  entries: Fixture['entry'][] = [],
) {
  const teachingRead = jest.fn(() => Promise.resolve(teachings));
  const basisRead = jest.fn(() => Promise.resolve(bases));
  const entryRead = jest.fn(() => Promise.resolve(entries));
  const tx = {
    teachingRecord: { findMany: teachingRead },
    partnerEarningBasis: { findMany: basisRead },
    partnerEarningEntry: { findMany: entryRead },
  } as unknown as Prisma.TransactionClient;
  return { tx, teachingRead, basisRead, entryRead };
}
const known = (estimatedTotalFen = 0, pendingReviewFen = 0) => ({
  estimatedTotalFen,
  pendingReviewFen,
  currency: 'CNY',
});
const unknown = {
  estimatedTotalFen: null,
  pendingReviewFen: null,
  currency: 'CNY',
};
const incomplete = { ...unknown, pendingReviewFen: 0 };
function one(value = fixture()) {
  return reader([value.teaching], [value.basis], [value.entry]);
}
function reverse(value: Fixture) {
  value.teaching.status = 'REVERSED';
  value.teaching.lessonSession.status = 'REVERSED';
  value.basis.status = 'REVERSED';
  value.entry.status = 'REVERSED';
  const reversal = {
    ...value.entry,
    id: 'reversal-1',
    entryType: 'REVERSAL',
    amountFen: -value.entry.amountFen,
    reversalOfId: value.entry.id,
  };
  value.entry.reversedBy = {
    id: reversal.id,
    campusId: reversal.campusId,
    earningBasisId: reversal.earningBasisId,
    entryType: reversal.entryType,
    status: reversal.status,
    reversalOfId: reversal.reversalOfId,
  };
  return reversal;
}

describe('operator internal earning source with memory transactions only', () => {
  it('returns reliable zero only when the covered system history is empty', async () => {
    const env = reader();
    await expect(
      readOperatorInternalEarningSummary(env.tx, campusId),
    ).resolves.toEqual(known());
    expect(env.teachingRead).toHaveBeenCalledTimes(1);
    expect(env.basisRead).toHaveBeenCalledTimes(1);
    expect(env.entryRead).toHaveBeenCalledTimes(1);
  });

  it.each(['', ' ', undefined])(
    'rejects an absent campus scope before any read: %s',
    async (scope) => {
      const env = reader();
      await expect(
        readOperatorInternalEarningSummary(env.tx, scope as string),
      ).rejects.toThrow('campus scope');
      expect(env.teachingRead).not.toHaveBeenCalled();
      expect(env.basisRead).not.toHaveBeenCalled();
      expect(env.entryRead).not.toHaveBeenCalled();
    },
  );

  it.each<[string, number, number]>([
    ['PENDING_REVIEW', 400, 400],
    ['AVAILABLE', 400, 0],
    ['REJECTED', 0, 0],
  ])(
    'uses original %s status without disclosing the source',
    async (status, total, pending) => {
      const value = fixture();
      value.entry.status = status;
      await expect(
        readOperatorInternalEarningSummary(one(value).tx, campusId),
      ).resolves.toEqual(known(total, pending));
    },
  );

  it('does not treat a completed unpriced lesson with no entries as zero', async () => {
    const value = fixture();
    value.basis.status = 'UNPRICED';
    value.basis.selectedRuleId = null;
    value.basis.selectedRule = null;
    value.basis.countedAttendeeCount = 0;
    await expect(
      readOperatorInternalEarningSummary(
        reader([value.teaching], [value.basis]).tx,
        campusId,
      ),
    ).resolves.toEqual(incomplete);
  });

  it('recognizes an originally priced zero after per-person rounding', async () => {
    const value = fixture();
    value.rule.unitPriceFen = 1;
    value.rule.shareBasisPoints = 1;
    await expect(
      readOperatorInternalEarningSummary(
        reader([value.teaching], [value.basis]).tx,
        campusId,
      ),
    ).resolves.toEqual(known());
  });

  it('recognizes original exclusion of the lesson kind and zero counted attendees', async () => {
    const value = fixture();
    value.rule.eligibleLessonKinds = ['MAKEUP'];
    value.basis.countedAttendeeCount = 0;
    await expect(
      readOperatorInternalEarningSummary(
        reader([value.teaching], [value.basis]).tx,
        campusId,
      ),
    ).resolves.toEqual(known());
  });

  it('continues using the selected historical rule instead of any current rule query', async () => {
    const value = fixture();
    Object.assign(value.rule, { status: 'RETIRED' });
    await expect(
      readOperatorInternalEarningSummary(one(value).tx, campusId),
    ).resolves.toEqual(known(400, 400));
  });

  it('marks missing basis coverage and missing positive accrual as unknown', async () => {
    const value = fixture();
    for (const env of [
      reader([value.teaching]),
      reader([value.teaching], [value.basis]),
    ]) {
      await expect(
        readOperatorInternalEarningSummary(env.tx, campusId),
      ).resolves.toEqual(incomplete);
    }
  });

  it('marks an orphan basis or orphan own-campus entry as unknown', async () => {
    const value = fixture();
    for (const env of [
      reader([], [value.basis], [value.entry]),
      reader([], [], [value.entry]),
    ]) {
      await expect(
        readOperatorInternalEarningSummary(env.tx, campusId),
      ).resolves.toEqual(unknown);
    }
  });

  it.each(['basis', 'entry', 'rule', 'lesson'])(
    'rejects cross-campus %s relationships without exposing their values',
    async (target) => {
      const value = fixture();
      if (target === 'basis') value.basis.campusId = outsideCampusId;
      if (target === 'entry') value.entry.campusId = outsideCampusId;
      if (target === 'rule') value.rule.campusId = outsideCampusId;
      if (target === 'lesson')
        value.teaching.lessonSession.campusId = outsideCampusId;
      const result = await readOperatorInternalEarningSummary(
        one(value).tx,
        campusId,
      );
      expect(result).toEqual(target === 'entry' ? incomplete : unknown);
      expect(Object.keys(result).sort()).toEqual([
        'currency',
        'estimatedTotalFen',
        'pendingReviewFen',
      ]);
    },
  );

  it.each(['teacher', 'class'])(
    'retains frozen earnings after the current %s moves campus',
    async (target) => {
      const value = fixture();
      if (target === 'teacher')
        value.teaching.lessonSession.teacher.campusId = outsideCampusId;
      else value.teaching.lessonSession.classGroup.campusId = outsideCampusId;
      await expect(
        readOperatorInternalEarningSummary(one(value).tx, campusId),
      ).resolves.toEqual(known(400, 400));
    },
  );

  it.each(['statuses', 'kinds', 'snapshot-only'])(
    'accepts historically legal duplicate enum members: %s',
    async (target) => {
      const value = fixture();
      if (target === 'statuses')
        value.rule.countedAttendanceStatuses = ['PRESENT', 'PRESENT'];
      else if (target === 'kinds')
        value.rule.eligibleLessonKinds = ['REGULAR', 'REGULAR'];
      value.entry.ruleSnapshot.countedAttendanceStatuses =
        target === 'snapshot-only'
          ? ['PRESENT', 'PRESENT']
          : value.rule.countedAttendanceStatuses;
      value.entry.ruleSnapshot.eligibleLessonKinds =
        value.rule.eligibleLessonKinds;
      await expect(
        readOperatorInternalEarningSummary(one(value).tx, campusId),
      ).resolves.toEqual(known(400, 400));
    },
  );

  it('does not trust duplicated or inconsistent frozen attendance', async () => {
    for (const mutate of [
      (value: Fixture) =>
        value.basis.attendanceSnapshot.push(value.basis.attendanceSnapshot[0]),
      (value: Fixture) => {
        value.basis.actualAttendeeCount = 2;
      },
      (value: Fixture) => {
        value.basis.countedAttendeeCount = 2;
      },
      (value: Fixture) => {
        value.basis.attendanceSnapshot[0].status = 'UNKNOWN';
      },
    ]) {
      const value = fixture();
      mutate(value);
      await expect(
        readOperatorInternalEarningSummary(one(value).tx, campusId),
      ).resolves.toEqual(unknown);
    }
  });

  it('does not trust a replaced historical snapshot or mismatched amount', async () => {
    for (const mutate of [
      (value: Fixture) => {
        value.entry.ruleSnapshot.ruleVersion = 2;
      },
      (value: Fixture) => {
        value.entry.ruleSnapshot.unitPriceFen = 1001;
      },
      (value: Fixture) => {
        value.entry.ruleSnapshot.amountFen = 401;
      },
      (value: Fixture) => {
        value.entry.amountFen = 401;
      },
      (value: Fixture) => {
        value.basis.completedAt = new Date('2026-10-11T00:00:00Z');
      },
    ]) {
      const value = fixture();
      mutate(value);
      await expect(
        readOperatorInternalEarningSummary(one(value).tx, campusId),
      ).resolves.toEqual(unknown);
    }
  });

  it('preserves reliable registered pending zero when only available sources are damaged', async () => {
    const value = fixture();
    value.entry.status = 'AVAILABLE';
    value.entry.ruleSnapshot.amountFen = 401;
    await expect(
      readOperatorInternalEarningSummary(one(value).tx, campusId),
    ).resolves.toEqual(incomplete);
  });

  it('excludes a structurally valid rejected entry without repricing its damaged snapshot', async () => {
    const value = fixture();
    value.entry.status = 'REJECTED';
    value.entry.ruleSnapshot.amountFen = 401;
    value.entry.ruleSnapshot.shareBasisPoints = 0;
    await expect(
      readOperatorInternalEarningSummary(one(value).tx, campusId),
    ).resolves.toEqual(known());
  });

  it('still detects a duplicate accrual when one entry is rejected', async () => {
    const value = fixture();
    value.entry.status = 'REJECTED';
    const extra = { ...value.entry, id: 'duplicate-entry' };
    await expect(
      readOperatorInternalEarningSummary(
        reader([value.teaching], [value.basis], [value.entry, extra]).tx,
        campusId,
      ),
    ).resolves.toEqual(incomplete);
  });

  it('allows the original rule to count leave in addition to actual present attendees', async () => {
    const value = fixture();
    value.rule.countedAttendanceStatuses = ['PRESENT', 'LEAVE'];
    value.basis.attendanceSnapshot.push({
      studentId: 'student-2',
      status: 'LEAVE',
    });
    value.basis.countedAttendeeCount = 2;
    value.entry.amountFen = 800;
    value.entry.ruleSnapshot.countedAttendeeCount = 2;
    value.entry.ruleSnapshot.countedAttendanceStatuses = ['PRESENT', 'LEAVE'];
    value.entry.ruleSnapshot.amountFen = 800;
    await expect(
      readOperatorInternalEarningSummary(one(value).tx, campusId),
    ).resolves.toEqual(known(800, 800));
  });

  it('nets a complete reversal pair without deducting the original twice', async () => {
    const value = fixture();
    const reversal = reverse(value);
    await expect(
      readOperatorInternalEarningSummary(
        reader([value.teaching], [value.basis], [value.entry, reversal]).tx,
        campusId,
      ),
    ).resolves.toEqual(known());
  });

  it('does not claim zero for missing, duplicate or invalid reversal links', async () => {
    const value = fixture();
    const reversal = reverse(value);
    for (const entries of [
      [value.entry],
      [value.entry, { ...reversal, reversalOfId: 'another-entry' }],
      [value.entry, { ...reversal, amountFen: -399 }],
      [value.entry, reversal, { ...reversal, id: 'second-reversal' }],
    ]) {
      await expect(
        readOperatorInternalEarningSummary(
          reader([value.teaching], [value.basis], entries).tx,
          campusId,
        ),
      ).resolves.toEqual(incomplete);
    }
  });

  it.each(['PENDING_REVIEW', 'AVAILABLE', 'REJECTED'])(
    'detects an incoming outside-basis reversal for a %s original',
    async (status) => {
      const value = fixture();
      value.entry.status = status;
      value.entry.reversedBy = {
        id: 'outside-reversal',
        campusId: outsideCampusId,
        earningBasisId: 'outside-basis',
        entryType: 'REVERSAL',
        status: 'REVERSED',
        reversalOfId: value.entry.id,
      };
      const env = one(value);
      await expect(
        readOperatorInternalEarningSummary(env.tx, campusId),
      ).resolves.toEqual(status === 'PENDING_REVIEW' ? unknown : incomplete);
      const calls = env.entryRead.mock.calls as unknown as Array<
        [{ select: Prisma.PartnerEarningEntrySelect }]
      >;
      expect(calls[0][0].select.reversedBy).toEqual({
        select: {
          id: true,
          campusId: true,
          earningBasisId: true,
          entryType: true,
          status: true,
          reversalOfId: true,
        },
      });
    },
  );

  it('requires the inverse reference to match the covered reversal pair', async () => {
    const value = fixture();
    const reversal = reverse(value);
    value.entry.reversedBy!.earningBasisId = 'another-basis';
    await expect(
      readOperatorInternalEarningSummary(
        reader([value.teaching], [value.basis], [value.entry, reversal]).tx,
        campusId,
      ),
    ).resolves.toEqual(incomplete);
  });

  it('returns zero for a reversed unpriced lesson with no monetary facts', async () => {
    const value = fixture();
    reverse(value);
    value.basis.selectedRuleId = null;
    value.basis.selectedRule = null;
    value.basis.countedAttendeeCount = 0;
    await expect(
      readOperatorInternalEarningSummary(
        reader([value.teaching], [value.basis]).tx,
        campusId,
      ),
    ).resolves.toEqual(known());
  });

  it('returns zero for a reversed originally priced zero', async () => {
    const value = fixture();
    reverse(value);
    value.rule.unitPriceFen = 1;
    value.rule.shareBasisPoints = 1;
    await expect(
      readOperatorInternalEarningSummary(
        reader([value.teaching], [value.basis]).tx,
        campusId,
      ),
    ).resolves.toEqual(known());
  });

  it('fails closed when a reversed teaching record still has a priced basis', async () => {
    const value = fixture();
    value.teaching.status = 'REVERSED';
    value.teaching.lessonSession.status = 'REVERSED';
    await expect(
      readOperatorInternalEarningSummary(one(value).tx, campusId),
    ).resolves.toEqual(unknown);
  });

  it('keeps overflow isolated to the affected final aggregate using integer accumulation', async () => {
    const high = (prefix: string, status: string) => {
      const value = fixture();
      value.rule.id = `${prefix}-rule`;
      value.rule.unitPriceFen = Number.MAX_SAFE_INTEGER - 5000;
      value.rule.shareBasisPoints = 1;
      value.teaching.id = `${prefix}-teaching`;
      value.teaching.lessonSessionId = `${prefix}-lesson`;
      value.teaching.lessonSession.id = value.teaching.lessonSessionId;
      value.teaching.attendeeCount = 5001;
      value.basis.id = `${prefix}-basis`;
      value.basis.teachingRecordId = value.teaching.id;
      value.basis.lessonSessionId = value.teaching.lessonSessionId;
      value.basis.selectedRuleId = value.rule.id;
      value.basis.actualAttendeeCount = 5001;
      value.basis.countedAttendeeCount = 5001;
      value.basis.attendanceSnapshot = Array.from(
        { length: 5001 },
        (_, index) => ({
          studentId: `${prefix}-student-${index}`,
          status: 'PRESENT',
        }),
      );
      const perAttendee = Math.floor((value.rule.unitPriceFen + 5000) / 10000);
      value.entry.id = `${prefix}-entry`;
      value.entry.earningBasisId = value.basis.id;
      value.entry.status = status;
      value.entry.amountFen = perAttendee * 5001;
      Object.assign(value.entry.ruleSnapshot, {
        ruleId: value.rule.id,
        unitPriceFen: value.rule.unitPriceFen,
        shareBasisPoints: 1,
        actualAttendeeCount: 5001,
        countedAttendeeCount: 5001,
        perAttendeeAmountFen: perAttendee,
        amountFen: value.entry.amountFen,
      });
      return value;
    };
    // Synthetic numeric boundaries isolate the JavaScript aggregate; this is not a PostgreSQL fixture.
    const available = high('available', 'AVAILABLE');
    const pending = high('pending', 'PENDING_REVIEW');
    const env = reader(
      [available.teaching, pending.teaching],
      [available.basis, pending.basis],
      [available.entry, pending.entry],
    );
    await expect(
      readOperatorInternalEarningSummary(env.tx, campusId),
    ).resolves.toEqual({
      ...incomplete,
      pendingReviewFen: pending.entry.amountFen,
    });
    available.entry.status = 'PENDING_REVIEW';
    await expect(
      readOperatorInternalEarningSummary(env.tx, campusId),
    ).resolves.toEqual(unknown);
  });

  it('does not accept an unsafe individual pending amount', async () => {
    const value = fixture();
    value.entry.amountFen = Number.MAX_SAFE_INTEGER + 1;
    await expect(
      readOperatorInternalEarningSummary(one(value).tx, campusId),
    ).resolves.toEqual(unknown);
  });

  it('keeps scope on complete campus history without current-student or status filters', async () => {
    const env = one();
    await readOperatorInternalEarningSummary(env.tx, campusId);
    for (const call of [env.teachingRead, env.basisRead, env.entryRead]) {
      const args = call.mock.calls as unknown as Array<
        [{ where: unknown; select: unknown }]
      >;
      const serialized = JSON.stringify(args[0][0].where);
      expect(serialized).toContain(campusId);
      expect(serialized).not.toMatch(
        /isActive|student|PENDING_REVIEW|AVAILABLE|REJECTED/,
      );
    }
  });
});
