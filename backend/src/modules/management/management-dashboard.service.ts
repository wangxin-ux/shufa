import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { lessonBalanceSelect, summarizeLessonBalances } from '../lesson-ledger/lesson-balance';
import type {
  ManagementDashboardQueryDto,
  ManagementRevenuePeriod,
} from './dto/management.dto';

const REPORTING_TIME_ZONE = 'Asia/Shanghai' as const;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

const REVENUE_PERIOD_LABELS: Record<ManagementRevenuePeriod, string> = {
  TODAY: '今日',
  LAST_7_DAYS: '近7天',
  CURRENT_MONTH: '本月',
  HISTORY: '历史',
};

interface RevenueCampusInput {
  id: string;
  name: string;
  partnerCount: number;
}

interface RevenueEntryInput {
  campusId: string;
  entryType: 'ACCRUAL' | 'REVERSAL';
  amountFen: number;
  unitPriceFen: number;
  countedAttendeeCount: number;
}

export function buildShanghaiRevenueRange(
  period: ManagementRevenuePeriod,
  now: Date,
): { from: Date | null; to: Date | null } {
  if (period === 'HISTORY') {
    return { from: null, to: null };
  }

  const local = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  const todayUtc = Date.UTC(year, month, day) - SHANGHAI_OFFSET_MS;

  if (period === 'TODAY') {
    return {
      from: new Date(todayUtc),
      to: new Date(todayUtc + 24 * 60 * 60 * 1000),
    };
  }
  if (period === 'LAST_7_DAYS') {
    return {
      from: new Date(todayUtc - 6 * 24 * 60 * 60 * 1000),
      to: new Date(todayUtc + 24 * 60 * 60 * 1000),
    };
  }
  return {
    from: new Date(Date.UTC(year, month, 1) - SHANGHAI_OFFSET_MS),
    to: new Date(Date.UTC(year, month + 1, 1) - SHANGHAI_OFFSET_MS),
  };
}

export function summarizeManagementRevenue(
  campuses: RevenueCampusInput[],
  entries: RevenueEntryInput[],
) {
  const rows = campuses.map((campus) => ({
    campusId: campus.id,
    campusName: campus.name,
    partnerCount: campus.partnerCount,
    countedAttendeeCount: 0,
    grossLessonRevenueFen: 0,
    partnerEarningFen: 0,
    headquartersRetainedFen: 0,
  }));
  const rowByCampus = new Map(rows.map((row) => [row.campusId, row]));

  for (const entry of entries) {
    const row = rowByCampus.get(entry.campusId);
    if (!row) continue;
    const sign = entry.entryType === 'REVERSAL' ? -1 : 1;
    const attendeeCount = sign * entry.countedAttendeeCount;
    row.countedAttendeeCount += attendeeCount;
    row.grossLessonRevenueFen += entry.unitPriceFen * attendeeCount;
    row.partnerEarningFen += entry.amountFen;
  }

  for (const row of rows) {
    row.headquartersRetainedFen =
      row.grossLessonRevenueFen - row.partnerEarningFen;
  }

  return {
    partnerCount: rows.reduce((total, row) => total + row.partnerCount, 0),
    countedAttendeeCount: rows.reduce(
      (total, row) => total + row.countedAttendeeCount,
      0,
    ),
    grossLessonRevenueFen: rows.reduce(
      (total, row) => total + row.grossLessonRevenueFen,
      0,
    ),
    partnerEarningFen: rows.reduce(
      (total, row) => total + row.partnerEarningFen,
      0,
    ),
    headquartersRetainedFen: rows.reduce(
      (total, row) => total + row.headquartersRetainedFen,
      0,
    ),
    currency: 'CNY' as const,
    campuses: rows,
  };
}

@Injectable()
export class ManagementDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(
    user: AuthenticatedUser,
    query: ManagementDashboardQueryDto = { revenuePeriod: 'TODAY' },
  ) {
    const administrator = await this.requireAdministrator(user);
    const now = new Date();
    const monthStart = this.shanghaiMonthStart(now);
    const revenuePeriod = query.revenuePeriod ?? 'TODAY';
    const revenueRange = buildShanghaiRevenueRange(revenuePeriod, now);
    const revenueCreatedAt =
      revenueRange.from && revenueRange.to
        ? { gte: revenueRange.from, lt: revenueRange.to }
        : undefined;
    const [campuses, revenueEntries] = await Promise.all([
      this.prisma.campus.findMany({
        orderBy: { code: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          lessonWarningThresholdUnits: true,
          userRoles: {
            where: { roleCode: 'PARTNER', user: { status: 'ACTIVE' } },
            select: { id: true },
          },
          students: {
            where: { isActive: true },
            select: {
              id: true,
              coursePackages: {
                where: {
                  isActive: true,
                  validFrom: { lte: now },
                  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                },
                select: lessonBalanceSelect,
              },
            },
          },
          lessonSessions: {
            where: {
              status: 'COMPLETED',
              startsAt: { gte: monthStart, lte: now },
            },
            select: {
              id: true,
              attendanceRecords: { select: { status: true } },
            },
          },
        },
      }),
      this.prisma.partnerEarningEntry.findMany({
        where: {
          status: { not: 'REJECTED' },
          ...(revenueCreatedAt ? { createdAt: revenueCreatedAt } : {}),
        },
        select: {
          campusId: true,
          entryType: true,
          amountFen: true,
          ruleSnapshot: true,
          earningBasis: { select: { countedAttendeeCount: true } },
        },
      }),
    ]);
    const revenue = summarizeManagementRevenue(
      campuses.map((campus) => ({
        id: campus.id,
        name: campus.name,
        partnerCount: campus.userRoles.length,
      })),
      revenueEntries.map((entry) => ({
        campusId: entry.campusId,
        entryType: entry.entryType,
        amountFen: entry.amountFen,
        unitPriceFen: snapshotInteger(entry.ruleSnapshot, 'unitPriceFen'),
        countedAttendeeCount: entry.earningBasis.countedAttendeeCount,
      })),
    );

    const summaries = campuses.map((campus) => {
      const warningStudentCount = campus.students.filter((student) => {
        const balance = summarizeLessonBalances(student.coursePackages).availableTotalUnits;
        return balance <= campus.lessonWarningThresholdUnits;
      }).length;
      const attendance = campus.lessonSessions.flatMap(
        (lesson) => lesson.attendanceRecords,
      );
      const presentCount = attendance.filter(
        (record) => record.status === 'PRESENT',
      ).length;
      return {
        id: campus.id,
        code: campus.code,
        name: campus.name,
        activeStudentCount: campus.students.length,
        monthCompletedLessonCount: campus.lessonSessions.length,
        attendanceRatePercent:
          attendance.length === 0
            ? 0
            : Math.round((presentCount / attendance.length) * 100),
        warningStudentCount,
      };
    });
    const featured = [...summaries].sort(
      (left, right) =>
        right.activeStudentCount - left.activeStudentCount ||
        left.code.localeCompare(right.code),
    )[0];

    return {
      administrator: { displayName: administrator.displayName },
      reportingTimeZone: REPORTING_TIME_ZONE,
      campusCount: campuses.length,
      activeStudentCount: summaries.reduce(
        (total, item) => total + item.activeStudentCount,
        0,
      ),
      monthCompletedLessonCount: summaries.reduce(
        (total, item) => total + item.monthCompletedLessonCount,
        0,
      ),
      warningStudentCount: summaries.reduce(
        (total, item) => total + item.warningStudentCount,
        0,
      ),
      featuredCampus: featured
        ? {
            id: featured.id,
            name: featured.name,
            activeStudentCount: featured.activeStudentCount,
            monthCompletedLessonCount: featured.monthCompletedLessonCount,
            attendanceRatePercent: featured.attendanceRatePercent,
            warningStudentCount: featured.warningStudentCount,
          }
        : null,
      revenue: {
        period: revenuePeriod,
        periodLabel: REVENUE_PERIOD_LABELS[revenuePeriod],
        ...revenue,
      },
      serverTime: now.toISOString(),
    };
  }

  async getProfile(user: AuthenticatedUser) {
    const administrator = await this.requireAdministrator(user);
    return {
      displayName: administrator.displayName,
      roleCode: 'SUPER_ADMIN' as const,
      campusId: null,
      campusName: '全部校区',
    };
  }

  private async requireAdministrator(user: AuthenticatedUser) {
    const hasGlobalRole = user.roles.some(
      (role) => role.code === 'SUPER_ADMIN' && role.campusId === null,
    );
    if (!hasGlobalRole) {
      this.forbidden();
    }
    const administrator = await this.prisma.user.findFirst({
      where: {
        id: user.userId,
        status: 'ACTIVE',
        roles: { some: { roleCode: 'SUPER_ADMIN', campusId: null } },
      },
      select: { displayName: true },
    });
    if (!administrator) {
      this.forbidden();
    }
    return administrator;
  }

  private shanghaiMonthStart(now: Date): Date {
    const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return new Date(
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) -
        8 * 60 * 60 * 1000,
    );
  }

  private forbidden(): never {
    throw new DomainError(
      ErrorCode.FORBIDDEN,
      'The authenticated account cannot access global management data',
      403,
    );
  }
}

function snapshotInteger(value: Prisma.JsonValue, field: string): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const item = (value as Record<string, Prisma.JsonValue>)[field];
  return typeof item === 'number' && Number.isSafeInteger(item) ? item : 0;
}
