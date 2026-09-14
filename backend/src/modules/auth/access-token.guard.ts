import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

interface AccessTokenPayload {
  sub: string;
  kind: 'access';
}

interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const [scheme, token] = authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      this.unauthorized();
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      this.unauthorized();
    }
    if (!payload.sub || payload.kind !== 'access') {
      this.unauthorized();
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, status: 'ACTIVE' },
      select: {
        id: true,
        roles: { select: { roleCode: true, campusId: true } },
      },
    });
    if (!user || user.roles.length === 0) {
      this.unauthorized();
    }

    request.user = {
      userId: user.id,
      roles: user.roles.map(({ roleCode, campusId }) => ({
        code: roleCode,
        campusId,
      })),
    };
    return true;
  }

  private unauthorized(): never {
    throw new DomainError(
      ErrorCode.UNAUTHORIZED,
      '登录凭证缺失或已失效',
      401,
    );
  }
}
