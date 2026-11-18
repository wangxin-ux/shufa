import type { Prisma } from '@prisma/client';

export const partnerLedgerPackageSelect = {
  name: true,
  campusId: true,
  studentId: true,
  financeIssuance: {
    select: {
      receipt: {
        select: { campusId: true, studentId: true, receivedOn: true },
      },
    },
  },
  sourceOrder: {
    select: {
      id: true,
      campusId: true,
      studentId: true,
      parentUserId: true,
      status: true,
      groupMember: {
        select: {
          id: true,
          studentId: true,
          parentUserId: true,
          enrollmentOrderId: true,
          status: true,
          paidAt: true,
          campaignId: true,
          campaign: { select: { campusId: true } },
          team: { select: { campaignId: true } },
          transactions: {
            where: { type: 'PAYMENT', status: 'SUCCEEDED' },
            take: 2,
            select: { id: true, enrollmentOrderId: true },
          },
        },
      },
      paymentTransactions: {
        where: { type: 'PAYMENT', status: 'SUCCEEDED' },
        take: 2,
        select: {
          id: true,
          groupMemberId: true,
          succeededAt: true,
        },
      },
    },
  },
} satisfies Prisma.CoursePackageSelect;

type LedgerPackage = Prisma.CoursePackageGetPayload<{
  select: typeof partnerLedgerPackageSelect;
}>;

export function toPartnerLedgerPayment(
  campusId: string,
  studentId: string,
  pack: LedgerPackage,
): { receivedOn: string } | { paidAt: string } | null {
  if (pack.campusId !== campusId || pack.studentId !== studentId) return null;
  const receipt = pack.financeIssuance?.receipt;
  const order = pack.sourceOrder;
  if (receipt && order) return null;
  if (receipt) {
    return receipt.campusId === campusId && receipt.studentId === studentId
      ? { receivedOn: receipt.receivedOn.toISOString().slice(0, 10) }
      : null;
  }
  const member = order?.groupMember;
  if (!order || !member) return null;
  const matchingState =
    (order.status === 'EFFECTIVE' && member.status === 'SETTLED') ||
    (order.status === 'REFUNDING' && member.status === 'REFUNDING') ||
    (order.status === 'REFUNDED' && member.status === 'REFUNDED');
  const payment = order.paymentTransactions[0];
  if (
    order.campusId !== campusId ||
    order.studentId !== studentId ||
    member.studentId !== studentId ||
    member.parentUserId !== order.parentUserId ||
    member.enrollmentOrderId !== order.id ||
    member.campaign.campusId !== campusId ||
    member.team.campaignId !== member.campaignId ||
    !matchingState ||
    !member.paidAt ||
    order.paymentTransactions.length !== 1 ||
    member.transactions.length !== 1 ||
    member.transactions[0].id !== payment.id ||
    member.transactions[0].enrollmentOrderId !== order.id ||
    payment.groupMemberId !== member.id ||
    !payment.succeededAt
  )
    return null;
  return { paidAt: payment.succeededAt.toISOString() };
}
