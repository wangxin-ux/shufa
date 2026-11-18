import { Prisma } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { AuthenticatedUser } from '../../src/common/auth/authenticated-user';
import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';
import { OperatorHeadquartersScopeService } from '../../src/common/auth/operator-headquarters-scope.service';
import { PermissionsGuard } from '../../src/common/auth/permissions.guard';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { StaffAccountManagementService } from '../../src/modules/management/staff-account-management.service';
import { StaffAccountManagementController } from '../../src/modules/management/staff-account-management.controller';
import { AccessTokenGuard } from '../../src/modules/auth/access-token.guard';
import type { AuthService } from '../../src/modules/auth/auth.service';
import { WechatStaffAuthService } from '../../src/modules/auth/wechat-staff-auth.service';

// Query objects are the ORM boundary; service results are never stubbed.
type Query = Record<string, any>;
export interface MemoryRole {
  roleCode: string;
  campusId?: string | null;
  campus?: { id: string; name: string } | null;
}
export interface MemoryUser {
  id: string;
  displayName: string;
  staffPhone: string | null;
  status: string;
  accountVersion: number;
  createdAt: Date;
  updatedAt: Date;
  roles: MemoryRole[];
}
interface Identity {
  userId: string;
  provider: string;
  subject: string;
}
interface Grant {
  userId: string;
  campusId: string;
  isActive: boolean;
  version: number;
}
export const uuid = (number: number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export const campusId = uuid(20),
  targetId = uuid(30),
  adminId = uuid(40);
export const admin: AuthenticatedUser = {
  userId: adminId,
  roles: [{ code: 'SUPER_ADMIN', campusId: null }],
};
export const user = (
  roles: MemoryRole[] = [
    { roleCode: 'OPERATOR', campusId: null, campus: null },
  ],
): MemoryUser => ({
  id: targetId,
  displayName: 'Synthetic headquarters reader',
  staffPhone: '+8619900000001',
  status: 'ACTIVE',
  accountVersion: 4,
  createdAt: new Date('2026-10-30T00:00:00.123Z'),
  updatedAt: new Date('2026-10-30T00:00:00.123Z'),
  roles,
});
export const ordinary = () =>
  user([
    {
      roleCode: 'OPERATOR',
      campusId,
      campus: { id: campusId, name: 'Synthetic campus' },
    },
  ]);
const clone = <T>(value: T): T => structuredClone(value);

function project(value: any, select?: Query): any {
  if (value === null || value === undefined || !select) return clone(value);
  const result: Query = {};
  for (const [key, selection] of Object.entries(select)) {
    if (!(key in value)) continue;
    if (selection === true) result[key] = clone(value[key]);
    else if (selection && typeof selection === 'object') {
      let nested = value[key];
      if (Array.isArray(nested)) {
        const where = selection.where;
        if (where)
          nested = nested.filter((row) =>
            Object.entries(where).every(
              ([name, expected]) => row[name] === expected,
            ),
          );
        result[key] = nested.map((row: unknown) =>
          project(row, selection.select),
        );
      } else result[key] = project(nested, selection.select);
    }
  }
  return result;
}

export function memory(
  target: MemoryUser = user(),
  actor: AuthenticatedUser = admin,
) {
  let afterSnapshot: (() => void) | undefined;
  const state = {
    users: new Map<string, MemoryUser>([
      [target.id, clone(target)],
      [
        actor.userId,
        {
          ...user(
            actor.roles.map((role) => ({
              roleCode: role.code,
              campusId: role.campusId,
              campus: null,
            })),
          ),
          id: actor.userId,
          displayName: 'Synthetic administrator',
          staffPhone: '+8619900000002',
        },
      ],
    ]),
    identities: [
      {
        userId: target.id,
        provider: 'WECHAT',
        subject: 'synthetic-old-wechat',
      },
      {
        userId: target.id,
        provider: 'MOCK',
        subject: 'synthetic-retained-mock',
      },
    ] as Identity[],
    grants: [
      { userId: target.id, campusId, isActive: true, version: 3 },
      { userId: target.id, campusId: uuid(21), isActive: false, version: 7 },
    ] as Grant[],
    records: new Map<string, Query>(),
    audits: [] as Query[],
    profiles: new Map<string, boolean>(),
    listIds: [] as string[],
    failAudit: false,
    failVersionUpdate: false,
  };
  const events: string[] = [],
    queries: Array<{ sql: string; values: unknown[] }> = [];
  const transactionOptions: unknown[] = [],
    sessionBoundaries: string[] = [];
  const hydrated = (record?: MemoryUser) =>
    record
      ? {
          ...record,
          authIdentities: state.identities.filter(
            (identity) => identity.userId === record.id,
          ),
          partnerApplicationApproval: null,
        }
      : null;
  const findUser = (where: Query) =>
    [...state.users.values()].find(
      (record) =>
        (!('id' in where) || record.id === where.id) &&
        (!('staffPhone' in where) || record.staffPhone === where.staffPhone) &&
        (!('status' in where) || record.status === where.status),
    );
  const findUnique = async ({ where, select }: Query) =>
    project(hydrated(findUser(where)), select);
  const identityFind = async ({ where, select }: Query) => {
    const match = where.provider_subject ?? where.userId_provider;
    const found = state.identities.find((identity) =>
      Object.entries(match).every(
        ([key, value]) => identity[key as keyof Identity] === value,
      ),
    );
    return project(found ?? null, select);
  };
  const recordKey = (where: Query) => {
    const value = where.key_route ?? where;
    return value.key + '\0' + value.route;
  };
  const tx = {
    $queryRaw: async (
      source: Prisma.Sql | TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const query = Array.isArray(source)
        ? Prisma.sql(source as TemplateStringsArray, ...values)
        : (source as Prisma.Sql);
      queries.push({ sql: query.sql, values: clone(query.values) });
      if (/SELECT count\(\*\) AS total/.test(query.sql))
        return [{ total: BigInt(state.listIds.length) }];
      if (/SELECT u\.id/.test(query.sql)) {
        // Preselected rows exercise projection only, never SQL eligibility.
        const [limit, offset] = query.values.slice(-2) as [number, number];
        return state.listIds
          .slice(offset, offset + limit)
          .map((id) => ({ id }));
      }
      if (/SELECT g\."campusId"/.test(query.sql))
        return state.grants
          .filter((grant) => grant.userId === query.values[0] && grant.isActive)
          .sort((a, b) => a.campusId.localeCompare(b.campusId))
          .map(({ campusId: id, version }) => ({ campusId: id, version }));
      if (/FOR (UPDATE|SHARE)/.test(query.sql)) {
        events.push('row-lock-request');
        return [];
      }
      throw new Error('HARNESS_UNSUPPORTED_SQL: ' + query.sql);
    },
    user: {
      findUnique,
      findFirst: findUnique,
      findMany: async ({ where, select }: Query) =>
        where.id.in
          .map((id: string) => state.users.get(id))
          .filter(Boolean)
          .map((record: MemoryUser) => project(hydrated(record), select)),
      updateMany: async ({ where, data }: Query) => {
        events.push('user-update-attempt');
        const record = state.users.get(where.id);
        if (
          !record ||
          state.failVersionUpdate ||
          record.accountVersion !== where.accountVersion ||
          (where.status && record.status !== where.status) ||
          (where.staffPhone === null && record.staffPhone !== null) ||
          (where.staffPhone?.not === null && record.staffPhone === null)
        )
          return { count: 0 };
        if (data.status !== undefined) record.status = data.status;
        if (data.accountVersion?.increment)
          record.accountVersion += data.accountVersion.increment;
        return { count: 1 };
      },
      create: async () => {
        throw new Error('HARNESS_UNEXPECTED_USER_CREATE');
      },
    },
    teacherProfile: {
      updateMany: async ({ where, data }: Query) => {
        events.push('profile-update');
        if (!state.profiles.has(where.userId)) return { count: 0 };
        state.profiles.set(where.userId, data.isActive);
        return { count: 1 };
      },
    },
    authIdentity: {
      findUnique: identityFind,
      deleteMany: async ({ where }: Query) => {
        events.push('identity-delete');
        const before = state.identities.length;
        state.identities = state.identities.filter(
          (identity) =>
            !(
              identity.userId === where.userId &&
              identity.provider === where.provider
            ),
        );
        return { count: before - state.identities.length };
      },
      createMany: async ({ data }: Query) => {
        events.push('identity-insert');
        if (
          state.identities.some(
            (identity) =>
              identity.provider === data.provider &&
              (identity.userId === data.userId ||
                identity.subject === data.subject),
          )
        )
          return { count: 0 };
        state.identities.push(clone(data));
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }: Query) => {
        events.push('audit-attempt');
        if (state.failAudit) throw new Error('SYNTHETIC_AUDIT_UNAVAILABLE');
        state.audits.push(clone(data));
        return clone(data);
      },
    },
    idempotencyRecord: {
      createMany: async ({ data }: Query) => {
        events.push('idempotency-claim');
        const key = recordKey(data);
        if (state.records.has(key)) return { count: 0 };
        state.records.set(key, { ...clone(data), responseBody: null });
        return { count: 1 };
      },
      findUnique: async ({ where, select }: Query) =>
        project(state.records.get(recordKey(where)) ?? null, select),
      update: async ({ where, data }: Query) => {
        const record = state.records.get(recordKey(where));
        if (!record) throw new Error('HARNESS_MISSING_IDEMPOTENCY_RECORD');
        Object.assign(record, clone(data));
        return clone(record);
      },
    },
  };
  const prisma = {
    user: tx.user,
    authIdentity: tx.authIdentity,
    $transaction: async <T>(
      run: (client: typeof tx) => Promise<T>,
      options?: unknown,
    ): Promise<T> => {
      transactionOptions.push(clone(options));
      const before = clone(state);
      try {
        const result = await run(tx);
        if (
          (options as { isolationLevel?: string } | undefined)
            ?.isolationLevel === 'RepeatableRead' &&
          afterSnapshot
        ) {
          const notify = afterSnapshot;
          afterSnapshot = undefined;
          notify();
        }
        return result;
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    },
  };
  const service = new StaffAccountManagementService(
    prisma as unknown as PrismaService,
    new IdempotencyService(),
  );
  const controller = new StaffAccountManagementController(service);
  const scope = new OperatorHeadquartersScopeService(
    prisma as unknown as PrismaService,
  );
  async function dispatch(
    method: 'list' | 'updateStatus' | 'unbindWechat',
    ...args: unknown[]
  ) {
    const request: Query = {
      headers: { authorization: 'Bearer SYNTHETIC-UNVERIFIED-INPUT' },
    };
    const context = {
      getClass: () => StaffAccountManagementController,
      getHandler: () => controller[method],
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const access = new AccessTokenGuard(
      {
        verifyAsync: async () => ({ sub: actor.userId, kind: 'access' }),
      } as unknown as JwtService,
      {
        getOrThrow: () => 'SYNTHETIC-CONFIG-NOT-A-SECRET',
      } as unknown as ConfigService,
      prisma as unknown as PrismaService,
    );
    await access.canActivate(context);
    new PermissionsGuard(new Reflector()).canActivate(context);
    if (method === 'list')
      return controller.list(request.user, args[0] as never);
    if (method === 'updateStatus')
      return controller.updateStatus(
        request.user,
        args[0] as string,
        args[1] as never,
        args[2] as string,
      );
    return controller.unbindWechat(
      request.user,
      args[0] as string,
      args[1] as never,
      args[2] as string,
    );
  }
  function wechat(subject: string) {
    return new WechatStaffAuthService(
      prisma as unknown as PrismaService,
      new IdempotencyService(),
      {
        exchangeLoginCode: async () => ({ openId: subject }),
        exchangePhoneCode: async () => ({ phone: target.staffPhone! }),
      },
      {
        issueSessionForUser: async (id: string) => {
          sessionBoundaries.push(id);
          throw new Error('SYNTHETIC_SESSION_BOUNDARY_NO_CREDENTIAL_ISSUED');
        },
      } as unknown as AuthService,
    );
  }
  return {
    state,
    tx,
    prisma,
    service,
    scope,
    controller,
    dispatch,
    wechat,
    queries,
    events,
    transactionOptions,
    sessionBoundaries,
    afterSnapshot: (notify: () => void) => {
      afterSnapshot = notify;
    },
  };
}
