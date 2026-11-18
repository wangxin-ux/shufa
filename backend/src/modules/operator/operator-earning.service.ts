import { Injectable } from '@nestjs/common';
import {
  PartnerEarningEntryType,
  PartnerEarningStatus,
  Prisma,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  OperatorScopeService,
  type OperatorScope,
} from '../../common/auth/operator-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  OPERATOR_EARNING_MAX_OFFSET,
  OperatorEarningQueryDto,
} from './dto/operator-earning.dto';
import { readOperatorInternalEarningSummary } from './operator-internal-earning-source';

const entrySelect = {
  id: true,
  campusId: true,
  entryType: true,
  status: true,
  amountFen: true,
  createdAt: true,
  earningBasis: {
    select: {
      campusId: true,
      teachingRecordId: true,
      lessonSessionId: true,
      completedAt: true,
      teachingRecord: {
        select: { id: true, campusId: true, lessonSessionId: true },
      },
      lessonSession: { select: { id: true, campusId: true } },
    },
  },
} satisfies Prisma.PartnerEarningEntrySelect;
type Entry = Prisma.PartnerEarningEntryGetPayload<{
  select: typeof entrySelect;
}>;
type Client = Prisma.TransactionClient;

@Injectable()
export class OperatorEarningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OperatorScopeService,
  ) {}

  summary(actor: AuthenticatedUser, now = new Date()) {
    return this.snapshot(actor, async (tx, owner) => {
      const { estimatedTotalFen, pendingReviewFen, currency } =
        await readOperatorInternalEarningSummary(tx, owner.campusId);
      return {
        estimatedTotalFen,
        pendingReviewFen,
        currency,
        serverTime: now.toISOString(),
        timezone: await this.timezone(tx, owner.campusId),
      };
    });
  }

  async entries(
    actor: AuthenticatedUser,
    query: OperatorEarningQueryDto,
    now = new Date(),
  ) {
    const skip = (query.page - 1) * query.pageSize;
    if (
      !Number.isSafeInteger(query.page) ||
      query.page < 1 ||
      query.page > OPERATOR_EARNING_MAX_OFFSET ||
      !Number.isSafeInteger(query.pageSize) ||
      query.pageSize < 1 ||
      query.pageSize > 100 ||
      !Number.isSafeInteger(skip) ||
      skip > OPERATOR_EARNING_MAX_OFFSET ||
      (query.status !== undefined &&
        !Object.values(PartnerEarningStatus).includes(query.status)) ||
      (query.entryType !== undefined &&
        !Object.values(PartnerEarningEntryType).includes(query.entryType))
    )
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        '分页或流水筛选无效，请缩小范围',
        400,
      );
    return this.snapshot(actor, async (tx, owner) => {
      const where: Prisma.PartnerEarningEntryWhereInput = {
        campusId: owner.campusId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.entryType ? { entryType: query.entryType } : {}),
      };
      const total = await tx.partnerEarningEntry.count({ where });
      const rows = await tx.partnerEarningEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: query.pageSize,
        select: entrySelect,
      });
      return {
        data: rows.map((entry) => this.row(owner.campusId, entry)),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.ceil(total / query.pageSize),
        },
        serverTime: now.toISOString(),
        timezone: await this.timezone(tx, owner.campusId),
      };
    });
  }

  private row(campusId: string, entry: Entry) {
    const basis = entry.earningBasis;
    if (
      entry.campusId !== campusId ||
      basis.campusId !== campusId ||
      basis.teachingRecord.campusId !== campusId ||
      basis.lessonSession.campusId !== campusId ||
      basis.teachingRecordId !== basis.teachingRecord.id ||
      basis.lessonSessionId !== basis.lessonSession.id ||
      basis.teachingRecord.lessonSessionId !== basis.lessonSessionId ||
      !Number.isSafeInteger(entry.amountFen) ||
      !Object.values(PartnerEarningStatus).includes(entry.status) ||
      !(
        (entry.entryType === 'ACCRUAL' && entry.amountFen > 0) ||
        (entry.entryType === 'REVERSAL' &&
          entry.amountFen < 0 &&
          entry.status === 'REVERSED')
      ) ||
      !Number.isFinite(entry.createdAt.getTime()) ||
      !Number.isFinite(basis.completedAt.getTime())
    )
      throw new DomainError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        '收益流水来源待核对，请稍后重试',
        500,
      );
    return {
      id: entry.id,
      entryType: entry.entryType,
      status: entry.status,
      amountFen: entry.amountFen,
      createdAt: entry.createdAt.toISOString(),
      completedAt: basis.completedAt.toISOString(),
    };
  }

  private async timezone(tx: Client, campusId: string) {
    const campus = await tx.campus.findUnique({
      where: { id: campusId },
      select: { timezone: true },
    });
    if (!campus)
      throw new DomainError(ErrorCode.RESOURCE_NOT_FOUND, '未找到本校区', 404);
    if (!campus.timezone.trim())
      throw new DomainError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        '校区时区待核对',
        500,
      );
    return campus.timezone;
  }

  private async current(tx: Client, owner: OperatorScope) {
    const user = await tx.user.findUnique({
      where: { id: owner.userId },
      select: {
        status: true,
        roles: { select: { roleCode: true, campusId: true } },
      },
    });
    if (!user || user.status !== 'ACTIVE')
      throw new DomainError(
        ErrorCode.UNAUTHORIZED,
        '登录已失效，请重新登录',
        401,
      );
    if (
      user.roles.length !== 1 ||
      user.roles[0].roleCode !== 'OPERATOR' ||
      user.roles[0].campusId !== owner.campusId
    )
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        '当前账号没有本校区收益读取权限',
        403,
      );
  }

  private async snapshot<T>(
    actor: AuthenticatedUser,
    read: (tx: Client, owner: OperatorScope) => Promise<T>,
  ) {
    const owner = this.scope.require(actor);
    const result = await this.prisma.$transaction(
      async (tx) => {
        await this.current(tx, owner);
        return read(tx, owner);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15000,
      },
    );
    // A fresh transaction must observe revocation hidden by the read snapshot.
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${owner.userId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "UserRole" WHERE "userId" = ${owner.userId}::uuid ORDER BY "id" FOR UPDATE`;
        await this.current(tx, owner);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 15000,
      },
    );
    return result;
  }
}
