import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccessTokenGuard } from './access-token.guard';

describe('AccessTokenGuard', () => {
  it('returns a Chinese message when the access token is missing', async () => {
    const request = { headers: {} };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const guard = new AccessTokenGuard(
      {} as JwtService,
      {} as ConfigService,
      {} as PrismaService,
    );

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      statusCode: 401,
      message: '登录凭证缺失或已失效',
    });
  });
});
