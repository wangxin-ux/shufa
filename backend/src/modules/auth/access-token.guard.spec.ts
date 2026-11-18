import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccessTokenGuard } from './access-token.guard';

describe('AccessTokenGuard', () => {
  const secret = 'partner-applicant-unit-test-secret-32-characters';
  const userId = 'a441025e-85ba-439b-ad7b-1294a4072058';
  const campusId = 'ce8bda14-e4bf-4d91-89d7-af83769305b8';

  const guardedRequest = (token: string, account: unknown = {
    id: userId, roles: [{ roleCode: 'PARTNER', campusId }],
  }) => {
    const request = {
      headers: { authorization: `Bearer ${token}` },
    };
    const findFirst = jest.fn().mockResolvedValue(account);
    const guard = new AccessTokenGuard(
      new JwtService(),
      { getOrThrow: () => secret } as unknown as ConfigService,
      { user: { findFirst } } as unknown as PrismaService,
    );
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { guard, context, request, findFirst };
  };

  it.each(['partner_application', 'refresh'])(
    'rejects a genuinely signed %s token before looking up a formal account',
    async (kind) => {
      const token = await new JwtService().signAsync(
        { sub: userId, kind },
        { secret, audience: 'partner_application', expiresIn: 60 },
      );
      const { guard, context, request, findFirst } = guardedRequest(token);
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: 'UNAUTHORIZED', statusCode: 401,
      });
      expect(findFirst).not.toHaveBeenCalled();
      expect(request).not.toHaveProperty('user');
    },
  );

  it.each(['wrong-signature', 'expired'])(
    'rejects a %s formal token before querying user data',
    async (scenario) => {
      const token = await new JwtService().signAsync(
        { sub: userId, kind: 'access' },
        {
          secret: scenario === 'wrong-signature' ? `${secret}-other` : secret,
          expiresIn: scenario === 'expired' ? -1 : 60,
        },
      );
      const { guard, context, request, findFirst } = guardedRequest(token);
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: 'UNAUTHORIZED', statusCode: 401,
      });
      expect(findFirst).not.toHaveBeenCalled();
      expect(request).not.toHaveProperty('user');
    },
  );

  it.each([null, { id: userId, roles: [] }])(
    'does not promote an unavailable or zero-role identity to a formal user: %s',
    async (account) => {
      const token = await new JwtService().signAsync(
        { sub: userId, kind: 'access' }, { secret, expiresIn: 60 },
      );
      const { guard, context, request, findFirst } = guardedRequest(token, account);
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: 'UNAUTHORIZED', statusCode: 401,
      });
      expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: userId, status: 'ACTIVE' },
      }));
      expect(request).not.toHaveProperty('user');
    },
  );

  it('keeps the existing scoped formal PARTNER access path working', async () => {
    const token = await new JwtService().signAsync(
      { sub: userId, kind: 'access' }, { secret, expiresIn: 60 },
    );
    const { guard, context, request } = guardedRequest(token);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request).toHaveProperty('user', {
      userId, roles: [{ code: 'PARTNER', campusId }],
    });
  });

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
