import { readFileSync, readdirSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { accountRealNow } from './operator-pdf-test-account-window';
import { accountJson } from './operator-pdf-test-account-adapter-schema';
import { MAIN_GRAPHS, type MainFixture } from './operator-account-main-fixture';

export interface MainAllocation {
  kind: 'E01_E02_PAGE_HTTP_POSTGRES';
  status: 'ALLOCATED';
  coordinatorApproved: true;
  mainIntegrated: true;
  windowId: string;
  execution: string;
  syntheticNow: string;
  opensAt: string;
  expiresAt: string;
  executionScope?: string;
  predecessor?: {
    resource: {
      containerId: string;
      startedAt: string;
      finishedAt: string;
      restartCount: number;
    };
    rawRows: number;
    rawDigest: Record<string, { count: number; sha256: string }>;
  };
  sources: Record<string, string>;
  migrations: Array<{ name: string; checksum: string }>;
  fixtures: Array<{
    graph: string;
    executionId: string;
    sha256: string;
    rows: Array<{ table: string; id: string }>;
    actors: string[];
  }>;
  resource: {
    container: string;
    containerId: string;
    image: string;
    volume: string;
    database: string;
    role: string;
    host: '127.0.0.1';
    port: 55437;
    owner: string;
    resourceRun: string;
  };
}
export function requireMain(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(`E01/E02 admission: ${reason}`);
}
const sha = (data: string | Buffer) =>
  createHash('sha256').update(data).digest('hex');
type PredecessorInput = Pick<
  MainAllocation,
  'resource' | 'executionScope' | 'predecessor'
>;
function mainPredecessor(a: PredecessorInput) {
  if (
    a.executionScope !==
    'Only new account credential lifecycle observation; preserve captured business and original credential gaps'
  )
    return;
  const p = a.predecessor;
  requireMain(
    p &&
      p.resource?.containerId === a.resource.containerId &&
      typeof p.resource.startedAt === 'string' &&
      Number.isFinite(Date.parse(p.resource.startedAt)) &&
      typeof p.resource.finishedAt === 'string' &&
      Date.parse(p.resource.finishedAt) >= Date.parse(p.resource.startedAt) &&
      Number.isInteger(p.resource.restartCount) &&
      p.resource.restartCount >= 0 &&
      Number.isInteger(p.rawRows) &&
      p.rawRows >= 0 &&
      p.rawDigest &&
      !Array.isArray(p.rawDigest) &&
      Object.keys(p.rawDigest).length > 0 &&
      Object.values(p.rawDigest).every(
        (row) =>
          Number.isInteger(row.count) &&
          row.count >= 0 &&
          /^[a-f0-9]{64}$/.test(row.sha256),
      ) &&
      Object.values(p.rawDigest).reduce((sum, row) => sum + row.count, 0) ===
        p.rawRows,
    'complete predecessor checkpoint required for lifecycle window',
  );
  return p;
}
export function assertMainPredecessorSnapshot(
  a: PredecessorInput,
  snapshot: { rawRows?: Record<string, string[]> },
) {
  const p = mainPredecessor(a);
  if (!p) return;
  requireMain(snapshot.rawRows, 'complete raw predecessor snapshot required');
  const actual = Object.fromEntries(
    Object.entries(snapshot.rawRows).map(([table, rows]) => {
      requireMain(
        Array.isArray(rows) && rows.every((row) => typeof row === 'string'),
        'raw predecessor rows required',
      );
      return [
        table,
        { count: rows.length, sha256: sha(JSON.stringify([...rows].sort())) },
      ];
    }),
  );
  requireMain(
    isDeepStrictEqual(actual, p.rawDigest),
    'predecessor raw checkpoint changed before fixture',
  );
}
export function assertMainStoppedPredecessor(
  a: PredecessorInput,
  current: {
    Id: string;
    RestartCount: number;
    State: {
      Status: string;
      Running: boolean;
      Pid: number;
      ExitCode: number;
      StartedAt: string;
      FinishedAt: string;
    };
  },
) {
  const p = mainPredecessor(a);
  if (!p) return;
  requireMain(
    current.Id === p.resource.containerId &&
      current.State.Status === 'exited' &&
      !current.State.Running &&
      current.State.Pid === 0 &&
      current.State.ExitCode === 0 &&
      current.State.StartedAt === p.resource.startedAt &&
      current.State.FinishedAt === p.resource.finishedAt &&
      current.RestartCount === p.resource.restartCount,
    'predecessor stopped generation changed before start',
  );
}
export const mainFixtureManifest = (plan: MainFixture) => ({
  graph: plan.mainGraph,
  executionId: plan.executionId,
  sha256: sha(accountJson(plan.records)),
  rows: plan.records.map((row) => ({
    table: row.table,
    id: String(row.data.id),
  })),
  actors: plan.accounts.map((account) => account.userId),
});
export function assertMainClock(
  a: Pick<MainAllocation, 'opensAt' | 'expiresAt'>,
) {
  const now = accountRealNow().getTime(),
    opens = Date.parse(a.opensAt),
    expires = Date.parse(a.expiresAt);
  requireMain(
    Number.isFinite(opens) &&
      Number.isFinite(expires) &&
      opens <= now &&
      expires > now &&
      expires - opens <= 1800000 &&
      expires > opens,
    'real-clock window unavailable',
  );
}
export function assertMainReady(
  allocation: MainAllocation,
  root: string,
  plans: MainFixture[],
) {
  const a = allocation,
    r = a.resource;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  requireMain(
    resolve(root) === resolve('F:/学习项目组/小程序开发1'),
    'exact main root required',
  );
  requireMain(
    a.kind === 'E01_E02_PAGE_HTTP_POSTGRES' &&
      a.status === 'ALLOCATED' &&
      a.coordinatorApproved === true &&
      a.mainIntegrated === true &&
      uuid.test(a.windowId) &&
      uuid.test(a.execution) &&
      a.windowId !== a.execution,
    'new coordinator allocation required',
  );
  assertMainClock(a);
  mainPredecessor(a);
  requireMain(
    process.env.NODE_ENV === 'test' &&
      process.env.AUTH_DRIVER === 'mock' &&
      process.env.PAYMENT_DRIVER === 'mock' &&
      process.env.MESSAGE_DRIVER === 'mock' &&
      !process.env.PGOPTIONS &&
      !process.env.DATABASE_URL,
    'isolated test/mock environment required',
  );
  requireMain(
    r.host === '127.0.0.1' &&
      r.port === 55437 &&
      /^[0-9a-f]{64}$/.test(r.containerId) &&
      /^[0-9a-f]{64}$/.test(r.volume) &&
      /^sha256:[0-9a-f]{64}$/.test(r.image) &&
      /^[A-Za-z0-9_]+_test$/.test(r.database) &&
      /^[A-Za-z0-9_]+$/.test(r.role) &&
      !!r.container &&
      !!r.owner &&
      !!r.resourceRun,
    'exact dedicated resource required',
  );
  requireMain(
    Object.keys(a.sources).length > 30,
    'complete source fingerprints required',
  );
  for (const [name, expected] of Object.entries(a.sources)) {
    requireMain(
      !isAbsolute(name) &&
        !name.split(/[\\/]/).includes('..') &&
        /^[0-9a-f]{64}$/.test(expected) &&
        sha(readFileSync(resolve(root, name))) === expected,
      `source baseline changed: ${name}`,
    );
  }
  const currentMigrations = readdirSync(
    resolve(root, 'backend/prisma/migrations'),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      checksum: sha(
        readFileSync(
          resolve(
            root,
            'backend/prisma/migrations',
            entry.name,
            'migration.sql',
          ),
        ),
      ),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  requireMain(
    a.migrations.length >= 55 &&
      accountJson(currentMigrations) === accountJson(a.migrations) &&
      a.migrations.some(
        (item) =>
          item.name === '202610290004_operator_headquarters_grants' &&
          item.checksum ===
            '5268104ad778e5df36a1743d21564980fe28d2815f9b3a9723a4526091ddfe4d',
      ),
    'complete current raw migration baseline required; deployed 54 is insufficient for main source 55',
  );
  requireMain(
    accountJson(plans.map(mainFixtureManifest)) === accountJson(a.fixtures) &&
      accountJson(plans.map((plan) => plan.mainGraph)) ===
        accountJson([...MAIN_GRAPHS]) &&
      plans.reduce((n, plan) => n + plan.records.length, 0) < 6000,
    'exact bounded UUID fixture whitelist required',
  );
}
