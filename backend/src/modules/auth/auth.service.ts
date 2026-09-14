import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StaffBindTokenService } from './staff-bind-token.service';

export interface MeView extends AuthenticatedUser {
  displayName: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  me: MeView;
}

@Injectable()
export class AuthService {
  private readonly accessTokenTtlSeconds = 3_600;
  private readonly refreshTokenTtlSeconds = 30 * 24 * 60 * 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly staffBindTokenService: StaffBindTokenService,
  ) {}

  async login(code: string): Promise<AuthSession> {
    this.requireMockDriver();
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: 'MOCK', subject: code } },
      select: { userId: true },
    });
    if (!identity) {
      this.unauthorized();
    }

    const me = await this.getMe(identity.userId);
    if (!this.hasValidSingleRoleScope(me)) {
      this.unauthorized();
    }
    return this.issueSession(me);
  }

  async bindStaff(
    code: string,
    bindToken: string,
    idempotencyKey: string,
  ): Promise<AuthSession> {
    this.requireMockDriver();
    const userId = await this.staffBindTokenService.consume(
      bindToken,
      code,
      idempotencyKey,
    );
    return this.issueSessionForUser(userId);
  }

  async issueSessionForUser(userId: string): Promise<AuthSession> {
    return this.issueSession(await this.getMe(userId));
  }

  async getMe(userId: string): Promise<MeView> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: 'ACTIVE' },
      select: {
        id: true,
        displayName: true,
        roles: {
          orderBy: { roleCode: 'asc' },
          select: { roleCode: true, campusId: true },
        },
      },
    });
    if (!user || user.roles.length === 0) {
      this.unauthorized();
    }

    return {
      userId: user.id,
      displayName: user.displayName,
      roles: user.roles.map(({ roleCode, campusId }) => ({
        code: roleCode,
        campusId,
      })),
    };
  }

  private async issueSession(me: MeView): Promise<AuthSession> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: me.userId, kind: 'access' },
        {
          secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
          expiresIn: this.accessTokenTtlSeconds,
        },
      ),
      this.jwtService.signAsync(
        { sub: me.userId, kind: 'refresh' },
        {
          secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
          expiresIn: this.refreshTokenTtlSeconds,
        },
      ),
    ]);

    return {
      accessToken,
      refreshToken,
      expiresInSeconds: this.accessTokenTtlSeconds,
      me,
    };
  }

  private hasValidSingleRoleScope(me: MeView): boolean {
    if (me.roles.length !== 1) {
      return false;
    }
    const role = me.roles[0];
    if (
      role.code === 'SUPER_ADMIN' ||
      role.code === 'HR' ||
      role.code === 'FINANCE'
    ) {
      return role.campusId === null;
    }
    return (
      (role.code === 'PARENT' ||
        role.code === 'PARTNER' ||
        role.code === 'TEACHER' ||
        role.code === 'CAMPUS_MANAGER') &&
      typeof role.campusId === 'string' &&
      role.campusId.length > 0
    );
  }

  private requireMockDriver(): void {
    if (this.configService.get<string>('AUTH_DRIVER') !== 'mock') {
      throw new DomainError(
        ErrorCode.BAD_REQUEST,
        'The configured authentication driver cannot consume a Mock code',
        400,
      );
    }
  }

  private unauthorized(): never {
    throw new DomainError(
      ErrorCode.UNAUTHORIZED,
      'The login code or account is invalid',
      401,
    );
  }
}
