import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  WECHAT_IDENTITY_GATEWAY,
  type WechatIdentityGateway,
} from '../auth/wechat-identity.gateway';

export const APPLICANT_AUDIENCE = 'partner_application';

@Injectable()
export class PartnerApplicantSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(WECHAT_IDENTITY_GATEWAY)
    private readonly gateway: WechatIdentityGateway,
  ) {}

  async login(code: string) {
    if (
      this.config.get<string>('AUTH_DRIVER') === 'mock' &&
      !['development', 'test'].includes(
        this.config.get<string>('NODE_ENV') ?? '',
      )
    ) {
      throw new DomainError(ErrorCode.UNAUTHORIZED, '模拟身份未启用', 401);
    }
    const { openId } = await this.gateway.exchangeLoginCode(code);
    if (!openId || openId.length > 256) {
      throw new DomainError(
        ErrorCode.WECHAT_PROVIDER_RESPONSE_INVALID,
        '身份验证失败',
        401,
      );
    }
    try {
      return await this.issue(openId);
    } catch (error) {
      // Only a concurrent first identity creation may retry; all other errors propagate.
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002' ||
        !(await this.prisma.authIdentity.findUnique({
          where: { provider_subject: { provider: 'WECHAT', subject: openId } },
          select: { id: true },
        }))
      ) {
        throw error;
      }
      return this.issue(openId);
    }
  }

  private issue(openId: string) {
    return this.prisma.$transaction(async (tx) => {
      const identity = await tx.authIdentity.findUnique({
        where: { provider_subject: { provider: 'WECHAT', subject: openId } },
        select: { userId: true },
      });
      const userId =
        identity?.userId ??
        (
          await tx.user.create({
            data: {
              displayName: '入驻申请人',
              authIdentities: {
                create: { provider: 'WECHAT', subject: openId },
              },
              partnerApplicant: { create: {} },
            },
            select: { id: true },
          })
        ).id;
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { roles: true, partnerApplicant: true },
      });
      if (user.status !== 'ACTIVE') {
        throw new DomainError(ErrorCode.UNAUTHORIZED, '账号不可用', 401);
      }
      if (!user.partnerApplicant) {
        throw new DomainError(
          ErrorCode.WECHAT_IDENTITY_CONFLICT,
          '该身份已有正式账号，请使用正式登录',
          409,
        );
      }
      const now = new Date();
      const count = await tx.partnerApplicantSession.count({
        where: {
          applicantId: user.partnerApplicant.id,
          createdAt: { gte: new Date(now.getTime() - 60_000) },
        },
      });
      if (count >= 5) {
        throw new DomainError(
          ErrorCode.TOO_MANY_REQUESTS,
          '登录过于频繁，请稍后重试',
          429,
        );
      }
      const expiresAt = new Date(
        Math.floor(now.getTime() / 1000) * 1000 + 900_000,
      );
      const session = await tx.partnerApplicantSession.create({
        data: { applicantId: user.partnerApplicant.id, expiresAt },
      });
      const token = await this.jwt.signAsync(
        {
          sub: user.id,
          applicantId: user.partnerApplicant.id,
          jti: session.id,
          kind: APPLICANT_AUDIENCE,
          iat: Math.floor(now.getTime() / 1000),
        },
        {
          algorithm: 'HS256',
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
          audience: APPLICANT_AUDIENCE,
          expiresIn: 900,
        },
      );
      return {
        token,
        expiresAt: expiresAt.toISOString(),
        me: this.identity(user.partnerApplicant.id, user),
      };
    });
  }

  async me(applicantId: string) {
    const applicant = await this.prisma.partnerApplicant.findUniqueOrThrow({
      where: { id: applicantId },
      include: { user: { include: { roles: true } } },
    });
    return this.identity(applicant.id, applicant.user);
  }

  async logout(sessionId: string) {
    await this.prisma.partnerApplicantSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: true as const };
  }

  private identity(
    applicantId: string,
    user: {
      displayName: string;
      roles: { roleCode: string; campusId: string | null }[];
    },
  ) {
    return {
      applicantId,
      displayName: user.displayName,
      formalAccountReady:
        user.roles.length === 1 &&
        user.roles[0].roleCode === 'PARTNER' &&
        Boolean(user.roles[0].campusId),
    };
  }
}
