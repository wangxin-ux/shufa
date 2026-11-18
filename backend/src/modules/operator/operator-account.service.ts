import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  OperatorScopeService,
  type OperatorScope,
} from '../../common/auth/operator-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { lessonBalanceSelect } from '../lesson-ledger/lesson-balance';
import { readCampusEnrollmentSummary } from '../partner/partner-enrollment-summary';
import type {
  OperatorAccountQueryDto,
  OperatorAccountSubjectsQueryDto,
} from './dto/operator-account.dto';
import { OPERATOR_ACCOUNT_MAX_OFFSET } from './dto/operator-account.dto';
import {
  accountActivityTotals,
  accountBalances,
  accountLedgerSelect,
  toAccountLedgerRow,
} from './operator-account-ledger';

type Client = Prisma.TransactionClient;
type Page = { page: number; pageSize: number };

@Injectable()
export class OperatorAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OperatorScopeService,
  ) {}

  lessonAccount(
    actor: AuthenticatedUser,
    query: OperatorAccountQueryDto,
    now = new Date(),
  ) {
    const pagination = this.pagination(query);
    return this.snapshot(
      actor,
      async (tx, owner) => {
        if (
          query.subjectId &&
          query.subjectId !== 'UNCLASSIFIED' &&
          !(await tx.campusSubject.findFirst({
            where: { id: query.subjectId, campusId: owner.campusId },
            select: { id: true },
          }))
        )
          throw new DomainError(
            ErrorCode.RESOURCE_NOT_FOUND,
            '未找到本校区科目',
            404,
          );
        const packages = await tx.coursePackage.findMany({
          where: {
            campusId: owner.campusId,
            student: { campusId: owner.campusId },
            isActive: true,
            validFrom: { lte: now },
            OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
          },
          select: lessonBalanceSelect,
        });
        const balances = accountBalances(packages);
        const enrollmentSummary = await readCampusEnrollmentSummary(
          tx,
          owner.campusId,
        );
        const lessonActivityTotals = await accountActivityTotals(
          tx,
          owner.campusId,
        );
        const where: Prisma.LessonLedgerEntryWhereInput = {
          campusId: owner.campusId,
          student: { campusId: owner.campusId },
          coursePackage: { campusId: owner.campusId },
          ...(query.entryType ? { entryType: query.entryType } : {}),
          ...(query.subjectId
            ? {
                subjectId:
                  query.subjectId === 'UNCLASSIFIED' ? null : query.subjectId,
              }
            : {}),
        };
        const total = await tx.lessonLedgerEntry.count({ where });
        const rows = await tx.lessonLedgerEntry.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...pagination,
          select: accountLedgerSelect,
        });
        return {
          ...balances,
          enrollmentSummary,
          lessonActivityTotals,
          items: rows.map((row) => toAccountLedgerRow(owner.campusId, row)),
          meta: this.meta(total, query),
          serverTime: now.toISOString(),
          timezone: await this.timezone(tx, owner.campusId),
        };
      },
      (result) => result.items.map((entry) => entry.studentId),
    );
  }

  subjects(actor: AuthenticatedUser, query: OperatorAccountSubjectsQueryDto) {
    const pagination = this.pagination(query);
    const now = new Date();
    return this.snapshot(actor, async (tx, owner) => {
      const keyword = query.query?.trim();
      const where: Prisma.CampusSubjectWhereInput = {
        campusId: owner.campusId,
        ...(keyword
          ? { name: { contains: keyword, mode: 'insensitive' } }
          : {}),
      };
      const total = await tx.campusSubject.count({ where });
      const rows = await tx.campusSubject.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...pagination,
        select: { id: true, name: true, isActive: true, version: true },
      });
      return {
        data: rows.map(({ id, name, isActive, version }) => ({
          id,
          name,
          isActive,
          version,
        })),
        meta: this.meta(total, query),
        serverTime: now.toISOString(),
        timezone: await this.timezone(tx, owner.campusId),
      };
    });
  }

  private async timezone(tx: Client, campusId: string) {
    const campus = await tx.campus.findUnique({
      where: { id: campusId },
      select: { timezone: true },
    });
    if (!campus)
      throw new DomainError(ErrorCode.RESOURCE_NOT_FOUND, '未找到本校区', 404);
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
        '当前账号没有本校区账户读取权限',
        403,
      );
  }

  private async snapshot<T>(
    actor: AuthenticatedUser,
    read: (tx: Client, owner: OperatorScope) => Promise<T>,
    returnedStudentIds: (result: T) => string[] = () => [],
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
    // An older repeatable snapshot cannot observe a later role or campus revocation.
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${owner.userId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "UserRole" WHERE "userId" = ${owner.userId}::uuid ORDER BY "id" FOR UPDATE`;
        await this.current(tx, owner);
        const ids = [...new Set(returnedStudentIds(result))].sort();
        if (ids.length) {
          const parameters = Prisma.join(
            ids.map((id) => Prisma.sql`${id}::uuid`),
          );
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Student"
            WHERE "id" IN (${parameters}) ORDER BY "id" FOR SHARE`);
          const count = await tx.student.count({
            where: { id: { in: ids }, campusId: owner.campusId },
          });
          if (count !== ids.length)
            throw new DomainError(
              ErrorCode.RESOURCE_NOT_FOUND,
              '学员已不在本校区，请刷新后重试',
              404,
            );
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 15000,
      },
    );
    return result;
  }

  private meta(total: number, query: Page) {
    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  private pagination(query: Page) {
    const skip = (query.page - 1) * query.pageSize;
    if (
      !Number.isSafeInteger(query.page) ||
      query.page < 1 ||
      query.page > OPERATOR_ACCOUNT_MAX_OFFSET ||
      !Number.isSafeInteger(query.pageSize) ||
      query.pageSize < 1 ||
      query.pageSize > 100 ||
      !Number.isSafeInteger(skip) ||
      skip > OPERATOR_ACCOUNT_MAX_OFFSET
    )
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        '分页范围过大或格式无效，请缩小页码',
        400,
      );
    return { skip, take: query.pageSize };
  }
}
