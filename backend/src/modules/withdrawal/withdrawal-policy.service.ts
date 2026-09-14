import { Injectable } from '@nestjs/common';
import { Prisma, type TeacherWithdrawalPolicy } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  RetireConfigurationDto,
  VersionedActionDto,
} from '../earning/dto/earning.dto';
import type {
  CreateWithdrawalPolicyDto,
  WithdrawalPoliciesQueryDto,
} from './dto/withdrawal.dto';

@Injectable()
export class WithdrawalPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async list(query: WithdrawalPoliciesQueryDto) {
    const where: Prisma.TeacherWithdrawalPolicyWhereInput = query.status
      ? { status: query.status }
      : {};
    const [policies, total] = await Promise.all([
      this.prisma.teacherWithdrawalPolicy.findMany({
        where,
        orderBy: [{ version: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.teacherWithdrawalPolicy.count({ where }),
    ]);
    return {
      data: policies.map(toPolicyView),
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
    dto: CreateWithdrawalPolicyDto,
    idempotencyKey: string,
  ) {
    const route = '/management/teacher-withdrawal-policies';
    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotencyService.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: null,
        actorUserId: actor.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }
      await lockPolicies(transaction);
      const latest = await transaction.teacherWithdrawalPolicy.aggregate({
        _max: { version: true },
      });
      const policy = await transaction.teacherWithdrawalPolicy.create({
        data: {
          minimumAmountFen: dto.minimumAmountFen,
          dailyRequestLimit: dto.dailyRequestLimit,
          version: (latest._max.version ?? 0) + 1,
          status: 'DRAFT',
          effectiveFrom: new Date(dto.effectiveFrom),
          effectiveTo: null,
          createdByUserId: actor.userId,
        },
      });
      const result = toPolicyView(policy);
      await this.writeAudit(transaction, actor.userId, policy, 'CREATE');
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
    policyId: string,
    dto: VersionedActionDto,
    idempotencyKey: string,
  ) {
    return this.transition(
      actor,
      policyId,
      dto,
      idempotencyKey,
      'activate',
      async (transaction, policy) => {
        if (
          policy.status !== 'DRAFT' ||
          policy.version !== dto.expectedVersion
        ) {
          this.statusConflict(policy);
        }
        const overlaps = await transaction.teacherWithdrawalPolicy.findMany({
          where: {
            id: { not: policy.id },
            status: 'ACTIVE',
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gt: policy.effectiveFrom } },
            ],
          },
        });
        for (const existing of overlaps) {
          if (existing.effectiveFrom >= policy.effectiveFrom) {
            this.statusConflict(existing);
          }
          await transaction.teacherWithdrawalPolicy.update({
            where: { id: existing.id },
            data: {
              effectiveTo: policy.effectiveFrom,
              status:
                policy.effectiveFrom.getTime() <= Date.now()
                  ? 'RETIRED'
                  : 'ACTIVE',
            },
          });
        }
        return transaction.teacherWithdrawalPolicy.update({
          where: { id: policy.id },
          data: { status: 'ACTIVE' },
        });
      },
    );
  }

  retire(
    actor: AuthenticatedUser,
    policyId: string,
    dto: RetireConfigurationDto,
    idempotencyKey: string,
  ) {
    return this.transition(
      actor,
      policyId,
      dto,
      idempotencyKey,
      'retire',
      async (transaction, policy) => {
        const effectiveTo = new Date(dto.effectiveTo);
        if (
          policy.status !== 'ACTIVE' ||
          policy.version !== dto.expectedVersion ||
          effectiveTo <= policy.effectiveFrom
        ) {
          this.statusConflict(policy);
        }
        return transaction.teacherWithdrawalPolicy.update({
          where: { id: policy.id },
          data: { status: 'RETIRED', effectiveTo },
        });
      },
    );
  }

  private async transition(
    actor: AuthenticatedUser,
    policyId: string,
    dto: VersionedActionDto,
    idempotencyKey: string,
    action: 'activate' | 'retire',
    mutate: (
      transaction: Prisma.TransactionClient,
      policy: TeacherWithdrawalPolicy,
    ) => Promise<TeacherWithdrawalPolicy>,
  ) {
    const route = `/management/teacher-withdrawal-policies/${policyId}/${action}`;
    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotencyService.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: null,
        actorUserId: actor.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }
      await lockPolicies(transaction);
      const policy = await transaction.teacherWithdrawalPolicy.findUnique({
        where: { id: policyId },
      });
      if (!policy) {
        throw new DomainError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'The withdrawal policy was not found',
          404,
        );
      }
      const updated = await mutate(transaction, policy);
      const result = toPolicyView(updated);
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

  private statusConflict(policy: {
    id: string;
    status: string;
    version: number;
  }): never {
    throw new DomainError(
      ErrorCode.WITHDRAWAL_STATUS_CONFLICT,
      'The withdrawal policy state or version has changed',
      409,
      policy,
    );
  }

  private async writeAudit(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    policy: { id: string; version: number },
    action: string,
  ): Promise<void> {
    await transaction.auditLog.create({
      data: {
        campusId: null,
        actorUserId,
        action: `TEACHER_WITHDRAWAL_POLICY_${action}`,
        resourceType: 'TeacherWithdrawalPolicy',
        resourceId: policy.id,
        outcome: 'SUCCESS',
        details: { version: policy.version },
      },
    });
  }
}

function toPolicyView(policy: TeacherWithdrawalPolicy) {
  return {
    id: policy.id,
    minimumAmountFen: policy.minimumAmountFen,
    dailyRequestLimit: policy.dailyRequestLimit,
    version: policy.version,
    status: policy.status,
    effectiveFrom: policy.effectiveFrom.toISOString(),
    effectiveTo: policy.effectiveTo?.toISOString() ?? null,
    createdAt: policy.createdAt.toISOString(),
  };
}

async function lockPolicies(transaction: Prisma.TransactionClient) {
  await transaction.$executeRaw`
    LOCK TABLE "TeacherWithdrawalPolicy" IN SHARE ROW EXCLUSIVE MODE
  `;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
