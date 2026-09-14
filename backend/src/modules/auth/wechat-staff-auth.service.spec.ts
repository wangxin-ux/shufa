import type { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuthService } from './auth.service';
import type { WechatIdentityGateway } from './wechat-identity.gateway';
import { WechatStaffAuthService } from './wechat-staff-auth.service';

describe('WeChat staff authentication service', () => {
  it.each(['HR', 'FINANCE'])('binds a single headquarters %s with null campus', async (roleCode) => {
    const harness = createHarness();
    harness.gateway.exchangeLoginCode.mockResolvedValue({ openId: 'hq-openid' });
    harness.gateway.exchangePhoneCode.mockResolvedValue({ phone: '13800138000' });
    harness.transaction.user.findUnique.mockResolvedValue({
      ...staffAccount(), roles: [{ roleCode, campusId: null }],
    });
    harness.transaction.authIdentity.findUnique.mockResolvedValue(null);
    harness.transaction.authIdentity.createMany.mockResolvedValue({ count: 1 });
    harness.transaction.user.updateMany.mockResolvedValue({ count: 1 });
    await harness.service.bindPhone({ code: 'hq-code', phoneCode: 'hq-phone' }, `hq-bind-${roleCode}`);
    expect(harness.transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ campusId: null, details: { roleCode, campusId: null } }),
    });
    expect(harness.authService.issueSessionForUser).toHaveBeenCalledWith('staff-user');
  });

  it.each([
    [{ roleCode: 'HR', campusId: 'campus-id' }],
    [{ roleCode: 'FINANCE', campusId: 'campus-id' }],
    [{ roleCode: 'TEACHER', campusId: null }],
    [{ roleCode: 'HR', campusId: null }, { roleCode: 'SUPER_ADMIN', campusId: null }],
  ])('rejects invalid headquarters and mixed-role binding', async (...roles) => {
    const harness = createHarness();
    harness.gateway.exchangeLoginCode.mockResolvedValue({ openId: 'hq-openid' });
    harness.gateway.exchangePhoneCode.mockResolvedValue({ phone: '13800138000' });
    harness.transaction.user.findUnique.mockResolvedValue({ ...staffAccount(), roles });
    await expect(harness.service.bindPhone({ code: 'code', phoneCode: 'phone' }, 'invalid-bind'))
      .rejects.toMatchObject({ code: 'STAFF_ACCOUNT_UNAVAILABLE' });
    expect(harness.transaction.authIdentity.createMany).not.toHaveBeenCalled();
  });

  it('logs in an active staff account already bound to the WeChat identity', async () => {
    const harness = createHarness();
    harness.gateway.exchangeLoginCode.mockResolvedValue({ openId: 'wx-openid' });
    harness.prisma.authIdentity.findUnique.mockResolvedValue({ userId: 'staff-user' });

    await expect(harness.service.login('login-code')).resolves.toEqual(session);
    expect(harness.authService.issueSessionForUser).toHaveBeenCalledWith('staff-user');
  });

  it('requires phone authorization when the WeChat identity is not bound', async () => {
    const harness = createHarness();
    harness.gateway.exchangeLoginCode.mockResolvedValue({ openId: 'unbound-openid' });
    harness.prisma.authIdentity.findUnique.mockResolvedValue(null);

    await expect(harness.service.login('login-code')).rejects.toMatchObject({
      code: 'STAFF_PHONE_BINDING_REQUIRED',
      statusCode: 409,
    });
  });

  it('binds one trusted phone to one active single-role staff account', async () => {
    const harness = createHarness();
    harness.gateway.exchangeLoginCode.mockResolvedValue({ openId: 'new-openid' });
    harness.gateway.exchangePhoneCode.mockResolvedValue({ phone: '13800138000' });
    harness.transaction.user.findUnique.mockResolvedValue(staffAccount());
    harness.transaction.authIdentity.findUnique.mockResolvedValue(null);
    harness.transaction.authIdentity.createMany.mockResolvedValue({ count: 1 });
    harness.transaction.user.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      harness.service.bindPhone(
        { code: 'fresh-login-code', phoneCode: 'trusted-phone-code' },
        'wechat-bind-0001',
      ),
    ).resolves.toEqual(session);

    expect(harness.transaction.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { staffPhone: '+8613800138000' } }),
    );
    expect(harness.transaction.authIdentity.createMany).toHaveBeenCalledWith({
      data: { userId: 'staff-user', provider: 'WECHAT', subject: 'new-openid' },
      skipDuplicates: true,
    });
    expect(harness.transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'STAFF_ACCOUNT_WECHAT_BIND',
        actorUserId: 'staff-user',
        details: expect.not.objectContaining({
          phone: expect.anything(),
          openId: expect.anything(),
        }) as unknown,
      }),
    });
    expect(harness.authService.issueSessionForUser).toHaveBeenCalledWith('staff-user');
  });

  it('rejects an unknown or disabled staff phone without exposing it', async () => {
    const harness = createHarness();
    harness.gateway.exchangeLoginCode.mockResolvedValue({ openId: 'new-openid' });
    harness.gateway.exchangePhoneCode.mockResolvedValue({ phone: '13800138000' });
    harness.transaction.user.findUnique.mockResolvedValue(null);

    await expect(
      harness.service.bindPhone(
        { code: 'fresh-login-code', phoneCode: 'trusted-phone-code' },
        'wechat-bind-missing',
      ),
    ).rejects.toMatchObject({
      code: 'STAFF_ACCOUNT_UNAVAILABLE',
      message: expect.not.stringContaining('13800138000') as unknown,
    });
  });

  it('does not replace a different WeChat identity already bound to the account', async () => {
    const harness = createHarness();
    harness.gateway.exchangeLoginCode.mockResolvedValue({ openId: 'new-openid' });
    harness.gateway.exchangePhoneCode.mockResolvedValue({ phone: '13800138000' });
    harness.transaction.user.findUnique.mockResolvedValue(staffAccount());
    harness.transaction.authIdentity.findUnique
      .mockResolvedValueOnce({ userId: 'staff-user', subject: 'old-openid' })
      .mockResolvedValueOnce(null);

    await expect(
      harness.service.bindPhone(
        { code: 'fresh-login-code', phoneCode: 'trusted-phone-code' },
        'wechat-bind-conflict',
      ),
    ).rejects.toMatchObject({ code: 'WECHAT_IDENTITY_CONFLICT' });
    expect(harness.transaction.authIdentity.createMany).not.toHaveBeenCalled();
  });

  it('replays a completed bind without creating another identity', async () => {
    const harness = createHarness({ replayedUserId: 'staff-user' });
    harness.gateway.exchangeLoginCode.mockResolvedValue({ openId: 'same-openid' });
    harness.gateway.exchangePhoneCode.mockResolvedValue({ phone: '13800138000' });
    harness.transaction.user.findUnique.mockResolvedValue(staffAccount());

    await expect(
      harness.service.bindPhone(
        { code: 'fresh-login-code', phoneCode: 'trusted-phone-code' },
        'wechat-bind-replay',
      ),
    ).resolves.toEqual(session);
    expect(harness.transaction.authIdentity.createMany).not.toHaveBeenCalled();
  });
});

const session = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresInSeconds: 3600,
  me: {
    userId: 'staff-user',
    displayName: '林老师',
    roles: [{ code: 'TEACHER' as const, campusId: 'campus-id' }],
  },
};

function staffAccount() {
  return {
    id: 'staff-user',
    status: 'ACTIVE' as const,
    staffPhone: '+8613800138000',
    accountVersion: 1,
    roles: [
      {
        roleCode: 'TEACHER' as const,
        campusId: 'campus-id',
      },
    ],
  };
}

function createHarness(options?: { replayedUserId?: string }) {
  const transaction = {
    user: { findUnique: jest.fn(), updateMany: jest.fn() },
    authIdentity: { findUnique: jest.fn(), createMany: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    authIdentity: { findUnique: jest.fn() },
    $transaction: jest.fn(async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const idempotency = {
    claim: jest.fn().mockResolvedValue(
      options?.replayedUserId
        ? { replayed: true, responseBody: { userId: options.replayedUserId } }
        : { replayed: false, requestHash: 'hash' },
    ),
    complete: jest.fn().mockResolvedValue(undefined),
  };
  const gateway = {
    exchangeLoginCode: jest.fn(),
    exchangePhoneCode: jest.fn(),
  };
  const authService = {
    issueSessionForUser: jest.fn().mockResolvedValue(session),
  };
  return {
    transaction,
    prisma,
    idempotency,
    gateway,
    authService,
    service: new WechatStaffAuthService(
      prisma as unknown as PrismaService,
      idempotency as unknown as IdempotencyService,
      gateway as unknown as WechatIdentityGateway,
      authService as unknown as AuthService,
    ),
  };
}
