import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { OperatorScopeService } from '../../common/auth/operator-scope.service';
import { PartnerScopeService } from '../../common/auth/partner-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  PartnerRankingMetric,
  PartnerRankingQueryDto,
} from './dto/partner-ranking.dto';

const VERSION = 'monthly-rankings-2026-10-15-v1';
const TIMEZONE = 'Asia/Shanghai' as const;
type Client = Prisma.TransactionClient;
type RankingOwner = {
  userId: string;
  campusId: string;
  roleCode: 'PARTNER' | 'OPERATOR';
};
interface CampusValue {
  campusId: string;
  campusName: string;
  value: bigint;
}
type Source = {
  rows: CampusValue[];
  reason: 'HISTORY_UNAVAILABLE' | 'SOURCE_DATA_INVALID' | null;
};

export function rankingMonthRange(month: string, now: Date) {
  const currentMonth = new Date(now.getTime() + 28_800_000)
    .toISOString()
    .slice(0, 7);
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month) || month > currentMonth)
    throw new DomainError(
      ErrorCode.VALIDATION_FAILED,
      'A valid non-future month is required',
      400,
    );
  const [year, number] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, number - 1, 1) - 28_800_000);
  const end = new Date(Date.UTC(year, number, 1) - 28_800_000);
  const previousMonth = new Date(Date.UTC(year, number - 2, 1))
    .toISOString()
    .slice(0, 7);
  return { start, end, previousMonth, current: month === currentMonth };
}

export function rankCampusValues(values: CampusValue[]) {
  const sorted = [...values].sort((a, b) =>
    a.value === b.value
      ? a.campusId.localeCompare(b.campusId)
      : a.value > b.value
        ? -1
        : 1,
  );
  let rank = 0;
  return sorted.map((row, index) => {
    if (index === 0 || row.value !== sorted[index - 1].value) rank++;
    return { ...row, rank, position: index + 1 };
  });
}

@Injectable()
export class PartnerRankingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: PartnerScopeService,
    private readonly operatorScope: OperatorScopeService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: PartnerRankingQueryDto,
    now = new Date(),
  ) {
    const owner = this.scope.require(actor);
    return this.listScoped({ ...owner, roleCode: 'PARTNER' }, query, now);
  }

  async listForOperator(
    actor: AuthenticatedUser,
    query: PartnerRankingQueryDto,
    now = new Date(),
  ) {
    const owner = this.operatorScope.require(actor);
    const result = await this.listScoped(
      { ...owner, roleCode: 'OPERATOR' },
      query,
      now,
    );
    const present = (row: NonNullable<typeof result.ownCampus>) => ({
      campusName: row.campusName,
      rank: row.rank,
      rankDelta: row.rankDelta,
      isOwnCampus: row.isOwnCampus,
    });
    return {
      ...result,
      data: result.data.map(present),
      ownCampus: result.ownCampus ? present(result.ownCampus) : null,
    };
  }

  private async listScoped(
    owner: RankingOwner,
    query: PartnerRankingQueryDto,
    now: Date,
  ) {
    const month =
      query.month ??
      new Date(now.getTime() + 28_800_000).toISOString().slice(0, 7);
    const range = rankingMonthRange(month, now);
    let result: Awaited<ReturnType<PartnerRankingService['read']>> | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await this.prisma.$transaction(
          (tx) => this.read(tx, owner, query, month, range, now),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
            timeout: 20_000,
          },
        );
        break;
      } catch (error) {
        if (
          attempt === 2 ||
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          !['P2034', 'P2002'].includes(error.code)
        )
          throw error;
      }
    }
    await this.prisma.$transaction((tx) => this.assertOwner(tx, owner));
    return result!;
  }

  private async assertOwner(tx: Client, owner: RankingOwner) {
    const user = await tx.user.findUnique({
      where: { id: owner.userId },
      select: {
        status: true,
        roles: { select: { roleCode: true, campusId: true } },
      },
    });
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      user.roles.length !== 1 ||
      user.roles[0].roleCode !== owner.roleCode ||
      user.roles[0].campusId !== owner.campusId
    )
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        'Current single-campus ranking scope is required',
        403,
      );
  }

  private async read(
    tx: Client,
    owner: RankingOwner,
    query: PartnerRankingQueryDto,
    month: string,
    range: ReturnType<typeof rankingMonthRange>,
    now: Date,
  ) {
    await this.assertOwner(tx, owner);
    const base = {
      metric: query.metric,
      month,
      timezone: TIMEZONE,
      asOf: now.toISOString(),
      calculationVersion: VERSION,
      availability: range.current ? ('LIVE' as const) : ('SNAPSHOT' as const),
      unavailableReason: null as Source['reason'],
    };
    let revision = query.revisionId
      ? await tx.partnerRankingRevision.findFirst({
          where: {
            id: query.revisionId,
            metric: query.metric,
            month,
            calculationVersion: VERSION,
          },
        })
      : null;
    if (query.revisionId && !revision)
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Ranking revision not found',
        404,
      );
    if (!revision) {
      const source = await this.collect(tx, query.metric, month, now);
      if (source.reason)
        return {
          ...base,
          availability: 'UNAVAILABLE' as const,
          unavailableReason: source.reason,
          revisionId: null,
          data: [],
          ownCampus: null,
          meta: {
            page: query.page,
            pageSize: query.pageSize,
            total: 0,
            totalPages: 0,
          },
        };
      const previous: Source =
        range.previousMonth < '1000-01'
          ? { rows: [], reason: 'HISTORY_UNAVAILABLE' }
          : await this.collect(tx, query.metric, range.previousMonth, now);
      const previousRanks = new Map(
        previous.reason
          ? []
          : rankCampusValues(previous.rows).map(
              (row) => [row.campusId, row.rank] as const,
            ),
      );
      const rows = rankCampusValues(source.rows).map((row) => ({
        ...row,
        previousRank: previousRanks.get(row.campusId) ?? null,
      }));
      const sourceHash = createHash('sha256')
        .update(
          JSON.stringify({
            version: VERSION,
            rows: rows.map((row) => ({
              ...row,
              value: row.value.toString(),
            })),
          }),
        )
        .digest('hex');
      revision = await tx.partnerRankingRevision.upsert({
        where: {
          metric_month_sourceHash: { metric: query.metric, month, sourceHash },
        },
        update: {},
        create: {
          metric: query.metric,
          month,
          asOf: now,
          calculationVersion: VERSION,
          sourceHash,
          rows: { create: rows },
        },
      });
    }
    const select = {
      campusId: true,
      campusName: true,
      rank: true,
      previousRank: true,
    } as const;
    const where = { revisionId: revision.id };
    const rows = await tx.partnerRankingRow.findMany({
      where,
      select,
      orderBy: { position: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    const own = await tx.partnerRankingRow.findUnique({
      where: {
        revisionId_campusId: {
          revisionId: revision.id,
          campusId: owner.campusId,
        },
      },
      select,
    });
    const total = await tx.partnerRankingRow.count({ where });
    const present = (row: (typeof rows)[number]) => ({
      ...row,
      rankDelta: row.previousRank === null ? null : row.previousRank - row.rank,
      isOwnCampus: row.campusId === owner.campusId,
    });
    return {
      ...base,
      asOf: revision.asOf.toISOString(),
      revisionId: revision.id,
      data: rows.map(present),
      ownCampus: own ? present(own) : null,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  private async collect(
    tx: Client,
    metric: PartnerRankingMetric,
    month: string,
    now: Date,
  ): Promise<Source> {
    const range = rankingMonthRange(month, now);
    const coverage = await tx.partnerRankingCoverage.findUnique({
      where: { id: 'monthly-rankings' },
    });
    if (!coverage) return { rows: [], reason: 'SOURCE_DATA_INVALID' };
    if (
      metric === 'STUDENTS' &&
      !range.current &&
      coverage.startedAt >= range.end
    )
      return { rows: [], reason: 'HISTORY_UNAVAILABLE' };
    const campuses = await tx.campus.findMany({
      where: { createdAt: { lt: range.current ? now : range.end } },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
    let values: Map<string, bigint>;
    if (metric === 'STUDENTS') {
      if (range.current) {
        const counts = await tx.student.groupBy({
          by: ['campusId'],
          where: { isActive: true },
          _count: { _all: true },
        });
        values = new Map(
          counts.map((row) => [row.campusId, BigInt(row._count._all)]),
        );
      } else {
        const counts = await tx.$queryRaw<
          Array<{ campusId: string; value: bigint }>
        >`
          SELECT f."campusId", COUNT(*)::bigint AS "value"
          FROM (
            SELECT DISTINCT ON ("studentId") "studentId", "campusId", "isActive"
            FROM "PartnerRankingStudentFact" WHERE "recordedAt" < ${range.end}
            ORDER BY "studentId", "recordedAt" DESC, "id" DESC
          ) f WHERE f."isActive" GROUP BY f."campusId"
        `;
        values = new Map(counts.map((row) => [row.campusId, row.value]));
      }
    } else {
      const entries = await tx.partnerEarningEntry.findMany({
        where: {
          status: { not: 'REJECTED' },
          createdAt: { gte: range.start, lt: range.current ? now : range.end },
        },
        select: {
          campusId: true,
          entryType: true,
          amountFen: true,
          ruleSnapshot: true,
          earningBasis: {
            select: { campusId: true, countedAttendeeCount: true },
          },
        },
      });
      if (
        !entries.length &&
        !range.current &&
        coverage.startedAt >= range.end
      ) {
        const historicalEntry = await tx.partnerEarningEntry.findFirst({
          where: { createdAt: { gte: range.start, lt: range.end } },
          select: { id: true },
        });
        if (!historicalEntry)
          return { rows: [], reason: 'HISTORY_UNAVAILABLE' };
      }
      values = new Map();
      for (const entry of entries) {
        const snapshot = entry.ruleSnapshot;
        const price =
          snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
            ? snapshot.unitPriceFen
            : null;
        const count = entry.earningBasis.countedAttendeeCount;
        if (
          typeof price !== 'number' ||
          !Number.isSafeInteger(price) ||
          price < 0 ||
          count < 0 ||
          entry.campusId !== entry.earningBasis.campusId
        )
          return { rows: [], reason: 'SOURCE_DATA_INVALID' };
        const amount = BigInt(entry.amountFen);
        const value =
          metric === 'PARTNER_EARNINGS'
            ? amount
            : BigInt(price) *
                BigInt(count) *
                (entry.entryType === 'REVERSAL' ? -1n : 1n) -
              amount;
        values.set(entry.campusId, (values.get(entry.campusId) ?? 0n) + value);
      }
    }
    return {
      reason: null,
      rows: campuses.map((campus) => ({
        campusId: campus.id,
        campusName: campus.name,
        value: values.get(campus.id) ?? 0n,
      })),
    };
  }
}
