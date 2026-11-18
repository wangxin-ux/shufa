import type { Prisma } from '@prisma/client';
import type { AccountFixturePlan } from './operator-pdf-test-account-fixture-builder';
import {
  accountClone,
  accountFixtureId,
  accountFixtureOrder,
  type AdapterRecord,
  type AdapterRow,
} from './operator-pdf-test-account-adapter-schema';

export type AccountGraphName =
  | 'baseline'
  | 'expired'
  | 'inactive'
  | 'departed'
  | 'paid-unissued'
  | 'pending-refund'
  | 'approved-unpaid-refund'
  | 'executed-refund'
  | 'effective-correction'
  | 'invalid-historical';
export function accountHistoryAdmission(
  name: string,
): asserts name is AccountGraphName {
  if (name === 'invalid-current' || name === 'historical-overflow')
    throw new Error(
      `E01 history ${name} blocked: legal Int/CHECK fixture requires a separately approved scale; no fabricated provider overflow`,
    );
  if (
    ![
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
    ].includes(name)
  )
    throw new Error('Unknown E01 history graph');
}

export function buildAccountGraph(
  base: AccountFixturePlan,
  name: AccountGraphName,
  dmmf: Prisma.DMMF.Datamodel,
) {
  accountHistoryAdmission(name);
  const records: AdapterRecord[] = accountClone(base.records);
  const expected = accountClone(base.expected);
  const id = (key: string) =>
    accountFixtureId(base.windowId, base.executionId, name, key);
  const row = (key: string) => {
    const found = records.find((row) => row.key === key);
    if (!found) throw new Error(`Missing source graph ${key}`);
    return found.data;
  };
  const add = (table: string, key: string, data: AdapterRow) => {
    records.push({ table, key, data: { ...data, id: id(key) } });
    return id(key);
  };
  if (name === 'paid-unissued') {
    const campaign = add('GroupCampaign', 'pending-campaign', {
      ...row('campaign'),
      code: `e01-${id('pending-campaign')}`,
      status: 'ACTIVE',
    });
    const team = add('GroupTeam', 'pending-team', {
      ...row('team'),
      status: 'OPEN',
      campaignId: campaign,
      finalTier: null,
      settledAt: null,
    });
    const order = add('EnrollmentOrder', 'pending-online-order', {
      ...row('order-online'),
      orderNo: `e01-${id('pending-online-order')}`,
      status: 'PAID',
    });
    const member = add('GroupMember', 'pending-online-member', {
      ...row('member-online'),
      campaignId: campaign,
      teamId: team,
      enrollmentOrderId: order,
      status: 'PAID',
      settledAt: null,
      grantedMainUnits: null,
      grantedGiftUnits: null,
    });
    add('PaymentTransaction', 'pending-online-payment', {
      ...row('payment-online'),
      groupMemberId: member,
      enrollmentOrderId: order,
      outTradeNo: `e01-${id('pending-online-payment')}`,
    });
    expected.enrollmentSummary.receivedAmountFen! += 60000;
    expected.enrollmentSummary.pendingIssuanceCount += 1;
  }
  if (name === 'approved-unpaid-refund')
    Object.assign(row('refund-reserved'), {
      status: 'APPROVED',
      version: 2,
      reviewedByUserId: row('user-finance-reviewer').id,
      reviewedAt: new Date(base.syntheticNow.getTime() - 86400000),
      paymentStartedAt: null,
    });
  // This legal bad source leaves all ledger detail rows valid; enrollment fields become unknown.
  if (name === 'invalid-historical') {
    records.splice(
      records.findIndex((item) => item.key === 'issuance-unclassified'),
      1,
    );
    Object.assign(expected.enrollmentSummary, {
      receivedAmountFen: null,
      refundedAmountFen: null,
      initialMainUnits: null,
      initialGiftUnits: null,
    });
    expected.enrollmentSummary.pendingIssuanceCount += 1;
  }
  if (name === 'effective-correction') {
    const requester = row('user-finance-requester').id,
      reviewer = row('user-finance-reviewer').id;
    const original = row('correction-void');
    let previousIssuance = row('issuance-voided').id;
    for (const [index, campusId, studentId, main, gift, amount] of [
      [0, base.ids.campusB, base.ids.studentB, 1100, 110, 11000],
      [1, base.ids.campusA, base.ids.studentA, 1200, 120, 12000],
    ] as const) {
      const suffix = `replacement-${index}`;
      const proof = add('StoredFile', `${suffix}-proof`, {
        ...row('proof-voided'),
        storageKey: `synthetic/e01/${base.windowId}/${id(suffix)}`,
      });
      const receipt = add('FinanceReceipt', `${suffix}-receipt`, {
        ...row('receipt-voided'),
        campusId,
        studentId,
        amountFen: amount,
        proofFileId: proof,
      });
      const pack = add('CoursePackage', `${suffix}-pack`, {
        ...row('pack-voided'),
        campusId,
        studentId,
        name: suffix,
        subjectId: null,
        paidAmountFen: amount,
        mainBalanceUnits: index === 0 ? 0 : main,
        giftBalanceUnits: index === 0 ? 0 : gift,
        isActive: index === 1,
      });
      const issuance = add('FinancePackageIssuance', `${suffix}-issuance`, {
        ...row('issuance-voided'),
        receiptId: receipt,
        coursePackageId: pack,
        originalAmountFen: amount,
        initialMainUnits: main,
        initialGiftUnits: gift,
        name: suffix,
      });
      const correctionData: AdapterRow = {
        ...original,
        originalIssuanceId: previousIssuance,
        type: 'REPLACE',
        version: 3,
        replacementReceiptId: receipt,
        proposedProofFileId: proof,
        originalAmountFen: index === 0 ? 10000 : 11000,
        replacementSnapshot: {
          campusId,
          studentId,
          amountFen: amount,
          receivedOn: String(
            row('receipt-voided').receivedOn instanceof Date
              ? (row('receipt-voided').receivedOn as Date)
                  .toISOString()
                  .slice(0, 10)
              : '',
          ),
          channel: 'OTHER',
          proofFileId: proof,
          note: 'Synthetic historical chain',
          package: {
            name: suffix,
            mainUnits: main,
            giftUnits: gift,
            validFrom: (row('pack-voided').validFrom as Date).toISOString(),
            expiresAt: (row('pack-voided').expiresAt as Date).toISOString(),
          },
        },
        requestedByUserId: requester,
        reviewedByUserId: reviewer,
      };
      const correction =
        index === 0
          ? String(original.id)
          : add(
              'FinanceReceiptCorrection',
              `${suffix}-correction`,
              correctionData,
            );
      if (index === 0) Object.assign(original, correctionData);
      for (const [bucket, units] of [
        ['MAIN', main],
        ['GIFT', gift],
      ] as const) {
        const grant = add('LessonLedgerEntry', `${suffix}-grant-${bucket}`, {
          ...row(`grant-voided-${bucket}`),
          campusId,
          studentId,
          coursePackageId: pack,
          subjectId: null,
          subjectName: null,
          deltaUnits: units,
          balanceAfterUnits: units,
          idempotencyKey: id(`${suffix}-${bucket}`),
        });
        if (index === 0)
          add('LessonLedgerEntry', `${suffix}-correct-${bucket}`, {
            ...row(`correct-${bucket}`),
            campusId,
            studentId,
            coursePackageId: pack,
            subjectId: null,
            subjectName: null,
            deltaUnits: -units,
            balanceBeforeUnits: units,
            reversalOfId: grant,
            financeCorrectionId: id('replacement-1-correction'),
            idempotencyKey: id(`${suffix}-correct-${bucket}`),
          });
      }
      void correction;
      previousIssuance = issuance;
    }
    const b = expected.balances;
    b.mainBalanceUnits += 1200;
    b.mainAvailableUnits += 1200;
    b.giftBalanceUnits += 120;
    b.giftAvailableUnits += 120;
    b.totalBalanceUnits += 1320;
    b.availableTotalUnits += 1320;
    expected.enrollmentSummary.receivedAmountFen! += 12000;
    expected.enrollmentSummary.initialMainUnits! += 1200;
    expected.enrollmentSummary.initialGiftUnits! += 120;
    const grant = expected.lessonActivityTotals.find(
      (item) => item.entryType === 'GRANT',
    )!;
    grant.mainDeltaUnits! += 1200;
    grant.giftDeltaUnits! += 120;
    grant.totalDeltaUnits! += 1320;
  }
  // Historical events are synthetic fixture facts, not evidence of finance API execution.
  for (const refund of records.filter(
    (record) => record.table === 'FinanceRefundRequest',
  )) {
    const steps =
      refund.data.status === 'PAID'
        ? [
            ['SUBMIT', null, 'SUBMITTED'],
            ['APPROVE', 'SUBMITTED', 'APPROVED'],
            ['START_PAYMENT', 'APPROVED', 'PAYING'],
            ['RECORD_PAYMENT', 'PAYING', 'PAID'],
          ]
        : refund.data.status === 'APPROVED'
          ? [
              ['SUBMIT', null, 'SUBMITTED'],
              ['APPROVE', 'SUBMITTED', 'APPROVED'],
            ]
          : [['SUBMIT', null, 'SUBMITTED']];
    refund.data.version = steps.length;
    steps.forEach(([action, fromStatus, toStatus], index) => {
      const actor =
        action === 'SUBMIT'
          ? refund.data.requestedByUserId
          : row('user-finance-reviewer').id;
      const occurredAt =
        index === 0
          ? refund.data.createdAt
          : index === 1
            ? refund.data.reviewedAt
            : index === 2
              ? refund.data.paymentStartedAt
              : row('refund-payment').recordedAt;
      add('FinanceRefundEvent', `${refund.key}-event-${index}`, {
        refundId: refund.data.id,
        actorUserId: actor,
        action,
        fromStatus,
        toStatus,
        version: index + 1,
        reason: 'Synthetic history',
        createdAt: occurredAt,
      });
      add('AuditLog', `${refund.key}-audit-${index}`, {
        campusId: base.ids.campusA,
        actorUserId: actor,
        action: `FINANCE_REFUND_${action}`,
        resourceType: 'FinanceRefundRequest',
        resourceId: refund.data.id,
        outcome: 'SUCCESS',
        details: { synthetic: true, fromStatus, toStatus, version: index + 1 },
        createdAt: occurredAt,
      });
    });
  }
  for (const correction of records.filter(
    (record) => record.table === 'FinanceReceiptCorrection',
  )) {
    correction.data.version = 3;
    [
      ['SUBMIT', null, 'SUBMITTED'],
      ['APPROVE', 'SUBMITTED', 'APPROVED'],
      ['APPLY', 'APPROVED', 'APPLIED'],
    ].forEach(([action, fromStatus, toStatus], index) => {
      const actor =
        index === 1
          ? correction.data.reviewedByUserId
          : correction.data.requestedByUserId;
      const issuance = records.find(
        (row) =>
          row.table === 'FinancePackageIssuance' &&
          row.data.id === correction.data.originalIssuanceId,
      )!;
      const receipt = records.find(
        (row) =>
          row.table === 'FinanceReceipt' &&
          row.data.id === issuance.data.receiptId,
      )!;
      const occurredAt =
        index === 0
          ? correction.data.createdAt
          : index === 1
            ? correction.data.reviewedAt
            : correction.data.appliedAt;
      add('FinanceReceiptCorrectionEvent', `${correction.key}-event-${index}`, {
        correctionId: correction.data.id,
        actorUserId: actor,
        action,
        fromStatus,
        toStatus,
        version: index + 1,
        reason: 'Synthetic history',
        createdAt: occurredAt,
      });
      add('AuditLog', `${correction.key}-audit-${index}`, {
        campusId: receipt.data.campusId,
        actorUserId: actor,
        action: `FINANCE_CORRECTION_${action}`,
        resourceType: 'FinanceReceiptCorrection',
        resourceId: correction.data.id,
        outcome: 'SUCCESS',
        details: { synthetic: true, fromStatus, toStatus },
        createdAt: occurredAt,
      });
    });
  }
  accountFixtureOrder(records, dmmf);
  return { ...base, records, expected, graph: name };
}
