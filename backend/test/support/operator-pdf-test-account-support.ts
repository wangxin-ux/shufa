import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { setTimeout, clearTimeout } from 'node:timers';

export function createAccountSetup(deadlineMs = 120_000) {
  let original: Promise<void> | undefined;
  let reason: Error | undefined;
  let deadline = Infinity;
  let settled = false;
  let timer: ReturnType<typeof setTimeout>;
  let rejectWait: ((error: Error) => void) | undefined;
  const failures: Error[] = [];
  const cancel = (error = new Error('E01 setup cancelled')) => {
    reason ??= error;
    clearTimeout(timer);
    rejectWait?.(reason);
  };
  const check = () => {
    if (!settled && performance.now() >= deadline)
      cancel(new Error('E01 setup deadline exceeded'));
    if (reason) throw reason;
  };
  return {
    cancel,
    check,
    start(operation: () => Promise<void>) {
      if (original || reason)
        throw new Error('E01 setup already started or cancelled');
      deadline = performance.now() + deadlineMs;
      const stopped = new Promise<never>((_resolve, reject) => {
        rejectWait = reject;
      });
      timer = setTimeout(
        () => cancel(new Error('E01 setup deadline exceeded')),
        deadlineMs,
      );
      original = Promise.resolve()
        .then(() => {
          check();
          return operation();
        })
        .catch((error: unknown) => {
          failures.push(
            error instanceof Error
              ? error
              : new Error('Unknown E01 setup failure'),
          );
          throw error;
        })
        .finally(() => {
          settled = true;
          clearTimeout(timer);
        });
      return Promise.race([original, stopped]);
    },
    async cancelAndDrain() {
      cancel();
      if (original) await Promise.allSettled([original]);
    },
    state: () => ({
      started: !!original,
      cancelled: !!reason,
      settled,
      failures: [...failures],
    }),
  };
}

export function createAccountResources() {
  const owned: Array<{
    label: string;
    close: () => Promise<void>;
    closed: boolean;
  }> = [];
  let closing: Promise<void> | undefined;
  const failures: unknown[] = [];
  return {
    register(label: string, close: () => Promise<void>) {
      if (closing || owned.some((r) => r.label === label))
        throw new Error('E01 resource registration closed or duplicated');
      owned.push({ label, close, closed: false });
    },
    labels: () => owned.map((r) => r.label),
    close() {
      closing ??= (async () => {
        for (const item of [...owned].reverse()) {
          try {
            await item.close();
            item.closed = true;
          } catch (error) {
            failures.push(error);
          }
        }
        if (failures.length)
          throw new AggregateError(failures, 'E01 resource cleanup failed');
      })();
      return closing;
    },
    state: () => ({
      closed: owned.every((r) => r.closed),
      outstanding: owned.filter((r) => !r.closed).map((r) => r.label),
      failures: [...failures],
    }),
  };
}

export async function runAccountScope<T>(
  operation: (
    resources: ReturnType<typeof createAccountResources>,
  ) => Promise<T>,
): Promise<T> {
  const resources = createAccountResources();
  let failed = false,
    primary: unknown,
    value: T | undefined;
  try {
    value = await operation(resources);
  } catch (error) {
    failed = true;
    primary = error;
  }
  try {
    await resources.close();
  } catch (cleanup) {
    if (!failed) throw cleanup;
    const errors: unknown[] =
      cleanup instanceof AggregateError
        ? (cleanup.errors as unknown[])
        : [cleanup];
    throw new AggregateError(
      [primary, ...errors],
      'E01 operation and cleanup failed',
    );
  }
  if (failed) throw primary;
  return value as T;
}
interface AccountApp {
  init(): Promise<unknown>;
  listen(port: number, hostname: string): Promise<unknown>;
  getUrl(): Promise<string>;
  close(): Promise<void>;
}
interface AccountPrisma {
  connect(): Promise<void>;
  close(): Promise<void>;
}
export interface AccountHostFactory {
  createPrisma(): AccountPrisma;
  compile(prisma: AccountPrisma): Promise<{
    createApp(): AccountApp;
    close(): Promise<void>;
  }>;
}

export async function initializeAccountHost(
  resources: ReturnType<typeof createAccountResources>,
  factory: AccountHostFactory,
  checkpoint: () => void,
) {
  try {
    checkpoint();
    const prisma = factory.createPrisma();
    resources.register('prisma', () => prisma.close());
    checkpoint();
    await prisma.connect();
    checkpoint();
    const moduleRef = await factory.compile(prisma);
    resources.register('module', () => moduleRef.close());
    checkpoint();
    const app = moduleRef.createApp();
    resources.register('app', () => app.close());
    checkpoint();
    await app.init();
    checkpoint();
    await app.listen(0, '127.0.0.1');
    checkpoint();
    const origin = await app.getUrl();
    checkpoint();
    return { prisma, app, origin };
  } catch (primary) {
    try {
      await resources.close();
    } catch (cleanup) {
      const cleanupErrors: unknown[] =
        cleanup instanceof AggregateError
          ? (cleanup.errors as unknown[])
          : [cleanup];
      throw new AggregateError(
        [primary, ...cleanupErrors],
        'E01 initialization and cleanup failed',
      );
    }
    throw primary;
  }
}

export async function createAccountManifest<T, A>(
  transaction: (operation: (tx: T) => Promise<void>) => Promise<void>,
  accounts: readonly A[],
  create: (tx: T, account: A) => Promise<void>,
  manifest: (tx: T, accounts: readonly A[]) => Promise<void>,
  checkpoint: () => void = () => undefined,
) {
  checkpoint();
  await transaction(async (tx) => {
    checkpoint();
    for (const account of accounts) {
      await create(tx, account);
      checkpoint();
    }
    await manifest(tx, accounts);
    checkpoint();
  });
  checkpoint();
}

export interface AccountCredential {
  userId: string;
  kind: 'access' | 'refresh';
  token: string;
}
export interface AccountSessionRegistry {
  attemptedActors: Set<string>;
  issued: AccountCredential[];
}
export async function issueAccountSessions(
  actors: readonly string[],
  issue: (
    id: string,
    record: (kind: AccountCredential['kind'], token: string) => void,
  ) => Promise<{ accessToken: string; refreshToken: string } | void>,
  registry: AccountSessionRegistry,
  checkpoint: () => void,
) {
  for (const userId of actors) {
    checkpoint();
    registry.attemptedActors.add(userId);
    const record = (kind: AccountCredential['kind'], token: string) => {
      if (!token) throw new Error('E01 empty credential');
      const existing = registry.issued.find(
        (c) => c.userId === userId && c.kind === kind && c.token === token,
      );
      if (!existing) registry.issued.push({ userId, kind, token });
    };
    const session = await issue(userId, record);
    if (session) {
      record('access', session.accessToken);
      record('refresh', session.refreshToken);
    }
    if (
      !['access', 'refresh'].every((kind) =>
        registry.issued.some((c) => c.userId === userId && c.kind === kind),
      )
    )
      throw new Error('E01 partial credential result');
    checkpoint();
  }
}

export async function closeAccountCredentials(
  registry: AccountSessionRegistry,
  manifestActorIds: readonly string[],
  disable: (ids: string[]) => Promise<void>,
  probe: (
    credential: AccountCredential,
  ) => Promise<{ status: number; via: string }>,
) {
  const failures: unknown[] = [];
  const report: Array<{
    userId: string;
    kind: string;
    status: number;
    via: string;
  }> = [];
  try {
    if (
      [
        ...registry.attemptedActors,
        ...registry.issued.map((c) => c.userId),
      ].some((id) => !manifestActorIds.includes(id))
    )
      throw new Error(
        'E01 attempted actor outside manifest; no account mutation',
      );
    await disable([...new Set(manifestActorIds)]);
  } catch (error) {
    failures.push(error);
  }
  for (const credential of registry.issued) {
    try {
      const response = await probe(credential);
      report.push({
        userId: credential.userId,
        kind: credential.kind,
        status: response.status,
        via: response.via,
      });
      if (response.status !== 401 || response.via !== 'http/tcp')
        throw new Error(
          `E01 credential revocation unproved: ${credential.kind}`,
        );
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, 'E01 credential cleanup failed', {
      cause: report,
    });
  return report;
}

export type AccountFact = Record<string, unknown>;
export interface AccountForeignKey {
  table: string;
  columns: string[];
  targetTable: string;
  targetColumns: string[];
  nullable?: boolean[];
}
export interface AccountSnapshot {
  tables: Record<string, AccountFact[]>;
  foreignKeys: AccountForeignKey[];
  rawRows?: Record<string, string[]>;
}
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const same = (a: unknown, b: unknown) => isDeepStrictEqual(json(a), json(b));

export function reconcileAccountFacts(
  before: AccountSnapshot,
  after: AccountSnapshot,
  allowed: Record<string, readonly string[]>,
) {
  if (
    !same(
      Object.keys(before.tables).sort(),
      Object.keys(after.tables).sort(),
    ) ||
    !same(before.foreignKeys, after.foreignKeys)
  )
    throw new Error('E01 table/FK schema changed');
  if (!!before.rawRows !== !!after.rawRows)
    throw new Error('E01 raw snapshot coverage changed');
  let additions = 0,
    preserved = 0;
  for (const [table, oldRows] of Object.entries(before.tables)) {
    if (before.rawRows && after.rawRows) {
      const remainingRaw = [...after.rawRows[table]];
      for (const raw of before.rawRows[table]) {
        const index = remainingRaw.indexOf(raw);
        if (index < 0) throw new Error(`E01 old raw fact changed: ${table}`);
        remainingRaw.splice(index, 1);
      }
    }
    const remaining = [...after.tables[table]];
    for (const old of oldRows) {
      const index = remaining.findIndex((row) => same(row, old));
      if (index < 0)
        throw new Error(`E01 old fact changed or missing: ${table}`);
      remaining.splice(index, 1);
      preserved += 1;
    }
    const planned = new Set(allowed[table] ?? []);
    if (
      oldRows.some((row) => typeof row.id === 'string' && planned.has(row.id))
    )
      throw new Error(`E01 ownership overlaps old facts: ${table}`);
    const seen = new Set<unknown>();
    for (const row of remaining) {
      if (
        typeof row.id !== 'string' ||
        !planned.has(row.id) ||
        seen.has(row.id)
      )
        throw new Error(`E01 unowned addition: ${table}`);
      seen.add(row.id);
      additions += 1;
      for (const fk of after.foreignKeys.filter(
        (item) => item.table === table,
      )) {
        const values = fk.columns.map((column) => row[column]);
        if (
          values.some(
            (value, index) =>
              value === undefined ||
              (value === null && fk.nullable?.[index] !== true),
          )
        )
          throw new Error(`E01 partial FK ownership: ${table}`);
        // PostgreSQL MATCH SIMPLE permits a missing optional subjectId with a required campusId.
        if (values.some((value) => value === null)) continue;
        const targets = after.tables[fk.targetTable] ?? [];
        const target = targets.find((candidate) =>
          fk.targetColumns.every((column, index) =>
            same(candidate[column], values[index]),
          ),
        );
        if (
          !target ||
          typeof target.id !== 'string' ||
          !(allowed[fk.targetTable] ?? []).includes(target.id) ||
          before.tables[fk.targetTable].some((old) => same(old, target))
        )
          throw new Error(
            `E01 FK ownership failed: ${table} -> ${fk.targetTable}`,
          );
      }
    }
  }
  return { additions, preserved };
}

interface AccountSnapshotTransaction {
  $queryRawUnsafe<T>(text: string): Promise<T>;
}
interface AccountSnapshotClient {
  $transaction<T>(
    operation: (tx: AccountSnapshotTransaction) => Promise<T>,
    options: { isolationLevel: 'RepeatableRead'; timeout: number },
  ): Promise<T>;
}
export async function accountSnapshot(
  prisma: AccountSnapshotClient,
  checkpoint: () => void,
  transactionTimeoutMs = 30_000,
): Promise<AccountSnapshot> {
  checkpoint();
  const result = await prisma.$transaction(
    async (tx) => {
      const query = async <T>(sql: string): Promise<T> => {
        checkpoint();
        const value = await tx.$queryRawUnsafe<T>(sql);
        checkpoint();
        return value;
      };
      const [settings] = await query<
        Array<{ replicationRole: string; searchPath: string }>
      >(`
      SELECT current_setting('session_replication_role') AS "replicationRole",
             current_setting('search_path') AS "searchPath"
    `);
      if (
        settings?.replicationRole !== 'origin' ||
        settings.searchPath !== 'public'
      )
        throw new Error('E01 snapshot requires effective origin/public');
      const tables = await query<Array<{ tablename: string }>>(`
      SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename
    `);
      const bigints = await query<Array<{ table: string; column: string }>>(`
      SELECT c.relname AS "table", a.attname AS "column"
      FROM pg_attribute a
      JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_type t ON t.oid=a.atttypid
      WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
        AND (t.oid='pg_catalog.int8'::regtype OR t.typbasetype='pg_catalog.int8'::regtype)
      ORDER BY c.relname,a.attnum
    `);
      const foreignKeys = await query<
        Array<AccountForeignKey & { targetSchema: string }>
      >(`
      SELECT source.relname AS "table", array_agg(sa.attname::text ORDER BY key.ordinality) AS columns,
             target.relname AS "targetTable", tn.nspname AS "targetSchema",
             array_agg(NOT sa.attnotnull ORDER BY key.ordinality) AS nullable,
             array_agg(ta.attname::text ORDER BY key.ordinality) AS "targetColumns"
      FROM pg_constraint c
      JOIN pg_class source ON source.oid=c.conrelid
      JOIN pg_namespace sn ON sn.oid=source.relnamespace
      JOIN pg_class target ON target.oid=c.confrelid
      JOIN pg_namespace tn ON tn.oid=target.relnamespace
      CROSS JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY AS key(source_key,target_key,ordinality)
      JOIN pg_attribute sa ON sa.attrelid=source.oid AND sa.attnum=key.source_key
      JOIN pg_attribute ta ON ta.attrelid=target.oid AND ta.attnum=key.target_key
      WHERE c.contype='f' AND sn.nspname='public'
      GROUP BY c.oid,source.relname,target.relname,tn.nspname
      ORDER BY source.relname,c.oid
    `);
      if (foreignKeys.some((fk) => fk.targetSchema !== 'public'))
        throw new Error('E01 cross-schema FK ownership is not allocated');
      const publicForeignKeys = foreignKeys.map((fk) => ({
        table: fk.table,
        columns: fk.columns,
        targetTable: fk.targetTable,
        targetColumns: fk.targetColumns,
        ...(fk.nullable ? { nullable: fk.nullable } : {}),
      }));
      const snapshot: AccountSnapshot = {
        tables: {},
        foreignKeys: publicForeignKeys,
        rawRows: {},
      };
      for (const { tablename } of tables) {
        const quoted = '"' + tablename.replaceAll('"', '""') + '"';
        const bigintFields = bigints
          .filter((item) => item.table === tablename)
          .flatMap(({ column }) => [
            "'" + column.replaceAll("'", "''") + "'",
            't."' + column.replaceAll('"', '""') + '"::text',
          ]);
        // Cast int8 before JSON parsing while retaining the exact original row.
        const normalized = bigintFields.length
          ? `to_jsonb(t) || jsonb_build_object(${bigintFields.join(',')})`
          : 'to_jsonb(t)';
        const rows = await query<Array<{ row: string; normalizedRow: string }>>(
          `SELECT to_jsonb(t)::text AS row, (${normalized})::text AS "normalizedRow" FROM public.${quoted} t ORDER BY to_jsonb(t)::text`,
        );
        snapshot.rawRows![tablename] = rows.map((row) => row.row);
        snapshot.tables[tablename] = rows.map(
          (row) => JSON.parse(row.normalizedRow) as AccountFact,
        );
      }
      return snapshot;
    },
    { isolationLevel: 'RepeatableRead', timeout: transactionTimeoutMs },
  );
  checkpoint();
  return result;
}
