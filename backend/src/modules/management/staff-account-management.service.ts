import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  MANAGEABLE_STAFF_ROLES,
  hasValidStaffCampus,
  isHeadquartersStaffRole,
} from '../../common/auth/staff-roles';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  ManageableStaffRole,
  StaffAccountCreationInput,
  StaffAccountsQueryDto,
  UnbindStaffWechatDto,
  UpdateStaffAccountStatusDto,
} from './dto/staff-account-management.dto';

const CREATE_ROUTE = '/management/staff-accounts';
const statusRoute = (userId: string) =>
  `/management/staff-accounts/${userId}/status`;
const unbindRoute = (userId: string) =>
  `/management/staff-accounts/${userId}/unbind-wechat`;

interface StaffAccountRecord {
  id: string;
  displayName: string;
  staffPhone: string | null;
  status: 'ACTIVE' | 'DISABLED';
  accountVersion: number;
  createdAt: Date;
  updatedAt: Date;
  roles: Array<{
    roleCode: string;
    campusId: string | null;
    campus: { id: string; name: string } | null;
  }>;
  authIdentities: Array<{ provider: string }>;
  partnerApplicationApproval?: {
    campusId: string;
    submission: {
      review: { decision: string } | null;
      application: { status: string; applicant: { userId: string } };
    };
  } | null;
}

export interface StaffAccountView {
  id: string;
  displayName: string;
  maskedPhone: string;
  roleCode: ManageableStaffRole;
  campusId: string | null;
  campusName: string;
  bindingStatus: 'BOUND' | 'UNBOUND';
  status: 'ACTIVE' | 'DISABLED';
  version: number;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class StaffAccountManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(actor: AuthenticatedUser, query: StaffAccountsQueryDto) {
    this.requireAdministrator(actor);
    const keyword = query.query?.trim();
    // Compare role and approval campus columns before counting/pagination.
    const source = Prisma.sql`
      FROM "User" u JOIN "UserRole" r ON r."userId" = u.id
      LEFT JOIN "Campus" c ON c.id = r."campusId"
      LEFT JOIN "PartnerApplicationApproval" a ON a."userId" = u.id
      LEFT JOIN "PartnerApplicationSubmission" s ON s.id = a."submissionId"
      LEFT JOIN "PartnerApplication" p ON p.id = s."applicationId"
      LEFT JOIN "PartnerApplicant" applicant ON applicant.id = p."applicantId"
      LEFT JOIN "PartnerApplicationReview" review ON review."submissionId" = s.id
      WHERE r."roleCode" IN (${Prisma.join([...MANAGEABLE_STAFF_ROLES])})
        AND NOT EXISTS (SELECT 1 FROM "UserRole" extra WHERE extra."userId" = u.id AND extra.id <> r.id)
        AND ((r."roleCode" IN ('HR', 'FINANCE') AND r."campusId" IS NULL) OR
          (r."roleCode" = 'OPERATOR' AND r."campusId" IS NULL) OR
          (r."roleCode" NOT IN ('HR', 'FINANCE') AND c.id IS NOT NULL))
        AND (u."staffPhone" IS NOT NULL OR
          (r."roleCode" = 'PARTNER' AND a."campusId" = r."campusId" AND applicant."userId" = u.id
            AND p.status = 'APPROVED' AND review.decision = 'APPROVED'))
        ${query.status ? Prisma.sql`AND u.status = ${query.status}::"UserStatus"` : Prisma.empty}
        ${query.roleCode ? Prisma.sql`AND r."roleCode" = ${query.roleCode}::"RoleCode"` : Prisma.empty}
        ${query.campusId ? Prisma.sql`AND r."campusId" = ${query.campusId}::uuid` : Prisma.empty}
        ${
          keyword
            ? Prisma.sql`AND (strpos(lower(u."displayName"), lower(${keyword})) > 0 OR
          strpos(u."staffPhone", ${keyword}) > 0 OR strpos(lower(s."institutionName"), lower(${keyword})) > 0)`
            : Prisma.empty
        }`;
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.userId}::uuid FOR UPDATE`;
        await this.currentAdministrator(tx, actor.userId);
        const [count] = await tx.$queryRaw<
          Array<{ total: bigint }>
        >`SELECT count(*) AS total ${source}`;
        const ids = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT u.id ${source} ORDER BY u."createdAt" DESC, u.id ASC
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`;
        const accounts = await tx.user.findMany({
          where: { id: { in: ids.map((row) => row.id) } },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          select: this.accountSelect(),
        });
        const total = Number(count.total);
        return {
          data: accounts.map((account) => this.toView(account)),
          meta: {
            page: query.page,
            pageSize: query.pageSize,
            total,
            totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    // A role-only change can be newer than the repeatable-read snapshot.
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.userId}::uuid FOR UPDATE`;
        await this.currentAdministrator(tx, actor.userId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    return result;
  }

  async createAccount(
    actor: AuthenticatedUser,
    input: StaffAccountCreationInput,
    idempotencyKey: string,
  ): Promise<StaffAccountView> {
    if (!MANAGEABLE_STAFF_ROLES.includes(input.roleCode)) {
      this.validation('The requested staff role cannot be created');
    }
    const headquarters = isHeadquartersStaffRole(input.roleCode);
    if (
      headquarters &&
      (actor.roles.length !== 1 ||
        actor.roles[0].code !== 'SUPER_ADMIN' ||
        actor.roles[0].campusId !== null)
    ) {
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        'Only the headquarters administrator can create headquarters staff',
        403,
      );
    }
    if (!hasValidStaffCampus(input.roleCode, input.campusId)) {
      this.validation('The staff role and campus scope do not match');
    }
    const displayName = input.displayName.trim();
    if (!displayName) this.validation('displayName is required');
    const staffPhone = normalizeStaffPhone(input.phone);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const claim = await this.idempotency.claim(transaction, {
          key: idempotencyKey,
          route: CREATE_ROUTE,
          request: { ...input, displayName, phone: staffPhone },
          campusId: null,
          actorUserId: actor.userId,
        });
        if (claim.replayed)
          return claim.responseBody as unknown as StaffAccountView;

        if (!headquarters) {
          const campus = await transaction.campus.findUnique({
            where: { id: input.campusId! },
            select: { id: true, name: true },
          });
          if (!campus) this.unavailable('The selected campus does not exist');
        }

        const duplicate = await transaction.user.findUnique({
          where: { staffPhone },
          select: { id: true },
        });
        if (duplicate) this.duplicatePhone();

        const created = await transaction.user.create({
          data: {
            displayName,
            staffPhone,
            status: 'ACTIVE',
            roles: {
              create: { roleCode: input.roleCode, campusId: input.campusId },
            },
            ...(input.roleCode === 'TEACHER'
              ? {
                  teacherProfile: {
                    create: {
                      campusId: input.campusId!,
                      employeeCode: `T-${randomUUID()}`,
                      specialties: [],
                      isActive: true,
                    },
                  },
                }
              : {}),
          },
          select: { id: true },
        });
        const account = await this.findAccount(transaction, created.id);
        const response = this.toView(account);

        await transaction.auditLog.create({
          data: {
            campusId: input.campusId,
            actorUserId: actor.userId,
            action: 'STAFF_ACCOUNT_CREATE',
            resourceType: 'User',
            resourceId: created.id,
            outcome: 'SUCCESS',
            details: {
              displayName,
              roleCode: input.roleCode,
              campusId: input.campusId,
            },
          },
        });
        await this.idempotency.complete(transaction, {
          key: idempotencyKey,
          route: CREATE_ROUTE,
          responseBody: this.asJson(response),
          responseStatus: 201,
        });
        return response;
      });
    } catch (error) {
      if (this.isUniqueConstraint(error)) this.duplicatePhone();
      throw error;
    }
  }

  async updateStatus(
    actor: AuthenticatedUser,
    staffAccountId: string,
    input: UpdateStaffAccountStatusDto,
    idempotencyKey: string,
  ): Promise<StaffAccountView> {
    this.requireAdministrator(actor);
    const route = statusRoute(staffAccountId);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "User"
        WHERE "id" IN (${staffAccountId}::uuid, ${actor.userId}::uuid) ORDER BY "id" FOR UPDATE`;
      await this.currentAdministrator(transaction, actor.userId);
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route,
        request: input,
        campusId: null,
        actorUserId: actor.userId,
      });
      if (claim.replayed)
        return claim.responseBody as unknown as StaffAccountView;

      const current = await this.findAccount(transaction, staffAccountId);
      if (current.accountVersion >= 2_147_483_647) this.versionConflict();
      const updated = await transaction.user.updateMany({
        where: {
          id: staffAccountId,
          accountVersion: input.expectedVersion,
          ...(current.staffPhone
            ? { staffPhone: { not: null } }
            : { staffPhone: null }),
        },
        data: { status: input.status, accountVersion: { increment: 1 } },
      });
      if (updated.count !== 1) this.versionConflict();
      await transaction.teacherProfile.updateMany({
        where: { userId: staffAccountId },
        data: { isActive: input.status === 'ACTIVE' },
      });
      const response = this.toView(
        await this.findAccount(transaction, staffAccountId),
      );
      await transaction.auditLog.create({
        data: {
          campusId: response.campusId,
          actorUserId: actor.userId,
          action: 'STAFF_ACCOUNT_STATUS_UPDATE',
          resourceType: 'User',
          resourceId: staffAccountId,
          outcome: 'SUCCESS',
          details: {
            roleCode: response.roleCode,
            statusBefore: current.status,
            statusAfter: response.status,
            versionBefore: current.accountVersion,
            versionAfter: response.version,
          },
        },
      });
      await this.idempotency.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: this.asJson(response),
      });
      return response;
    });
  }

  async unbindWechat(
    actor: AuthenticatedUser,
    staffAccountId: string,
    input: UnbindStaffWechatDto,
    idempotencyKey: string,
  ): Promise<StaffAccountView> {
    this.requireAdministrator(actor);
    const route = unbindRoute(staffAccountId);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "User"
        WHERE "id" IN (${staffAccountId}::uuid, ${actor.userId}::uuid) ORDER BY "id" FOR UPDATE`;
      await this.currentAdministrator(transaction, actor.userId);
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route,
        request: input,
        campusId: null,
        actorUserId: actor.userId,
      });
      if (claim.replayed)
        return claim.responseBody as unknown as StaffAccountView;

      const current = await this.findAccount(transaction, staffAccountId);
      if (current.accountVersion >= 2_147_483_647) this.versionConflict();
      if (!current.staffPhone) {
        throw new DomainError(
          ErrorCode.WECHAT_IDENTITY_CONFLICT,
          '未绑定个人手机号，暂不支持解除唯一微信登录身份',
          409,
        );
      }
      if (
        !current.authIdentities.some(({ provider }) => provider === 'WECHAT')
      ) {
        throw new DomainError(
          ErrorCode.WECHAT_IDENTITY_CONFLICT,
          'The staff account has no WeChat identity to unbind',
          409,
        );
      }
      const updated = await transaction.user.updateMany({
        where: {
          id: staffAccountId,
          accountVersion: input.expectedVersion,
          staffPhone: { not: null },
        },
        data: { accountVersion: { increment: 1 } },
      });
      if (updated.count !== 1) this.versionConflict();
      await transaction.authIdentity.deleteMany({
        where: { userId: staffAccountId, provider: 'WECHAT' },
      });
      const response = this.toView(
        await this.findAccount(transaction, staffAccountId),
      );
      await transaction.auditLog.create({
        data: {
          campusId: response.campusId,
          actorUserId: actor.userId,
          action: 'STAFF_ACCOUNT_WECHAT_UNBIND',
          resourceType: 'User',
          resourceId: staffAccountId,
          outcome: 'SUCCESS',
          details: {
            roleCode: response.roleCode,
            versionBefore: current.accountVersion,
            versionAfter: response.version,
          },
        },
      });
      await this.idempotency.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: this.asJson(response),
      });
      return response;
    });
  }

  private async findAccount(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<StaffAccountRecord> {
    const account = await transaction.user.findUnique({
      where: { id: userId },
      select: this.accountSelect(),
    });
    if (!account || !this.hasLoginProvenance(account)) this.unavailable();
    this.resolveRole(account.roles);
    return account;
  }

  private accountSelect() {
    return {
      id: true,
      displayName: true,
      staffPhone: true,
      status: true,
      accountVersion: true,
      createdAt: true,
      updatedAt: true,
      roles: {
        select: {
          roleCode: true,
          campusId: true,
          campus: { select: { id: true, name: true } },
        },
      },
      authIdentities: {
        where: { provider: 'WECHAT' as const },
        select: { provider: true },
      },
      partnerApplicationApproval: {
        select: {
          campusId: true,
          submission: {
            select: {
              review: { select: { decision: true } },
              application: {
                select: {
                  status: true,
                  applicant: { select: { userId: true } },
                },
              },
            },
          },
        },
      },
    };
  }

  private toView(account: StaffAccountRecord): StaffAccountView {
    if (!this.hasLoginProvenance(account)) this.unavailable();
    const role = this.resolveRole(account.roles);
    const headquartersOperator =
      role.roleCode === 'OPERATOR' && role.campusId === null;
    const headquarters =
      isHeadquartersStaffRole(role.roleCode) || headquartersOperator;
    if (
      (!headquartersOperator &&
        !hasValidStaffCampus(role.roleCode, role.campusId)) ||
      (!headquarters && !role.campus)
    ) {
      this.unavailable('The staff campus is unavailable');
    }
    return {
      id: account.id,
      displayName: account.displayName,
      maskedPhone: account.staffPhone
        ? maskStaffPhone(account.staffPhone)
        : '未绑定个人手机号',
      roleCode: role.roleCode,
      campusId: role.campusId,
      campusName: headquarters ? '总部' : role.campus!.name,
      bindingStatus: account.authIdentities.length > 0 ? 'BOUND' : 'UNBOUND',
      status: account.status,
      version: account.accountVersion,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    };
  }

  private resolveRole(roles: StaffAccountRecord['roles']) {
    const manageable = roles.filter(({ roleCode }) =>
      MANAGEABLE_STAFF_ROLES.includes(roleCode as ManageableStaffRole),
    );
    if (roles.length !== 1 || manageable.length !== 1)
      this.unavailable('The staff account must have one role');
    return {
      ...manageable[0],
      roleCode: manageable[0].roleCode as ManageableStaffRole,
    };
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

  // Called only by the locked approval transaction; never starts a nested transaction.
  async activateApprovedPartner(
    transaction: Prisma.TransactionClient,
    userId: string,
    campusId: string,
  ) {
    const user = await transaction.user.findUnique({
      where: { id: userId },
      select: { status: true, accountVersion: true },
    });
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      user.accountVersion >= 2_147_483_647 ||
      (await transaction.userRole.count({ where: { userId } }))
    ) {
      throw new DomainError(
        ErrorCode.CONFLICT,
        '申请账号已更新，无法启用',
        409,
      );
    }
    const updated = await transaction.user.updateMany({
      where: {
        id: userId,
        status: 'ACTIVE',
        accountVersion: user.accountVersion,
      },
      data: { accountVersion: { increment: 1 } },
    });
    if (updated.count !== 1) this.versionConflict();
    await transaction.userRole.create({
      data: { userId, roleCode: 'PARTNER', campusId },
    });
  }

  private hasLoginProvenance(account: StaffAccountRecord) {
    if (account.staffPhone) return true;
    return (
      account.roles.length === 1 &&
      account.roles[0].roleCode === 'PARTNER' &&
      Boolean(account.roles[0].campusId) &&
      account.partnerApplicationApproval?.campusId ===
        account.roles[0].campusId &&
      account.partnerApplicationApproval.submission.application.status ===
        'APPROVED' &&
      account.partnerApplicationApproval.submission.application.applicant
        .userId === account.id &&
      account.partnerApplicationApproval.submission.review?.decision ===
        'APPROVED'
    );
  }

  private asJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private isUniqueConstraint(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }

  private validation(message: string): never {
    throw new DomainError(ErrorCode.VALIDATION_FAILED, message, 400);
  }

  private duplicatePhone(): never {
    throw new DomainError(
      ErrorCode.STAFF_PHONE_ALREADY_EXISTS,
      'A staff account already uses this phone number',
      409,
    );
  }

  private unavailable(message = 'The staff account is unavailable'): never {
    throw new DomainError(ErrorCode.STAFF_ACCOUNT_UNAVAILABLE, message, 404);
  }

  private versionConflict(): never {
    throw new DomainError(
      ErrorCode.STAFF_ACCOUNT_VERSION_CONFLICT,
      'The staff account version is stale',
      409,
    );
  }
}

export function normalizeStaffPhone(value: string): string {
  const match = value.trim().match(/^(?:\+?86)?(1[3-9][0-9]{9})$/);
  if (!match) {
    throw new DomainError(
      ErrorCode.VALIDATION_FAILED,
      'A valid mainland mobile phone number is required',
      400,
    );
  }
  return `+86${match[1]}`;
}

export function maskStaffPhone(value: string): string {
  return `+86****${value.slice(-4)}`;
}
