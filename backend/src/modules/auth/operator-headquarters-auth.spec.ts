import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { hasValidStaffCampus } from '../../common/auth/staff-roles';
import { OperatorScopeService } from '../../common/auth/operator-scope.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthService } from './auth.service';
import type { StaffBindTokenService } from './staff-bind-token.service';
import { WechatStaffAuthService } from './wechat-staff-auth.service';

const userId = '72000000-0000-4000-8000-000000000900';
const campusId = '10000000-0000-4000-8000-000000000001';
type Role = { roleCode: string; campusId?: string | null };
const headquarters = [{ roleCode: 'OPERATOR', campusId: null }];

function host(roles: Role[] = headquarters, status = 'ACTIVE') {
  const account = {
    id: userId,
    displayName: '总部只读运营',
    roles,
    status,
    staffPhone: '+8613800138000',
    accountVersion: 1,
  };
  const tx = {
    user: {
      findUnique: jest.fn(() => Promise.resolve(account)),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    authIdentity: {
      findUnique: jest.fn(() => Promise.resolve(null)),
      createMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    auditLog: { create: jest.fn(() => Promise.resolve({})) },
  };
  const prisma = {
    user: {
      findFirst: jest.fn(() =>
        Promise.resolve(status === 'ACTIVE' ? account : null),
      ),
    },
    authIdentity: { findUnique: jest.fn(() => Promise.resolve({ userId })) },
    $transaction: <T>(run: (transaction: typeof tx) => Promise<T>) => run(tx),
  };
  const jwt = { signAsync: jest.fn(() => Promise.resolve('synthetic-token')) };
  const config = { get: () => 'mock', getOrThrow: () => 'synthetic-secret' };
  const idempotency = {
    claim: jest.fn(() => Promise.resolve({ replayed: false })),
    complete: jest.fn(() => Promise.resolve(undefined)),
  };
  const auth = new AuthService(
    prisma as unknown as PrismaService,
    jwt as unknown as JwtService,
    config as unknown as ConfigService,
    {} as StaffBindTokenService,
  );
  const gateway = {
    exchangeLoginCode: () => Promise.resolve({ openId: 'synthetic-hq-openid' }),
    exchangePhoneCode: () => Promise.resolve({ phone: '13800138000' }),
  };
  const wechat = new WechatStaffAuthService(
    prisma as unknown as PrismaService,
    idempotency as unknown as IdempotencyService,
    gateway,
    auth,
  );
  return { auth, wechat, tx, jwt, idempotency };
}

describe('headquarters authentication through existing real services', () => {
  it('allows existing Mock identity login for the independent null-campus OPERATOR', async () => {
    const h = host();
    const result = await h.auth.login('synthetic-hq-code');
    expect(result.me.roles).toEqual([{ code: 'OPERATOR', campusId: null }]);
    expect(h.jwt.signAsync).toHaveBeenCalledTimes(2);
  });

  it('allows an already bound WeChat identity without granting ordinary operator access', async () => {
    const h = host();
    const result = await h.wechat.login('synthetic-login-code');
    expect(result.me.userId).toBe(userId);
    expect(() => new OperatorScopeService().require(result.me)).toThrow();
    expect(hasValidStaffCampus('OPERATOR', null)).toBe(false);
  });

  it('binds a precreated headquarters account, preserving null scope in idempotency and audit', async () => {
    const h = host();
    const result = await h.wechat.bindPhone(
      { code: 'synthetic-code', phoneCode: 'synthetic-phone' },
      'synthetic-key',
    );
    expect(result.me.roles).toEqual([{ code: 'OPERATOR', campusId: null }]);
    expect(h.tx.authIdentity.createMany).toHaveBeenCalledWith({
      data: { userId, provider: 'WECHAT', subject: 'synthetic-hq-openid' },
      skipDuplicates: true,
    });
    expect(h.idempotency.claim).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ campusId: null, actorUserId: userId }),
    );
    expect(h.tx.auditLog.create.mock.calls[0]).toMatchObject([
      {
        data: {
          campusId: null,
          actorUserId: userId,
          action: 'STAFF_ACCOUNT_WECHAT_BIND',
          details: { roleCode: 'OPERATOR', campusId: null },
        },
      },
    ]);
  });

  const invalid: Array<[string, Role[]]> = [
    ['missing campus', [{ roleCode: 'OPERATOR' }]],
    ['empty campus', [{ roleCode: 'OPERATOR', campusId: '' }]],
    ['mixed identity', [...headquarters, { roleCode: 'TEACHER', campusId }]],
    ['teacher without campus', [{ roleCode: 'TEACHER', campusId: null }]],
    ['unknown role', [{ roleCode: 'OPERATOR_HEADQUARTERS', campusId: null }]],
  ];
  it.each(invalid)(
    'every session issuance rejects %s before signing',
    async (_label, roles) => {
      const h = host(roles);
      await expect(h.auth.issueSessionForUser(userId)).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(h.jwt.signAsync).not.toHaveBeenCalled();
    },
  );
  it.each(invalid)(
    'phone binding rejects %s before identity/audit writes',
    async (_label, roles) => {
      const h = host(roles);
      await expect(
        h.wechat.bindPhone(
          { code: 'synthetic-code', phoneCode: 'synthetic-phone' },
          'synthetic-key',
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(h.tx.authIdentity.createMany).not.toHaveBeenCalled();
      expect(h.tx.auditLog.create).not.toHaveBeenCalled();
      expect(h.jwt.signAsync).not.toHaveBeenCalled();
    },
  );

  it.each(['DISABLED', 'ARCHIVED'])(
    'does not issue sessions for %s accounts',
    async (status) => {
      const h = host(headquarters, status);
      await expect(h.wechat.login('synthetic-code')).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(h.jwt.signAsync).not.toHaveBeenCalled();
    },
  );

  it('keeps the ordinary campus operator on its existing scope', async () => {
    const h = host([{ roleCode: 'OPERATOR', campusId }]);
    const result = await h.auth.login('synthetic-code');
    expect(new OperatorScopeService().require(result.me)).toEqual({
      userId,
      campusId,
    });
  });
});
