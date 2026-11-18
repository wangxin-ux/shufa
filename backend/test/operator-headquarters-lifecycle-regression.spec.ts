import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { load } from 'js-yaml';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { AuthenticatedUser } from '../src/common/auth/authenticated-user';
import { hasValidStaffCampus } from '../src/common/auth/staff-roles';
import { OperatorScopeService } from '../src/common/auth/operator-scope.service';
import { CreateStaffAccountDto } from '../src/modules/management/dto/staff-account-management.dto';
import {
  memory,
  ordinary,
  user,
  admin,
  adminId,
  campusId,
  targetId,
  uuid,
} from './support/operator-headquarters-lifecycle-memory';
import type { MemoryRole } from './support/operator-headquarters-lifecycle-memory';

const sourceFile =
  require.resolve('../src/modules/management/staff-account-management.service');
const contract = load(
  readFileSync(
    resolve(dirname(sourceFile), '../../../../contracts/openapi.yaml'),
    'utf8',
  ),
) as {
  components: {
    schemas: {
      StaffAccountView: {
        properties: Record<string, unknown>;
        additionalProperties: boolean;
      };
    };
  };
};
const viewFields = Object.keys(
  contract.components.schemas.StaffAccountView.properties,
).sort();
const stateCopy = (h: ReturnType<typeof memory>) => structuredClone(h.state);
const projection = async (h: ReturnType<typeof memory>) => {
  h.state.listIds = [targetId];
  return h.service.list(admin, { page: 1, pageSize: 20 });
};
const hqActor: AuthenticatedUser = {
  userId: targetId,
  roles: [{ code: 'OPERATOR', campusId: null }],
};

describe('headquarters lifecycle regression against actual main', () => {
  it('[SQL shape] count and page source explicitly admit exact null-campus OPERATOR before pagination', async () => {
    const h = memory();
    await h.service.list(admin, {
      page: 2,
      pageSize: 20,
      roleCode: 'OPERATOR',
      query: 'Synthetic',
    });
    const [count, page] = h.queries.filter(
      (row) =>
        row.sql.includes('SELECT count(*) AS total') ||
        row.sql.includes('SELECT u.id'),
    );
    const from = (sql: string) =>
      sql
        .slice(sql.indexOf('FROM "User"'))
        .split('ORDER BY u."createdAt"')[0]
        .trim();
    expect(from(count.sql)).toBe(from(page.sql));
    for (const query of [count, page]) {
      expect(query.sql).toContain('NOT EXISTS (SELECT 1 FROM "UserRole" extra');
      expect(query.sql).toMatch(
        /r\."roleCode"\s*=\s*'OPERATOR'\s+AND\s+r\."campusId"\s+IS\s+NULL/,
      );
      expect(query.values).toContain('OPERATOR');
      expect(query.values).toContain('Synthetic');
    }
    expect(h.transactionOptions[0]).toEqual({
      isolationLevel: 'RepeatableRead',
    });
  });

  it('[projection] a preselected headquarters row retains the original public list shape and explicit null scope', async () => {
    const h = memory();
    const result = await projection(h);
    expect(result.meta).toEqual({
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    });
    expect(result.data[0]).toMatchObject({
      id: targetId,
      roleCode: 'OPERATOR',
      campusId: null,
      campusName: '总部',
      maskedPhone: '+86****0001',
      bindingStatus: 'BOUND',
      version: 4,
    });
    expect(Object.keys(result.data[0]).sort()).toEqual(viewFields);
    expect(
      contract.components.schemas.StaffAccountView.additionalProperties,
    ).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(
      /synthetic-old-wechat|19900000001|staffPhone|authIdentities/,
    );
  });

  it('[projection] an ordinary single-campus operator keeps its existing public fields', async () => {
    const h = memory(ordinary());
    const result = await projection(h);
    expect(result.data[0]).toMatchObject({
      roleCode: 'OPERATOR',
      campusId,
      campusName: 'Synthetic campus',
    });
    expect(Object.keys(result.data[0]).sort()).toEqual(viewFields);
    expect(JSON.stringify(result)).not.toMatch(
      /synthetic-old-wechat|19900000001|staffPhone|authIdentities/,
    );
  });

  it('[behavior] headquarters disable, replay and re-enable preserve retained grants and enforce current read status', async () => {
    const h = memory(),
      grants = structuredClone(h.state.grants);
    const before = await h.scope.snapshot(hqActor, async (_tx, ids) => [
      ...ids,
    ]);
    expect(before).toEqual([campusId]);
    const disabled = await h.service.updateStatus(
      admin,
      targetId,
      { status: 'DISABLED', expectedVersion: 4 },
      'hq-status-original',
    );
    expect(disabled).toMatchObject({
      status: 'DISABLED',
      campusId: null,
      version: 5,
    });
    expect(
      await h.service.updateStatus(
        admin,
        targetId,
        { status: 'DISABLED', expectedVersion: 4 },
        'hq-status-original',
      ),
    ).toEqual(disabled);
    await expect(
      h.scope.snapshot(hqActor, async () => 'private'),
    ).rejects.toMatchObject({ statusCode: 401 });
    const enabled = await h.service.updateStatus(
      admin,
      targetId,
      { status: 'ACTIVE', expectedVersion: 5 },
      'hq-status-enable',
    );
    expect(enabled).toMatchObject({ status: 'ACTIVE', version: 6 });
    expect(
      await h.scope.snapshot(hqActor, async (_tx, ids) => [...ids]),
    ).toEqual([campusId]);
    expect(h.state.grants).toEqual(grants);
    expect(h.state.audits.map((row) => row.action)).toEqual([
      'STAFF_ACCOUNT_STATUS_UPDATE',
      'STAFF_ACCOUNT_STATUS_UPDATE',
    ]);
    expect(
      [...h.state.records.values()].every(
        (row) => row.status === 'COMPLETED' && row.campusId === null,
      ),
    ).toBe(true);
    expect(h.state.users.get(targetId)!.accountVersion).toBe(6);
  });

  it('[behavior] headquarters unbind and replay remove only WeChat and allow the actual new binding transaction', async () => {
    const h = memory(),
      grants = structuredClone(h.state.grants);
    const result = await h.service.unbindWechat(
      admin,
      targetId,
      { expectedVersion: 4 },
      'hq-unbind-original',
    );
    expect(result).toMatchObject({
      bindingStatus: 'UNBOUND',
      version: 5,
      campusId: null,
    });
    expect(
      await h.service.unbindWechat(
        admin,
        targetId,
        { expectedVersion: 4 },
        'hq-unbind-original',
      ),
    ).toEqual(result);
    expect(h.state.identities).toEqual([
      {
        userId: targetId,
        provider: 'MOCK',
        subject: 'synthetic-retained-mock',
      },
    ]);
    await expect(
      h.wechat('synthetic-old-wechat').login('synthetic-code'),
    ).rejects.toMatchObject({
      code: 'STAFF_PHONE_BINDING_REQUIRED',
      statusCode: 409,
    });
    expect(h.sessionBoundaries).toEqual([]);
    await expect(
      h
        .wechat('synthetic-new-wechat')
        .bindPhone(
          { code: 'synthetic-code', phoneCode: 'synthetic-phone-code' },
          'hq-rebind-original',
        ),
    ).rejects.toThrow('SYNTHETIC_SESSION_BOUNDARY_NO_CREDENTIAL_ISSUED');
    expect(
      h.state.identities.filter((row) => row.provider === 'WECHAT'),
    ).toEqual([
      { userId: targetId, provider: 'WECHAT', subject: 'synthetic-new-wechat' },
    ]);
    expect(h.state.users.get(targetId)!.accountVersion).toBe(6);
    expect(h.state.audits.map((row) => row.action)).toEqual([
      'STAFF_ACCOUNT_WECHAT_UNBIND',
      'STAFF_ACCOUNT_WECHAT_BIND',
    ]);
    expect(h.state.grants).toEqual(grants);
    expect(h.sessionBoundaries).toEqual([targetId]);
  });

  it('[behavior] ordinary status keeps version, original-key replay, changed-body conflict and private audit fields', async () => {
    const h = memory(ordinary());
    const input = { status: 'DISABLED' as const, expectedVersion: 4 };
    const result = await h.service.updateStatus(
      admin,
      targetId,
      input,
      'ordinary-status-original',
    );
    expect(result).toMatchObject({ status: 'DISABLED', campusId, version: 5 });
    expect(
      await h.service.updateStatus(
        admin,
        targetId,
        input,
        'ordinary-status-original',
      ),
    ).toEqual(result);
    await expect(
      h.service.updateStatus(
        admin,
        targetId,
        { ...input, status: 'ACTIVE' },
        'ordinary-status-original',
      ),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      statusCode: 409,
    });
    expect(h.state.users.get(targetId)!.accountVersion).toBe(5);
    expect(h.state.audits).toEqual([
      expect.objectContaining({
        actorUserId: adminId,
        resourceId: targetId,
        campusId,
        action: 'STAFF_ACCOUNT_STATUS_UPDATE',
        details: {
          roleCode: 'OPERATOR',
          statusBefore: 'ACTIVE',
          statusAfter: 'DISABLED',
          versionBefore: 4,
          versionAfter: 5,
        },
      }),
    ]);
    expect(JSON.stringify(h.state.audits)).not.toMatch(
      /19900000001|staffPhone|subject/,
    );
    const record = [...h.state.records.values()][0];
    expect(record).toMatchObject({
      key: 'ordinary-status-original',
      actorUserId: adminId,
      status: 'COMPLETED',
    });
  });

  it('[behavior] ordinary unbind keeps exact version, replay, retained identity and one audit', async () => {
    const h = memory(ordinary());
    const result = await h.service.unbindWechat(
      admin,
      targetId,
      { expectedVersion: 4 },
      'ordinary-unbind-original',
    );
    expect(result).toMatchObject({
      bindingStatus: 'UNBOUND',
      campusId,
      version: 5,
    });
    expect(
      await h.service.unbindWechat(
        admin,
        targetId,
        { expectedVersion: 4 },
        'ordinary-unbind-original',
      ),
    ).toEqual(result);
    expect(h.state.identities).toEqual([
      {
        userId: targetId,
        provider: 'MOCK',
        subject: 'synthetic-retained-mock',
      },
    ]);
    expect(h.state.audits).toEqual([
      expect.objectContaining({
        actorUserId: adminId,
        resourceId: targetId,
        campusId,
        action: 'STAFF_ACCOUNT_WECHAT_UNBIND',
        details: { roleCode: 'OPERATOR', versionBefore: 4, versionAfter: 5 },
      }),
    ]);
    await expect(
      h.wechat('synthetic-old-wechat').login('synthetic-code'),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(h.sessionBoundaries).toEqual([]);
  });

  for (const operation of ['status', 'unbind'] as const) {
    const invoke = (
      h: ReturnType<typeof memory>,
      expectedVersion: number,
      key: string,
    ) =>
      operation === 'status'
        ? h.service.updateStatus(
            admin,
            targetId,
            { status: 'DISABLED', expectedVersion },
            key,
          )
        : h.service.unbindWechat(admin, targetId, { expectedVersion }, key);
    it.each(['headquarters', 'ordinary'])(
      `[behavior] ${operation} rejects a stale version for %s without committed facts`,
      async (scope) => {
        const h = memory(scope === 'ordinary' ? ordinary() : user()),
          before = stateCopy(h);
        await expect(invoke(h, 3, 'stale-version')).rejects.toMatchObject({
          code: 'STAFF_ACCOUNT_VERSION_CONFLICT',
          statusCode: 409,
        });
        expect(h.state).toEqual(before);
      },
    );
    it(`[behavior] ${operation} rolls back its write and original idempotency claim when the ordinary audit fails`, async () => {
      const h = memory(ordinary());
      h.state.failAudit = true;
      const before = stateCopy(h);
      await expect(invoke(h, 4, 'audit-rollback')).rejects.toThrow(
        'SYNTHETIC_AUDIT_UNAVAILABLE',
      );
      expect(h.events).toContain('audit-attempt');
      expect(h.state).toEqual(before);
    });
    it(`[behavior] ${operation} rejects version exhaustion before any user or identity write`, async () => {
      const target = ordinary();
      target.accountVersion = 2147483647;
      const h = memory(target),
        before = stateCopy(h);
      await expect(
        invoke(h, 2147483647, 'version-exhausted'),
      ).rejects.toMatchObject({
        code: 'STAFF_ACCOUNT_VERSION_CONFLICT',
        statusCode: 409,
      });
      expect(h.state).toEqual(before);
      expect(h.events).not.toContain('user-update-attempt');
    });
    const invalid: Array<[string, MemoryRole[]]> = [
      [
        'mixed target',
        [...user().roles, { roleCode: 'HR', campusId: null, campus: null }],
      ],
      ['missing target campus', [{ roleCode: 'OPERATOR' }]],
      [
        'empty target campus',
        [{ roleCode: 'OPERATOR', campusId: '', campus: null }],
      ],
    ];
    it.each(invalid)(
      `[behavior] ${operation} rejects %s without committed state`,
      async (_label, roles) => {
        const h = memory(user(roles)),
          before = stateCopy(h);
        await expect(invoke(h, 4, 'invalid-target')).rejects.toMatchObject({
          code: 'STAFF_ACCOUNT_UNAVAILABLE',
          statusCode: 404,
        });
        expect(h.state).toEqual(before);
      },
    );
  }

  it('[behavior] the ordinary create service and DTO continue to reject null-campus OPERATOR before persistence', async () => {
    const h = memory(),
      before = stateCopy(h);
    const input = {
      displayName: 'Synthetic reader',
      phone: '19900000001',
      roleCode: 'OPERATOR' as const,
      campusId: null,
    };
    expect(hasValidStaffCampus('OPERATOR', null)).toBe(false);
    expect(
      validateSync(plainToInstance(CreateStaffAccountDto, input)).map(
        (row) => row.property,
      ),
    ).toContain('campusId');
    await expect(
      h.service.createAccount(admin, input, 'forbidden-general-create'),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      statusCode: 400,
    });
    expect(h.transactionOptions).toEqual([]);
    expect(h.state).toEqual(before);
  });

  it('[behavior] the headquarters reader still cannot obtain ordinary operator business scope', () => {
    expect(() => new OperatorScopeService().require(hqActor)).toThrow();
    expect(
      new OperatorScopeService().require({
        ...hqActor,
        roles: [{ code: 'OPERATOR', campusId }],
      }),
    ).toEqual({ userId: targetId, campusId });
  });

  it.each(['list', 'updateStatus', 'unbindWechat'] as const)(
    '[guards] a headquarters OPERATOR cannot invoke management %s through the actual guards/controller',
    async (method) => {
      const actor: AuthenticatedUser = {
        userId: uuid(41),
        roles: [{ code: 'OPERATOR', campusId: null }],
      };
      const h = memory(ordinary(), actor),
        before = stateCopy(h);
      const args =
        method === 'list'
          ? [{ page: 1, pageSize: 20 }]
          : [
              targetId,
              method === 'updateStatus'
                ? { status: 'DISABLED', expectedVersion: 4 }
                : { expectedVersion: 4 },
              'not-an-admin',
            ];
      await expect(h.dispatch(method, ...args)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(h.transactionOptions).toEqual([]);
      expect(h.state).toEqual(before);
    },
  );

  it.each([
    {
      label: 'mixed administrator',
      roles: [...admin.roles, { code: 'OPERATOR' as const, campusId: null }],
    },
    {
      label: 'campus-bound administrator',
      roles: [{ code: 'SUPER_ADMIN' as const, campusId }],
    },
  ])(
    '[guards] $label cannot disable an ordinary target through the actual guards/controller',
    async ({ roles }) => {
      const h = memory(ordinary(), { userId: adminId, roles }),
        before = stateCopy(h);
      await expect(
        h.dispatch(
          'updateStatus',
          targetId,
          { status: 'DISABLED', expectedVersion: 4 },
          'bad-admin-status',
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(h.state).toEqual(before);
    },
  );

  it('[guards] the current active administrator can use the existing ordinary management route', async () => {
    const h = memory(ordinary());
    await expect(
      h.dispatch(
        'updateStatus',
        targetId,
        { status: 'DISABLED', expectedVersion: 4 },
        'good-admin-status',
      ),
    ).resolves.toMatchObject({ status: 'DISABLED', version: 5 });
  });

  for (const method of ['list', 'updateStatus', 'unbindWechat'] as const) {
    const invoke = (h: ReturnType<typeof memory>, actor = admin) =>
      method === 'list'
        ? h.service.list(actor, { page: 1, pageSize: 20 })
        : method === 'updateStatus'
          ? h.service.updateStatus(
              actor,
              targetId,
              { status: 'DISABLED', expectedVersion: 4 },
              'admin-boundary',
            )
          : h.service.unbindWechat(
              actor,
              targetId,
              { expectedVersion: 4 },
              'admin-boundary',
            );
    it.each([
      {
        label: 'mixed input',
        roles: [...admin.roles, { code: 'OPERATOR' as const, campusId: null }],
      },
      {
        label: 'scoped input',
        roles: [{ code: 'SUPER_ADMIN' as const, campusId }],
      },
      {
        label: 'missing input scope',
        roles: [{ code: 'SUPER_ADMIN' as const }],
      },
      {
        label: 'empty input scope',
        roles: [{ code: 'SUPER_ADMIN' as const, campusId: '' }],
      },
    ])(
      `[administrator] ${method} refuses $label before claim or staff data`,
      async ({ roles }) => {
        const h = memory(ordinary()),
          before = stateCopy(h);
        await expect(
          invoke(h, { userId: adminId, roles } as AuthenticatedUser),
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(h.state).toEqual(before);
        expect(h.queries).toEqual([]);
        expect(h.events).not.toContain('idempotency-claim');
      },
    );
    it.each(['missing', 'disabled', 'mixed', 'scoped'] as const)(
      `[administrator] ${method} rechecks current %s administrator before replay/data`,
      async (change) => {
        const h = memory(ordinary());
        const current = h.state.users.get(adminId)!;
        if (change === 'missing') h.state.users.delete(adminId);
        if (change === 'disabled') current.status = 'DISABLED';
        if (change === 'mixed')
          current.roles.push({ roleCode: 'OPERATOR', campusId: null });
        if (change === 'scoped') current.roles[0].campusId = campusId;
        const before = stateCopy(h);
        await expect(invoke(h)).rejects.toMatchObject({
          statusCode: ['missing', 'disabled'].includes(change) ? 401 : 403,
        });
        expect(h.state).toEqual(before);
        expect(h.events).toContain('row-lock-request');
        expect(h.events).not.toContain('idempotency-claim');
        expect(h.events).not.toContain('user-update-attempt');
        expect(
          h.queries.every(
            (row) =>
              !row.sql.includes('SELECT count(*)') &&
              !row.sql.includes('SELECT u.id'),
          ),
        ).toBe(true);
      },
    );
  }

  for (const operation of ['status', 'unbind'] as const) {
    const invoke = (h: ReturnType<typeof memory>) =>
      operation === 'status'
        ? h.service.updateStatus(
            admin,
            targetId,
            { status: 'DISABLED', expectedVersion: 4 },
            'replay-after-revoke',
          )
        : h.service.unbindWechat(
            admin,
            targetId,
            { expectedVersion: 4 },
            'replay-after-revoke',
          );
    it.each(['disabled', 'mixed'])(
      `[administrator] ${operation} refuses its completed key after current administrator becomes %s`,
      async (change) => {
        const h = memory(ordinary());
        await invoke(h);
        expect([...h.state.records.values()][0].status).toBe('COMPLETED');
        const current = h.state.users.get(adminId)!;
        if (change === 'disabled') current.status = 'DISABLED';
        else current.roles.push({ roleCode: 'OPERATOR', campusId: null });
        const before = stateCopy(h),
          previousClaims = h.events.filter(
            (event) => event === 'idempotency-claim',
          ).length;
        await expect(invoke(h)).rejects.toMatchObject({
          statusCode: change === 'disabled' ? 401 : 403,
        });
        expect(h.state).toEqual(before);
        expect(
          h.events.filter((event) => event === 'idempotency-claim'),
        ).toHaveLength(previousClaims);
      },
    );
    it(`[behavior] headquarters ${operation} rolls back version, identities and claim when audit fails`, async () => {
      const h = memory();
      h.state.failAudit = true;
      const before = stateCopy(h);
      await expect(invoke(h)).rejects.toThrow('SYNTHETIC_AUDIT_UNAVAILABLE');
      expect(h.events).toContain('audit-attempt');
      expect(h.state).toEqual(before);
    });
  }

  it.each(['disabled', 'mixed'] as const)(
    '[administrator] list discards its snapshot when the fresh administrator becomes %s',
    async (change) => {
      const h = memory(ordinary());
      h.state.listIds = [targetId];
      h.afterSnapshot(() => {
        const current = h.state.users.get(adminId)!;
        if (change === 'disabled') current.status = 'DISABLED';
        else current.roles.push({ roleCode: 'OPERATOR', campusId: null });
      });
      await expect(
        h.dispatch('list', { page: 1, pageSize: 20 }),
      ).rejects.toMatchObject({
        statusCode: change === 'disabled' ? 401 : 403,
      });
      expect(h.state.audits).toEqual([]);
      expect(h.state.records.size).toBe(0);
    },
  );
});
