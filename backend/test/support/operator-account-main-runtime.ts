import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { compileMainReadHost } from './operator-account-main-host';
import { createMainAccountResource } from './operator-account-main-docker';
import {
  assertMainReady,
  assertMainClock,
  assertMainPredecessorSnapshot,
  requireMain,
  type MainAllocation,
} from './operator-account-main-admission';
import { bindMainAccountAdmission } from './operator-account-main-capability';
import {
  MAIN_GRAPHS,
  buildMainFixture,
  type MainFixture,
} from './operator-account-main-fixture';
import {
  readAccountAdapterDmmf,
  accountFixtureId,
  accountJson,
} from './operator-pdf-test-account-adapter-schema';
import {
  applyAccountFixture,
  recoverAccountFixture,
  withAccountMixedIdentity,
  expectAccountAuthRefusal,
} from './operator-pdf-test-account-fixture-applicator';
import {
  accountSnapshot,
  reconcileAccountFacts,
  issueAccountSessions,
  type AccountCredential,
  type AccountSessionRegistry,
  type AccountSnapshot,
} from './operator-pdf-test-account-support';
import { readMainHttp } from './operator-account-main-pages';
import type { MainObservation } from './operator-account-main-observation';

export function buildMainPlans(
  a: Pick<MainAllocation, 'windowId' | 'execution' | 'syntheticNow'>,
  dmmf = readAccountAdapterDmmf(),
) {
  return MAIN_GRAPHS.map((graph) =>
    buildMainFixture(
      {
        windowId: a.windowId,
        executionId: accountFixtureId(a.windowId, a.execution, graph),
        syntheticNow: new Date(a.syntheticNow),
      },
      dmmf,
      graph,
    ),
  );
}
export async function finalizeMainFacts(options: {
  ownership(): Promise<{ state: string }>;
  disable(ids: string[]): Promise<void>;
  probe(credential: AccountCredential): Promise<number>;
  states(): Promise<Array<{ id: string; status: string }>>;
  facts(): Promise<void>;
  actors: string[];
  credentials: AccountCredential[];
}) {
  const failures: unknown[] = [];
  const report = {
    ownership: 'UNRESOLVED',
    factsVerified: false,
    probes: [] as Array<{
      userId: string;
      kind: string;
      status: number;
      meaning: string;
    }>,
    states: [] as Array<{ id: string; status: string }>,
  };
  const attempt = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      failures.push(error);
    }
  };
  await attempt(async () => {
    report.ownership = (await options.ownership()).state;
  });
  if (report.ownership === 'OWNED')
    await attempt(() => options.disable(options.actors));
  else if (report.ownership !== 'ABSENT')
    failures.push(
      new Error('Current fixture ownership unresolved; no mutation'),
    );
  for (const credential of options.credentials)
    await attempt(async () => {
      const status = await options.probe(credential);
      report.probes.push({
        userId: credential.userId,
        kind: credential.kind,
        status,
        meaning:
          credential.kind === 'access'
            ? 'access-entry-rejected'
            : 'refresh-not-accepted-as-access',
      });
      if (status !== 401) throw new Error('Issued credential still accepted');
    });
  await attempt(async () => {
    report.states = await options.states();
    if (
      report.ownership === 'OWNED' &&
      (accountJson(report.states.map((row) => row.id).sort()) !==
        accountJson([...options.actors].sort()) ||
        report.states.some((row) => row.status !== 'DISABLED'))
    )
      throw new Error('Manifest accounts not all disabled');
    if (report.ownership === 'ABSENT' && report.states.length)
      throw new Error('Absent ownership has accounts');
  });
  await attempt(async () => {
    await options.facts();
    if (report.ownership !== 'OWNED' && report.ownership !== 'ABSENT')
      throw new Error('Account fact ownership unresolved');
    report.factsVerified = true;
  });
  if (failures.length)
    throw new AggregateError(failures, 'Account main cleanup incomplete', {
      cause: report,
    });
  return report;
}
export function createSnapshotPause() {
  let held:
    { userId: string; entered(): void; wait: Promise<void> } | undefined;
  let releasing: (() => void) | undefined;
  return {
    hold(userId: string) {
      if (held) throw new Error('Snapshot pause already active');
      let entered!: () => void, release!: () => void;
      const ready = new Promise<void>((done) => {
        entered = done;
      });
      const wait = new Promise<void>((done) => {
        release = done;
      });
      held = { userId, entered, wait };
      releasing = release;
      return { entered: ready, release };
    },
    release() {
      releasing?.();
      held = undefined;
      releasing = undefined;
    },
    wrap(client: PrismaClient): PrismaClient {
      return new Proxy(client, {
        get(target, key) {
          if (key !== '$transaction') {
            const value = Reflect.get(target, key, target) as unknown;
            return typeof value === 'function'
              ? (value.bind(target) as unknown)
              : value;
          }
          return async <T>(
            operation: (tx: Prisma.TransactionClient) => Promise<T>,
            options?: { isolationLevel?: string; timeout?: number },
          ) => {
            let observed = false;
            const pause = held;
            const result = await target.$transaction(
              async (tx) => {
                if (!pause || options?.isolationLevel !== 'RepeatableRead')
                  return operation(tx);
                const proxied = new Proxy(tx, {
                  get(transaction, property) {
                    if (property === 'user')
                      return new Proxy(transaction.user, {
                        get(delegate, method) {
                          if (method === 'findUnique')
                            return async (args: Prisma.UserFindUniqueArgs) => {
                              if (args.where.id === pause.userId)
                                observed = true;
                              return delegate.findUnique(args);
                            };
                          const value = Reflect.get(
                            delegate,
                            method,
                          ) as unknown;
                          return typeof value === 'function'
                            ? (value.bind(delegate) as unknown)
                            : value;
                        },
                      });
                    const value = Reflect.get(transaction, property) as unknown;
                    return typeof value === 'function'
                      ? (value.bind(transaction) as unknown)
                      : value;
                  },
                });
                return operation(proxied);
              },
              options as {
                isolationLevel: Prisma.TransactionIsolationLevel;
                timeout: number;
              },
            );
            if (pause && observed) {
              held = undefined;
              pause.entered();
              await pause.wait;
            }
            return result;
          };
        },
      });
    },
  };
}

export async function runMainAccountWindow(
  allocation: MainAllocation,
  root: string,
  exercise: (context: MainRuntimeContext) => Promise<void>,
  record: (name: string, value: unknown) => void,
  observation?: MainObservation,
) {
  const dmmf = readAccountAdapterDmmf(),
    plans = buildMainPlans(allocation, dmmf);
  const ready = () => assertMainReady(allocation, root, plans);
  ready();
  const resource = createMainAccountResource(allocation, root, ready);
  const checkpoint = () => {
    assertMainClock(allocation);
    resource.assertHeld();
  };
  const fixtureCheckpoint = () => {
    assertMainClock(allocation);
    resource.assertLockHeld();
  };
  const cleanupCheckpoint = () => resource.assertHeld();
  let client: PrismaClient | undefined, writer: PrismaClient | undefined;
  let host: Awaited<ReturnType<typeof compileMainReadHost>> | undefined,
    app: INestApplication | undefined;
  let baseline: AccountSnapshot | undefined,
    origin = '',
    unbind: (() => void) | undefined;
  const pause = createSnapshotPause();
  const registry: AccountSessionRegistry = {
    attemptedActors: new Set(),
    issued: [],
  };
  const sessions = new Map<string, string>();
  const faults = new Set<string>();
  const failures: unknown[] = [];
  let drained = false,
    factsVerified = false,
    allClosed = false;
  let observedOrdinal = 0;
  const pages = new Set<{ close(): Promise<void> }>();
  const allActorIds = plans.flatMap((plan) =>
    plan.accounts.map((account) => account.userId),
  );
  const attempt = async (operation: () => Promise<void> | void) => {
    try {
      await operation();
    } catch (error) {
      failures.push(error);
    }
  };
  try {
    const target = await resource.start();
    record('resource-start', resource.state());
    unbind = bindMainAccountAdmission(root, cleanupCheckpoint);
    const create = (label: string) =>
      new PrismaClient({
        adapter: new PrismaPg({
          connectionString: target.href,
          max: 1,
          connectionTimeoutMillis: 3000,
          statement_timeout: 10000,
          options: '-c session_replication_role=origin -c search_path=public',
          application_name: `operator-account-main:${allocation.execution}:${label}`,
        }),
      });
    client = create('reads');
    writer = create('fixture');
    await client.$connect();
    await writer.$connect();
    checkpoint();
    const identity = await client.$queryRaw<
      Array<{
        database: string;
        actor: string;
        replicationRole: string;
        searchPath: string;
        visible: boolean;
      }>
    >`
      SELECT current_database() AS database, current_user AS actor,
      current_setting('session_replication_role') AS "replicationRole",
      current_setting('search_path') AS "searchPath",
      (SELECT rolsuper OR pg_has_role(current_user,'pg_read_all_stats','member') FROM pg_roles WHERE rolname=current_user) AS visible`;
    requireMain(
      identity[0]?.database === allocation.resource.database &&
        identity[0]?.actor === allocation.resource.role &&
        identity[0]?.replicationRole === 'origin' &&
        identity[0]?.searchPath === 'public' &&
        identity[0]?.visible,
      'actual SQL identity/settings/statistics visibility',
    );
    const mine = await client.$queryRaw<
      Array<{ pid: number }>
    >`SELECT pg_backend_pid() AS pid`;
    const theirs = await writer.$queryRaw<
      Array<{ pid: number }>
    >`SELECT pg_backend_pid() AS pid`;
    const outsiders = await client.$queryRaw<Array<{ pid: number }>>`
      SELECT pid FROM pg_stat_activity WHERE backend_type='client backend'
      AND pid NOT IN (${mine[0].pid},${theirs[0].pid})`;
    requireMain(outsiders.length === 0, 'unknown clients before fixture');
    const migrations = await client.$queryRaw<
      Array<{
        name: string;
        checksum: string;
        finished: Date | null;
        rolledBack: Date | null;
      }>
    >`
      SELECT migration_name AS name, checksum, finished_at AS finished, rolled_back_at AS "rolledBack"
      FROM "_prisma_migrations" ORDER BY migration_name`;
    requireMain(
      migrations.every(
        (row) => row.finished !== null && row.rolledBack === null,
      ) &&
        accountJson(
          migrations.map(({ name, checksum }) => ({ name, checksum })),
        ) === accountJson(allocation.migrations),
      'actual migration history mismatch; no repair permitted',
    );
    baseline = await accountSnapshot(client, checkpoint);
    record('before-snapshot', baseline);
    assertMainPredecessorSnapshot(allocation, baseline);
    for (const plan of plans) {
      checkpoint();
      await applyAccountFixture(writer, plan, dmmf, fixtureCheckpoint);
      checkpoint();
    }
    host = await compileMainReadHost(
      pause.wrap(client),
      {
        AUTH_DRIVER: 'mock',
        JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
        JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
      },
      registry,
      observation,
    );
    app = host.createApp();
    if (observation) app.use(observation.middleware);
    app.use((request: Request, response: Response, next: NextFunction) => {
      const page =
        typeof request.query.page === 'string' ? request.query.page : '';
      const key = `${request.path}?page=${page}`;
      if (!faults.delete(key)) return next();
      response.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Synthetic one-shot retry boundary',
      });
    });
    await app.init();
    checkpoint();
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
    requireMain(
      /^http:\/\/127\.0\.0\.1:\d+$/.test(origin),
      'exact loopback HTTP origin',
    );
    for (const plan of plans) {
      await issueAccountSessions(
        plan.accounts.map((actor) => actor.userId),
        async (id) => {
          const session = await host!.auth.issueSessionForUser(id);
          sessions.set(id, session.accessToken);
          return session;
        },
        registry,
        checkpoint,
      );
      const refusal = await withAccountMixedIdentity(
        writer,
        plan,
        () =>
          expectAccountAuthRefusal(
            plan.actors.mixed.userId,
            (id) => host!.auth.issueSessionForUser(id),
            registry,
            checkpoint,
          ),
        checkpoint,
        cleanupCheckpoint,
      );
      record(`mixed-auth-refusal-${plan.mainGraph}`, refusal);
    }
    const context: MainRuntimeContext = {
      root,
      plans,
      client,
      writer,
      origin,
      checkpoint,
      cleanupCheckpoint,
      pause,
      pages,
      token(plan, actor) {
        const userId =
          plan.actors[actor]?.userId ??
          plan.accounts.find((account) => account.label === actor)?.userId;
        const token = userId && sessions.get(userId);
        requireMain(token, 'unowned or unissued actor');
        return token;
      },
      withMixedIdentity(plan, operation) {
        return withAccountMixedIdentity(
          writer!,
          plan,
          operation,
          checkpoint,
          cleanupCheckpoint,
        );
      },
      fault(path, page) {
        faults.add(`${path}?page=${page}`);
      },
      record,
    };
    ready();
    await exercise(context);
    ready();
  } catch (error) {
    failures.push(error);
  } finally {
    const businessFailureCount = failures.length;
    pause.release();
    for (const page of pages) await attempt(() => page.close());
    drained = true;
    if (client && writer && baseline) {
      await attempt(async () => {
        let ownedActors: string[] = [];
        const ownership = async () => {
          const current = [];
          for (const plan of plans) {
            cleanupCheckpoint();
            current.push(await recoverAccountFixture(writer!, plan));
          }
          ownedActors = current.flatMap((entry, index) =>
            entry.state === 'OWNED'
              ? plans[index].accounts.map((account) => account.userId)
              : [],
          );
          return {
            state: current.some((row) => row.state === 'UNRESOLVED')
              ? 'UNRESOLVED'
              : current.every((row) => row.state === 'ABSENT')
                ? 'ABSENT'
                : 'OWNED',
            current,
          };
        };
        const allowed: Record<string, string[]> = {};
        const cleanup = await finalizeMainFacts({
          ownership,
          get actors() {
            return ownedActors;
          },
          credentials: registry.issued,
          async disable(ids) {
            cleanupCheckpoint();
            // Recheck exact ownership inside the same serializable write transaction.
            await writer!.$transaction(
              async (tx) => {
                let disabled = 0;
                for (const plan of plans) {
                  const recovered = await recoverAccountFixture(tx, plan);
                  requireMain(
                    recovered.state === 'OWNED' || recovered.state === 'ABSENT',
                    'ownership changed before account disable',
                  );
                  if (recovered.state === 'ABSENT') continue;
                  const planIds = plan.accounts.map((actor) => actor.userId);
                  requireMain(
                    planIds.every((id) => ids.includes(id)),
                    'disable target differs from recovered actors',
                  );
                  const original = plan.records.find(
                    (row) => row.table === 'User',
                  )!;
                  const result = await tx.user.updateMany({
                    where: { id: { in: planIds } },
                    data: {
                      status: 'DISABLED',
                      updatedAt: original.data.updatedAt as Date,
                    },
                  });
                  requireMain(
                    result.count === planIds.length,
                    'exact manifest disable count',
                  );
                  disabled += result.count;
                }
                requireMain(
                  disabled === ids.length,
                  'disable actor set changed',
                );
              },
              { isolationLevel: 'Serializable', timeout: 30000 },
            );
          },
          async probe(credential) {
            cleanupCheckpoint();
            requireMain(
              !!origin,
              'HTTP host unavailable for independent credential probes',
            );
            const observed = observation?.begin({
              ordinal: ++observedOrdinal,
              userId: credential.userId,
              kind: credential.kind,
            });
            const result = await readMainHttp(
              origin,
              credential.token,
              '/me',
              {},
              cleanupCheckpoint,
              observed,
            );
            record(`credential-${credential.userId}-${credential.kind}`, {
              status: result.status,
              provenance: result.provenance,
              kind: credential.kind,
              userId: credential.userId,
            });
            if (observed) observation?.receipt(observed.ordinal);
            return result.status;
          },
          async states() {
            cleanupCheckpoint();
            return writer!.user.findMany({
              where: { id: { in: allActorIds } },
              select: { id: true, status: true },
            });
          },
          async facts() {
            cleanupCheckpoint();
            const finalOwnership = await ownership();
            for (const entry of finalOwnership.current)
              if (entry.state === 'OWNED')
                for (const row of entry.owned)
                  (allowed[row.table] ??= []).push(row.id);
            const after = await accountSnapshot(client!, cleanupCheckpoint);
            record('after-snapshot', after);
            record('facts', reconcileAccountFacts(baseline!, after, allowed));
            requireMain(
              finalOwnership.state === 'OWNED' ||
                finalOwnership.state === 'ABSENT',
              'current fact ownership unresolved',
            );
          },
        });
        factsVerified = cleanup.factsVerified;
        record('cleanup', cleanup);
      });
    }
    await attempt(async () => {
      await app?.close();
    });
    await attempt(async () => {
      await host?.close();
    });
    await attempt(async () => {
      await writer?.$disconnect();
    });
    await attempt(async () => {
      await client?.$disconnect();
    });
    await attempt(() => {
      unbind?.();
    });
    allClosed = drained && failures.length === businessFailureCount;
    const closeout = await resource.finish(allClosed && factsVerified);
    record('resource-finish', closeout);
    observation?.summary();
    if (closeout.retained)
      failures.push(
        new Error(`Resource and common lock retained: ${closeout.reason}`),
      );
    if (failures.length) record('failures', failures);
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      'E01/E02 main HTTP/SQL acceptance incomplete',
    );
}
export interface MainRuntimeContext {
  root: string;
  plans: MainFixture[];
  client: PrismaClient;
  writer: PrismaClient;
  origin: string;
  checkpoint(this: void): void;
  cleanupCheckpoint(this: void): void;
  pause: ReturnType<typeof createSnapshotPause>;
  pages: Set<{ close(): Promise<void> }>;
  token(plan: MainFixture, actor: string): string;
  withMixedIdentity<T>(plan: MainFixture, operation: () => Promise<T>): Promise<T>;
  fault(path: string, page: number): void;
  record(name: string, value: unknown): void;
}
