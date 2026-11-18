import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { notFound } from './free-campaign-policy';

type FreeActorRole = 'PARTNER' | 'PARENT' | 'SUPER_ADMIN';
export interface FreeActorScope {
  userId: string;
  campusId: string | null;
}

@Injectable()
export class FreeCampaignScopeService {
  constructor(private readonly prisma: PrismaService) {}

  require(user: AuthenticatedUser, role: FreeActorRole): FreeActorScope {
    if (
      user.roles.length !== 1 ||
      user.roles[0].code !== role ||
      (role !== 'SUPER_ADMIN' && !user.roles[0].campusId)
    )
      this.forbidden();
    return { userId: user.userId, campusId: user.roles[0].campusId };
  }

  campus(scope: FreeActorScope): string {
    if (!scope.campusId) this.forbidden();
    return scope.campusId;
  }

  withActor<T>(
    user: AuthenticatedUser,
    role: FreeActorRole,
    action: (tx: Prisma.TransactionClient, scope: FreeActorScope) => Promise<T>,
  ): Promise<T> {
    const requested = this.require(user, role);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.userId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "UserRole" WHERE "userId" = ${user.userId}::uuid ORDER BY "id" FOR UPDATE`;
        await this.current(tx, user, role, requested);
        return action(tx, requested);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 15_000,
        maxWait: 10_000,
      },
    );
  }

  async snapshot<T>(
    user: AuthenticatedUser,
    role: FreeActorRole,
    read: (tx: Prisma.TransactionClient, scope: FreeActorScope) => Promise<T>,
    recheck?: (
      tx: Prisma.TransactionClient,
      scope: FreeActorScope,
      result: T,
    ) => Promise<void>,
  ): Promise<T> {
    const requested = this.require(user, role);
    const result = await this.prisma.$transaction(
      async (tx) => {
        await this.current(tx, user, role, requested);
        return read(tx, requested);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15_000,
      },
    );
    return this.withActor(user, role, async (tx, scope) => {
      await recheck?.(tx, scope, result);
      return result;
    });
  }

  async draft(
    tx: Prisma.TransactionClient,
    id: string,
    campusId: string,
    lock = false,
  ) {
    if (lock)
      await tx.$queryRaw`SELECT "id" FROM "PartnerCampaignDraft"
      WHERE "id" = ${id}::uuid AND "campusId" = ${campusId}::uuid FOR UPDATE`;
    const row = await tx.partnerCampaignDraft.findFirst({
      where: { id, campusId },
    });
    return row ?? notFound();
  }

  async campaign(tx: Prisma.TransactionClient, id: string, campusId?: string) {
    await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const row = await tx.campaign.findFirst({
      where: { id, ...(campusId ? { campusId } : {}) },
    });
    return row ?? notFound();
  }

  async boundStudents(
    tx: Prisma.TransactionClient,
    scope: FreeActorScope,
    ids: string[],
  ) {
    if (!ids.length) return;
    const campusId = this.campus(scope);
    const unique = [...new Set(ids)].sort();
    // Consistent student-before-binding order also applies to final read authorization.
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Student" WHERE "id" IN
      (${Prisma.join(unique.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ParentStudentBinding"
      WHERE "parentUserId" = ${scope.userId}::uuid AND "studentId" IN
      (${Prisma.join(unique.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR UPDATE`);
    const count = await tx.student.count({
      where: {
        id: { in: unique },
        campusId,
        isActive: true,
        parentBindings: { some: { parentUserId: scope.userId, campusId } },
      },
    });
    if (count !== unique.length) this.forbidden();
  }

  async namedStudents(
    tx: Prisma.TransactionClient,
    campusId: string,
    ids: string[],
  ) {
    if (!ids.length) return;
    const unique = [...new Set(ids)].sort();
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Student" WHERE "id" IN
      (${Prisma.join(unique.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR SHARE`);
    if (
      (await tx.student.count({
        where: { id: { in: unique }, campusId, isActive: true },
      })) !== unique.length
    )
      this.forbidden();
  }

  private async current(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    role: FreeActorRole,
    requested: FreeActorScope,
  ) {
    const current = await tx.user.findUnique({
      where: { id: user.userId },
      select: {
        status: true,
        roles: { select: { roleCode: true, campusId: true } },
      },
    });
    if (!current || current.status !== 'ACTIVE')
      throw new DomainError(
        ErrorCode.UNAUTHORIZED,
        '登录已失效，请重新登录',
        401,
      );
    const actual = this.require(
      {
        userId: user.userId,
        roles: current.roles.map((r) => ({
          code: r.roleCode,
          campusId: r.campusId,
        })),
      },
      role,
    );
    if (actual.campusId !== requested.campusId) this.forbidden();
  }

  private forbidden(): never {
    throw new DomainError(
      ErrorCode.FORBIDDEN,
      '当前身份、校区或学员绑定无访问权限',
      403,
    );
  }
}
