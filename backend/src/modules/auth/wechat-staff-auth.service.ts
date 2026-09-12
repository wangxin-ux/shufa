import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MANAGEABLE_STAFF_ROLES, hasValidStaffCampus } from '../../common/auth/staff-roles';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { normalizeStaffPhone } from '../management/staff-account-management.service';
import type { WechatStaffBindPhoneDto } from './dto/wechat-auth.dto';
import { AuthService, type AuthSession } from './auth.service';
import {
  WECHAT_IDENTITY_GATEWAY,
  type WechatIdentityGateway,
} from './wechat-identity.gateway';

const BIND_ROUTE = '/auth/wechat/staff/bind-phone';

@Injectable()
export class WechatStaffAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    @Inject(WECHAT_IDENTITY_GATEWAY)
    private readonly gateway: WechatIdentityGateway,
    private readonly authService: AuthService,
  ) {}

  async login(code: string): Promise<AuthSession> {
    const { openId } = await this.gateway.exchangeLoginCode(code);
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: 'WECHAT', subject: openId } },
      select: { userId: true },
    });
    if (!identity) {
      throw new DomainError(
        ErrorCode.STAFF_PHONE_BINDING_REQUIRED,
        'Phone authorization is required for this WeChat identity',
        409,
      );
    }
    return this.authService.issueSessionForUser(identity.userId);
  }

  async bindPhone(
    input: WechatStaffBindPhoneDto,
    idempotencyKey: string,
  ): Promise<AuthSession> {
    const [{ openId }, { phone }] = await Promise.all([
      this.gateway.exchangeLoginCode(input.code),
      this.gateway.exchangePhoneCode(input.phoneCode),
    ]);
    const staffPhone = normalizeStaffPhone(phone);
    const userId = await this.prisma.$transaction(async (transaction) => {
      const account = await transaction.user.findUnique({
        where: { staffPhone },
        select: {
          id: true,
          status: true,
          staffPhone: true,
          accountVersion: true,
          roles: { select: { roleCode: true, campusId: true } },
        },
      });
      if (!account || account.status !== 'ACTIVE') this.unavailable();
      const role = this.resolveRole(account.roles);

      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route: BIND_ROUTE,
        request: { code: input.code, phoneCode: input.phoneCode },
        campusId: role.campusId,
        actorUserId: account.id,
      });
      if (claim.replayed) {
        const replay = claim.responseBody as { userId?: unknown };
        if (replay.userId !== account.id) this.identityConflict();
        return account.id;
      }

      const [identityForUser, identityForOpenId] = await Promise.all([
        transaction.authIdentity.findUnique({
          where: {
            userId_provider: { userId: account.id, provider: 'WECHAT' },
          },
          select: { userId: true, subject: true },
        }),
        transaction.authIdentity.findUnique({
          where: {
            provider_subject: { provider: 'WECHAT', subject: openId },
          },
          select: { userId: true, subject: true },
        }),
      ]);
      if (
        (identityForUser && identityForUser.subject !== openId) ||
        (identityForOpenId && identityForOpenId.userId !== account.id)
      ) {
        this.identityConflict();
      }

      let createdIdentity = false;
      if (!identityForUser && !identityForOpenId) {
        const created = await transaction.authIdentity.createMany({
          data: { userId: account.id, provider: 'WECHAT', subject: openId },
          skipDuplicates: true,
        });
        createdIdentity = created.count === 1;
        if (!createdIdentity) {
          const concurrent = await transaction.authIdentity.findUnique({
            where: {
              userId_provider: { userId: account.id, provider: 'WECHAT' },
            },
            select: { userId: true, subject: true },
          });
          if (concurrent?.subject !== openId) this.identityConflict();
        }
      }

      if (createdIdentity) {
        const updated = await transaction.user.updateMany({
          where: {
            id: account.id,
            status: 'ACTIVE',
            accountVersion: account.accountVersion,
          },
          data: { accountVersion: { increment: 1 } },
        });
        if (updated.count !== 1) this.unavailable();
        await transaction.auditLog.create({
          data: {
            campusId: role.campusId,
            actorUserId: account.id,
            action: 'STAFF_ACCOUNT_WECHAT_BIND',
            resourceType: 'User',
            resourceId: account.id,
            outcome: 'SUCCESS',
            details: { roleCode: role.roleCode, campusId: role.campusId },
          },
        });
      }
      await this.idempotency.complete(transaction, {
        key: idempotencyKey,
        route: BIND_ROUTE,
        responseBody: this.asJson({ userId: account.id }),
      });
      return account.id;
    });
    return this.authService.issueSessionForUser(userId);
  }

  private resolveRole(
    roles: Array<{ roleCode: string; campusId: string | null }>,
  ) {
    const allowed = roles.filter(({ roleCode }) =>
      MANAGEABLE_STAFF_ROLES.includes(roleCode as (typeof MANAGEABLE_STAFF_ROLES)[number]),
    );
    if (allowed.length !== 1 || roles.length !== 1 || !hasValidStaffCampus(allowed[0].roleCode, allowed[0].campusId)) {
      this.unavailable();
    }
    return allowed[0] as {
      roleCode: (typeof MANAGEABLE_STAFF_ROLES)[number];
      campusId: string | null;
    };
  }

  private asJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private unavailable(): never {
    throw new DomainError(
      ErrorCode.STAFF_ACCOUNT_UNAVAILABLE,
      'No active staff account matches the authorized phone number',
      404,
    );
  }

  private identityConflict(): never {
    throw new DomainError(
      ErrorCode.WECHAT_IDENTITY_CONFLICT,
      'The staff account or WeChat identity is already bound elsewhere',
      409,
    );
  }
}
