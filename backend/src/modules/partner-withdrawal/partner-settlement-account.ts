import type { Prisma, PartnerSettlementProfile } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  isPartnerWithdrawalSimulation,
  OCCUPIED_PARTNER_WITHDRAWALS,
  withdrawalConflict,
} from './partner-withdrawal-rules';

export type SettlementTx = Prisma.TransactionClient;
export function requireSimulation() {
  if (!isPartnerWithdrawalSimulation())
    withdrawalConflict('提现暂未开放；当前仅支持专用本地隔离库模拟');
}
export function requirePartner(actor: AuthenticatedUser) {
  if (
    actor.roles.length !== 1 ||
    actor.roles[0].code !== 'PARTNER' ||
    !actor.roles[0].campusId
  )
    throw new DomainError(ErrorCode.FORBIDDEN, '仅限本校区合作方', 403);
  return actor.roles[0].campusId;
}
export function requireReviewer(actor: AuthenticatedUser) {
  if (
    actor.roles.length !== 1 ||
    actor.roles[0].code !== 'SUPER_ADMIN' ||
    actor.roles[0].campusId !== null
  )
    throw new DomainError(ErrorCode.FORBIDDEN, '仅限总部审核人员', 403);
}
export async function lockPartnerSettlementCampus(
  tx: SettlementTx,
  campusId: string,
) {
  // One campus is the shared serialization boundary for allocation and source reversal.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'partner-settlement:' + campusId}, 0))::text`;
}
export async function assertSettlementActor(
  tx: SettlementTx,
  actor: AuthenticatedUser,
) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor.userId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "UserRole" WHERE "userId"=${actor.userId}::uuid FOR SHARE`;
  const current = await tx.user.findUnique({
    where: { id: actor.userId },
    select: {
      status: true,
      roles: { select: { roleCode: true, campusId: true } },
    },
  });
  if (
    !current ||
    current.status !== 'ACTIVE' ||
    current.roles.length !== 1 ||
    actor.roles.length !== 1 ||
    current.roles[0].roleCode !== actor.roles[0].code ||
    current.roles[0].campusId !== actor.roles[0].campusId
  )
    throw new DomainError(
      ErrorCode.UNAUTHORIZED,
      '登录状态已变化，请重新登录',
      401,
    );
}
export function settlementProfileView(p: PartnerSettlementProfile) {
  return {
    version: p.version,
    payerName: p.payerName,
    beneficiaryName: p.beneficiaryName,
    accountLabel: `模拟对公 ****${p.accountLastFour}`,
    minimumAmountFen: p.minimumAmountFen,
    dailyRequestLimit: p.dailyRequestLimit,
  };
}
export async function settlementAudit(
  tx: SettlementTx,
  actor: string,
  campusId: string,
  action: string,
  id: string,
  details: Prisma.InputJsonObject = {},
) {
  await tx.auditLog.create({
    data: {
      campusId,
      actorUserId: actor,
      action: `PARTNER_${action}`,
      resourceType: 'PartnerSettlement',
      resourceId: id,
      outcome: 'SUCCESS',
      details: { simulated: true, ...details },
    },
  });
}
export async function settlementSources(tx: SettlementTx, campusId: string) {
  const rows = await tx.partnerSettlementSource.findMany({
    where: { campusId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      reversal: true,
      earningEntry: {
        select: {
          campusId: true,
          status: true,
          amountFen: true,
          entryType: true,
          reversedBy: { select: { id: true } },
        },
      },
      allocations: { include: { withdrawal: { select: { status: true } } } },
    },
  });
  let broken = false;
  const sources = rows.map((row) => {
    const entry = row.earningEntry;
    if (
      !row.reversal &&
      (entry.status !== 'AVAILABLE' ||
        entry.reversedBy ||
        entry.campusId !== campusId ||
        entry.amountFen !== row.amountFen ||
        entry.entryType !== 'ACCRUAL')
    )
      broken = true;
    const valid =
      !row.reversal &&
      entry.status === 'AVAILABLE' &&
      !entry.reversedBy &&
      entry.campusId === campusId &&
      entry.amountFen === row.amountFen &&
      entry.entryType === 'ACCRUAL';
    const occupied = row.allocations
      .filter((a) =>
        (OCCUPIED_PARTNER_WITHDRAWALS as readonly string[]).includes(
          a.withdrawal.status,
        ),
      )
      .reduce((sum, a) => sum + a.amountFen, 0);
    if (occupied > row.amountFen) broken = true;
    return {
      id: row.id,
      valid,
      amountFen: row.amountFen,
      remainingFen: valid ? Math.max(0, row.amountFen - occupied) : 0,
    };
  });
  return { sources, broken };
}
export async function recordPartnerSettlementIssues(
  tx: SettlementTx,
  withdrawalId: string,
) {
  const allocations = await tx.partnerWithdrawalAllocation.findMany({
    where: { withdrawalId, source: { reversal: { isNot: null } } },
  });
  for (const allocation of allocations)
    await tx.partnerSettlementIssue.upsert({
      where: { allocationId: allocation.id },
      create: { allocationId: allocation.id, amountFen: allocation.amountFen },
      update: {},
    });
}
export async function invalidatePartnerSettlementSource(
  tx: SettlementTx,
  originalId: string,
  reversalId: string,
  actorId: string,
) {
  if (!isPartnerWithdrawalSimulation()) return;
  const source = await tx.partnerSettlementSource.findUnique({
    where: { earningEntryId: originalId },
  });
  if (!source) return;
  await tx.partnerSettlementReversal.upsert({
    where: { sourceId: source.id },
    create: {
      sourceId: source.id,
      earningReversalId: reversalId,
      amountFen: -source.amountFen,
    },
    update: {},
  });
  await settlementAudit(
    tx,
    actorId,
    source.campusId,
    'SETTLEMENT_SOURCE_INVALIDATE',
    source.id,
    { earningReversalId: reversalId, amountFen: -source.amountFen },
  );
  const withdrawals = await tx.partnerWithdrawal.findMany({
    where: {
      allocations: { some: { sourceId: source.id } },
      status: { in: [...OCCUPIED_PARTNER_WITHDRAWALS] },
    },
  });
  for (const w of withdrawals) {
    if (['SUBMITTED', 'APPROVED'].includes(w.status))
      await tx.partnerWithdrawal.update({
        where: { id: w.id },
        data: {
          status: 'INVALIDATED',
          reason: '结算来源已撤销，未出款申请已停止',
          version: { increment: 1 },
        },
      });
    else if (w.status === 'PAYING')
      await tx.partnerWithdrawal.update({
        where: { id: w.id },
        data: {
          status: 'RECONCILING',
          reason: '结算来源已撤销，出款结果待核对',
          version: { increment: 1 },
        },
      });
    else if (w.status === 'PAID') await recordPartnerSettlementIssues(tx, w.id);
    await settlementAudit(
      tx,
      actorId,
      source.campusId,
      'SETTLEMENT_SOURCE_REVERSED',
      w.id,
      {
        sourceId: source.id,
        beforeStatus: w.status,
        earningReversalId: reversalId,
      },
    );
  }
}
