import { Prisma } from '@prisma/client';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { OperatorScopeService } from '../../common/auth/operator-scope.service';
import { hasValidStaffCampus } from '../../common/auth/staff-roles';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OperatorHeadquartersManagementService } from './operator-headquarters-management.service';
import { OperatorHeadquartersManagementController } from './operator-headquarters-management.controller';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import {
  CreateOperatorHeadquartersDto,
  UpdateOperatorCampusGrantDto,
} from './dto/operator-headquarters-management.dto';

const admin: AuthenticatedUser = {
  userId: '90000000-0000-4000-8000-000000000001',
  roles: [{ code: 'SUPER_ADMIN', campusId: null }],
};
const target = '70000000-0000-4000-8000-000000000002';
const campusId = '10000000-0000-4000-8000-000000000001';
const input = { displayName: '总部只读运营', phone: '13800138000' };
const headquarters = () => ({
  id: target,
  status: 'ACTIVE',
  displayName: input.displayName,
  staffPhone: '+8613800138000',
  accountVersion: 1,
  createdAt: new Date('2026-10-29T00:00:00Z'),
  roles: [{ roleCode: 'OPERATOR', campusId: null }],
});
interface Grant {
  campusId: string;
  isActive: boolean;
  version: number;
}

function harness(initial: Grant | null = null) {
  const state = {
    target: headquarters(),
    admin: {
      status: 'ACTIVE',
      roles: [{ roleCode: 'SUPER_ADMIN', campusId: null }],
    },
    grant: initial ? { ...initial } : null,
    campusExists: true,
    auditFailure: false,
    calls: [] as string[],
    audits: [] as Array<Record<string, unknown>>,
    replay: null as unknown,
  };
  const tx = {
    user: {
      findUnique: jest.fn(
        ({ where }: { where: { id?: string; staffPhone?: string } }) => {
          state.calls.push(`user:${where.id ?? 'phone'}`);
          if (where.staffPhone) return null;
          return where.id === admin.userId ? state.admin : state.target;
        },
      ),
      create: jest.fn(() => ({ ...state.target })),
    },
    campus: {
      findUnique: jest.fn(() =>
        state.campusExists ? { id: campusId, name: '东城校区' } : null,
      ),
    },
    auditLog: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        state.calls.push('audit');
        if (state.auditFailure) throw new Error('audit unavailable');
        state.audits.push(data);
        return {};
      }),
    },
    $queryRaw: jest.fn(
      (sql: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
        const text = 'sql' in sql ? sql.sql : sql.join('?');
        state.calls.push(text);
        if (text.includes('count(*) AS total FROM "OperatorCampusReadGrant"')) {
          return [{ total: state.grant ? 1n : 0n }];
        }
        if (
          text.includes('FROM "OperatorCampusReadGrant"') &&
          !text.includes('FOR SHARE')
        ) {
          return state.grant
            ? [{ ...state.grant, userId: target, name: '东城校区' }]
            : [];
        }
        if (text.includes('INSERT INTO "OperatorCampusReadGrant"')) {
          state.grant = { campusId, isActive: true, version: 1 };
          return [{ ...state.grant, userId: target }];
        }
        if (text.includes('UPDATE "OperatorCampusReadGrant"')) {
          const args = 'sql' in sql ? sql.values : values;
          state.grant = {
            campusId,
            isActive: args.find(
              (value) => typeof value === 'boolean',
            ) as boolean,
            version: state.grant!.version + 1,
          };
          return [{ ...state.grant, userId: target }];
        }
        return [];
      },
    ),
  };
  const prisma = {
    $transaction: jest.fn(
      async (read: (client: typeof tx) => Promise<unknown>) => {
        const before = {
          grant: state.grant && { ...state.grant },
          audits: [...state.audits],
        };
        try {
          return await read(tx);
        } catch (error) {
          state.grant = before.grant;
          state.audits = before.audits;
          throw error;
        }
      },
    ),
  };
  const idempotency = {
    claim: jest.fn(() =>
      state.replay === null
        ? { replayed: false, requestHash: 'test' }
        : { replayed: true, responseBody: state.replay },
    ),
    complete: jest.fn(),
  };
  const service = new OperatorHeadquartersManagementService(
    prisma as unknown as PrismaService,
    idempotency as unknown as IdempotencyService,
  );
  return { state, tx, prisma, idempotency, service };
}

describe('operator headquarters account and explicit campus grants', () => {
  it('creates a separate single-role null-campus account and audits without phone disclosure', async () => {
    const h = harness();
    const result = await h.service.create(admin, input, 'hq-create-test');
    expect(result).toMatchObject({
      id: target,
      roleCode: 'OPERATOR',
      campusId: null,
      maskedPhone: '+86****8000',
      version: 1,
    });
    expect(h.tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          staffPhone: '+8613800138000',
          roles: { create: { roleCode: 'OPERATOR', campusId: null } },
        }) as unknown,
      }),
    );
    expect(h.state.grant).toBeNull();
    expect(h.tx.campus.findUnique).not.toHaveBeenCalled();
    expect(h.state.audits).toEqual([
      expect.objectContaining({
        actorUserId: admin.userId,
        resourceType: 'User',
        resourceId: target,
        campusId: null,
        outcome: 'SUCCESS',
        action: 'OPERATOR_HEADQUARTERS_CREATE',
      }),
    ]);
    expect(JSON.stringify(h.state.audits)).not.toContain('13800138000');
  });

  it.each(
    [
      [{ code: 'OPERATOR', campusId: null }],
      [{ code: 'CAMPUS_MANAGER', campusId }],
      [{ code: 'HR', campusId: null }],
      [{ code: 'SUPER_ADMIN', campusId }],
      [
        { code: 'SUPER_ADMIN', campusId: null },
        { code: 'OPERATOR', campusId: null },
      ],
    ].map((roles) => ({ roles })),
  )(
    'rejects a non-exclusive headquarters administrator before any transaction',
    async ({ roles }) => {
      const h = harness();
      await expect(
        h.service.create(
          { ...admin, roles: roles as never },
          input,
          'bad-admin',
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['create', 'grant'] as const)(
    'rechecks the current administrator before %s writes',
    async (action) => {
      const h = harness();
      h.state.admin.status = 'DISABLED';
      const write =
        action === 'create'
          ? h.service.create(admin, input, 'disabled')
          : h.service.updateGrant(
              admin,
              target,
              campusId,
              { isActive: true, expectedVersion: 0 },
              'disabled',
            );
      await expect(write).rejects.toMatchObject({ statusCode: 401 });
      expect(h.tx.user.create).not.toHaveBeenCalled();
      expect(h.idempotency.claim).not.toHaveBeenCalled();
    },
  );

  it('replays completed creation without creating another user or another audit', async () => {
    const h = harness();
    h.state.replay = { id: target, roleCode: 'OPERATOR', campusId: null };
    await expect(
      h.service.create(admin, input, 'same-create'),
    ).resolves.toEqual(h.state.replay);
    expect(h.tx.user.create).not.toHaveBeenCalled();
    expect(h.state.audits).toEqual([]);
  });

  it('rejects a current administrator role change even with an old claimed role', async () => {
    const h = harness();
    h.state.admin.roles[0].roleCode = 'OPERATOR';
    await expect(
      h.service.create(admin, input, 'changed-role'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(h.tx.user.create).not.toHaveBeenCalled();
    expect(h.idempotency.claim).not.toHaveBeenCalled();
  });

  it('protects all dedicated management routes with authentication and staff management permission', () => {
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        OperatorHeadquartersManagementController,
      ),
    ).toBe('management/operator-headquarters');
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        OperatorHeadquartersManagementController,
      ),
    ).toEqual([AccessTokenGuard, PermissionsGuard]);
    expect(
      Reflect.getMetadata(
        'required-permissions',
        OperatorHeadquartersManagementController,
      ),
    ).toEqual(['STAFF_ACCOUNT_MANAGE']);
  });

  it('maps a phone uniqueness race to the existing conflict code', async () => {
    const h = harness();
    h.tx.user.create.mockImplementation(() => {
      throw Object.assign(new Error('duplicate'), { code: 'P2002' });
    });
    await expect(
      h.service.create(admin, input, 'duplicate-phone'),
    ).rejects.toMatchObject({
      code: 'STAFF_PHONE_ALREADY_EXISTS',
      statusCode: 409,
    });
    expect(h.idempotency.complete).not.toHaveBeenCalled();
  });

  it('retains a current empty grant list without a platform-wide fallback', async () => {
    const h = harness();
    await expect(
      h.service.listGrants(admin, target, { page: 1, pageSize: 20 }),
    ).resolves.toEqual({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
  });

  it('grants exactly one explicit campus with a positive version and audit', async () => {
    const h = harness();
    await expect(
      h.service.updateGrant(
        admin,
        target,
        campusId,
        { isActive: true, expectedVersion: 0 },
        'grant-one',
      ),
    ).resolves.toEqual({
      userId: target,
      campusId,
      isActive: true,
      version: 1,
    });
    expect(h.state.calls[0]).toMatch(/FROM "User".*ORDER BY "id" FOR UPDATE/s);
    const lock = h.state.calls.findIndex((text) =>
      text.includes('FROM "User"'),
    );
    const grantRead = h.state.calls.findIndex((text) =>
      text.includes('FROM "OperatorCampusReadGrant"'),
    );
    expect(grantRead).toBeGreaterThan(lock);
    expect(h.state.audits).toEqual([
      expect.objectContaining({
        actorUserId: admin.userId,
        campusId,
        outcome: 'SUCCESS',
        action: 'OPERATOR_HEADQUARTERS_GRANT_UPDATE',
        details: {
          userId: target,
          activeBefore: false,
          activeAfter: true,
          versionBefore: 0,
          versionAfter: 1,
        },
      }),
    ]);
  });

  it('soft revokes and regrants the retained row with new versions', async () => {
    const h = harness({ campusId, isActive: true, version: 1 });
    await expect(
      h.service.updateGrant(
        admin,
        target,
        campusId,
        { isActive: false, expectedVersion: 1 },
        'revoke',
      ),
    ).resolves.toMatchObject({ isActive: false, version: 2 });
    await expect(
      h.service.updateGrant(
        admin,
        target,
        campusId,
        { isActive: true, expectedVersion: 2 },
        'regrant',
      ),
    ).resolves.toMatchObject({ isActive: true, version: 3 });
    expect(h.state.calls.some((text) => /DELETE\s+FROM/i.test(text))).toBe(
      false,
    );
  });

  it('does not change version or create a business audit for an unchanged grant', async () => {
    const h = harness({ campusId, isActive: true, version: 5 });
    await expect(
      h.service.updateGrant(
        admin,
        target,
        campusId,
        { isActive: true, expectedVersion: 5 },
        'unchanged',
      ),
    ).resolves.toMatchObject({ isActive: true, version: 5 });
    expect(h.state.audits).toEqual([]);
    expect(
      h.state.calls.some((text) =>
        text.includes('UPDATE "OperatorCampusReadGrant"'),
      ),
    ).toBe(false);
  });

  it('does not insert a row when revoking an absent grant', async () => {
    const h = harness();
    await expect(
      h.service.updateGrant(
        admin,
        target,
        campusId,
        { isActive: false, expectedVersion: 0 },
        'absent-revoke',
      ),
    ).resolves.toMatchObject({ isActive: false, version: 0 });
    expect(h.state.grant).toBeNull();
    expect(h.state.audits).toEqual([]);
  });

  it.each([0, 3])(
    'rejects stale expected version %s before grant writes',
    async (expectedVersion) => {
      const h = harness({ campusId, isActive: true, version: 2 });
      await expect(
        h.service.updateGrant(
          admin,
          target,
          campusId,
          { isActive: false, expectedVersion },
          'stale',
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(h.state.grant?.version).toBe(2);
      expect(h.state.audits).toEqual([]);
    },
  );

  it('replays a completed mutation without incrementing version again', async () => {
    const h = harness({ campusId, isActive: false, version: 2 });
    h.state.replay = { userId: target, campusId, isActive: false, version: 2 };
    await expect(
      h.service.updateGrant(
        admin,
        target,
        campusId,
        { isActive: false, expectedVersion: 1 },
        'same-revoke',
      ),
    ).resolves.toEqual(h.state.replay);
    expect(h.state.audits).toEqual([]);
  });

  it.each(['campus', 'mixed'] as const)(
    'rejects a %s account as a headquarters target',
    async (kind) => {
      const h = harness();
      if (kind === 'campus')
        h.state.target.roles[0].campusId = campusId as never;
      else h.state.target.roles.push({ roleCode: 'HR', campusId: null });
      await expect(
        h.service.updateGrant(
          admin,
          target,
          campusId,
          { isActive: true, expectedVersion: 0 },
          'wrong-target',
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(h.state.grant).toBeNull();
    },
  );

  it('rejects a missing campus before any grant write', async () => {
    const h = harness();
    h.state.campusExists = false;
    await expect(
      h.service.updateGrant(
        admin,
        target,
        campusId,
        { isActive: true, expectedVersion: 0 },
        'missing-campus',
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(h.state.grant).toBeNull();
  });

  it('returns the missing-campus error before the idempotency campus foreign key is written', async () => {
    const h = harness();
    h.state.campusExists = false;
    const records = {
      createMany: jest.fn(() => {
        throw Object.assign(new Error('IdempotencyRecord campus foreign key'), {
          code: 'P2003',
        });
      }),
    };
    Object.assign(h.tx, { idempotencyRecord: records });
    const service = new OperatorHeadquartersManagementService(
      h.prisma as unknown as PrismaService,
      new IdempotencyService(),
    );
    await expect(
      service.updateGrant(
        admin,
        target,
        campusId,
        { isActive: true, expectedVersion: 0 },
        'missing-campus-before-claim',
      ),
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      statusCode: 404,
    });
    expect(records.createMany).not.toHaveBeenCalled();
    expect(h.state.grant).toBeNull();
    expect(h.state.audits).toEqual([]);
  });

  it('allows revocation for disabled HQ accounts but rejects granting them access', async () => {
    const h = harness({ campusId, isActive: true, version: 1 });
    h.state.target.status = 'DISABLED';
    await expect(
      h.service.updateGrant(
        admin,
        target,
        campusId,
        { isActive: false, expectedVersion: 1 },
        'disabled-revoke',
      ),
    ).resolves.toMatchObject({ isActive: false, version: 2 });
    await expect(
      h.service.updateGrant(
        admin,
        target,
        campusId,
        { isActive: true, expectedVersion: 2 },
        'disabled-grant',
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects version exhaustion before changing the retained row', async () => {
    const h = harness({ campusId, isActive: true, version: 2_147_483_647 });
    await expect(
      h.service.updateGrant(
        admin,
        target,
        campusId,
        { isActive: false, expectedVersion: 2_147_483_647 },
        'exhausted',
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(h.state.grant?.isActive).toBe(true);
  });

  it('propagates audit failure through the same transaction and does not complete the command', async () => {
    const h = harness();
    h.state.auditFailure = true;
    await expect(
      h.service.updateGrant(
        admin,
        target,
        campusId,
        { isActive: true, expectedVersion: 0 },
        'audit-fail',
      ),
    ).rejects.toThrow('audit unavailable');
    expect(h.state.grant).toBeNull();
    expect(h.idempotency.complete).not.toHaveBeenCalled();
  });

  it('keeps ordinary campus scope closed to headquarters accounts', () => {
    expect(hasValidStaffCampus('OPERATOR', null)).toBe(false);
    expect(() =>
      new OperatorScopeService().require({
        userId: target,
        roles: [{ code: 'OPERATOR', campusId: null }],
      }),
    ).toThrow();
    expect(
      new OperatorScopeService().require({
        userId: target,
        roles: [{ code: 'OPERATOR', campusId }],
      }),
    ).toEqual({ userId: target, campusId });
  });

  it('validates the separate create and grant commands without coercing booleans', () => {
    expect(
      validateSync(plainToInstance(CreateOperatorHeadquartersDto, input)),
    ).toEqual([]);
    for (const isActive of ['true', 1, null, undefined]) {
      expect(
        validateSync(
          plainToInstance(UpdateOperatorCampusGrantDto, {
            isActive,
            expectedVersion: 0,
          }),
        ).length,
      ).toBeGreaterThan(0);
    }
    for (const expectedVersion of [-1, 0.5, 2_147_483_648]) {
      expect(
        validateSync(
          plainToInstance(UpdateOperatorCampusGrantDto, {
            isActive: true,
            expectedVersion,
          }),
        ).length,
      ).toBeGreaterThan(0);
    }
  });
});
