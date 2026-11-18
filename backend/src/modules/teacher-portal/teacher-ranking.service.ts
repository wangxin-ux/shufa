import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TeacherScope } from '../../common/auth/teacher-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { resolvePartnerPeriodRange } from '../partner/partner-period';
import type {
  TeacherRankingMetric,
  TeacherRankingQueryDto,
} from './teacher-ranking.dto';

type Client = Prisma.TransactionClient;
type Value = { id: string; value: bigint };
const VERSION = 'teacher-monthly-rankings-2026-10-25-v1';
const invalidSource = (): never => {
  throw new DomainError(
    ErrorCode.CONFLICT,
    '榜单收益来源待核对，请稍后重试',
    409,
  );
};

export function rankTeacherValues(values: Value[]) {
  const sorted = values
    .filter((row) => row.value > 0n)
    .sort((left, right) =>
      left.value === right.value
        ? left.id.localeCompare(right.id)
        : left.value > right.value
          ? -1
          : 1,
    );
  let rank = 0;
  return sorted.map((row, index) => {
    if (index === 0 || row.value !== sorted[index - 1].value) rank = index + 1;
    return { ...row, rank, position: index + 1 };
  });
}

@Injectable()
export class TeacherRankingService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    scope: TeacherScope,
    query: TeacherRankingQueryDto,
    now = new Date(),
  ) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        await this.assertOwner(tx, scope);
        const campus = await tx.campus.findUniqueOrThrow({
          where: { id: scope.campusId },
          select: { timezone: true },
        });
        const timezone = campus.timezone;
        const currentParts = Object.fromEntries(
          new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
          })
            .formatToParts(now)
            .map((part) => [part.type, part.value]),
        );
        const currentMonth = `${currentParts.year}-${currentParts.month}`;
        const month = query.month ?? currentMonth;
        if (
          !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month) ||
          month > currentMonth ||
          (query.page > 1 && !query.revision)
        ) {
          throw new DomainError(
            ErrorCode.VALIDATION_FAILED,
            '月份或分页版本无效',
            400,
          );
        }
        const range = resolvePartnerPeriodRange(
          'MONTH',
          `${month}-01`,
          timezone,
          now,
        );
        const [year, number] = month.split('-').map(Number);
        const previousMonth = new Date(Date.UTC(year, number - 2, 1))
          .toISOString()
          .slice(0, 7);
        const previousRange = resolvePartnerPeriodRange(
          'MONTH',
          `${previousMonth}-01`,
          timezone,
          now,
        );
        // Each query uses this transaction's snapshot; no per-teacher database reads.
        const current = await this.collect(
          tx,
          scope.campusId,
          query.metric,
          range.start,
          range.end,
          now,
        );
        const previous = await this.collect(
          tx,
          scope.campusId,
          query.metric,
          previousRange.start,
          previousRange.end,
          now,
        );
        const teachers = await tx.teacherProfile.findMany({
          where: { campusId: scope.campusId },
          select: { id: true, user: { select: { displayName: true } } },
        });
        const names = new Map(
          teachers.map((row) => [row.id, row.user.displayName]),
        );
        const previousRanks = new Map(
          rankTeacherValues(previous).map((row) => [row.id, row.rank]),
        );
        const ranked = rankTeacherValues(current).map((row) => ({
          ...row,
          displayName: names.get(row.id) ?? '教师',
          previousRank: previousRanks.get(row.id) ?? null,
        }));
        const ownValue = current.find(
          (row) => row.id === scope.teacherProfileId,
        );
        const ownRow = ranked.find((row) => row.id === scope.teacherProfileId);
        const revision = createHash('sha256')
          .update(
            JSON.stringify({
              version: VERSION,
              campusId: scope.campusId,
              month,
              metric: query.metric,
              timezone,
              rows: ranked.map((row) => ({
                ...row,
                value: row.value.toString(),
              })),
              own: {
                value: ownValue?.value.toString() ?? '0',
                hasActivity: !!ownValue,
              },
            }),
          )
          .digest('hex');
        if (query.revision && query.revision !== revision) {
          throw new DomainError(
            ErrorCode.CONFLICT,
            '榜单已更新，请刷新后继续',
            409,
          );
        }
        const present = (row: (typeof ranked)[number]) => ({
          position: row.position,
          displayName: row.displayName,
          rank: row.rank,
          previousRank: row.previousRank,
          rankDelta:
            row.previousRank === null ? null : row.previousRank - row.rank,
          isSelf: row.id === scope.teacherProfileId,
        });
        const value = Number(ownValue?.value ?? 0n);
        if (!Number.isSafeInteger(value) || value < 0) invalidSource();
        return {
          metric: query.metric,
          month,
          timezone,
          asOf: now.toISOString(),
          revision,
          rows: ranked
            .slice(
              (query.page - 1) * query.pageSize,
              query.page * query.pageSize,
            )
            .map(present),
          own: {
            value,
            rank: ownRow?.rank ?? null,
            previousRank: ownRow?.previousRank ?? null,
            rankDelta:
              ownRow?.previousRank == null
                ? null
                : ownRow.previousRank - ownRow.rank,
            hasActivity: !!ownValue,
          },
          meta: {
            page: query.page,
            pageSize: query.pageSize,
            total: ranked.length,
            totalPages: Math.ceil(ranked.length / query.pageSize),
          },
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 20000,
      },
    );
    await this.assertOwner(this.prisma, scope);
    return result;
  }

  private async assertOwner(tx: Pick<Client, 'user'>, scope: TeacherScope) {
    const user = await tx.user.findUnique({
      where: { id: scope.userId },
      select: {
        status: true,
        roles: { select: { roleCode: true, campusId: true } },
        teacherProfile: {
          select: { id: true, isActive: true, campusId: true },
        },
      },
    });
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      user.roles.length !== 1 ||
      user.roles[0].roleCode !== 'TEACHER' ||
      user.roles[0].campusId !== scope.campusId ||
      user.teacherProfile?.id !== scope.teacherProfileId ||
      !user.teacherProfile.isActive ||
      user.teacherProfile.campusId !== scope.campusId
    ) {
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        '当前教师身份已失效，请重新登录',
        403,
      );
    }
  }

  private async collect(
    tx: Client,
    campusId: string,
    metric: TeacherRankingMetric,
    start: Date,
    end: Date,
    now: Date,
  ): Promise<Value[]> {
    if (metric === 'ATTENDANCE') {
      return tx.$queryRaw<Value[]>`
        SELECT t."id", COUNT(a."id")::bigint AS "value"
        FROM "AttendanceRecord" a
        JOIN "LessonSession" l ON l."id" = a."lessonSessionId"
        JOIN "TeachingRecord" r ON r."lessonSessionId" = l."id"
        JOIN "TeacherProfile" t ON t."id" = r."teacherId"
        JOIN "Student" s ON s."id" = a."studentId"
        WHERE a."campusId" = ${campusId}::uuid AND l."campusId" = ${campusId}::uuid
          AND r."campusId" = ${campusId}::uuid AND t."campusId" = ${campusId}::uuid
          AND s."campusId" = ${campusId}::uuid
          AND r."teacherId" = l."teacherId" AND a."status" = 'PRESENT'
          AND a."includedInFinalRoster" = TRUE
          AND r."status" = 'COMPLETED' AND l."status" = 'COMPLETED'
          AND r."completedAt" <= ${now}
          AND l."startsAt" >= ${start} AND l."startsAt" < ${end} AND l."startsAt" <= ${now}
        GROUP BY t."id"`;
    }
    const bases = await tx.teacherEarningBasis.findMany({
      where: {
        campusId,
        teacher: { campusId },
        lessonSession: {
          campusId,
          startsAt: { gte: start, lt: end, lte: now },
        },
      },
      select: {
        id: true,
        teacherProfileId: true,
        status: true,
        teachingRecordId: true,
        lessonSessionId: true,
        teachingRecord: {
          select: {
            id: true,
            campusId: true,
            teacherId: true,
            lessonSessionId: true,
            status: true,
          },
        },
        lessonSession: { select: { id: true, teacherId: true, status: true } },
        entries: {
          where: { createdAt: { lte: now } },
          select: {
            id: true,
            campusId: true,
            teacherProfileId: true,
            entryType: true,
            amountFen: true,
            status: true,
            reversalOfId: true,
          },
        },
      },
    });
    const totals = new Map<string, bigint>();
    for (const basis of bases) {
      const record = basis.teachingRecord,
        lesson = basis.lessonSession;
      if (
        record.campusId !== campusId ||
        record.teacherId !== basis.teacherProfileId ||
        lesson.teacherId !== basis.teacherProfileId ||
        record.lessonSessionId !== lesson.id ||
        record.id !== basis.teachingRecordId
      )
        continue;
      if (
        basis.entries.some(
          (entry) =>
            entry.campusId !== campusId ||
            entry.teacherProfileId !== basis.teacherProfileId,
        )
      )
        continue;
      let amount = 0n;
      if (
        basis.status === 'PRICED' &&
        record.status === 'COMPLETED' &&
        lesson.status === 'COMPLETED'
      ) {
        for (const entry of basis.entries) {
          if (entry.status === 'REJECTED') continue;
          if (
            entry.entryType !== 'ACCRUAL' ||
            !['PENDING_REVIEW', 'AVAILABLE'].includes(entry.status) ||
            entry.reversalOfId ||
            entry.amountFen < 0
          )
            invalidSource();
          amount += BigInt(entry.amountFen);
        }
      } else if (
        basis.status === 'REVERSED' &&
        record.status === 'REVERSED' &&
        lesson.status === 'REVERSED'
      ) {
        for (const entry of basis.entries) {
          if (entry.entryType === 'ACCRUAL') {
            const reverse = basis.entries.find(
              (row) => row.reversalOfId === entry.id,
            );
            if (
              !reverse ||
              reverse.entryType !== 'REVERSAL' ||
              reverse.amountFen !== -entry.amountFen ||
              entry.status !== 'REVERSED' ||
              reverse.status !== 'REVERSED'
            )
              invalidSource();
          } else if (
            !basis.entries.some(
              (row) =>
                row.id === entry.reversalOfId && row.entryType === 'ACCRUAL',
            )
          )
            invalidSource();
        }
        // A valid reversed source contributes its original amount plus the paired negative entry.
        amount = basis.entries.reduce(
          (sum, entry) => sum + BigInt(entry.amountFen),
          0n,
        );
        if (amount !== 0n) invalidSource();
      } else continue;
      if (basis.entries.length)
        totals.set(
          basis.teacherProfileId,
          (totals.get(basis.teacherProfileId) ?? 0n) + amount,
        );
    }
    return [...totals].map(([id, value]) => ({ id, value }));
  }
}
