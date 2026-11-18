import type { Prisma } from '@prisma/client';
import {
  buildAccountFixture,
  type AccountFixtureInput,
} from './operator-pdf-test-account-fixture-builder';
import {
  buildAccountGraph,
  accountHistoryAdmission,
} from './operator-pdf-test-account-fixture-graphs';
import {
  accountFixtureId,
  accountFixtureOrder,
  type AdapterRow,
} from './operator-pdf-test-account-adapter-schema';

export const MAIN_GRAPHS = [
  'baseline',
  'expired',
  'inactive',
  'departed',
  'paid-unissued',
  'pending-refund',
  'approved-unpaid-refund',
  'executed-refund',
  'effective-correction',
  'invalid-historical',
  'unknown-pending',
] as const;
export type MainGraph = (typeof MAIN_GRAPHS)[number];

export function buildMainFixture(
  input: AccountFixtureInput,
  dmmf: Prisma.DMMF.Datamodel,
  graph: MainGraph,
) {
  const accountGraph = graph === 'unknown-pending' ? 'baseline' : graph;
  accountHistoryAdmission(accountGraph);
  if (!MAIN_GRAPHS.includes(graph))
    throw new Error('Main fixture graph blocked');
  const plan = buildAccountGraph(
    buildAccountFixture(input, dmmf),
    accountGraph,
    dmmf,
  );
  const records = plan.records;
  const id = (key: string) =>
    accountFixtureId(input.windowId, input.executionId, 'E02', key);
  const source = (key: string) => {
    const row = records.find((row) => row.key === key);
    if (!row) throw new Error(`Missing main fixture source ${key}`);
    return row.data;
  };
  const now = input.syntheticNow.getTime();
  const time = (index: number) => new Date(now - 7 * 86400000 + index * 60000);
  const add = (table: string, key: string, data: AdapterRow) => {
    records.push({ table, key, data: { ...data, id: id(key) } });
    return id(key);
  };
  const campusId = plan.ids.campusA;
  const teacherId = source('teacher-profile').id;
  const reviewer = source('user-finance-reviewer').id;
  const ruleId = add('PartnerEarningRule', 'earning-rule', {
    campusId,
    scopeKey: `campus:${campusId}:partner`,
    unitPriceFen: 2000,
    shareBasisPoints: 5000,
    eligibleLessonKinds: ['REGULAR'],
    countedAttendanceStatuses: ['PRESENT'],
    settlementDelayDays: 0,
    version: 1,
    status: 'ACTIVE',
    effectiveFrom: time(-10),
    effectiveTo: null,
    createdByUserId: reviewer,
    createdAt: time(-10),
    updatedAt: time(-10),
  });
  for (let index = 0; index < 24; index++) {
    const reversed = index === 23;
    const status =
      index < 21
        ? 'PENDING_REVIEW'
        : index === 21
          ? 'AVAILABLE'
          : index === 22
            ? 'REJECTED'
            : 'REVERSED';
    const completedAt = time(index);
    const lessonSessionId = add('LessonSession', `earning-lesson-${index}`, {
      ...source('lesson-1'),
      campusId,
      teacherId,
      kind: 'REGULAR',
      startsAt: new Date(completedAt.getTime() - 3600000),
      endsAt: completedAt,
      completedAt,
      lessonUnits: 100,
      status: reversed ? 'REVERSED' : 'COMPLETED',
      reversedAt: reversed ? time(30) : null,
      reversalReason: reversed ? 'Synthetic E02 inverse' : null,
      createdAt: completedAt,
      updatedAt: completedAt,
    });
    const teachingRecordId = add(
      'TeachingRecord',
      `earning-teaching-${index}`,
      {
        campusId,
        lessonSessionId,
        teacherId,
        status: reversed ? 'REVERSED' : 'COMPLETED',
        attendeeCount: 1,
        lessonUnits: 100,
        recordedByUserId: source('user-teacher').id,
        completedAt,
        reversedAt: reversed ? time(30) : null,
        reversalReason: reversed ? 'Synthetic E02 inverse' : null,
        createdAt: completedAt,
        updatedAt: completedAt,
      },
    );
    const earningBasisId = add(
      'PartnerEarningBasis',
      `earning-basis-${index}`,
      {
        campusId,
        teachingRecordId,
        lessonSessionId,
        selectedRuleId: ruleId,
        lessonKind: 'REGULAR',
        lessonUnits: 100,
        actualAttendeeCount: 1,
        countedAttendeeCount: 1,
        attendanceSnapshot: [
          { studentId: plan.ids.studentA, status: 'PRESENT' },
        ],
        completedAt,
        status: reversed ? 'REVERSED' : 'PRICED',
        createdAt: completedAt,
        updatedAt: completedAt,
      },
    );
    const ruleSnapshot = {
      ruleId,
      ruleVersion: 1,
      unitPriceFen: 2000,
      shareBasisPoints: 5000,
      eligibleLessonKinds: ['REGULAR'],
      countedAttendanceStatuses: ['PRESENT'],
      settlementDelayDays: 0,
      lessonKind: 'REGULAR',
      lessonUnits: 100,
      actualAttendeeCount: 1,
      countedAttendeeCount: 1,
      perAttendeeAmountFen: 1000,
      amountFen: 1000,
    };
    if (graph === 'unknown-pending' && index === 0)
      ruleSnapshot.ruleVersion = 2;
    const entry = {
      campusId,
      earningBasisId,
      entryType: 'ACCRUAL',
      status,
      amountFen: index === 22 ? 1900 : 1000,
      ruleSnapshot,
      reviewableAt: completedAt,
      reviewedByUserId: status === 'PENDING_REVIEW' ? null : reviewer,
      reviewedAt: status === 'PENDING_REVIEW' ? null : completedAt,
      reviewReason:
        status === 'REJECTED' ? 'Synthetic rejection preserves original' : null,
      reversalOfId: null,
      version: 1,
      createdAt: time(index),
      updatedAt: time(index),
    };
    const accrualId = add(
      'PartnerEarningEntry',
      `earning-entry-${index}`,
      entry,
    );
    if (reversed)
      add('PartnerEarningEntry', 'earning-reversal', {
        ...entry,
        entryType: 'REVERSAL',
        amountFen: -1000,
        reversalOfId: accrualId,
        createdAt: time(31),
        updatedAt: time(31),
      });
  }
  if (graph === 'invalid-historical') {
    const lessonSessionId = add('LessonSession', 'earning-unpriced-lesson', {
      ...source('lesson-1'),
      kind: 'REGULAR',
      lessonUnits: 100,
    });
    const teachingRecordId = add(
      'TeachingRecord',
      'earning-unpriced-teaching',
      {
        ...source('earning-teaching-0'),
        lessonSessionId,
      },
    );
    add('PartnerEarningBasis', 'earning-unpriced-basis', {
      ...source('earning-basis-0'),
      lessonSessionId,
      teachingRecordId,
      selectedRuleId: null,
      status: 'UNPRICED',
      countedAttendeeCount: 0,
    });
  }
  accountFixtureOrder(records, dmmf);
  return {
    ...plan,
    mainGraph: graph,
    earnings: {
      estimatedTotalFen:
        graph === 'invalid-historical' || graph === 'unknown-pending'
          ? null
          : 22000,
      pendingReviewFen: graph === 'unknown-pending' ? null : 21000,
      currency: 'CNY' as const,
    },
  };
}
export type MainFixture = ReturnType<typeof buildMainFixture>;
