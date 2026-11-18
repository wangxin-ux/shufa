import {
  HttpException,
  ValidationPipe,
  type ExecutionContext,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { AuthService } from '../../src/modules/auth/auth.service';
import { AccessTokenGuard } from '../../src/modules/auth/access-token.guard';
import { PermissionsGuard } from '../../src/common/auth/permissions.guard';
import { DomainError } from '../../src/common/errors/domain-error';
import { createResponseEnvelope } from '../../src/common/interceptors/response-envelope.interceptor';
import { OperatorAccountController } from '../../src/modules/operator/operator-account.controller';
import {
  OperatorAccountQueryDto,
  OperatorAccountSubjectsQueryDto,
} from '../../src/modules/operator/dto/operator-account.dto';
import type { AuthenticatedUser } from '../../src/common/auth/authenticated-user';
import {
  createAccountNestModule,
  startAccountNestHost,
  type AccountModuleOwner,
} from './operator-pdf-test-account-host';
import {
  buildAccountFixture,
  type AccountFixtureInput,
} from './operator-pdf-test-account-fixture-builder';
import {
  applyAccountFixture,
  recoverAccountFixture,
  accountDelegate,
  withAccountMixedIdentity,
  expectAccountAuthRefusal,
} from './operator-pdf-test-account-fixture-applicator';
import {
  createAccountMemoryPrisma,
  type AccountMemoryFaults,
} from './operator-pdf-test-account-memory-prisma';
import { captureAccountPage } from './operator-pdf-test-account-pages';
import {
  runAccountCase,
  type AccountCaseContext,
  type AccountScenarioSession,
  type ACCOUNT_CASES,
} from './operator-pdf-test-account-live-cases';
import {
  issueAccountSessions,
  reconcileAccountFacts,
  type AccountSessionRegistry,
} from './operator-pdf-test-account-support';
import {
  accountClone,
  accountFixtureId,
  accountJson,
} from './operator-pdf-test-account-adapter-schema';
import {
  buildAccountGraph,
  accountHistoryAdmission,
  type AccountGraphName,
} from './operator-pdf-test-account-fixture-graphs';
import type { Prisma } from '@prisma/client';

type Observation = Awaited<ReturnType<AccountCaseContext['read']>>;
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((done) => {
    release = done;
  });
  return { promise, release };
}
function errors(error: unknown): unknown[] {
  return error instanceof AggregateError
    ? (error.errors as unknown[]).flatMap(errors)
    : [error];
}
export function startAccountRuntimeAdapter(options: {
  mode?: 'offline';
  input: AccountFixtureInput;
  dmmf: Prisma.DMMF.Datamodel;
  graph?: AccountGraphName;
  faults?: AccountMemoryFaults;
  checkpoint?: () => void;
  cleanupCheckpoint?: () => void;
  moduleFactory?: typeof createAccountNestModule;
}) {
  if (options.mode && options.mode !== 'offline')
    throw new Error('E01 runtime adapter is offline only');
  let cancelled: Error | undefined,
    accepting = true,
    closed = false;
  let closing: Promise<void> | undefined,
    module: AccountModuleOwner | undefined;
  const failures: unknown[] = [],
    work = new Set<Promise<unknown>>();
  const registry: AccountSessionRegistry = {
    attemptedActors: new Set(),
    issued: [],
  };
  const authRefusals: Array<
    Awaited<ReturnType<typeof expectAccountAuthRefusal>>
  > = [];
  const cleanup = {
    ownership: 'UNRESOLVED',
    probes: [] as Array<{
      userId: string;
      kind: string;
      status: number;
      meaning: string;
    }>,
    states: [] as Array<{ id: string; status: string }>,
    factsVerified: false,
    failures: [] as string[],
  };
  let fixtureOwned: Array<{ table: string; id: string }> = [];
  const checkpoint = () => {
    if (cancelled) throw cancelled;
    options.checkpoint?.();
  };
  const cleanupCheckpoint = () => {
    options.cleanupCheckpoint?.();
  };
  const base = buildAccountFixture(options.input, options.dmmf);
  const plan = buildAccountGraph(
    base,
    options.graph ?? 'baseline',
    options.dmmf,
  );
  const memoryFaults = options.faults ?? {};
  const memory = createAccountMemoryPrisma(
    options.dmmf,
    options.input.syntheticNow,
    memoryFaults,
  );
  const baseline = memory.snapshot();
  const sessions = new Set<AccountScenarioSession>();
  const children = new Set<ReturnType<typeof startAccountRuntimeAdapter>>();
  const denialChildren = new Map<
    string,
    ReturnType<typeof startAccountRuntimeAdapter>
  >();
  const pageOwners = new WeakMap<
    AccountScenarioSession,
    ReturnType<typeof startAccountRuntimeAdapter>
  >();
  const releases = new Set<() => void>();
  const calls: Array<{
    path: string;
    query: Record<string, string>;
    status: number;
    responseBody: unknown;
  }> = [];
  const host = startAccountNestHost({
    mode: 'offline',
    settings: {
      AUTH_DRIVER: 'mock',
      JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
      JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    },
    providers: {
      createClient: () => memory.client,
      createModule: options.moduleFactory ?? createAccountNestModule,
    },
    checkpoint,
  });
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const track = <T>(operation: Promise<T>) => {
    work.add(operation);
    void operation.finally(() => work.delete(operation)).catch(() => undefined);
    return operation;
  };
  const ready = (async () => {
    module = (await host.ready).module;
    checkpoint();
    fixtureOwned = (
      await applyAccountFixture(memory.client, plan, options.dmmf, checkpoint)
    ).owned;
    checkpoint();
    const auth = module.get(AuthService);
    await issueAccountSessions(
      plan.accounts.map((account) => account.userId),
      (id) => auth.issueSessionForUser(id),
      registry,
      checkpoint,
    );
    const refusal = await withAccountMixedIdentity(
      memory.client,
      plan,
      () =>
        expectAccountAuthRefusal(
          plan.actors.mixed.userId,
          (id) => auth.issueSessionForUser(id),
          registry,
          checkpoint,
        ),
      checkpoint,
      cleanupCheckpoint,
    );
    authRefusals.push(refusal);
    checkpoint();
  })().catch((error: unknown) => {
    failures.push(...errors(error));
    throw error;
  });
  void ready.catch(() => undefined);
  const tokenFor = (actor: string) => {
    const id = plan.actors[actor]?.userId ?? actor;
    const credential = registry.issued.find(
      (item) => item.userId === id && item.kind === 'access',
    );
    if (!credential)
      throw new Error('No observed credential for requested fixture actor');
    return credential.token;
  };
  async function dispatch(
    token: string,
    path: string,
    query: Record<string, string> = {},
  ): Promise<Observation> {
    if (!module) throw new Error('Account module unavailable');
    const request: {
      headers: { authorization: string };
      user?: AuthenticatedUser;
    } = { headers: { authorization: `Bearer ${token}` } };
    const controller = module.get(OperatorAccountController);
    const handler: unknown = Reflect.get(
      controller,
      path.endsWith('/subjects') ? 'subjects' : 'lessonAccount',
    );
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => OperatorAccountController,
    } as unknown as ExecutionContext;
    let status = 200,
      body: unknown;
    try {
      await module.get(AccessTokenGuard).canActivate(context);
      let value: unknown;
      if (path === '/me')
        value = await module.get(AuthService).getMe(request.user!.userId);
      else {
        module.get(PermissionsGuard).canActivate(context);
        if (path === '/operators/me/subjects') {
          const dto = (await pipe.transform(query, {
            type: 'query',
            metatype: OperatorAccountSubjectsQueryDto,
          })) as OperatorAccountSubjectsQueryDto;
          value = await controller.subjects(request.user!, dto);
        } else if (path === '/operators/me/lesson-account') {
          const dto = (await pipe.transform(query, {
            type: 'query',
            metatype: OperatorAccountQueryDto,
          })) as OperatorAccountQueryDto;
          value = await controller.lessonAccount(request.user!, dto);
        } else throw new Error('Account adapter read route not permitted');
      }
      body = createResponseEnvelope(value, 'e01-memory-provider');
    } catch (error) {
      status =
        error instanceof DomainError
          ? error.statusCode
          : error instanceof HttpException
            ? error.getStatus()
            : 500;
      body = {
        code:
          error instanceof DomainError
            ? error.code
            : status === 400
              ? 'VALIDATION_FAILED'
              : 'INTERNAL_SERVER_ERROR',
        message:
          status >= 500
            ? 'Internal server error'
            : 'Memory provider rejected read',
        requestId: 'e01-memory-provider',
        details: {},
      };
    }
    const result: Observation = { status, body, provenance: 'memory-provider' };
    calls.push({ path, query: { ...query }, status, responseBody: body });
    return result;
  }
  type Fault = {
    path: string;
    kind: '503' | 'denial';
    status: number;
    delivered: (result: Observation) => void;
    held: ReturnType<typeof latch>;
    used: boolean;
    lateUsed: boolean;
    delivery?: ReturnType<typeof latch>;
  };
  const wires = new WeakMap<AccountScenarioSession, { fault?: Fault }>();
  function open(actor: string): AccountScenarioSession {
    checkpoint();
    if (!accepting) throw new Error('Runtime Page admission closed');
    const token = tokenFor(actor),
      pending = new Set<Promise<void>>();
    let active = true;
    const wireState: { fault?: Fault } = {};
    const sessionCalls: AccountScenarioSession['calls'] = [];
    const captured = captureAccountPage('http://127.0.0.1:1', token, {
      request(requestOptions) {
        const url = new URL(requestOptions.url);
        if (
          url.origin !== 'http://127.0.0.1:1' ||
          requestOptions.method !== 'GET' ||
          requestOptions.data !== undefined
        )
          throw new Error('Memory Page request outside allowed origin');
        const path = url.pathname,
          query = Object.fromEntries(url.searchParams);
        const task = (async () => {
          let response: Observation;
          const fault = wireState.fault;
          if (
            fault?.kind === 'denial' &&
            path !== '/me' &&
            path !== fault.path &&
            !fault.lateUsed
          ) {
            fault.lateUsed = true;
            response = await dispatch(token, path, query);
            fault.held.release();
            await fault.delivery!.promise;
          } else if (fault && fault.path === path && !fault.used) {
            fault.used = true;
            if (fault.kind === 'denial') await fault.held.promise;
            response = {
              status: fault.status,
              body: {
                code:
                  fault.status === 401
                    ? 'UNAUTHORIZED'
                    : fault.status === 403
                      ? 'FORBIDDEN'
                      : 'INTERNAL_SERVER_ERROR',
                message: 'Explicit offline fault',
                requestId: 'e01-memory-fault',
                details: {},
              },
              provenance: 'memory-provider',
            };
            fault.delivered(response);
          } else response = await dispatch(token, path, query);
          sessionCalls.push({
            path,
            query,
            status: response.status,
            responseBody: response.body,
          });
          if (active)
            requestOptions.success({
              statusCode: response.status,
              data: response.body,
            });
        })().catch(() => {
          if (active)
            requestOptions.fail(new Error('Memory Page delivery failed'));
        });
        pending.add(task);
        void task.finally(() => pending.delete(task));
      },
    });
    const page =
      captured.instantiate() as unknown as AccountScenarioSession['page'];
    const idle = async () => {
      let quiet = 0;
      for (let index = 0; index < 60; index++) {
        await Promise.allSettled([...pending]);
        await new Promise<void>((done) => setImmediate(done));
        quiet = pending.size ? 0 : quiet + 1;
        if (quiet === 2) return;
      }
      throw new Error('Memory Page did not drain');
    };
    const session: AccountScenarioSession = {
      page,
      calls: sessionCalls,
      settle: idle,
      async close() {
        active = false;
        const fault = wireState.fault;
        fault?.held.release();
        fault?.delivery?.release();
        try {
          captured.close();
        } finally {
          await idle();
          sessions.delete(session);
        }
      },
    };
    wires.set(session, wireState);
    sessions.add(session);
    return session;
  }
  async function ownership() {
    cleanupCheckpoint();
    const result = await recoverAccountFixture(memory.client, plan);
    cleanupCheckpoint();
    if (result.state === 'OWNED') fixtureOwned = result.owned;
    return result;
  }
  const allowed = () => {
    const result: Record<string, string[]> = {};
    for (const row of fixtureOwned) (result[row.table] ??= []).push(row.id);
    return result;
  };
  const oracleAccount = () => ({
    ...accountClone(plan.expected.balances),
    enrollmentSummary: accountClone(plan.expected.enrollmentSummary),
    lessonActivityTotals: accountClone(plan.expected.lessonActivityTotals),
    items: [],
    meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    serverTime: options.input.syntheticNow.toISOString(),
    timezone: 'Asia/Shanghai',
  });
  const ctx: AccountCaseContext = {
    provenance: 'memory-provider',
    root: resolve(__dirname, '../../..'),
    checkpoint,
    cleanupCheckpoint,
    open(actor) {
      const child = denialChildren.get(actor);
      if (!child) return open(actor);
      const session = child.context().open(actor);
      pageOwners.set(session, child);
      return session;
    },
    read: (actor, path, query) => track(dispatch(tokenFor(actor), path, query)),
    arm503(session, path) {
      const state = wires.get(session);
      if (!state || state.fault)
        throw new Error('Unknown or already faulted Page');
      state.fault = {
        path,
        kind: '503',
        status: 503,
        delivered: () => undefined,
        held: latch(),
        used: false,
        lateUsed: false,
      };
      return {
        ready: Promise.resolve(),
        closeAndDrain: async () => {
          state.fault = undefined;
          await session.settle();
        },
      };
    },
    denyWithLateSuccess(session, path, status) {
      const child = pageOwners.get(session);
      if (child)
        return child.context().denyWithLateSuccess(session, path, status);
      const state = wires.get(session);
      if (!state || state.fault)
        throw new Error('Unknown or already faulted Page');
      let delivered!: (response: Observation) => void;
      const denialReady = new Promise<Observation>((done) => {
        delivered = done;
      });
      const delivery = latch(),
        held = latch();
      state.fault = {
        path,
        kind: 'denial',
        status,
        delivered,
        delivery,
        held,
        used: false,
        lateUsed: false,
      };
      releases.add(delivery.release);
      releases.add(held.release);
      return {
        denialReady,
        release: delivery.release,
        async closeAndDrain() {
          delivery.release();
          held.release();
          await session.settle();
          state.fault = undefined;
          releases.delete(delivery.release);
          releases.delete(held.release);
        },
      };
    },
    async historyFixture(name) {
      accountHistoryAdmission(name);
      const child = startAccountRuntimeAdapter({
        ...options,
        faults: undefined,
        graph: name,
        input: {
          ...options.input,
          scenario: undefined,
          executionId: accountFixtureId(options.input.executionId, name),
        },
      });
      children.add(child);
      await child.ready;
      return {
        actor: `history:${name}`,
        status: 200,
        expected: child.context().oracle.account,
      };
    },
    holdBeforeReturn(actor) {
      const entered = latch(),
        held = latch();
      let first = true;
      const previous = options.faults?.afterCommit;
      // The provider calls this only after the first transaction has committed.
      const install = memoryFaults;
      install.afterCommit = async (level) => {
        await previous?.(level);
        if (first && level === 'RepeatableRead') {
          first = false;
          entered.release();
          await held.promise;
        }
      };
      releases.add(held.release);
      const response = track(
        dispatch(tokenFor(actor), '/operators/me/lesson-account', {
          page: '1',
          pageSize: '20',
        }),
      );
      return {
        entered: entered.promise,
        response,
        release: held.release,
        async closeAndDrain() {
          held.release();
          await Promise.allSettled([response]);
          install.afterCommit = previous;
          releases.delete(held.release);
        },
      };
    },
    async mutateOwned(kind) {
      checkpoint();
      cleanupCheckpoint();
      if ((await ownership()).state !== 'OWNED')
        throw new Error('Unresolved fixture ownership');
      await memory.client.$transaction(
        async (tx) => {
          cleanupCheckpoint();
          const table = kind === 'revoke-before-return' ? 'User' : 'Student';
          const id =
            kind === 'revoke-before-return'
              ? plan.actors['return-revocation'].userId
              : plan.ids.studentA;
          const data =
            kind === 'revoke-before-return'
              ? { status: 'DISABLED' }
              : { campusId: plan.ids.campusB };
          const result = await accountDelegate(tx, table).updateMany({
            where: { id },
            data,
          });
          if (result.count !== 1) throw new Error('Race target changed');
          if (kind === 'move-student-before-return') {
            const facts = await accountDelegate(
              tx,
              'PartnerRankingStudentFact',
            ).findMany({
              where: { studentId: id },
              orderBy: { id: 'desc' },
            });
            const initial = fixtureOwned
              .filter((row) => row.table === 'PartnerRankingStudentFact')
              .map((row) => row.id);
            const added = facts.filter(
              (fact) => !initial.includes(String(fact.id)),
            );
            if (
              added.length !== 1 ||
              added[0].studentId !== id ||
              added[0].campusId !== plan.ids.campusB ||
              added[0].isActive !== true ||
              typeof added[0].id !== 'bigint' ||
              !(added[0].recordedAt instanceof Date)
            )
              throw new Error('Unowned movement trigger fact');
            await accountDelegate(tx, 'AuditLog').create({
              data: {
                id: accountFixtureId(
                  plan.windowId,
                  plan.executionId,
                  'student-move',
                ),
                campusId: null,
                actorUserId: plan.actors['student-move'].userId,
                action: 'E01_FIXTURE_STUDENT_MOVE',
                resourceType: 'E01_FIXTURE',
                resourceId: plan.executionId,
                outcome: 'SUCCESS',
                details: JSON.parse(
                  accountJson({
                    windowId: plan.windowId,
                    executionId: plan.executionId,
                    studentId: id,
                    campusId: plan.ids.campusB,
                    triggerFact: added[0],
                  }),
                ) as Prisma.InputJsonObject,
                createdAt: plan.syntheticNow,
              },
            });
          }
          cleanupCheckpoint();
        },
        { isolationLevel: 'Serializable', timeout: 15000 },
      );
      await ownership();
    },
    resolveOwnership: async () =>
      (await ownership()).state === 'OWNED' ? 'OWNED' : 'UNRESOLVED',
    async disableOwnedAccounts(ids) {
      cleanupCheckpoint();
      if (
        accountJson([...ids].sort()) !==
          accountJson(plan.accounts.map((account) => account.userId).sort()) ||
        (await ownership()).state !== 'OWNED'
      )
        throw new Error('Unowned disable target');
      await memory.client.$transaction(
        async (tx) => {
          cleanupCheckpoint();
          const result = await accountDelegate(tx, 'User').updateMany({
            where: { id: { in: ids } },
            data: { status: 'DISABLED' },
          });
          if (result.count !== ids.length)
            throw new Error('Incomplete account disable');
          cleanupCheckpoint();
        },
        { isolationLevel: 'Serializable', timeout: 15000 },
      );
    },
    async accountStates() {
      cleanupCheckpoint();
      return (await accountDelegate(memory.client, 'User').findMany({
        where: { id: { in: plan.accounts.map((account) => account.userId) } },
        select: { id: true, status: true },
        orderBy: { id: 'asc' },
      })) as Array<{ id: string; status: string }>;
    },
    probeCredential: (credential) => track(dispatch(credential.token, '/me')),
    snapshot: () => Promise.resolve(memory.snapshot()),
    flushCallbacks: async () => {
      await new Promise<void>((done) => setImmediate(done));
    },
    oracle: {
      account: oracleAccount() as AccountCaseContext['oracle']['account'],
      archivedSubjectId: plan.ids.archivedSubject,
      filteredSubjectId: plan.ids.filterSubject,
      subjectTotal: 101,
      otherCampusSubjectId: plan.ids.foreignSubject,
      filteredTotal: 24,
      filteredEntryType: 'CONSUME',
      filteredRowIds: plan.records
        .filter(
          (row) =>
            row.table === 'LessonLedgerEntry' &&
            row.data.entryType === 'CONSUME' &&
            row.data.subjectId === plan.ids.filterSubject,
        )
        .sort(
          (a, b) =>
            Number(b.data.createdAt as Date) -
              Number(a.data.createdAt as Date) ||
            String(b.data.id).localeCompare(String(a.data.id)),
        )
        .map((row) => String(row.data.id)),
      manifestActorIds: plan.accounts.map((account) => account.userId),
      credentials: registry.issued,
      baseline,
      allowed: {},
    },
  };
  const originalRead = ctx.read.bind(ctx);
  ctx.read = async (actor, path, query) => {
    checkpoint();
    if (!accepting) throw new Error('Runtime read admission closed');
    if (actor.startsWith('history:')) {
      const name = actor.slice(8);
      const child = [...children].find((child) => child.state().graph === name);
      if (!child) throw new Error('History runtime missing');
      return await child.context().read('owner', path, query);
    }
    if (actor === 'mixed')
      return track(
        withAccountMixedIdentity(
          memory.client,
          plan,
          () => originalRead(actor, path, query),
          checkpoint,
          cleanupCheckpoint,
        ),
      );
    return await originalRead(actor, path, query);
  };
  async function closeAndDrain() {
    if (closing) return closing;
    accepting = false;
    closing = (async () => {
      for (const release of releases) release();
      await Promise.allSettled([ready, ...work]);
      for (const session of [...sessions]) {
        try {
          await session.close();
        } catch (error) {
          failures.push(...errors(error));
        }
      }
      for (const child of children) {
        try {
          await child.closeAndDrain();
        } catch (error) {
          failures.push(...errors(error));
        }
      }
      const attempt = async (operation: () => Promise<void> | void) => {
        try {
          await operation();
        } catch (error) {
          failures.push(...errors(error));
          cleanup.failures.push(
            error instanceof Error ? error.message : 'Unknown cleanup failure',
          );
        }
      };
      let ownershipState: Awaited<ReturnType<typeof ownership>> | undefined;
      await attempt(async () => {
        ownershipState = await ownership();
        cleanup.ownership = ownershipState.state;
      });
      if (ownershipState?.state === 'OWNED') {
        await attempt(async () => {
          await ctx.disableOwnedAccounts(
            plan.accounts.map((account) => account.userId),
          );
        });
      } else if (ownershipState?.state !== 'ABSENT')
        failures.push(
          new Error('Account ownership unresolved; mutation forbidden'),
        );
      for (const credential of registry.issued)
        await attempt(async () => {
          cleanupCheckpoint();
          const response = await ctx.probeCredential(credential);
          cleanupCheckpoint();
          cleanup.probes.push({
            userId: credential.userId,
            kind: credential.kind,
            status: response.status,
            meaning:
              credential.kind === 'access'
                ? 'access-entry-rejected'
                : 'refresh-not-accepted-as-access',
          });
          if (response.status !== 401)
            throw new Error(`Credential still accepted: ${credential.kind}`);
        });
      await attempt(async () => {
        cleanup.states = await ctx.accountStates();
        cleanupCheckpoint();
        if (
          ownershipState?.state !== 'ABSENT' &&
          (cleanup.states.length !== plan.accounts.length ||
            cleanup.states.some((row) => row.status !== 'DISABLED'))
        )
          throw new Error('Accounts not all disabled');
      });
      await attempt(() => {
        cleanupCheckpoint();
        ctx.oracle.allowed = allowed();
        reconcileAccountFacts(baseline, memory.snapshot(), ctx.oracle.allowed);
        if (
          ownershipState?.state !== 'OWNED' &&
          ownershipState?.state !== 'ABSENT'
        )
          throw new Error('Account fact ownership unresolved');
        cleanup.factsVerified = true;
      });
      try {
        await host.closeAndDrain();
      } catch (error) {
        failures.push(...errors(error));
      }
      closed =
        host.state().closed &&
        sessions.size === 0 &&
        [...children].every((child) => child.state().closed);
      if (failures.length)
        throw new AggregateError(
          [...new Set(failures)],
          'E01 runtime work/cleanup failed',
        );
    })();
    return closing;
  }
  return {
    ready,
    context: () => {
      ctx.oracle.allowed = allowed();
      return ctx;
    },
    run(name: keyof typeof ACCOUNT_CASES) {
      if (!accepting)
        return Promise.reject(
          cancelled ?? new Error('Runtime work admission closed'),
        );
      return track(
        (async () => {
          try {
            checkpoint();
            await ready;
            if (name === 'errors-retry' && !denialChildren.size) {
              for (const actor of [
                'denial-account-401',
                'denial-account-403',
                'denial-subjects-401',
                'denial-subjects-403',
              ]) {
                const child = startAccountRuntimeAdapter({
                  ...options,
                  faults: undefined,
                  graph: 'baseline',
                  input: {
                    ...options.input,
                    executionId: accountFixtureId(
                      options.input.executionId,
                      actor,
                    ),
                  },
                });
                children.add(child);
                denialChildren.set(actor, child);
                await child.ready;
                checkpoint();
              }
            }
            ctx.oracle.allowed = allowed();
            return await host.run(() => runAccountCase(name, ctx));
          } catch (error) {
            failures.push(...errors(error));
            throw error;
          }
        })(),
      );
    },
    cancel(reason = new Error('E01 runtime cancelled')) {
      cancelled ??= reason;
      accepting = false;
      for (const release of releases) release();
    },
    closeAndDrain,
    state: () => ({
      closed,
      accepting,
      graph: options.graph ?? 'baseline',
      cleanup,
      host: host.state(),
      issued: registry.issued.map(({ userId, kind }) => ({ userId, kind })),
      attemptedActors: [...registry.attemptedActors],
      authRefusals: [...authRefusals],
    }),
    calls: () => accountClone(calls),
    memory,
  };
}
