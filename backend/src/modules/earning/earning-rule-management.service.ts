import { Injectable } from '@nestjs/common';
import { Prisma, type TeacherEarningRule } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  CreateTeacherEarningRuleDto,
  ManagementEarningRulesQueryDto,
  RetireConfigurationDto,
  VersionedActionDto,
} from './dto/earning.dto';
import { toRuleView } from './earning-query.service';

@Injectable()
export class EarningRuleManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async list(query: ManagementEarningRulesQueryDto) {
    const where: Prisma.TeacherEarningRuleWhereInput = {
      ...(query.campusId ? { campusId: query.campusId } : {}),
      ...(query.teacherId ? { teacherProfileId: query.teacherId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rules, total] = await Promise.all([
      this.prisma.teacherEarningRule.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.teacherEarningRule.count({ where }),
    ]);
    return {
      data: rules.map(toRuleView),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateTeacherEarningRuleDto,
    idempotencyKey: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotencyService.claim(transaction, {
        key: idempotencyKey,
        route: '/management/earning-rules',
        request: dto,
        campusId: dto.campusId,
        actorUserId: actor.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }

      await this.validateScope(
        transaction,
        dto.campusId,
        dto.teacherId ?? null,
      );
      const scopeKey = dto.teacherId
        ? `teacher:${dto.teacherId}`
        : `campus:${dto.campusId}:default`;
      await lockScope(transaction, scopeKey);
      const latest = await transaction.teacherEarningRule.aggregate({
        where: { scopeKey },
        _max: { version: true },
      });
      const rule = await transaction.teacherEarningRule.create({
        data: {
          campusId: dto.campusId,
          teacherProfileId: dto.teacherId ?? null,
          scopeKey,
          basisType: dto.basisType,
          unitAmountFen: dto.unitAmountFen,
          eligibleLessonKinds: dto.eligibleLessonKinds,
          countedAttendanceStatuses: dto.countedAttendanceStatuses,
          settlementDelayDays: dto.settlementDelayDays,
          version: (latest._max.version ?? 0) + 1,
          status: 'DRAFT',
          effectiveFrom: new Date(dto.effectiveFrom),
          effectiveTo: null,
          createdByUserId: actor.userId,
        },
      });
      const result = toRuleView(rule);
      await this.writeAudit(transaction, actor.userId, rule, 'CREATE');
      await this.idempotencyService.complete(transaction, {
        key: idempotencyKey,
        route: '/management/earning-rules',
        responseBody: asJson(result),
      });
      return result;
    });
  }

  async activate(
    actor: AuthenticatedUser,
    ruleId: string,
    dto: VersionedActionDto,
    idempotencyKey: string,
  ) {
    return this.transition(
      actor,
      ruleId,
      dto,
      idempotencyKey,
      'activate',
      async (transaction, rule) => {
        if (rule.status !== 'DRAFT' || rule.version !== dto.expectedVersion) {
          this.stateConflict(rule);
        }
        const overlaps = await transaction.teacherEarningRule.findMany({
          where: {
            scopeKey: rule.scopeKey,
            id: { not: rule.id },
            status: 'ACTIVE',
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gt: rule.effectiveFrom } },
            ],
          },
          orderBy: { effectiveFrom: 'asc' },
        });
        for (const existing of overlaps) {
          if (existing.effectiveFrom >= rule.effectiveFrom) {
            throw new DomainError(
              ErrorCode.EARNING_RULE_OVERLAP,
              'The earning rule overlaps another active version',
              409,
              { ruleId: existing.id },
            );
          }
          await transaction.teacherEarningRule.update({
            where: { id: existing.id },
            data: {
              effectiveTo: rule.effectiveFrom,
              status:
                rule.effectiveFrom.getTime() <= Date.now()
                  ? 'RETIRED'
                  : 'ACTIVE',
            },
          });
        }
        return transaction.teacherEarningRule.update({
          where: { id: rule.id },
          data: { status: 'ACTIVE' },
        });
      },
    );
  }

  async retire(
    actor: AuthenticatedUser,
    ruleId: string,
    dto: RetireConfigurationDto,
    idempotencyKey: string,
  ) {
    return this.transition(
      actor,
      ruleId,
      dto,
      idempotencyKey,
      'retire',
      async (transaction, rule) => {
        const effectiveTo = new Date(dto.effectiveTo);
        if (
          rule.status !== 'ACTIVE' ||
          rule.version !== dto.expectedVersion ||
          effectiveTo <= rule.effectiveFrom
        ) {
          this.stateConflict(rule);
        }
        return transaction.teacherEarningRule.update({
          where: { id: rule.id },
          data: { status: 'RETIRED', effectiveTo },
        });
      },
    );
  }

  private async transition(
    actor: AuthenticatedUser,
    ruleId: string,
    dto: VersionedActionDto,
    idempotencyKey: string,
    action: 'activate' | 'retire',
    mutate: (
      transaction: Prisma.TransactionClient,
      rule: TeacherEarningRule,
    ) => Promise<TeacherEarningRule>,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const initial = await transaction.teacherEarningRule.findUnique({
        where: { id: ruleId },
      });
      if (!initial) {
        throw new DomainError(
          ErrorCode.EARNING_RULE_NOT_FOUND,
          'The earning rule was not found',
          404,
        );
      }
      const route = `/management/earning-rules/${ruleId}/${action}`;
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
      await lockScope(transaction, initial.scopeKey);
      const rule = await transaction.teacherEarningRule.findUniqueOrThrow({
        where: { id: ruleId },
      });
      const updated = await mutate(transaction, rule);
      const result = toRuleView(updated);
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

  private async validateScope(
    transaction: Prisma.TransactionClient,
    campusId: string,
    teacherProfileId: string | null,
  ): Promise<void> {
    const campus = await transaction.campus.findUnique({
      where: { id: campusId },
      select: { id: true },
    });
    if (!campus) {
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'The campus was not found',
        404,
      );
    }
    if (teacherProfileId) {
      const teacher = await transaction.teacherProfile.findFirst({
        where: { id: teacherProfileId, campusId, isActive: true },
        select: { id: true },
      });
      if (!teacher) {
        throw new DomainError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'The teacher was not found in the campus',
          404,
        );
      }
    }
  }

  private stateConflict(rule: {
    id: string;
    status: string;
    version: number;
  }): never {
    throw new DomainError(
      ErrorCode.CONFLICT,
      'The earning rule state or version has changed',
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
        action: `TEACHER_EARNING_RULE_${action}`,
        resourceType: 'TeacherEarningRule',
        resourceId: rule.id,
        outcome: 'SUCCESS',
        details: { version: rule.version },
      },
    });
  }
}

async function lockScope(
  transaction: Prisma.TransactionClient,
  scopeKey: string,
): Promise<void> {
  const [scopeType, scopeId] = scopeKey.split(':');
  if (!scopeId) {
    throw new Error('Invalid earning rule scope key');
  }
  if (scopeType === 'teacher') {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "TeacherProfile"
      WHERE "id" = ${scopeId}::uuid
      FOR UPDATE
    `;
    return;
  }
  await transaction.$queryRaw`
    SELECT "id"
    FROM "Campus"
    WHERE "id" = ${scopeId}::uuid
    FOR UPDATE
  `;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
