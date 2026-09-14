import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PartnerScopeService } from '../../common/auth/partner-scope.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  ManagementPartnerEarningsQueryDto,
  PartnerEarningPeriodQueryDto,
  PartnerEarningsQueryDto,
} from './dto/partner-earning.dto';
import { toPartnerEarningRuleView } from './partner-earning-rule-management.service';
import { PartnerEarningRuleService } from './partner-earning-rule.service';
import { resolvePartnerPeriodRange } from '../partner/partner-period';

@Injectable()
export class PartnerEarningQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partnerScopeService: PartnerScopeService,
    private readonly ruleService: PartnerEarningRuleService,
  ) {}

  async getSummary(
    actor: AuthenticatedUser,
    query: PartnerEarningPeriodQueryDto = {},
  ) {
    const scope = this.partnerScopeService.require(actor);
    const periodWhere = await this.periodWhere(scope.campusId, query);
    const where: Prisma.PartnerEarningEntryWhereInput = {
      campusId: scope.campusId,
      ...periodWhere,
    };
    const [total, pending, available, reversals] = await Promise.all([
      this.prisma.partnerEarningEntry.aggregate({
        where,
        _sum: { amountFen: true },
      }),
      this.prisma.partnerEarningEntry.aggregate({
        where: { ...where, status: 'PENDING_REVIEW' },
        _sum: { amountFen: true },
      }),
      this.prisma.partnerEarningEntry.aggregate({
        where: { ...where, status: 'AVAILABLE' },
        _sum: { amountFen: true },
      }),
      this.prisma.partnerEarningEntry.aggregate({
        where: { ...where, entryType: 'REVERSAL' },
        _sum: { amountFen: true },
      }),
    ]);
    return {
      estimatedTotalFen: total._sum.amountFen ?? 0,
      pendingReviewFen: pending._sum.amountFen ?? 0,
      availableFen: available._sum.amountFen ?? 0,
      reversedNetFen: reversals._sum.amountFen ?? 0,
      currency: 'CNY' as const,
    };
  }

  async getCurrentRule(actor: AuthenticatedUser) {
    const scope = this.partnerScopeService.require(actor);
    const effective = await this.ruleService.findEffectiveRule({
      campusId: scope.campusId,
      at: new Date(),
    });
    if (!effective) {
      return null;
    }
    const rule = await this.prisma.partnerEarningRule.findUniqueOrThrow({
      where: { id: effective.id },
      include: { campus: { select: { name: true } } },
    });
    return toPartnerEarningRuleView(rule);
  }

  listForPartner(actor: AuthenticatedUser, query: PartnerEarningsQueryDto) {
    const scope = this.partnerScopeService.require(actor);
    return this.listEntries(query, scope.campusId, query);
  }

  listManaged(query: ManagementPartnerEarningsQueryDto) {
    return this.listEntries(query, query.campusId);
  }

  async getEntryView(
    entryId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const entry = await client.partnerEarningEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: entryInclude,
    });
    return toPartnerEarningEntryView(entry);
  }

  private async listEntries(
    query: PartnerEarningsQueryDto | ManagementPartnerEarningsQueryDto,
    campusId?: string,
    periodQuery?: PartnerEarningPeriodQueryDto,
  ) {
    const periodWhere = campusId && periodQuery
      ? await this.periodWhere(campusId, periodQuery)
      : {};
    const where: Prisma.PartnerEarningEntryWhereInput = {
      ...(campusId ? { campusId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...periodWhere,
    };
    const [entries, total] = await Promise.all([
      this.prisma.partnerEarningEntry.findMany({
        where,
        include: entryInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.partnerEarningEntry.count({ where }),
    ]);
    return {
      data: entries.map(toPartnerEarningEntryView),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  private async periodWhere(
    campusId: string,
    query: PartnerEarningPeriodQueryDto,
  ): Promise<Prisma.PartnerEarningEntryWhereInput> {
    if (!query.period && !query.anchorDate) return {};
    const campus = await this.prisma.campus.findUniqueOrThrow({
      where: { id: campusId },
      select: { timezone: true },
    });
    const range = resolvePartnerPeriodRange(
      query.period ?? 'MONTH',
      query.anchorDate,
      campus.timezone,
    );
    return {
      earningBasis: {
        completedAt: { gte: range.start, lt: range.end },
      },
    };
  }
}

const entryInclude = {
  campus: { select: { name: true } },
  earningBasis: {
    select: {
      teachingRecordId: true,
      lessonSessionId: true,
      actualAttendeeCount: true,
      countedAttendeeCount: true,
      completedAt: true,
      lessonSession: {
        select: {
          startsAt: true,
          classGroup: { select: { courseName: true } },
        },
      },
    },
  },
} satisfies Prisma.PartnerEarningEntryInclude;

type EntryWithViewRelations = Prisma.PartnerEarningEntryGetPayload<{
  include: typeof entryInclude;
}>;

function toPartnerEarningEntryView(entry: EntryWithViewRelations) {
  const snapshot = asSnapshot(entry.ruleSnapshot);
  return {
    id: entry.id,
    campusId: entry.campusId,
    campusName: entry.campus.name,
    teachingRecordId: entry.earningBasis.teachingRecordId,
    lessonSessionId: entry.earningBasis.lessonSessionId,
    courseName: entry.earningBasis.lessonSession.classGroup.courseName,
    lessonStartsAt: entry.earningBasis.lessonSession.startsAt.toISOString(),
    completedAt: entry.earningBasis.completedAt.toISOString(),
    entryType: entry.entryType,
    amountFen: entry.amountFen,
    status: entry.status,
    unitPriceFen: integerFromSnapshot(snapshot, 'unitPriceFen'),
    shareBasisPoints: integerFromSnapshot(snapshot, 'shareBasisPoints'),
    actualAttendeeCount: entry.earningBasis.actualAttendeeCount,
    countedAttendeeCount: entry.earningBasis.countedAttendeeCount,
    perAttendeeAmountFen: integerFromSnapshot(
      snapshot,
      'perAttendeeAmountFen',
    ),
    reviewableAt: entry.reviewableAt.toISOString(),
    reviewedAt: entry.reviewedAt?.toISOString() ?? null,
    reviewReason: entry.reviewReason,
    createdAt: entry.createdAt.toISOString(),
    version: entry.version,
  };
}

function asSnapshot(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function integerFromSnapshot(
  snapshot: Record<string, Prisma.JsonValue>,
  field: string,
): number {
  const value = snapshot[field];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;
}
