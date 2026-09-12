import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { DomainError } from '../../common/errors/domain-error';
import {
  maskStaffPhone,
  normalizeStaffPhone,
  StaffAccountManagementService,
} from './staff-account-management.service';

const actor = {
  userId: '90000000-0000-4000-8000-000000000001',
  roles: [{ code: 'SUPER_ADMIN' as const, campusId: null }],
};

const campus = {
  id: '10000000-0000-4000-8000-000000000001',
  name: '东城校区',
};

describe('staff account management service', () => {
  it.each(['HR', 'FINANCE'])('creates a headquarters %s without campus or teacher profile', async (roleCode) => {
    const harness = createHarness();
    const record = { ...accountRecord({ roleCode: 'PARTNER', bound: false }), roles: [{ roleCode, campusId: null, campus: null }] };
    harness.transaction.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(record);
    harness.transaction.user.create.mockResolvedValue({ id: record.id });
    const result = await harness.service.createAccount(actor, {
      displayName: '总部工作人员', phone: '13800138000', roleCode, campusId: null,
    } as never, `headquarters-create-${roleCode}`);
    expect(result).toMatchObject({ roleCode, campusId: null, campusName: '总部' });
    expect(harness.transaction.campus.findUnique).not.toHaveBeenCalled();
    const data = harness.transaction.user.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.roles).toEqual({ create: { roleCode, campusId: null } });
    expect(data).not.toHaveProperty('teacherProfile');
    expect(harness.transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ campusId: null, action: 'STAFF_ACCOUNT_CREATE' }),
    });
  });

  it.each([
    { roleCode: 'HR', campusId: campus.id },
    { roleCode: 'FINANCE', campusId: campus.id },
    { roleCode: 'PARTNER', campusId: null },
    { roleCode: 'TEACHER', campusId: null },
    { roleCode: 'CAMPUS_MANAGER', campusId: null },
  ])('rejects invalid campus scope $roleCode/$campusId before writes', async (scope) => {
    const harness = createHarness();
    await expect(harness.service.createAccount(actor, {
      displayName: '范围校验', phone: '13800138000', ...scope,
    } as never, 'scope-invalid')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not let a campus manager create headquarters accounts through the shared service', async () => {
    const harness = createHarness();
    await expect(harness.service.createAccount({
      userId: actor.userId, roles: [{ code: 'CAMPUS_MANAGER', campusId: campus.id }],
    }, { displayName: '总部人力', phone: '13800138000', roleCode: 'HR', campusId: null } as never,
    'unauthorized-hq')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('normalizes and masks mainland staff phone numbers', () => {
    expect(normalizeStaffPhone('13800138000')).toBe('+8613800138000');
    expect(normalizeStaffPhone('+8613800138000')).toBe('+8613800138000');
    expect(maskStaffPhone('+8613800138000')).toBe('+86****8000');
    expect(() => normalizeStaffPhone('12345')).toThrow(DomainError);
  });

  it('creates one teacher role, a minimal teacher profile, and an audit entry', async () => {
    const harness = createHarness();
    harness.transaction.campus.findUnique.mockResolvedValue(campus);
    harness.transaction.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(accountRecord({ roleCode: 'TEACHER', bound: false }));
    harness.transaction.user.create.mockResolvedValue({
      id: '70000000-0000-4000-8000-000000000001',
    });

    const result = await harness.service.createAccount(
      actor,
      {
        displayName: '林老师',
        phone: '13800138000',
        roleCode: 'TEACHER',
        campusId: campus.id,
      },
      'staff-create-0001',
    );

    expect(harness.transaction.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          displayName: '林老师',
          staffPhone: '+8613800138000',
          roles: { create: { roleCode: 'TEACHER', campusId: campus.id } },
          teacherProfile: {
            create: expect.objectContaining({
              campusId: campus.id,
              specialties: [],
              isActive: true,
              employeeCode: expect.stringMatching(/^T-/) as unknown,
            }) as unknown,
          },
        }) as unknown,
      }),
    );
    expect(harness.transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: actor.userId,
        action: 'STAFF_ACCOUNT_CREATE',
        resourceType: 'User',
        outcome: 'SUCCESS',
        details: expect.not.objectContaining({ phone: expect.anything() }) as unknown,
      }),
    });
    expect(result).toMatchObject({
      displayName: '林老师',
      maskedPhone: '+86****8000',
      roleCode: 'TEACHER',
      bindingStatus: 'UNBOUND',
      status: 'ACTIVE',
      version: 1,
    });
  });

  it('replays the same idempotency key without creating a duplicate user', async () => {
    const replayed = viewFixture();
    const harness = createHarness({ replayed });

    await expect(
      harness.service.createAccount(
        actor,
        {
          displayName: '林老师',
          phone: '13800138000',
          roleCode: 'TEACHER',
          campusId: campus.id,
        },
        'staff-create-replay',
      ),
    ).resolves.toEqual(replayed);
    expect(harness.transaction.user.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate phones and unsupported roles', async () => {
    const duplicate = createHarness();
    duplicate.transaction.campus.findUnique.mockResolvedValue(campus);
    duplicate.transaction.user.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(
      duplicate.service.createAccount(
        actor,
        {
          displayName: '重复账号',
          phone: '13800138000',
          roleCode: 'PARTNER',
          campusId: campus.id,
        },
        'staff-create-duplicate',
      ),
    ).rejects.toMatchObject({ code: 'STAFF_PHONE_ALREADY_EXISTS' });

    const unsupported = createHarness();
    await expect(
      unsupported.service.createAccount(
        actor,
        {
          displayName: '非法账号',
          phone: '13900139000',
          roleCode: 'PARENT',
          campusId: campus.id,
        } as never,
        'staff-create-invalid-role',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('updates status by expected version and synchronizes a teacher profile', async () => {
    const harness = createHarness();
    harness.transaction.user.findUnique
      .mockResolvedValueOnce(accountRecord({ roleCode: 'TEACHER' }))
      .mockResolvedValueOnce(
        accountRecord({ roleCode: 'TEACHER', status: 'DISABLED', version: 2 }),
      );
    harness.transaction.user.updateMany.mockResolvedValue({ count: 1 });

    const result = await harness.service.updateStatus(
      actor,
      '70000000-0000-4000-8000-000000000001',
      { status: 'DISABLED', expectedVersion: 1 },
      'staff-disable-0001',
    );

    expect(harness.transaction.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: '70000000-0000-4000-8000-000000000001',
        accountVersion: 1,
        staffPhone: { not: null },
      },
      data: { status: 'DISABLED', accountVersion: { increment: 1 } },
    });
    expect(harness.transaction.teacherProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: '70000000-0000-4000-8000-000000000001' },
      data: { isActive: false },
    });
    expect(result).toMatchObject({ status: 'DISABLED', version: 2 });
  });

  it('unbinds only the WeChat identity and increments the account version', async () => {
    const harness = createHarness();
    harness.transaction.user.findUnique
      .mockResolvedValueOnce(accountRecord({ roleCode: 'PARTNER' }))
      .mockResolvedValueOnce(
        accountRecord({ roleCode: 'PARTNER', version: 2, bound: false }),
      );
    harness.transaction.user.updateMany.mockResolvedValue({ count: 1 });
    harness.transaction.authIdentity.deleteMany.mockResolvedValue({ count: 1 });

    const result = await harness.service.unbindWechat(
      actor,
      '70000000-0000-4000-8000-000000000001',
      { expectedVersion: 1 },
      'staff-unbind-0001',
    );

    expect(harness.transaction.authIdentity.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: '70000000-0000-4000-8000-000000000001',
        provider: 'WECHAT',
      },
    });
    expect(result).toMatchObject({ bindingStatus: 'UNBOUND', version: 2 });
  });

  it('lists masked accounts without returning identity subjects', async () => {
    const harness = createHarness();
    harness.prisma.user.count.mockResolvedValue(1);
    harness.prisma.user.findMany.mockResolvedValue([
      accountRecord({ roleCode: 'CAMPUS_MANAGER', bound: true }),
    ]);

    const result = await harness.service.list({
      page: 1,
      pageSize: 20,
      query: '1380',
    });

    expect(result.data[0]).toEqual(
      expect.objectContaining({
        maskedPhone: '+86****8000',
        bindingStatus: 'BOUND',
      }),
    );
    expect(JSON.stringify(result)).not.toContain('wx-openid');
    expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
  });
});

function createHarness(options?: { replayed?: Record<string, unknown> }) {
  const transaction = {
    campus: { findUnique: jest.fn() },
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    teacherProfile: { updateMany: jest.fn() },
    authIdentity: { deleteMany: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    user: { count: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const idempotency = {
    claim: jest.fn().mockResolvedValue(
      options?.replayed
        ? { replayed: true, responseBody: options.replayed }
        : { replayed: false, requestHash: 'hash' },
    ),
    complete: jest.fn().mockResolvedValue(undefined),
  };
  return {
    transaction,
    prisma,
    idempotency,
    service: new StaffAccountManagementService(
      prisma as unknown as PrismaService,
      idempotency as unknown as IdempotencyService,
    ),
  };
}

function accountRecord(options: {
  roleCode: 'TEACHER' | 'CAMPUS_MANAGER' | 'PARTNER';
  status?: 'ACTIVE' | 'DISABLED';
  version?: number;
  bound?: boolean;
}) {
  return {
    id: '70000000-0000-4000-8000-000000000001',
    displayName: '林老师',
    staffPhone: '+8613800138000',
    status: options.status ?? 'ACTIVE',
    accountVersion: options.version ?? 1,
    createdAt: new Date('2026-09-03T00:00:00.000Z'),
    updatedAt: new Date('2026-09-03T00:00:00.000Z'),
    roles: [
      {
        roleCode: options.roleCode,
        campusId: campus.id,
        campus,
      },
    ],
    authIdentities: options.bound === false ? [] : [{ provider: 'WECHAT', subject: 'wx-openid' }],
  };
}

function viewFixture() {
  return {
    id: '70000000-0000-4000-8000-000000000001',
    displayName: '林老师',
    maskedPhone: '+86****8000',
    roleCode: 'TEACHER',
    campusId: campus.id,
    campusName: campus.name,
    bindingStatus: 'UNBOUND',
    status: 'ACTIVE',
    version: 1,
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
  };
}
