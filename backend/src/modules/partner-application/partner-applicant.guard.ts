import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { isUUID } from 'class-validator';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { APPLICANT_AUDIENCE } from './partner-applicant-session.service';

export interface ApplicantRequest extends Request {
  applicant: { applicantId: string; userId: string; sessionId: string };
}

@Injectable()
export class PartnerApplicantGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApplicantRequest>();
    const parts = request.headers.authorization?.split(' ') ?? [];
    if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) this.deny();
    let claims: {
      sub: string;
      applicantId: string;
      jti: string;
      kind: string;
      aud: unknown;
      exp: number;
    };
    try {
      claims = await this.jwt.verifyAsync(parts[1], {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        audience: APPLICANT_AUDIENCE,
        algorithms: ['HS256'],
      });
    } catch {
      this.deny();
    }
    if (
      claims.kind !== APPLICANT_AUDIENCE ||
      claims.aud !== APPLICANT_AUDIENCE ||
      !Number.isFinite(claims.exp) ||
      ![claims.sub, claims.applicantId, claims.jti].every(
        (id) => typeof id === 'string' && isUUID(id),
      )
    ) {
      this.deny();
    }
    const session = await this.prisma.partnerApplicantSession.findFirst({
      where: {
        id: claims.jti,
        applicantId: claims.applicantId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        applicant: { userId: claims.sub, user: { status: 'ACTIVE' } },
      },
      select: { id: true },
    });
    if (!session) this.deny();
    request.applicant = {
      userId: claims.sub,
      applicantId: claims.applicantId,
      sessionId: claims.jti,
    };
    return true;
  }

  private deny(): never {
    throw new DomainError(
      ErrorCode.UNAUTHORIZED,
      '申请登录凭证缺失或已失效',
      401,
    );
  }
}
