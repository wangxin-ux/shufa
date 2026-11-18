import type { Prisma } from '@prisma/client';

export interface PartnerEnrollmentSummary {
  receivedAmountFen: number | null;
  refundedAmountFen: number | null;
  initialMainUnits: number | null;
  initialGiftUnits: number | null;
  pendingIssuanceCount: number;
}

const grantSelect = {
  campusId: true,
  studentId: true,
  bucket: true,
  deltaUnits: true,
  balanceBeforeUnits: true,
  balanceAfterUnits: true,
  lessonSessionId: true,
  reversalOfId: true,
  financeRefundId: true,
  financeCorrectionId: true,
} satisfies Prisma.LessonLedgerEntrySelect;

const correctionSelect = {
  id: true,
  type: true,
  replacementReceiptId: true,
  originalIssuance: { select: { receiptId: true } },
  replacementReceipt: {
    select: {
      id: true,
      campusId: true,
      studentId: true,
      issuance: {
        select: {
          coursePackage: { select: { campusId: true, studentId: true } },
        },
      },
    },
  },
} satisfies Prisma.FinanceReceiptCorrectionSelect;

type Correction = Prisma.FinanceReceiptCorrectionGetPayload<{
  select: typeof correctionSelect;
}>;
type Grant = Prisma.LessonLedgerEntryGetPayload<{ select: typeof grantSelect }>;

function add(total: number | null, amount: number | null): number | null {
  if (
    total === null ||
    amount === null ||
    !Number.isSafeInteger(amount) ||
    amount < 0
  )
    return null;
  const result = total + amount;
  return Number.isSafeInteger(result) ? result : null;
}

function initialBucket(
  grants: Grant[],
  bucket: 'MAIN' | 'GIFT',
  expected: number | null,
  campusId: string,
  studentId: string,
): number | null {
  if (expected === null || !Number.isSafeInteger(expected) || expected < 0)
    return null;
  const entries = grants.filter((entry) => entry.bucket === bucket);
  if (expected === 0) return entries.length === 0 ? 0 : null;
  const entry = entries[0];
  return entries.length === 1 &&
    entry.campusId === campusId &&
    entry.studentId === studentId &&
    entry.deltaUnits === expected &&
    entry.balanceBeforeUnits === 0 &&
    entry.balanceAfterUnits === expected &&
    entry.lessonSessionId === null &&
    entry.reversalOfId === null &&
    entry.financeRefundId === null &&
    entry.financeCorrectionId === null
    ? expected
    : null;
}

// Only link identities cross the scope boundary; counterpart amounts and private data are never loaded.
async function correctionHistory(
  tx: Prisma.TransactionClient,
  receiptIds: string[],
) {
  let frontier = receiptIds;
  const visited = new Set<string>();
  const links = new Map<string, Correction>();
  for (let depth = 0; frontier.length > 0; depth++) {
    if (
      depth >= 64 ||
      visited.size + frontier.length > receiptIds.length + 1000
    )
      return null;
    for (const id of frontier) visited.add(id);
    const batch = await tx.financeReceiptCorrection.findMany({
      where: {
        status: 'APPLIED',
        OR: [
          { originalIssuance: { receiptId: { in: frontier } } },
          { replacementReceiptId: { in: frontier } },
        ],
      },
      select: correctionSelect,
    });
    const next = new Set<string>();
    for (const link of batch) {
      links.set(link.id, link);
      for (const id of [
        link.originalIssuance.receiptId,
        link.replacementReceiptId,
      ])
        if (id && !visited.has(id)) next.add(id);
    }
    frontier = [...next];
  }
  const outgoing = new Map<string, string | null>();
  for (const link of links.values()) {
    const from = link.originalIssuance.receiptId;
    const target = link.replacementReceipt;
    if (
      outgoing.has(from) ||
      (link.type === 'VOID'
        ? target !== null
        : !target ||
          !target.issuance ||
          target.issuance.coursePackage.campusId !== target.campusId ||
          target.issuance.coursePackage.studentId !== target.studentId)
    )
      return null;
    outgoing.set(from, link.replacementReceiptId);
  }
  for (const root of receiptIds) {
    const path = new Set<string>();
    let id: string | null = root;
    while (id && outgoing.has(id)) {
      if (path.has(id)) return null;
      path.add(id);
      id = outgoing.get(id) ?? null;
    }
  }
  return new Set(outgoing.keys());
}

export async function readPartnerEnrollmentSummary(
  tx: Prisma.TransactionClient,
  campusId: string,
  studentId: string,
): Promise<PartnerEnrollmentSummary> {
  return readEnrollmentSummary(tx, campusId, studentId);
}

export async function readCampusEnrollmentSummary(
  tx: Prisma.TransactionClient,
  campusId: string,
): Promise<PartnerEnrollmentSummary> {
  return readEnrollmentSummary(tx, campusId);
}

async function readEnrollmentSummary(
  tx: Prisma.TransactionClient,
  campusId: string,
  studentId?: string,
): Promise<PartnerEnrollmentSummary> {
  const owner = {
    campusId,
    ...(studentId === undefined ? {} : { studentId }),
  };
  const summary: PartnerEnrollmentSummary = {
    receivedAmountFen: 0,
    refundedAmountFen: 0,
    initialMainUnits: 0,
    initialGiftUnits: 0,
    pendingIssuanceCount: 0,
  };
  const unknown = () => {
    summary.receivedAmountFen = null;
    summary.refundedAmountFen = null;
    summary.initialMainUnits = null;
    summary.initialGiftUnits = null;
  };
  const receipts = await tx.financeReceipt.findMany({
    where: owner,
    select: {
      id: true,
      studentId: true,
      amountFen: true,
      replacementForCorrection: { select: { status: true } },
      issuance: {
        select: {
          id: true,
          coursePackageId: true,
          originalAmountFen: true,
          initialMainUnits: true,
          initialGiftUnits: true,
          refunds: {
            select: {
              status: true,
              amountFen: true,
              payment: { select: { amountFen: true } },
            },
          },
        },
      },
    },
  });
  const packages = await tx.coursePackage.findMany({
    where: owner,
    select: {
      id: true,
      studentId: true,
      sourceOrderId: true,
      financeIssuance: { select: { id: true } },
      lessonLedger: { where: { entryType: 'GRANT' }, select: grantSelect },
    },
  });
  const byPackage = new Map(packages.map((item) => [item.id, item]));
  const covered = new Set<string>();
  const excluded = await correctionHistory(
    tx,
    receipts.map((item) => item.id),
  );
  if (!excluded) unknown();
  for (const receipt of receipts) {
    const issuance = receipt.issuance;
    const pack = issuance ? byPackage.get(issuance.coursePackageId) : undefined;
    if (pack && pack.studentId !== receipt.studentId) {
      unknown();
      continue;
    }
    if (excluded?.has(receipt.id)) {
      if (pack) covered.add(pack.id);
      if (
        issuance?.refunds.some((item) => item.payment || item.status === 'PAID')
      )
        summary.refundedAmountFen = null;
      continue;
    }
    summary.receivedAmountFen = add(
      summary.receivedAmountFen,
      receipt.amountFen,
    );
    if (
      receipt.replacementForCorrection &&
      receipt.replacementForCorrection.status !== 'APPLIED'
    )
      unknown();
    if (!issuance) {
      summary.pendingIssuanceCount += 1;
      continue;
    }
    if (
      !pack ||
      pack.sourceOrderId ||
      pack.financeIssuance?.id !== issuance.id
    ) {
      unknown();
      continue;
    }
    covered.add(pack.id);
    summary.initialMainUnits = add(
      summary.initialMainUnits,
      initialBucket(
        pack.lessonLedger,
        'MAIN',
        issuance.initialMainUnits,
        campusId,
        receipt.studentId,
      ),
    );
    summary.initialGiftUnits = add(
      summary.initialGiftUnits,
      initialBucket(
        pack.lessonLedger,
        'GIFT',
        issuance.initialGiftUnits,
        campusId,
        receipt.studentId,
      ),
    );
    if (issuance.originalAmountFen !== receipt.amountFen) {
      summary.initialMainUnits = null;
      summary.initialGiftUnits = null;
    }
    let refunded: number | null = 0;
    for (const refund of issuance.refunds) {
      if (refund.status === 'PAID') {
        refunded = add(
          refunded,
          refund.payment?.amountFen === refund.amountFen
            ? refund.amountFen
            : null,
        );
      } else if (refund.payment) refunded = null;
    }
    summary.refundedAmountFen = add(
      summary.refundedAmountFen,
      refunded !== null && refunded <= receipt.amountFen ? refunded : null,
    );
  }

  const orders = await tx.enrollmentOrder.findMany({
    where: owner,
    select: {
      id: true,
      studentId: true,
      status: true,
      parentUserId: true,
      priceFenSnapshot: true,
      mainUnitsSnapshot: true,
      giftUnitsSnapshot: true,
      groupMember: {
        select: {
          id: true,
          studentId: true,
          parentUserId: true,
          enrollmentOrderId: true,
          status: true,
          paidAt: true,
          settledAt: true,
          grantedMainUnits: true,
          grantedGiftUnits: true,
          campaign: { select: { campusId: true } },
          team: { select: { campaignId: true } },
          campaignId: true,
          transactions: {
            where: { status: 'SUCCEEDED' },
            select: { id: true, enrollmentOrderId: true },
          },
        },
      },
      paymentTransactions: {
        where: { status: 'SUCCEEDED' },
        select: {
          id: true,
          type: true,
          amountFen: true,
          groupMemberId: true,
          enrollmentOrderId: true,
          succeededAt: true,
        },
      },
      coursePackage: { select: { id: true, campusId: true, studentId: true } },
    },
  });
  const memberLinks = await tx.groupMember.findMany({
    where: {
      ...(studentId === undefined ? {} : { studentId }),
      campaign: { campusId },
    },
    select: { id: true, enrollmentOrderId: true },
  });
  const orderMembers = new Map(
    orders.map((order) => [order.id, order.groupMember?.id]),
  );
  if (
    memberLinks.some(
      (member) => orderMembers.get(member.enrollmentOrderId) !== member.id,
    )
  )
    unknown();
  for (const order of orders) {
    const member = order.groupMember;
    const payments = order.paymentTransactions.filter(
      (item) => item.type === 'PAYMENT',
    );
    const refunds = order.paymentTransactions.filter(
      (item) => item.type === 'REFUND',
    );
    const paidState = ['PAID', 'EFFECTIVE', 'REFUNDING', 'REFUNDED'].includes(
      order.status,
    );
    if (
      !paidState &&
      !payments.length &&
      !refunds.length &&
      !order.coursePackage &&
      !member?.transactions.length &&
      !member?.paidAt &&
      !member?.settledAt
    )
      continue;
    const matchingState =
      member &&
      ((order.status === 'PAID' && member.status === 'PAID') ||
        (order.status === 'EFFECTIVE' && member.status === 'SETTLED') ||
        (order.status === 'REFUNDING' && member.status === 'REFUNDING') ||
        (order.status === 'REFUNDED' && member.status === 'REFUNDED'));
    if (
      !member ||
      member.studentId !== order.studentId ||
      member.parentUserId !== order.parentUserId ||
      member.enrollmentOrderId !== order.id ||
      member.campaign.campusId !== campusId ||
      member.team.campaignId !== member.campaignId ||
      !matchingState ||
      member.transactions.length !== order.paymentTransactions.length ||
      member.transactions.some((item) => item.enrollmentOrderId !== order.id) ||
      order.paymentTransactions.some(
        (item) =>
          item.groupMemberId !== member.id ||
          item.enrollmentOrderId !== order.id ||
          !item.succeededAt,
      ) ||
      payments.length !== 1 ||
      !member.paidAt
    ) {
      unknown();
      continue;
    }
    const paid = payments[0].amountFen;
    summary.receivedAmountFen = add(
      summary.receivedAmountFen,
      paid === order.priceFenSnapshot ? paid : null,
    );
    const refunded = refunds.reduce<number | null>(
      (total, item) => add(total, item.amountFen),
      0,
    );
    summary.refundedAmountFen = add(
      summary.refundedAmountFen,
      refunds.length <= 1 &&
        refunded !== null &&
        refunded <= paid &&
        (order.status !== 'REFUNDED' || refunded === paid)
        ? refunded
        : null,
    );
    const pack = order.coursePackage
      ? byPackage.get(order.coursePackage.id)
      : undefined;
    if (!pack) {
      if (
        order.coursePackage ||
        order.status === 'EFFECTIVE' ||
        member.settledAt ||
        member.grantedMainUnits !== null ||
        member.grantedGiftUnits !== null
      ) {
        summary.initialMainUnits = null;
        summary.initialGiftUnits = null;
      } else summary.pendingIssuanceCount += 1;
      continue;
    }
    if (
      pack.financeIssuance ||
      pack.studentId !== order.studentId ||
      pack.sourceOrderId !== order.id ||
      order.coursePackage?.campusId !== campusId ||
      order.coursePackage?.studentId !== order.studentId
    ) {
      unknown();
      continue;
    }
    covered.add(pack.id);
    summary.initialMainUnits = add(
      summary.initialMainUnits,
      member.settledAt && order.mainUnitsSnapshot === member.grantedMainUnits
        ? initialBucket(
            pack.lessonLedger,
            'MAIN',
            member.grantedMainUnits,
            campusId,
            order.studentId,
          )
        : null,
    );
    summary.initialGiftUnits = add(
      summary.initialGiftUnits,
      member.settledAt && order.giftUnitsSnapshot === member.grantedGiftUnits
        ? initialBucket(
            pack.lessonLedger,
            'GIFT',
            member.grantedGiftUnits,
            campusId,
            order.studentId,
          )
        : null,
    );
  }
  if (packages.some((pack) => !covered.has(pack.id))) unknown();
  return summary;
}
