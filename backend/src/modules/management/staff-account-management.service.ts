import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { MANAGEABLE_STAFF_ROLES, hasValidStaffCampus, isHeadquartersStaffRole } from '../../common/auth/staff-roles';
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

  async list(query: StaffAccountsQueryDto) {
    const keyword = query.query?.trim();
    const where: Prisma.UserWhereInput = {
      staffPhone: { not: null },
      ...(query.status ? { status: query.status } : {}),
      roles: {
        some: {
          roleCode: query.roleCode
            ? query.roleCode
            : { in: [...MANAGEABLE_STAFF_ROLES] },
          ...(query.campusId ? { campusId: query.campusId } : {}),
        },
      },
      ...(keyword
        ? {
            OR: [
              { displayName: { contains: keyword, mode: 'insensitive' } },
              { staffPhone: { contains: keyword } },
            ],
          }
        : {}),
    };
    const [total, accounts] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: this.accountSelect(),
      }),
    ]);
    return {
      data: accounts.map((account) => this.toView(account)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
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
    if (headquarters && (
      actor.roles.length !== 1 ||
      actor.roles[0].code !== 'SUPER_ADMIN' ||
      actor.roles[0].campusId !== null
    )) {
      throw new DomainError(ErrorCode.FORBIDDEN, 'Only the headquarters administrator can create headquarters staff', 403);
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
        if (claim.replayed) return claim.responseBody as unknown as StaffAccountView;

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
    const route = statusRoute(staffAccountId);
    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route,
        request: input,
        campusId: null,
        actorUserId: actor.userId,
      });
      if (claim.replayed) return claim.responseBody as unknown as StaffAccountView;

      const current = await this.findAccount(transaction, staffAccountId);
      const updated = await transaction.user.updateMany({
        where: {
          id: staffAccountId,
          accountVersion: input.expectedVersion,
          staffPhone: { not: null },
        },
        data: { status: input.status, accountVersion: { increment: 1 } },
      });
      if (updated.count !== 1) this.versionConflict();
      await transaction.teacherProfile.updateMany({
        where: { userId: staffAccountId },
        data: { isActive: input.status === 'ACTIVE' },
      });
      const response = this.toView(await this.findAccount(transaction, staffAccountId));
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
    const route = unbindRoute(staffAccountId);
    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route,
        request: input,
        campusId: null,
        actorUserId: actor.userId,
      });
      if (claim.replayed) return claim.responseBody as unknown as StaffAccountView;

      const current = await this.findAccount(transaction, staffAccountId);
      if (!current.authIdentities.some(({ provider }) => provider === 'WECHAT')) {
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
      const response = this.toView(await this.findAccount(transaction, staffAccountId));
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
    if (!account?.staffPhone) this.unavailable();
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
    };
  }

  private toView(account: StaffAccountRecord): StaffAccountView {
    if (!account.staffPhone) this.unavailable();
    const role = this.resolveRole(account.roles);
    const headquarters = isHeadquartersStaffRole(role.roleCode);
    if (!hasValidStaffCampus(role.roleCode, role.campusId) || (!headquarters && !role.campus)) {
      this.unavailable('The staff campus is unavailable');
    }
    return {
      id: account.id,
      displayName: account.displayName,
      maskedPhone: maskStaffPhone(account.staffPhone),
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
    if (roles.length !== 1 || manageable.length !== 1) this.unavailable('The staff account must have one role');
    return {
      ...manageable[0],
      roleCode: manageable[0].roleCode as ManageableStaffRole,
    };
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
