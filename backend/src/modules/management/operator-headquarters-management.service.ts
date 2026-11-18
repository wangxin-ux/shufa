import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ManagementPageQueryDto } from './dto/management.dto';
import type {
  CreateOperatorHeadquartersDto,
  UpdateOperatorCampusGrantDto,
} from './dto/operator-headquarters-management.dto';
import {
  maskStaffPhone,
  normalizeStaffPhone,
} from './staff-account-management.service';

const CREATE_ROUTE = '/management/operator-headquarters';
export interface Grant {
  userId: string;
  campusId: string;
  isActive: boolean;
  version: number;
}

@Injectable()
export class OperatorHeadquartersManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    input: CreateOperatorHeadquartersDto,
    key: string,
  ) {
    this.requireAdministrator(actor);
    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 100) this.validation();
    const staffPhone = normalizeStaffPhone(input.phone);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockUsers(tx, [actor.userId]);
        await this.currentAdministrator(tx, actor.userId);
        const claim = await this.idempotency.claim(tx, {
          key,
          route: CREATE_ROUTE,
          request: { displayName, phone: staffPhone },
          actorUserId: actor.userId,
          campusId: null,
        });
        if (claim.replayed) return claim.responseBody;
        if (
          await tx.user.findUnique({
            where: { staffPhone },
            select: { id: true },
          })
        )
          this.duplicatePhone();
        const account = await tx.user.create({
          data: {
            displayName,
            staffPhone,
            status: 'ACTIVE',
            roles: { create: { roleCode: 'OPERATOR', campusId: null } },
          },
          select: {
            id: true,
            displayName: true,
            createdAt: true,
            accountVersion: true,
          },
        });
        const result = {
          id: account.id,
          displayName: account.displayName,
          maskedPhone: maskStaffPhone(staffPhone),
          roleCode: 'OPERATOR' as const,
          campusId: null,
          status: 'ACTIVE' as const,
          version: account.accountVersion,
          createdAt: account.createdAt.toISOString(),
        };
        await tx.auditLog.create({
          data: {
            actorUserId: actor.userId,
            campusId: null,
            action: 'OPERATOR_HEADQUARTERS_CREATE',
            resourceType: 'User',
            resourceId: account.id,
            outcome: 'SUCCESS',
            details: { roleCode: 'OPERATOR', campusId: null },
          },
        });
        await this.idempotency.complete(tx, {
          key,
          route: CREATE_ROUTE,
          responseBody: result,
          responseStatus: 201,
        });
        return result;
      });
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      )
        this.duplicatePhone();
      throw error;
    }
  }

  async listGrants(
    actor: AuthenticatedUser,
    userId: string,
    query: ManagementPageQueryDto,
  ) {
    this.requireAdministrator(actor);
    if (
      !Number.isInteger(query.page) ||
      query.page < 1 ||
      query.page > 2_147_483_647 ||
      !Number.isInteger(query.pageSize) ||
      query.pageSize < 1 ||
      query.pageSize > 100
    )
      this.validation();
    return this.prisma.$transaction(async (tx) => {
      await this.lockUsers(tx, [actor.userId, userId]);
      await this.currentAdministrator(tx, actor.userId);
      await this.currentHeadquarters(tx, userId);
      const [count] = await tx.$queryRaw<Array<{ total: bigint }>>`
        SELECT count(*) AS total FROM "OperatorCampusReadGrant" WHERE "userId" = ${userId}::uuid`;
      const rows = await tx.$queryRaw<Grant[]>`
        SELECT "userId", "campusId", "isActive", "version" FROM "OperatorCampusReadGrant"
        WHERE "userId" = ${userId}::uuid ORDER BY "campusId"
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`;
      const total = Number(count.total);
      if (!Number.isSafeInteger(total) || total < 0)
        throw new DomainError(
          ErrorCode.INTERNAL_SERVER_ERROR,
          'Grant totals require verification',
          500,
        );
      return {
        data: rows.map((row) => this.toGrant(row)),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
        },
      };
    });
  }

  async updateGrant(
    actor: AuthenticatedUser,
    userId: string,
    campusId: string,
    input: UpdateOperatorCampusGrantDto,
    key: string,
  ) {
    this.requireAdministrator(actor);
    if (
      typeof input.isActive !== 'boolean' ||
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 0 ||
      input.expectedVersion > 2_147_483_647
    )
      this.validation();
    const route = `${CREATE_ROUTE}/${userId}/campuses/${campusId}`;
    return this.prisma.$transaction(async (tx) => {
      // Readers and every grant writer use the target User as the first lock.
      await this.lockUsers(tx, [actor.userId, userId]);
      await this.currentAdministrator(tx, actor.userId);
      const account = await this.currentHeadquarters(tx, userId);
      // The command record also references this campus through a foreign key.
      const campus = await tx.campus.findUnique({
        where: { id: campusId },
        select: { id: true },
      });
      if (!campus)
        throw new DomainError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'The campus is unavailable',
          404,
        );
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        request: input,
        actorUserId: actor.userId,
        campusId,
      });
      if (claim.replayed) return claim.responseBody;
      if (input.isActive && account.status !== 'ACTIVE')
        throw new DomainError(
          ErrorCode.CONFLICT,
          'A disabled headquarters account cannot receive grants',
          409,
        );
      const [existing] = await tx.$queryRaw<Grant[]>`
        SELECT "userId", "campusId", "isActive", "version" FROM "OperatorCampusReadGrant"
        WHERE "userId" = ${userId}::uuid AND "campusId" = ${campusId}::uuid`;
      const before = existing
        ? this.toGrant(existing)
        : { userId, campusId, isActive: false, version: 0 };
      if (before.version !== input.expectedVersion) this.versionConflict();
      let result = before;
      if (before.isActive !== input.isActive) {
        if (before.version >= 2_147_483_647) this.versionConflict();
        let changed: Grant[];
        if (existing) {
          changed = await tx.$queryRaw<Grant[]>`
            UPDATE "OperatorCampusReadGrant"
            SET "isActive" = ${input.isActive}, "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
            WHERE "userId" = ${userId}::uuid AND "campusId" = ${campusId}::uuid AND "version" = ${before.version}
            RETURNING "userId", "campusId", "isActive", "version"`;
        } else {
          changed = await tx.$queryRaw<Grant[]>`
            INSERT INTO "OperatorCampusReadGrant" ("userId", "campusId", "isActive", "version")
            VALUES (${userId}::uuid, ${campusId}::uuid, true, 1)
            RETURNING "userId", "campusId", "isActive", "version"`;
        }
        if (changed.length !== 1) this.versionConflict();
        result = this.toGrant(changed[0]);
        await tx.auditLog.create({
          data: {
            campusId,
            actorUserId: actor.userId,
            action: 'OPERATOR_HEADQUARTERS_GRANT_UPDATE',
            resourceType: 'OperatorCampusReadGrant',
            resourceId: `${userId}:${campusId}`,
            outcome: 'SUCCESS',
            details: {
              userId,
              activeBefore: before.isActive,
              activeAfter: result.isActive,
              versionBefore: before.version,
              versionAfter: result.version,
            },
          },
        });
      }
      await this.idempotency.complete(tx, {
        key,
        route,
        responseBody: { ...result },
      });
      return result;
    });
  }

  private requireAdministrator(actor: AuthenticatedUser) {
    if (
      actor.roles.length !== 1 ||
      actor.roles[0].code !== 'SUPER_ADMIN' ||
      actor.roles[0].campusId !== null
    )
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        'An exclusive headquarters administrator is required',
        403,
      );
  }

  private async lockUsers(tx: Prisma.TransactionClient, ids: string[]) {
    await tx.$queryRaw`SELECT "id" FROM "User"
      WHERE "id" IN (${Prisma.join([...new Set(ids)].sort().map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY "id" FOR UPDATE`;
  }

  private async currentAdministrator(
    tx: Prisma.TransactionClient,
    userId: string,
  ) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        roles: { select: { roleCode: true, campusId: true } },
      },
    });
    if (!user || user.status !== 'ACTIVE')
      throw new DomainError(
        ErrorCode.UNAUTHORIZED,
        'The administrator session is no longer active',
        401,
      );
    if (
      user.roles.length !== 1 ||
      user.roles[0].roleCode !== 'SUPER_ADMIN' ||
      user.roles[0].campusId !== null
    )
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        'The current administrator scope is unavailable',
        403,
      );
  }

  private async currentHeadquarters(
    tx: Prisma.TransactionClient,
    userId: string,
  ) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        staffPhone: true,
        roles: { select: { roleCode: true, campusId: true } },
      },
    });
    if (
      !user ||
      !user.staffPhone ||
      user.roles.length !== 1 ||
      user.roles[0].roleCode !== 'OPERATOR' ||
      user.roles[0].campusId !== null
    )
      throw new DomainError(
        ErrorCode.STAFF_ACCOUNT_UNAVAILABLE,
        'The headquarters operator account is unavailable',
        404,
      );
    return user;
  }

  private toGrant(row: Grant): Grant {
    if (
      !row.userId ||
      !row.campusId ||
      typeof row.isActive !== 'boolean' ||
      !Number.isInteger(row.version) ||
      row.version < 1 ||
      row.version > 2_147_483_647
    )
      throw new DomainError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Grant history requires verification',
        500,
      );
    return {
      userId: row.userId,
      campusId: row.campusId,
      isActive: row.isActive,
      version: row.version,
    };
  }

  private validation(): never {
    throw new DomainError(
      ErrorCode.VALIDATION_FAILED,
      'The headquarters management command is invalid',
      400,
    );
  }

  private versionConflict(): never {
    throw new DomainError(
      ErrorCode.CONFLICT,
      'The campus grant version is stale or exhausted',
      409,
    );
  }

  private duplicatePhone(): never {
    throw new DomainError(
      ErrorCode.STAFF_PHONE_ALREADY_EXISTS,
      'A staff account already uses this phone number',
      409,
    );
  }
}
