import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TeacherScope } from '../../common/auth/teacher-scope.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  ManagementTeacherEarningsQueryDto,
  TeacherEarningsQueryDto,
} from './dto/earning.dto';
import {
  EarningRuleService,
  type TeacherEarningRuleCandidate,
} from './earning-rule.service';

const earningEntryViewSelect =
  Prisma.validator<Prisma.TeacherEarningEntrySelect>()({
    id: true,
    campusId: true,
    teacherProfileId: true,
    entryType: true,
    amountFen: true,
    status: true,
    ruleSnapshot: true,
    reviewableAt: true,
    reviewedAt: true,
    reviewReason: true,
    createdAt: true,
    version: true,
    teacher: { select: { user: { select: { displayName: true } } } },
    earningBasis: {
      select: {
        teachingRecordId: true,
        lessonSessionId: true,
        lessonSession: {
          select: {
            startsAt: true,
            classGroup: { select: { courseName: true } },
          },
        },
      },
    },
  });

type EarningEntryRow = Prisma.TeacherEarningEntryGetPayload<{
  select: typeof earningEntryViewSelect;
}>;
type EarningEntryReader = Pick<Prisma.TransactionClient, 'teacherEarningEntry'>;

const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1_000;

export function teacherEarningPeriodBounds(now = new Date()) {
  const shanghaiNow = new Date(now.getTime() + SHANGHAI_UTC_OFFSET_MS);
  const year = shanghaiNow.getUTCFullYear();
  const month = shanghaiNow.getUTCMonth();
  const day = shanghaiNow.getUTCDate();
  const daysSinceMonday = (shanghaiNow.getUTCDay() + 6) % 7;
  const atShanghaiMidnight = (
    targetYear: number,
    targetMonth: number,
    targetDay: number,
  ) =>
    new Date(
      Date.UTC(targetYear, targetMonth, targetDay) - SHANGHAI_UTC_OFFSET_MS,
    );

  return {
    todayFrom: atShanghaiMidnight(year, month, day),
    tomorrowFrom: atShanghaiMidnight(year, month, day + 1),
    weekFrom: atShanghaiMidnight(year, month, day - daysSinceMonday),
    nextWeekFrom: atShanghaiMidnight(
      year,
      month,
      day - daysSinceMonday + 7,
    ),
    monthFrom: atShanghaiMidnight(year, month, 1),
    nextMonthFrom: atShanghaiMidnight(year, month + 1, 1),
  };
}

@Injectable()
export class EarningQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly earningRuleService: EarningRuleService,
  ) {}

  async getTeacherSummary(scope: TeacherScope) {
    const activeWithdrawalStatuses = [
      'SUBMITTED',
      'APPROVED',
      'PAYING',
    ] as const;
    const unavailableWithdrawalStatuses = [
      ...activeWithdrawalStatuses,
      'PAID',
    ] as const;
    const periods = teacherEarningPeriodBounds();
    const estimatedWhere: Prisma.TeacherEarningEntryWhereInput = {
      teacherProfileId: scope.teacherProfileId,
      status: { not: 'REJECTED' },
    };
    const [
      todayEstimated,
      weekEstimated,
      monthEstimated,
      estimated,
      pending,
      available,
      activeAllocated,
      unavailableAllocated,
    ] = await Promise.all([
      this.prisma.teacherEarningEntry.aggregate({
        where: {
          ...estimatedWhere,
          createdAt: { gte: periods.todayFrom, lt: periods.tomorrowFrom },
        },
        _sum: { amountFen: true },
      }),
      this.prisma.teacherEarningEntry.aggregate({
        where: {
          ...estimatedWhere,
          createdAt: { gte: periods.weekFrom, lt: periods.nextWeekFrom },
        },
        _sum: { amountFen: true },
      }),
      this.prisma.teacherEarningEntry.aggregate({
        where: {
          ...estimatedWhere,
          createdAt: { gte: periods.monthFrom, lt: periods.nextMonthFrom },
        },
        _sum: { amountFen: true },
      }),
      this.prisma.teacherEarningEntry.aggregate({
        where: estimatedWhere,
        _sum: { amountFen: true },
      }),
      this.prisma.teacherEarningEntry.aggregate({
        where: {
          teacherProfileId: scope.teacherProfileId,
          status: 'PENDING_REVIEW',
        },
        _sum: { amountFen: true },
      }),
      this.prisma.teacherEarningEntry.aggregate({
        where: {
          teacherProfileId: scope.teacherProfileId,
          status: 'AVAILABLE',
        },
        _sum: { amountFen: true },
      }),
      this.prisma.withdrawalAllocation.aggregate({
        where: {
          earningEntry: { teacherProfileId: scope.teacherProfileId },
          withdrawal: { status: { in: [...activeWithdrawalStatuses] } },
        },
        _sum: { amountFen: true },
      }),
      this.prisma.withdrawalAllocation.aggregate({
        where: {
          earningEntry: { teacherProfileId: scope.teacherProfileId },
          withdrawal: { status: { in: [...unavailableWithdrawalStatuses] } },
        },
        _sum: { amountFen: true },
      }),
    ]);
    const withdrawingFen = activeAllocated._sum.amountFen ?? 0;
    return {
      todayEstimatedFen: todayEstimated._sum.amountFen ?? 0,
      weekEstimatedFen: weekEstimated._sum.amountFen ?? 0,
      monthEstimatedFen: monthEstimated._sum.amountFen ?? 0,
      estimatedTotalFen: Math.max(0, estimated._sum.amountFen ?? 0),
      pendingReviewFen: Math.max(0, pending._sum.amountFen ?? 0),
      availableFen: Math.max(
        0,
        (available._sum.amountFen ?? 0) -
          (unavailableAllocated._sum.amountFen ?? 0),
      ),
      withdrawingFen,
      currency: 'CNY' as const,
    };
  }

  async getCurrentTeacherRule(scope: TeacherScope) {
    const rule = await this.earningRuleService.findEffectiveRule({
      campusId: scope.campusId,
      teacherProfileId: scope.teacherProfileId,
      at: new Date(),
    });
    return rule ? toRuleView(rule) : null;
  }

  async listTeacherEarnings(
    scope: TeacherScope,
    query: TeacherEarningsQueryDto,
  ) {
    const where: Prisma.TeacherEarningEntryWhereInput = {
      teacherProfileId: scope.teacherProfileId,
      campusId: scope.campusId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    return this.listEntries(where, query.page, query.pageSize);
  }

  async listManagedEarnings(query: ManagementTeacherEarningsQueryDto) {
    const where: Prisma.TeacherEarningEntryWhereInput = {
      ...(query.campusId ? { campusId: query.campusId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    return this.listEntries(where, query.page, query.pageSize);
  }

  async getEntryView(
    entryId: string,
    client: EarningEntryReader = this.prisma,
  ) {
    const entry = await client.teacherEarningEntry.findUniqueOrThrow({
      where: { id: entryId },
      select: earningEntryViewSelect,
    });
    return toEntryView(entry);
  }

  private async listEntries(
    where: Prisma.TeacherEarningEntryWhereInput,
    page: number,
    pageSize: number,
  ) {
    const [entries, total] = await Promise.all([
      this.prisma.teacherEarningEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: earningEntryViewSelect,
      }),
      this.prisma.teacherEarningEntry.count({ where }),
    ]);
    return {
      data: entries.map(toEntryView),
      meta: {
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }
}

export function toRuleView(rule: TeacherEarningRuleCandidate) {
  return {
    id: rule.id,
    campusId: rule.campusId,
    teacherId: rule.teacherProfileId,
    basisType: rule.basisType,
    unitAmountFen: rule.unitAmountFen,
    eligibleLessonKinds: [...rule.eligibleLessonKinds],
    countedAttendanceStatuses: [...rule.countedAttendanceStatuses],
    settlementDelayDays: rule.settlementDelayDays,
    version: rule.version,
    status: rule.status,
    effectiveFrom: rule.effectiveFrom.toISOString(),
    effectiveTo: rule.effectiveTo?.toISOString() ?? null,
    createdAt: rule.createdAt.toISOString(),
  };
}

function toEntryView(entry: EarningEntryRow) {
  const snapshot = asSnapshot(entry.ruleSnapshot);
  return {
    id: entry.id,
    campusId: entry.campusId,
    teacherId: entry.teacherProfileId,
    teacherName: entry.teacher.user.displayName,
    teachingRecordId: entry.earningBasis.teachingRecordId,
    lessonSessionId: entry.earningBasis.lessonSessionId,
    courseName: entry.earningBasis.lessonSession.classGroup.courseName,
    lessonStartsAt: entry.earningBasis.lessonSession.startsAt.toISOString(),
    entryType: entry.entryType,
    amountFen: entry.amountFen,
    status: entry.status,
    basisType: readString(snapshot, 'basisType'),
    unitAmountFen: readNumber(snapshot, 'unitAmountFen'),
    lessonUnits: readNumber(snapshot, 'lessonUnits'),
    attendeeCount: readNumber(snapshot, 'attendeeCount'),
    reviewableAt: entry.reviewableAt.toISOString(),
    reviewedAt: entry.reviewedAt?.toISOString() ?? null,
    rejectionReason:
      entry.status === 'REJECTED' ? (entry.reviewReason ?? null) : null,
    createdAt: entry.createdAt.toISOString(),
    version: entry.version,
  };
}

function asSnapshot(value: Prisma.JsonValue): Prisma.JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return value;
}

function readString(snapshot: Prisma.JsonObject, key: string): string {
  const value = snapshot[key];
  return typeof value === 'string' ? value : '';
}

function readNumber(snapshot: Prisma.JsonObject, key: string): number {
  const value = snapshot[key];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;
}
