import type { Prisma } from '@prisma/client';
import type { PartnerEnrollmentSummary } from '../src/modules/partner/partner-enrollment-summary';

const { readCampusEnrollmentSummary, readPartnerEnrollmentSummary } =
  jest.requireActual<{
    readCampusEnrollmentSummary: (
      tx: Prisma.TransactionClient,
      campusId: string,
    ) => Promise<PartnerEnrollmentSummary>;
    readPartnerEnrollmentSummary: (
      tx: Prisma.TransactionClient,
      campusId: string,
      studentId: string,
    ) => Promise<PartnerEnrollmentSummary>;
  }>('../src/modules/partner/partner-enrollment-summary');

type Row = Record<string, unknown>;
const zero = {
  receivedAmountFen: 0,
  refundedAmountFen: 0,
  initialMainUnits: 0,
  initialGiftUnits: 0,
  pendingIssuanceCount: 0,
};
const allUnknown = {
  receivedAmountFen: null,
  refundedAmountFen: null,
  initialMainUnits: null,
  initialGiftUnits: null,
};
function source({
  receipts = [],
  packages = [],
  orders = [],
  members = [],
  corrections = [],
}: {
  receipts?: Row[];
  packages?: Row[];
  orders?: Row[];
  members?: Row[];
  corrections?: Row[];
} = {}) {
  const delegate = (rows: Row[]) => ({
    findMany: jest.fn(({ where }: { where: Row }) =>
      Promise.resolve(
        rows.filter(
          (row) =>
            (where.campusId === undefined || row.campusId === where.campusId) &&
            (where.studentId === undefined ||
              row.studentId === where.studentId),
        ),
      ),
    ),
  });
  const db = {
    financeReceipt: delegate(receipts),
    coursePackage: delegate(packages),
    enrollmentOrder: delegate(orders),
    groupMember: delegate(members),
    financeReceiptCorrection: {
      findMany: jest.fn(() => Promise.resolve(corrections)),
    },
    student: {
      findMany: jest.fn(() => {
        throw new Error(
          'Historical campus totals must not use current students',
        );
      }),
    },
  };
  return { db, tx: db as unknown as Prisma.TransactionClient };
}
function enrollment(
  name: string,
  studentId: string,
  amountFen = 1000,
  main = 100,
  gift = 0,
  campusId = 'campus-a',
) {
  const packId = `package-${name}`;
  const receiptId = `receipt-${name}`;
  const issuanceId = `issuance-${name}`;
  const grants = (['MAIN', 'GIFT'] as const)
    .map((bucket) => ({ bucket, units: bucket === 'MAIN' ? main : gift }))
    .filter(({ units }) => units !== 0)
    .map(({ bucket, units }) => ({
      campusId,
      studentId,
      bucket,
      deltaUnits: units,
      balanceBeforeUnits: 0,
      balanceAfterUnits: units,
      lessonSessionId: null,
      reversalOfId: null,
      financeRefundId: null,
      financeCorrectionId: null,
    }));
  const pack = {
    id: packId,
    campusId,
    studentId,
    isActive: false,
    sourceOrderId: null,
    financeIssuance: { id: issuanceId },
    lessonLedger: grants,
  };
  const receipt = {
    id: receiptId,
    campusId,
    studentId,
    amountFen,
    replacementForCorrection: null,
    issuance: {
      id: issuanceId,
      coursePackageId: packId,
      originalAmountFen: amountFen,
      initialMainUnits: main,
      initialGiftUnits: gift,
      refunds: [] as Row[],
    },
  };
  return { pack, receipt };
}

function groupEnrollment(name: string, studentId: string) {
  const { pack } = enrollment(name, studentId, 1000, 100, 10);
  const orderId = `order-${name}`;
  const memberId = `member-${name}`;
  const paymentId = `payment-${name}`;
  const campaignId = `campaign-${name}`;
  const paidAt = new Date('2026-01-02T00:00:00Z');
  const member = {
    id: memberId,
    campusId: 'campus-a',
    studentId,
    parentUserId: 'parent-a',
    enrollmentOrderId: orderId,
    status: 'SETTLED',
    paidAt,
    settledAt: paidAt,
    grantedMainUnits: 100,
    grantedGiftUnits: 10,
    campaign: { campusId: 'campus-a' },
    team: { campaignId },
    campaignId,
    transactions: [{ id: paymentId, enrollmentOrderId: orderId }],
  };
  const order = {
    id: orderId,
    campusId: 'campus-a',
    studentId,
    parentUserId: 'parent-a',
    status: 'EFFECTIVE',
    priceFenSnapshot: 1000,
    mainUnitsSnapshot: 100,
    giftUnitsSnapshot: 10,
    groupMember: member,
    paymentTransactions: [
      {
        id: paymentId,
        type: 'PAYMENT',
        amountFen: 1000,
        groupMemberId: memberId,
        enrollmentOrderId: orderId,
        succeededAt: paidAt,
      },
    ],
    coursePackage: { id: pack.id, campusId: 'campus-a', studentId },
  };
  return {
    pack: { ...pack, sourceOrderId: orderId, financeIssuance: null },
    member,
    order,
  };
}

describe('campus enrollment aggregate source, offline only', () => {
  it('returns reliable zero for a campus with no enrollment facts', async () => {
    const { tx, db } = source();
    expect(await readCampusEnrollmentSummary(tx, 'campus-a')).toEqual(zero);
    expect(db.student.findMany).not.toHaveBeenCalled();
  });

  it('includes all historical owners and inactive packages, excluding another campus', async () => {
    const a = enrollment('old', 'moved-student', 1000, 100, 20);
    const b = enrollment('disabled', 'disabled-student', 2000, 200, 0);
    const other = enrollment(
      'other',
      'foreign-student',
      9000,
      900,
      90,
      'campus-b',
    );
    const { tx, db } = source({
      receipts: [a.receipt, b.receipt, other.receipt],
      packages: [a.pack, b.pack, other.pack],
    });
    expect(await readCampusEnrollmentSummary(tx, 'campus-a')).toEqual({
      ...zero,
      receivedAmountFen: 3000,
      initialMainUnits: 300,
      initialGiftUnits: 20,
    });
    for (const table of [
      'financeReceipt',
      'coursePackage',
      'enrollmentOrder',
    ] as const) {
      expect(db[table].findMany).toHaveBeenCalledTimes(1);
      expect(db[table].findMany.mock.calls[0][0].where).toEqual({
        campusId: 'campus-a',
      });
    }
    expect(db.student.findMany).not.toHaveBeenCalled();
  });

  it('preserves the existing per-student scope and amounts', async () => {
    const a = enrollment('a', 'student-a', 1000, 100, 10);
    const b = enrollment('b', 'student-b', 2000, 200, 20);
    const { tx, db } = source({
      receipts: [a.receipt, b.receipt],
      packages: [a.pack, b.pack],
    });
    expect(
      await readPartnerEnrollmentSummary(tx, 'campus-a', 'student-a'),
    ).toEqual({
      ...zero,
      receivedAmountFen: 1000,
      initialMainUnits: 100,
      initialGiftUnits: 10,
    });
    expect(db.financeReceipt.findMany.mock.calls[0][0].where).toEqual({
      campusId: 'campus-a',
      studentId: 'student-a',
    });
  });

  it('does not widen an explicitly supplied empty student scope', async () => {
    const a = enrollment('outside-empty-scope', 'student-a');
    const { tx } = source({ receipts: [a.receipt], packages: [a.pack] });
    expect(await readPartnerEnrollmentSummary(tx, 'campus-a', '')).toEqual(
      zero,
    );
  });

  it('sums legacy group facts for different historical students using each own identity', async () => {
    const a = groupEnrollment('a', 'former-student-a');
    const b = groupEnrollment('b', 'former-student-b');
    const { tx } = source({
      orders: [a.order, b.order],
      packages: [a.pack, b.pack],
      members: [a.member, b.member],
    });
    expect(await readCampusEnrollmentSummary(tx, 'campus-a')).toEqual({
      ...zero,
      receivedAmountFen: 2000,
      initialMainUnits: 200,
      initialGiftUnits: 20,
    });
  });

  it('rejects a cross-student legacy package link in the campus batch', async () => {
    const a = groupEnrollment('wrong', 'order-owner');
    const { tx } = source({
      orders: [a.order],
      members: [a.member],
      packages: [{ ...a.pack, studentId: 'another-owner' }],
    });
    expect(await readCampusEnrollmentSummary(tx, 'campus-a')).toEqual({
      ...zero,
      ...allUnknown,
    });
  });

  it('does not treat an unlinked historical group payment owner as a reliable zero', async () => {
    const a = groupEnrollment('orphan', 'former-student');
    const { tx } = source({ members: [a.member] });
    expect(await readCampusEnrollmentSummary(tx, 'campus-a')).toEqual({
      ...zero,
      ...allUnknown,
    });
  });

  it('includes received money before issuance without inventing original lesson units', async () => {
    const a = enrollment('pending', 'student-a', 2500);
    const { tx } = source({ receipts: [{ ...a.receipt, issuance: null }] });
    expect(await readCampusEnrollmentSummary(tx, 'campus-a')).toEqual({
      ...zero,
      receivedAmountFen: 2500,
      pendingIssuanceCount: 1,
    });
  });

  it('keeps approved reservations separate from matched actually paid refunds', async () => {
    const a = enrollment('refund', 'student-a', 1000);
    a.receipt.issuance.refunds = [
      { status: 'APPROVED', amountFen: 500, payment: null },
      { status: 'PAID', amountFen: 200, payment: { amountFen: 200 } },
    ];
    const { tx } = source({ receipts: [a.receipt], packages: [a.pack] });
    expect(await readCampusEnrollmentSummary(tx, 'campus-a')).toEqual({
      ...zero,
      receivedAmountFen: 1000,
      refundedAmountFen: 200,
      initialMainUnits: 100,
    });
  });

  it('propagates a missing refund payment only to the affected amount', async () => {
    const a = enrollment('bad-refund', 'student-a');
    a.receipt.issuance.refunds = [
      { status: 'PAID', amountFen: 200, payment: null },
    ];
    const { tx } = source({ receipts: [a.receipt], packages: [a.pack] });
    expect(await readCampusEnrollmentSummary(tx, 'campus-a')).toEqual({
      ...zero,
      receivedAmountFen: 1000,
      refundedAmountFen: null,
      initialMainUnits: 100,
    });
  });

  it('does not pair one historical student receipt with another student package', async () => {
    const a = enrollment('wrong-owner', 'receipt-owner');
    const { tx } = source({
      receipts: [a.receipt],
      packages: [{ ...a.pack, studentId: 'another-owner' }],
    });
    expect(await readCampusEnrollmentSummary(tx, 'campus-a')).toEqual({
      ...zero,
      ...allUnknown,
    });
  });

  it('counts an applied replacement once even when it changes the student', async () => {
    const old = enrollment('old', 'student-before', 2000, 200);
    const next = enrollment('new', 'student-after', 3000, 300);
    const { tx } = source({
      receipts: [
        old.receipt,
        { ...next.receipt, replacementForCorrection: { status: 'APPLIED' } },
      ],
      packages: [old.pack, next.pack],
      corrections: [
        {
          id: 'correction-a',
          type: 'REPLACE',
          originalIssuance: { receiptId: old.receipt.id },
          replacementReceiptId: next.receipt.id,
          replacementReceipt: {
            id: next.receipt.id,
            campusId: 'campus-a',
            studentId: 'student-after',
            issuance: {
              coursePackage: {
                campusId: 'campus-a',
                studentId: 'student-after',
              },
            },
          },
        },
      ],
    });
    expect(await readCampusEnrollmentSummary(tx, 'campus-a')).toEqual({
      ...zero,
      receivedAmountFen: 3000,
      initialMainUnits: 300,
    });
  });

  it('does not import the counterpart amounts when a replacement leaves the campus', async () => {
    const old = enrollment('old', 'student-before', 2000, 200);
    const { tx } = source({
      receipts: [old.receipt],
      packages: [old.pack],
      corrections: [
        {
          id: 'correction-out',
          type: 'REPLACE',
          originalIssuance: { receiptId: old.receipt.id },
          replacementReceiptId: 'foreign-receipt',
          replacementReceipt: {
            id: 'foreign-receipt',
            campusId: 'campus-b',
            studentId: 'foreign-student',
            issuance: {
              coursePackage: {
                campusId: 'campus-b',
                studentId: 'foreign-student',
              },
            },
          },
        },
      ],
    });
    expect(await readCampusEnrollmentSummary(tx, 'campus-a')).toEqual(zero);
  });

  it('marks broken correction provenance as unknown rather than adding both versions', async () => {
    const a = enrollment('broken', 'student-a');
    const { tx } = source({
      receipts: [a.receipt],
      packages: [a.pack],
      corrections: [
        {
          id: 'broken-link',
          type: 'REPLACE',
          originalIssuance: { receiptId: a.receipt.id },
          replacementReceiptId: 'missing',
          replacementReceipt: null,
        },
      ],
    });
    expect(await readCampusEnrollmentSummary(tx, 'campus-a')).toEqual({
      ...zero,
      ...allUnknown,
    });
  });

  it('keeps an orphan historical package unknown', async () => {
    const a = enrollment('orphan', 'student-a');
    const { tx } = source({ packages: [a.pack] });
    expect(await readCampusEnrollmentSummary(tx, 'campus-a')).toEqual({
      ...zero,
      ...allUnknown,
    });
  });

  it('does not require an invented zero gift grant', async () => {
    const a = enrollment('no-gift', 'student-a', 0, 0, 0);
    const { tx } = source({ receipts: [a.receipt], packages: [a.pack] });
    expect(await readCampusEnrollmentSummary(tx, 'campus-a')).toEqual(zero);
  });

  it('propagates a missing main grant without destroying a reliable gift value', async () => {
    const a = enrollment('missing-main', 'student-a', 1000, 100, 20);
    a.pack.lessonLedger = a.pack.lessonLedger.filter(
      ({ bucket }) => bucket !== 'MAIN',
    );
    const { tx } = source({ receipts: [a.receipt], packages: [a.pack] });
    expect(await readCampusEnrollmentSummary(tx, 'campus-a')).toEqual({
      ...zero,
      receivedAmountFen: 1000,
      initialMainUnits: null,
      initialGiftUnits: 20,
    });
  });

  it('never rounds an unsafe campus aggregate into an apparently reliable amount', async () => {
    const a = enrollment('max', 'student-a', Number.MAX_SAFE_INTEGER, 0);
    const b = enrollment('one', 'student-b', 1, 0);
    const { tx } = source({
      receipts: [a.receipt, b.receipt],
      packages: [a.pack, b.pack],
    });
    expect(await readCampusEnrollmentSummary(tx, 'campus-a')).toEqual({
      ...zero,
      receivedAmountFen: null,
    });
  });
});
