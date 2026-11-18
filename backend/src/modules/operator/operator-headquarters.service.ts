import { Injectable } from '@nestjs/common';
import { LessonLedgerEntryType, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { OperatorHeadquartersScopeService } from '../../common/auth/operator-headquarters-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { lessonBalanceSelect } from '../lesson-ledger/lesson-balance';
import { readCampusEnrollmentSummary } from '../partner/partner-enrollment-summary';
import {
  accountActivityTotals,
  accountBalances,
} from './operator-account-ledger';
import { readOperatorInternalEarningSummary } from './operator-internal-earning-source';
import type { OperatorHeadquartersCampusesQueryDto } from './dto/operator-headquarters.dto';

type Client = Prisma.TransactionClient;
const campusSelect = { id: true, name: true, timezone: true } as const;
type Campus = Prisma.CampusGetPayload<{ select: typeof campusSelect }>;
type Balance = ReturnType<typeof accountBalances>;
type Enrollment = Awaited<ReturnType<typeof readCampusEnrollmentSummary>>;
type Activity = Awaited<ReturnType<typeof accountActivityTotals>>;
type Earnings = Awaited<ReturnType<typeof readOperatorInternalEarningSummary>>;
type CampusSummary = {
  campus: Campus;
  activeStudentCount: number;
  todayLessonCount: number;
  account: Balance & {
    enrollmentSummary: Enrollment;
    lessonActivityTotals: Activity;
  };
  earnings: Earnings;
  serverTime: string;
};
const balanceKeys = [
  'mainBalanceUnits',
  'giftBalanceUnits',
  'totalBalanceUnits',
  'mainReservedUnits',
  'giftReservedUnits',
  'reservedTotalUnits',
  'mainAvailableUnits',
  'giftAvailableUnits',
  'availableTotalUnits',
] as const;
const enrollmentKeys = [
  'receivedAmountFen',
  'refundedAmountFen',
  'initialMainUnits',
  'initialGiftUnits',
] as const;

@Injectable()
export class OperatorHeadquartersService {
  constructor(private readonly scope: OperatorHeadquartersScopeService) {}

  campuses(
    actor: AuthenticatedUser,
    query: OperatorHeadquartersCampusesQueryDto,
  ) {
    const skip = (query.page - 1) * query.pageSize;
    if (
      !Number.isSafeInteger(query.page) ||
      query.page < 1 ||
      query.page > 2_147_483_647 ||
      !Number.isSafeInteger(query.pageSize) ||
      query.pageSize < 1 ||
      query.pageSize > 100 ||
      !Number.isSafeInteger(skip) ||
      skip > 2_147_483_647 ||
      (query.query !== undefined &&
        (typeof query.query !== 'string' || query.query.length > 100))
    )
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        'Invalid headquarters directory pagination or query',
        400,
      );
    return this.scope.snapshot(actor, async (tx, ids) => {
      if (!ids.length)
        return {
          data: [],
          meta: {
            page: query.page,
            pageSize: query.pageSize,
            total: 0,
            totalPages: 0,
          },
        };
      const keyword = query.query?.trim();
      const where: Prisma.CampusWhereInput = {
        id: { in: [...ids] },
        ...(keyword
          ? { name: { contains: keyword, mode: 'insensitive' } }
          : {}),
      };
      const total = this.nonnegative(await tx.campus.count({ where }));
      const data = await tx.campus.findMany({
        where,
        select: campusSelect,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take: query.pageSize,
      });
      if (
        total > ids.length ||
        data.length !== Math.min(query.pageSize, Math.max(0, total - skip)) ||
        new Set(data.map((campus) => campus.id)).size !== data.length
      )
        this.invalid();
      for (const campus of data) this.campus(campus, ids);
      return {
        data,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.ceil(total / query.pageSize),
        },
      };
    });
  }

  campusSummary(actor: AuthenticatedUser, campusId: string, now = new Date()) {
    return this.scope.snapshot(
      actor,
      async (tx) => {
        const campuses = await this.campusesInScope(tx, [campusId]);
        return this.readCampus(tx, campuses[0], now);
      },
      campusId,
    );
  }

  summary(actor: AuthenticatedUser, now = new Date()) {
    return this.scope.snapshot(actor, async (tx, ids) => {
      const campuses = ids.length ? await this.campusesInScope(tx, ids) : [];
      const rows: CampusSummary[] = [];
      for (const campus of campuses)
        rows.push(await this.readCampus(tx, campus, now));
      return {
        campusCount: campuses.length,
        activeStudentCount: this.sum(rows.map((row) => row.activeStudentCount)),
        todayLessonCount: this.sum(rows.map((row) => row.todayLessonCount)),
        studentCountBasis: 'SUM_OF_CAMPUS_ACTIVE_STUDENT_RECORDS' as const,
        account: this.accounts(rows),
        earnings: {
          estimatedTotalFen: this.nullableSum(
            rows.map((row) => row.earnings.estimatedTotalFen),
          ),
          pendingReviewFen: this.nullableSum(
            rows.map((row) => row.earnings.pendingReviewFen),
          ),
          currency: 'CNY' as const,
        },
        serverTime: this.time(now),
      };
    });
  }

  private async campusesInScope(tx: Client, ids: readonly string[]) {
    const campuses = await tx.campus.findMany({
      where: { id: { in: [...ids] } },
      select: campusSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    if (
      campuses.length !== ids.length ||
      new Set(campuses.map((campus) => campus.id)).size !== ids.length
    )
      this.invalid();
    for (const campus of campuses) this.campus(campus, ids);
    return campuses;
  }

  private campus(campus: Campus, ids: readonly string[]) {
    if (
      !ids.includes(campus.id) ||
      !campus.name.trim() ||
      !campus.timezone.trim()
    )
      this.invalid();
    try {
      new Intl.DateTimeFormat('en', { timeZone: campus.timezone }).format();
    } catch {
      this.invalid();
    }
  }

  private async readCampus(
    tx: Client,
    campus: Campus,
    now: Date,
  ): Promise<CampusSummary> {
    const serverTime = this.time(now);
    const activeStudentCount = this.nonnegative(
      await tx.student.count({
        where: { campusId: campus.id, isActive: true },
      }),
    );
    // Local midnight boundaries are interpreted independently per campus.
    const counts = await tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM "LessonSession"
      WHERE "campusId" = ${campus.id}::uuid
        AND "status" <> 'CANCELLED'
        AND "startsAt" >=
          ((CAST(${serverTime} AS timestamptz) AT TIME ZONE ${campus.timezone})::date::timestamp
            AT TIME ZONE ${campus.timezone})
        AND "startsAt" <
          (((CAST(${serverTime} AS timestamptz) AT TIME ZONE ${campus.timezone})::date
            + INTERVAL '1 day') AT TIME ZONE ${campus.timezone})
    `;
    if (counts.length !== 1 || typeof counts[0].count !== 'bigint')
      this.invalid();
    const packages = await tx.coursePackage.findMany({
      where: {
        campusId: campus.id,
        student: { campusId: campus.id },
        isActive: true,
        validFrom: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      },
      select: lessonBalanceSelect,
    });
    return {
      campus,
      activeStudentCount,
      todayLessonCount: this.nonnegative(counts[0].count),
      account: {
        ...accountBalances(packages),
        enrollmentSummary: await readCampusEnrollmentSummary(tx, campus.id),
        lessonActivityTotals: await accountActivityTotals(tx, campus.id),
      },
      earnings: await readOperatorInternalEarningSummary(tx, campus.id),
      serverTime,
    };
  }

  private accounts(rows: readonly CampusSummary[]) {
    const balances = Object.fromEntries(
      balanceKeys.map((key) => [
        key,
        this.sum(rows.map((row) => row.account[key])),
      ]),
    ) as Balance;
    const enrollment = Object.fromEntries(
      enrollmentKeys.map((key) => [
        key,
        this.nullableSum(rows.map((row) => row.account.enrollmentSummary[key])),
      ]),
    ) as Omit<Enrollment, 'pendingIssuanceCount'>;
    return {
      ...balances,
      enrollmentSummary: {
        ...enrollment,
        pendingIssuanceCount: this.sum(
          rows.map((row) => row.account.enrollmentSummary.pendingIssuanceCount),
        ),
      },
      lessonActivityTotals: Object.values(LessonLedgerEntryType).map(
        (entryType) => {
          const entries = rows.map((row) =>
            row.account.lessonActivityTotals.find(
              (entry) => entry.entryType === entryType,
            ),
          );
          if (entries.some((entry) => entry === undefined)) this.invalid();
          const mainDeltaUnits = this.nullableSum(
            entries.map((entry) => entry!.mainDeltaUnits),
          );
          const giftDeltaUnits = this.nullableSum(
            entries.map((entry) => entry!.giftDeltaUnits),
          );
          return {
            entryType,
            mainDeltaUnits,
            giftDeltaUnits,
            totalDeltaUnits: this.nullableSum(
              entries.map((entry) => entry!.totalDeltaUnits),
            ),
          };
        },
      ),
    };
  }

  private nullableSum(values: readonly (number | null)[]) {
    if (values.some((value) => value === null || !Number.isSafeInteger(value)))
      return null;
    const total = values.reduce<bigint>(
      (sum, value) => sum + BigInt(value!),
      0n,
    );
    const limit = BigInt(Number.MAX_SAFE_INTEGER);
    return total > limit || total < -limit ? null : Number(total);
  }

  private sum(values: readonly number[]) {
    for (const value of values) this.nonnegative(value);
    const total = this.nullableSum(values);
    if (total === null) this.invalid();
    return total;
  }

  private nonnegative(value: number | bigint): number {
    if (
      (typeof value !== 'number' && typeof value !== 'bigint') ||
      (typeof value === 'number' && !Number.isSafeInteger(value)) ||
      value < 0 ||
      value > Number.MAX_SAFE_INTEGER
    )
      this.invalid();
    return Number(value);
  }

  private time(now: Date) {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
      this.invalid();
    return now.toISOString();
  }

  private invalid(): never {
    throw new DomainError(
      ErrorCode.INTERNAL_SERVER_ERROR,
      'The headquarters aggregate source requires verification',
      500,
    );
  }
}
