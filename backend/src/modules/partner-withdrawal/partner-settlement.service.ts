import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  assertSettlementActor,
  lockPartnerSettlementCampus,
  requirePartner,
  requireReviewer,
  requireSimulation,
  settlementAudit,
  settlementProfileView,
  settlementSources,
  type SettlementTx,
} from './partner-settlement-account';
import {
  isPartnerWithdrawalSimulation,
  shanghaiWithdrawalDay,
  withdrawalConflict,
} from './partner-withdrawal-rules';
import type {
  PartnerSettlementConfigurationDto,
  PartnerSettlementConfirmDto,
  PartnerWithdrawalQueryDto,
} from './partner-withdrawal.dto';

@Injectable()
export class PartnerSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}
  ownSummary(actor: AuthenticatedUser) {
    const campusId = requirePartner(actor);
    if (!isPartnerWithdrawalSimulation())
      return Promise.resolve({
        simulated: false,
        enabled: false,
        campusId,
        profile: null,
        settledEntitlementFen: 0,
        reservedFen: 0,
        paidFen: 0,
        availableFen: 0,
        unresolvedFen: 0,
        requestsToday: 0,
        canApply: false,
        blockReason: 'SIMULATION_DISABLED',
      });
    return this.read(actor, (tx) => this.summary(tx, campusId));
  }
  managedSummary(actor: AuthenticatedUser, campusId: string) {
    requireReviewer(actor);
    requireSimulation();
    return this.read(actor, (tx) => this.summary(tx, campusId));
  }
  async read<T>(
    actor: AuthenticatedUser,
    fn: (tx: SettlementTx) => Promise<T>,
  ) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        await assertSettlementActor(tx, actor);
        return fn(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const current = await this.prisma.user.findUnique({
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
      current.roles[0].roleCode !== actor.roles[0]?.code ||
      current.roles[0].campusId !== actor.roles[0]?.campusId
    )
      throw new DomainError(
        ErrorCode.UNAUTHORIZED,
        '登录已更新，请重新登录',
        401,
      );
    return result;
  }
  async summary(tx: SettlementTx, campusId: string, at = new Date()) {
    const profile = await tx.partnerSettlementProfile.findUnique({
      where: { campusId },
    });
    const { sources, broken } = await settlementSources(tx, campusId);
    const reservations = await tx.partnerWithdrawal.findMany({
      where: {
        campusId,
        status: {
          in: ['SUBMITTED', 'APPROVED', 'PAYING', 'RECONCILING', 'PAID'],
        },
      },
      select: { status: true, amountFen: true },
    });
    const issues = await tx.partnerSettlementIssue.aggregate({
      where: { allocation: { withdrawal: { campusId } } },
      _sum: { amountFen: true },
    });
    const pendingReversed = await tx.partnerWithdrawal.count({
      where: {
        campusId,
        status: { in: ['PAYING', 'RECONCILING'] },
        allocations: { some: { source: { reversal: { isNot: null } } } },
      },
    });
    const day = shanghaiWithdrawalDay(at);
    const requestsToday = await tx.partnerWithdrawal.count({
      where: { campusId, createdAt: { gte: day.start, lt: day.end } },
    });
    const unresolvedFen = issues._sum.amountFen ?? 0;
    const rawAvailable = sources.reduce(
      (sum, row) => sum + row.remainingFen,
      0,
    );
    const blocked = broken || unresolvedFen > 0 || pendingReversed > 0;
    const availableFen = blocked ? 0 : rawAvailable;
    const blockReason = !profile
      ? 'PROFILE_REQUIRED'
      : blocked
        ? 'RECONCILIATION_REQUIRED'
        : requestsToday >= profile.dailyRequestLimit
          ? 'DAILY_LIMIT'
          : availableFen < profile.minimumAmountFen
            ? 'BELOW_MINIMUM'
            : '';
    return {
      simulated: true,
      enabled: true,
      campusId,
      profile: profile ? settlementProfileView(profile) : null,
      settledEntitlementFen: sources
        .filter((s) => s.valid)
        .reduce((sum, row) => sum + row.amountFen, 0),
      reservedFen: reservations
        .filter((w) => w.status !== 'PAID')
        .reduce((sum, w) => sum + w.amountFen, 0),
      paidFen: reservations
        .filter((w) => w.status === 'PAID')
        .reduce((sum, w) => sum + w.amountFen, 0),
      availableFen,
      unresolvedFen,
      requestsToday,
      canApply: !blockReason,
      blockReason,
    };
  }
  async configure(
    actor: AuthenticatedUser,
    campusId: string,
    dto: PartnerSettlementConfigurationDto,
    key: string,
  ) {
    requireReviewer(actor);
    requireSimulation();
    return this.prisma.$transaction(async (tx) => {
      await lockPartnerSettlementCampus(tx, campusId);
      await assertSettlementActor(tx, actor);
      const route = `/management/campuses/${campusId}/partner-settlement`;
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        request: dto,
        campusId,
        actorUserId: actor.userId,
      });
      if (claim.replayed) return claim.responseBody;
      if (
        !(await tx.campus.findUnique({
          where: { id: campusId },
          select: { id: true },
        }))
      )
        throw new DomainError(ErrorCode.RESOURCE_NOT_FOUND, '校区不存在', 404);
      const current = await tx.partnerSettlementProfile.findUnique({
        where: { campusId },
      });
      if ((current?.version ?? 0) !== dto.expectedVersion) withdrawalConflict();
      if (
        current &&
        (current.payerName !== dto.payerName ||
          current.beneficiaryName !== dto.beneficiaryName) &&
        (await tx.partnerSettlementSource.count({ where: { campusId } }))
      )
        withdrawalConflict('已有结算来源，不能直接更换结算主体');
      const values = {
        payerName: dto.payerName,
        beneficiaryName: dto.beneficiaryName,
        accountLastFour: dto.accountLastFour,
        minimumAmountFen: dto.minimumAmountFen,
        dailyRequestLimit: dto.dailyRequestLimit,
        configuredByUserId: actor.userId,
      };
      const result = await tx.partnerSettlementProfile.upsert({
        where: { campusId },
        create: { campusId, ...values },
        update: { ...values, version: { increment: 1 } },
      });
      await settlementAudit(
        tx,
        actor.userId,
        campusId,
        'SETTLEMENT_CONFIGURE',
        result.id,
        {
          beforeVersion: current?.version ?? 0,
          afterVersion: result.version,
          reason: dto.reason.trim(),
        },
      );
      const view = await this.summary(tx, campusId);
      await this.idempotency.complete(tx, {
        key,
        route,
        responseBody: view,
      });
      return view;
    });
  }
  candidates(
    actor: AuthenticatedUser,
    campusId: string,
    query: PartnerWithdrawalQueryDto,
  ) {
    requireReviewer(actor);
    requireSimulation();
    return this.read(actor, async (tx) => {
      const where = {
        campusId,
        entryType: 'ACCRUAL' as const,
        status: 'AVAILABLE' as const,
        amountFen: { gt: 0 },
      };
      const rows = await tx.partnerEarningEntry.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          amountFen: true,
          version: true,
          createdAt: true,
          settlementSource: { select: { id: true } },
        },
      });
      const total = await tx.partnerEarningEntry.count({ where });
      return {
        data: rows.map((e) => ({
          id: e.id,
          amountFen: e.amountFen,
          version: e.version,
          createdAt: e.createdAt.toISOString(),
          confirmed: !!e.settlementSource,
        })),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.ceil(total / query.pageSize),
        },
      };
    });
  }
  confirm(
    actor: AuthenticatedUser,
    campusId: string,
    earningId: string,
    dto: PartnerSettlementConfirmDto,
    key: string,
  ) {
    requireReviewer(actor);
    requireSimulation();
    return this.prisma.$transaction(async (tx) => {
      await lockPartnerSettlementCampus(tx, campusId);
      await assertSettlementActor(tx, actor);
      const route = `/management/campuses/${campusId}/partner-settlement/sources/${earningId}`;
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        request: dto,
        campusId,
        actorUserId: actor.userId,
      });
      if (claim.replayed) return claim.responseBody;
      await tx.$queryRaw`SELECT "id" FROM "PartnerEarningEntry" WHERE "id"=${earningId}::uuid AND "campusId"=${campusId}::uuid FOR UPDATE`;
      const p = await tx.partnerSettlementProfile.findUnique({
        where: { campusId },
      });
      const e = await tx.partnerEarningEntry.findFirst({
        where: { id: earningId, campusId },
        include: {
          reversedBy: true,
          settlementSource: true,
          earningBasis: true,
        },
      });
      if (
        !p ||
        p.version !== dto.expectedProfileVersion ||
        !e ||
        e.version !== dto.expectedVersion ||
        e.status !== 'AVAILABLE' ||
        e.entryType !== 'ACCRUAL' ||
        e.amountFen <= 0 ||
        e.reversedBy ||
        e.settlementSource ||
        e.earningBasis.campusId !== campusId ||
        e.earningBasis.status !== 'PRICED'
      )
        withdrawalConflict('该来源尚不可结算、已确认或版本已变化');
      const result = await tx.partnerSettlementSource.create({
        data: {
          campusId,
          earningEntryId: e.id,
          amountFen: e.amountFen,
          profileSnapshot: settlementProfileView(p),
          confirmedByUserId: actor.userId,
          reason: dto.reason.trim(),
        },
      });
      await settlementAudit(
        tx,
        actor.userId,
        campusId,
        'SETTLEMENT_CONFIRM',
        result.id,
        { earningId: e.id, amountFen: e.amountFen, reason: dto.reason.trim() },
      );
      const view = await this.summary(tx, campusId);
      await this.idempotency.complete(tx, {
        key,
        route,
        responseBody: view,
      });
      return view;
    });
  }
}
