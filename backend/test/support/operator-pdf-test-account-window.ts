import { performance } from 'node:perf_hooks';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { checkMainAccountAdmission } from './operator-account-main-capability';

export interface AccountLeaseTarget {
  windowId: string;
  executionId: string;
  containerId: string;
  volumeName: string;
  opensAt: string;
  expiresAt: string;
}
const RealDate = Date;
export const accountRealNow = () =>
  new RealDate(performance.timeOrigin + performance.now());

export function assertAccountLease(
  allocation: AccountLeaseTarget,
  input: unknown,
  now = accountRealNow(),
) {
  const opens = Date.parse(allocation.opensAt),
    expires = Date.parse(allocation.expiresAt);
  if (
    !Number.isFinite(opens) ||
    !Number.isFinite(expires) ||
    opens > now.getTime() ||
    expires <= now.getTime() ||
    expires - opens > 30 * 60_000
  )
    throw new Error('E01 real-clock window unavailable');
  const lease = input as Record<string, unknown> | null;
  if (
    !lease ||
    lease.mode !== 'E01_PAGE_READ' ||
    lease.active !== true ||
    lease.exclusive !== true ||
    lease.mainIntegrated !== true ||
    allocation.windowId === allocation.executionId ||
    !allocation.windowId ||
    !allocation.executionId ||
    !allocation.containerId ||
    !allocation.volumeName ||
    !Object.entries(allocation).every(([key, value]) => lease[key] === value)
  )
    throw new Error(
      'E01 exclusive same-volume lease or main integration missing',
    );
}

export function accountLiveAdmission(
  env: NodeJS.ProcessEnv,
  root: string,
): void {
  if (checkMainAccountAdmission(root)) return;
  const absent = [
    'backend/src/modules/operator/operator-account.controller.ts',
    'backend/src/modules/operator/operator-account.service.ts',
    'backend/src/modules/operator/operator-account-ledger.ts',
    'backend/src/modules/operator/dto/operator-account.dto.ts',
    'contracts/operator-account.openapi.yaml',
  ].filter((name) => !existsSync(resolve(root, name)));
  // An allocation and target-specific probes are still pending coordinator delivery.
  // An environment flag cannot turn this offline candidate into a resource owner.
  throw new Error(
    `E01 live window unassigned; admission closed (enabled=${env.OPERATOR_PDF_ACCOUNT_ENABLED === '1'}; missing=${absent.join(',')})`,
  );
}

export interface AccountResource {
  kind: string;
  containerName: string;
  containerId: string;
  volumeName: string;
  database: string;
  user: string;
  port: string;
  runTag: string;
  marker: string;
  image: string;
  labels: Record<string, string>;
}
function assertResourceShape(resource: AccountResource) {
  if (
    resource.kind !== 'operator-e01-page-api' ||
    !/^[0-9a-f]{64}$/.test(resource.containerId) ||
    !/^[1-9]\d{0,4}$/.test(resource.port) ||
    Number(resource.port) > 65535 ||
    !/^[a-zA-Z0-9_]+_test$/.test(resource.database) ||
    !/^[a-zA-Z0-9_]+$/.test(resource.user) ||
    !resource.containerName ||
    !resource.volumeName ||
    !resource.runTag ||
    resource.image !== 'postgres:17-alpine' ||
    resource.marker !== `operator-e01:c694:${resource.runTag}:synthetic-only` ||
    resource.labels['education.operator-pdf.workspace'] !== 'c694' ||
    resource.labels['education.operator-pdf.run'] !== resource.runTag
  )
    throw new Error('E01 exact resource shape is invalid');
}
export function accountPoolConfig(
  env: NodeJS.ProcessEnv,
  resource: AccountResource,
) {
  assertResourceShape(resource);
  if (
    env.NODE_ENV !== 'test' ||
    env.AUTH_DRIVER !== 'mock' ||
    env.PAYMENT_DRIVER !== 'mock' ||
    env.MESSAGE_DRIVER !== 'mock' ||
    (env.PGOPTIONS !== undefined && env.PGOPTIONS !== '')
  )
    throw new Error('E01 test/mock environment or PGOPTIONS gate failed');
  const target = new URL(env.DATABASE_URL ?? '');
  if (
    target.protocol !== 'postgresql:' ||
    target.hostname !== '127.0.0.1' ||
    target.port !== resource.port ||
    target.username !== resource.user ||
    target.pathname !== '/' + resource.database ||
    target.search ||
    target.hash ||
    !target.password
  )
    throw new Error('E01 exact database target gate failed');
  return {
    connectionString: target.href,
    options: '-c session_replication_role=origin -c search_path=public',
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 10_000,
  };
}
interface AccountResourceObservation {
  resource: AccountResource;
  dockerHost: string;
  mainIntegrated: boolean;
  binding: object;
  mounts: object[];
  database: string;
  user: string;
  marker: string;
  replicationRole: string;
  searchPath: string;
  otherSessions: number;
  sources: Record<string, string>;
  migrations: Array<{ name: string; checksum: string }>;
}
const same = (a: unknown, b: unknown) =>
  isDeepStrictEqual(
    JSON.parse(JSON.stringify(a)),
    JSON.parse(JSON.stringify(b)),
  );

export function assertAccountResource(
  expected: AccountResource,
  sources: Record<string, string>,
  migrations: Array<{ name: string; checksum: string }>,
  observed: AccountResourceObservation,
) {
  assertResourceShape(expected);
  if (
    !Object.keys(sources).length ||
    !migrations.length ||
    !Object.values(sources).every((hash) => /^[0-9a-f]{64}$/.test(hash)) ||
    !migrations.every((m) => /^[0-9a-f]{64}$/.test(m.checksum)) ||
    !same(expected, observed.resource) ||
    !observed.dockerHost.startsWith('npipe://') ||
    !observed.mainIntegrated ||
    !same(observed.binding, {
      '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: expected.port }],
    }) ||
    !same(observed.mounts, [
      {
        Type: 'volume',
        Name: expected.volumeName,
        Destination: '/var/lib/postgresql/data',
      },
    ]) ||
    observed.database !== expected.database ||
    observed.user !== expected.user ||
    observed.marker !== expected.marker ||
    observed.otherSessions !== 0 ||
    observed.replicationRole !== 'origin' ||
    observed.searchPath !== 'public' ||
    !same(sources, observed.sources) ||
    !same(migrations, observed.migrations)
  )
    throw new Error('E01 exact resource/source/migration gate failed');
}
