import { Injectable } from '@nestjs/common';
import { Prisma, type PartnerEarningRule } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { VersionedActionDto } from '../earning/dto/earning.dto';
import type {
  CreatePartnerEarningRuleDto,
  ManagementPartnerEarningRulesQueryDto,
} from './dto/partner-earning.dto';
import { partnerEarningScopeKey } from './partner-earning-rule.service';

type RuleWithCampus = PartnerEarningRule & { campus: { name: string } };

@Injectable()
export class PartnerEarningRuleManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async list(query: ManagementPartnerEarningRulesQueryDto) {
    const where: Prisma.PartnerEarningRuleWhereInput = {
      ...(query.campusId ? { campusId: query.campusId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rules, total] = await Promise.all([
      this.prisma.partnerEarningRule.findMany({
        where,
        include: { campus: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.partnerEarningRule.count({ where }),
    ]);
    return {
      data: rules.map(toPartnerEarningRuleView),
      meta: pageMeta(total, query.page, query.pageSize),
    };
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreatePartnerEarningRuleDto,
    idempotencyKey: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const route = '/management/partner-earning-rules';
      const claim = await this.idempotencyService.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: dto.campusId,
        actorUserId: actor.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }
      const campus = await transaction.campus.findUnique({
        where: { id: dto.campusId },
        select: { id: true, name: true },
      });
      if (!campus) {
        throw new DomainError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'The campus was not found',
          404,
        );
      }
      await lockCampus(transaction, campus.id);
      const scopeKey = partnerEarningScopeKey(campus.id);
      const latest = await transaction.partnerEarningRule.aggregate({
        where: { scopeKey },
        _max: { version: true },
      });
      const rule = await transaction.partnerEarningRule.create({
        data: {
          campusId: campus.id,
          scopeKey,
          unitPriceFen: dto.unitPriceFen,
          shareBasisPoints: dto.shareBasisPoints,
          eligibleLessonKinds: dto.eligibleLessonKinds,
          countedAttendanceStatuses: dto.countedAttendanceStatuses,
          settlementDelayDays: dto.settlementDelayDays,
          version: (latest._max.version ?? 0) + 1,
          status: 'DRAFT',
          effectiveFrom: new Date(dto.effectiveFrom),
          effectiveTo: null,
          createdByUserId: actor.userId,
        },
        include: { campus: { select: { name: true } } },
      });
      const result = toPartnerEarningRuleView(rule);
      await this.writeAudit(transaction, actor.userId, rule, 'CREATE');
      await this.idempotencyService.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: asJson(result),
      });
      return result;
    });
  }

  activate(
    actor: AuthenticatedUser,
    ruleId: string,
    dto: VersionedActionDto,
    idempotencyKey: string,
  ) {
    return this.transition(actor, ruleId, dto, idempotencyKey, 'activate');
  }

  retire(
    actor: AuthenticatedUser,
    ruleId: string,
    dto: VersionedActionDto,
    idempotencyKey: string,
  ) {
    return this.transition(actor, ruleId, dto, idempotencyKey, 'retire');
  }

  private async transition(
    actor: AuthenticatedUser,
    ruleId: string,
    dto: VersionedActionDto,
    idempotencyKey: string,
    action: 'activate' | 'retire',
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const initial = await transaction.partnerEarningRule.findUnique({
        where: { id: ruleId },
      });
      if (!initial) {
        throw new DomainError(
          ErrorCode.EARNING_RULE_NOT_FOUND,
          'The partner earning rule was not found',
          404,
        );
      }
      const route = `/management/partner-earning-rules/${ruleId}/${action}`;
      const claim = await this.idempotencyService.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: initial.campusId,
        actorUserId: actor.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }
      await lockCampus(transaction, initial.campusId);
      const rule = await transaction.partnerEarningRule.findUniqueOrThrow({
        where: { id: ruleId },
      });
      if (rule.version !== dto.expectedVersion) {
        this.stateConflict(rule);
      }

      const now = new Date();
      let updated: RuleWithCampus;
      if (action === 'activate') {
        if (rule.status !== 'DRAFT') {
          this.stateConflict(rule);
        }
        await transaction.partnerEarningRule.updateMany({
          where: { scopeKey: rule.scopeKey, status: 'ACTIVE' },
          data: { status: 'RETIRED', effectiveTo: now },
        });
        updated = await transaction.partnerEarningRule.update({
          where: { id: rule.id },
          data: { status: 'ACTIVE', effectiveTo: null },
          include: { campus: { select: { name: true } } },
        });
      } else {
        if (rule.status !== 'ACTIVE' || now <= rule.effectiveFrom) {
          this.stateConflict(rule);
        }
        updated = await transaction.partnerEarningRule.update({
          where: { id: rule.id },
          data: { status: 'RETIRED', effectiveTo: now },
          include: { campus: { select: { name: true } } },
        });
      }

      const result = toPartnerEarningRuleView(updated);
      await this.writeAudit(
        transaction,
        actor.userId,
        updated,
        action.toUpperCase(),
      );
      await this.idempotencyService.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: asJson(result),
      });
      return result;
    });
  }

  private stateConflict(rule: {
    id: string;
    status: string;
    version: number;
  }): never {
    throw new DomainError(
      ErrorCode.CONFLICT,
      'The partner earning rule state or version has changed',
      409,
      { ruleId: rule.id, status: rule.status, version: rule.version },
    );
  }

  private async writeAudit(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    rule: { id: string; campusId: string; version: number },
    action: string,
  ): Promise<void> {
    await transaction.auditLog.create({
      data: {
        campusId: rule.campusId,
        actorUserId,
        action: `PARTNER_EARNING_RULE_${action}`,
        resourceType: 'PartnerEarningRule',
        resourceId: rule.id,
        outcome: 'SUCCESS',
        details: { version: rule.version },
      },
    });
  }
}

export function toPartnerEarningRuleView(rule: RuleWithCampus) {
  return {
    id: rule.id,
    campusId: rule.campusId,
    campusName: rule.campus.name,
    unitPriceFen: rule.unitPriceFen,
    shareBasisPoints: rule.shareBasisPoints,
    eligibleLessonKinds: rule.eligibleLessonKinds,
    countedAttendanceStatuses: rule.countedAttendanceStatuses,
    settlementDelayDays: rule.settlementDelayDays,
    version: rule.version,
    status: rule.status,
    effectiveFrom: rule.effectiveFrom.toISOString(),
    effectiveTo: rule.effectiveTo?.toISOString() ?? null,
    createdAt: rule.createdAt.toISOString(),
  };
}

async function lockCampus(
  transaction: Prisma.TransactionClient,
  campusId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id" FROM "Campus" WHERE "id" = ${campusId}::uuid FOR UPDATE
  `;
}

function pageMeta(total: number, page: number, pageSize: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
