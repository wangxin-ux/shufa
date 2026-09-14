import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { TeacherScope } from '../../common/auth/teacher-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { VersionedActionDto } from '../earning/dto/earning.dto';
import type {
  CreateWithdrawalDto,
  ManagementWithdrawalsQueryDto,
  TeacherWithdrawalsQueryDto,
} from './dto/withdrawal.dto';
import { assertWithdrawalTransition } from './withdrawal-state';

const activeAllocationStatuses = ['SUBMITTED', 'APPROVED', 'PAYING'] as const;

const withdrawalViewSelect = Prisma.validator<Prisma.WithdrawalSelect>()({
  id: true,
  requestNo: true,
  campusId: true,
  teacherProfileId: true,
  amountFen: true,
  status: true,
  createdAt: true,
  reviewedAt: true,
  paidAt: true,
  rejectionReason: true,
  failureReason: true,
  payoutReference: true,
  payoutProofFileId: true,
  version: true,
  teacher: { select: { user: { select: { displayName: true } } } },
});

type WithdrawalViewRow = Prisma.WithdrawalGetPayload<{
  select: typeof withdrawalViewSelect;
}>;
type WithdrawalReader = Pick<Prisma.TransactionClient, 'withdrawal'>;

@Injectable()
export class WithdrawalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async listTeacherWithdrawals(
    scope: TeacherScope,
    query: TeacherWithdrawalsQueryDto,
  ) {
    return this.list(
      {
        teacherProfileId: scope.teacherProfileId,
        campusId: scope.campusId,
        ...(query.status ? { status: query.status } : {}),
      },
      query.page,
      query.pageSize,
    );
  }

  async listManagedWithdrawals(query: ManagementWithdrawalsQueryDto) {
    return this.list(
      {
        ...(query.campusId ? { campusId: query.campusId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      query.page,
      query.pageSize,
    );
  }

  async create(
    scope: TeacherScope,
    dto: CreateWithdrawalDto,
    idempotencyKey: string,
  ) {
    const route = '/teachers/me/withdrawals';
    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotencyService.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: scope.campusId,
        actorUserId: scope.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }

      await lockTeacher(transaction, scope.teacherProfileId);
      const now = new Date();
      const policy = await this.getActivePolicy(transaction, now);
      if (dto.amountFen < policy.minimumAmountFen) {
        throw new DomainError(
          ErrorCode.WITHDRAWAL_AMOUNT_INVALID,
          'The withdrawal amount is below the configured minimum',
          400,
          { minimumAmountFen: policy.minimumAmountFen },
        );
      }
      const day = shanghaiDayRange(now);
      const requestsToday = await transaction.withdrawal.count({
        where: {
          teacherProfileId: scope.teacherProfileId,
          createdAt: { gte: day.start, lt: day.end },
        },
      });
      if (requestsToday >= policy.dailyRequestLimit) {
        throw new DomainError(
          ErrorCode.WITHDRAWAL_FREQUENCY_EXCEEDED,
          'The daily withdrawal request limit has been reached',
          409,
          { dailyRequestLimit: policy.dailyRequestLimit },
        );
      }

      const earningRows = await transaction.$queryRaw<
        Array<{ id: string; amountFen: number }>
      >`
        SELECT "id", "amountFen"
        FROM "TeacherEarningEntry"
        WHERE "teacherProfileId" = ${scope.teacherProfileId}::uuid
          AND "campusId" = ${scope.campusId}::uuid
          AND "status" = 'AVAILABLE'
        ORDER BY "createdAt" ASC, "id" ASC
        FOR UPDATE
      `;
      const existingAllocations =
        await transaction.withdrawalAllocation.findMany({
          where: {
            earningEntryId: { in: earningRows.map(({ id }) => id) },
            withdrawal: { status: { in: [...activeAllocationStatuses] } },
          },
          select: { earningEntryId: true, amountFen: true },
        });
      const allocatedByEntry = new Map<string, number>();
      for (const allocation of existingAllocations) {
        allocatedByEntry.set(
          allocation.earningEntryId,
          (allocatedByEntry.get(allocation.earningEntryId) ?? 0) +
            allocation.amountFen,
        );
      }

      let remainingFen = dto.amountFen;
      const allocations: Array<{ earningEntryId: string; amountFen: number }> =
        [];
      for (const entry of earningRows) {
        const availableFen =
          entry.amountFen - (allocatedByEntry.get(entry.id) ?? 0);
        if (availableFen <= 0) {
          continue;
        }
        const amountFen = Math.min(availableFen, remainingFen);
        allocations.push({ earningEntryId: entry.id, amountFen });
        remainingFen -= amountFen;
        if (remainingFen === 0) {
          break;
        }
      }
      if (remainingFen > 0) {
        throw new DomainError(
          ErrorCode.WITHDRAWAL_BALANCE_INSUFFICIENT,
          'The available teacher earning balance is insufficient',
          409,
          { requestedAmountFen: dto.amountFen, missingAmountFen: remainingFen },
        );
      }

      const withdrawal = await transaction.withdrawal.create({
        data: {
          requestNo: `TW-${now.getTime()}-${randomUUID().slice(0, 8)}`,
          campusId: scope.campusId,
          teacherProfileId: scope.teacherProfileId,
          requestedByUserId: scope.userId,
          policyId: policy.id,
          amountFen: dto.amountFen,
          status: 'SUBMITTED',
          policySnapshot: {
            policyId: policy.id,
            policyVersion: policy.version,
            minimumAmountFen: policy.minimumAmountFen,
            dailyRequestLimit: policy.dailyRequestLimit,
          },
          allocations: { create: allocations },
        },
        select: withdrawalViewSelect,
      });
      await this.writeAudit(transaction, scope.userId, withdrawal, 'CREATE');
      const result = toWithdrawalView(withdrawal);
      await this.idempotencyService.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: asJson(result),
      });
      return result;
    });
  }

  async cancel(
    scope: TeacherScope,
    withdrawalId: string,
    dto: VersionedActionDto,
    idempotencyKey: string,
  ) {
    const route = `/teachers/me/withdrawals/${withdrawalId}/cancel`;
    return this.prisma.$transaction(async (transaction) => {
      await lockWithdrawal(transaction, withdrawalId);
      const withdrawal = await transaction.withdrawal.findUnique({
        where: { id: withdrawalId },
        select: {
          id: true,
          campusId: true,
          teacherProfileId: true,
          status: true,
          version: true,
        },
      });
      if (!withdrawal) {
        throw new DomainError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'The withdrawal was not found',
          404,
        );
      }
      if (
        withdrawal.campusId !== scope.campusId ||
        withdrawal.teacherProfileId !== scope.teacherProfileId
      ) {
        throw new DomainError(
          ErrorCode.FORBIDDEN,
          'The withdrawal is outside the teacher scope',
          403,
        );
      }
      const claim = await this.idempotencyService.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: scope.campusId,
        actorUserId: scope.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }
      if (withdrawal.version !== dto.expectedVersion) {
        this.statusConflict(withdrawal);
      }
      assertWithdrawalTransition(withdrawal.status, 'CANCELLED');
      await transaction.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      await this.writeAudit(transaction, scope.userId, withdrawal, 'CANCEL');
      const result = await this.getView(withdrawal.id, transaction);
      await this.idempotencyService.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: asJson(result),
      });
      return result;
    });
  }

  async getView(withdrawalId: string, client: WithdrawalReader = this.prisma) {
    const row = await client.withdrawal.findUniqueOrThrow({
      where: { id: withdrawalId },
      select: withdrawalViewSelect,
    });
    return toWithdrawalView(row);
  }

  private async list(
    where: Prisma.WithdrawalWhereInput,
    page: number,
    pageSize: number,
  ) {
    const [rows, total] = await Promise.all([
      this.prisma.withdrawal.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: withdrawalViewSelect,
      }),
      this.prisma.withdrawal.count({ where }),
    ]);
    return {
      data: rows.map(toWithdrawalView),
      meta: {
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }

  private async getActivePolicy(
    transaction: Prisma.TransactionClient,
    at: Date,
  ) {
    const policies = await transaction.teacherWithdrawalPolicy.findMany({
      where: {
        status: 'ACTIVE',
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
    });
    if (policies.length !== 1) {
      throw new DomainError(
        ErrorCode.WITHDRAWAL_STATUS_CONFLICT,
        'Exactly one active teacher withdrawal policy is required',
        409,
        { policyCount: policies.length },
      );
    }
    return policies[0];
  }

  private statusConflict(withdrawal: {
    id: string;
    status: string;
    version: number;
  }): never {
    throw new DomainError(
      ErrorCode.WITHDRAWAL_STATUS_CONFLICT,
      'The withdrawal status or version has changed',
      409,
      withdrawal,
    );
  }

  private async writeAudit(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    withdrawal: { id: string; campusId: string; status: string },
    action: string,
  ): Promise<void> {
    await transaction.auditLog.create({
      data: {
        campusId: withdrawal.campusId,
        actorUserId,
        action: `TEACHER_WITHDRAWAL_${action}`,
        resourceType: 'Withdrawal',
        resourceId: withdrawal.id,
        outcome: 'SUCCESS',
        details: { beforeStatus: withdrawal.status },
      },
    });
  }
}

export function toWithdrawalView(row: WithdrawalViewRow) {
  return {
    id: row.id,
    requestNo: row.requestNo,
    campusId: row.campusId,
    teacherId: row.teacherProfileId,
    teacherName: row.teacher.user.displayName,
    amountFen: row.amountFen,
    status: row.status,
    requestedAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
    failureReason: row.failureReason,
    payoutReference: row.payoutReference,
    payoutProofFileId: row.payoutProofFileId,
    version: row.version,
  };
}

export async function lockWithdrawal(
  transaction: Prisma.TransactionClient,
  withdrawalId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "Withdrawal"
    WHERE "id" = ${withdrawalId}::uuid
    FOR UPDATE
  `;
}

async function lockTeacher(
  transaction: Prisma.TransactionClient,
  teacherProfileId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "TeacherProfile"
    WHERE "id" = ${teacherProfileId}::uuid
    FOR UPDATE
  `;
}

function shanghaiDayRange(at: Date): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const date = `${read('year')}-${read('month')}-${read('day')}`;
  const start = new Date(`${date}T00:00:00+08:00`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1_000) };
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
