import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { ExecutionContext } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import type { MainAllocation } from './operator-account-main-admission';
import type { LifecycleObserver, createLifecycleObserver } from './operator-account-lifecycle-observer';

export const OBSERVATION_SCOPE =
  'Only new account credential lifecycle observation; preserve captured business and original credential gaps';
export const OBSERVATION_SOURCES = [
  'docs/verification/operator-account-http-main-20261030/observer-continuation.cjs',
  'docs/verification/operator-account-http-main-20261030/transform-main.cjs',
  'backend/test/support/operator-account-main-lifecycle.live.ts',
  'backend/test/support/operator-account-main-runtime.ts',
  'backend/test/support/operator-account-main-pages.ts',
  'backend/test/support/operator-pdf-test-account-pages.ts',
  'backend/test/support/operator-account-main-host.ts',
  'backend/test/support/operator-account-main-observation.ts',
  'backend/test/support/operator-account-lifecycle-observer.ts',
] as const;
type Identity = { ordinal: number; userId: string; kind: 'access' | 'refresh' };
type Outcome = 'ended' | 'error' | 'aborted' | 'destroyed';
export interface ClientObservation {
  ordinal: number;
  requestId: string;
  response(status: number): void;
  close(outcome: Outcome): void;
}
interface ObservedGuard {
  canActivate(context: ExecutionContext): Promise<boolean> | boolean;
}
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

export function createAccountObservation(observer: LifecycleObserver) {
  const requests = new WeakMap<object, number>();
  const decorated = new WeakSet<object>();
  let observingCredentials = false;
  function invalid() {
    observer.serverStart({ ordinal: 0, requestId: '' });
  }
  function tap(action: () => unknown) {
    try { action(); }
    catch { try { invalid(); } catch { /* Observation cannot replace original control flow. */ } }
  }
  function reference(value: unknown) {
    if (typeof value !== 'string') return;
    const at = value.lastIndexOf(':');
    if (at < 1) return;
    const ordinal = Number(value.slice(at + 1));
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 264) return;
    if (value !== observer.requestId(ordinal)) return;
    return { ordinal, requestId: value };
  }
  return {
    begin(identity: Identity): ClientObservation {
      observingCredentials = true;
      let requestId = '';
      tap(() => {
        observer.credentialStart(identity);
        requestId = observer.requestId(identity.ordinal);
      });
      return {
        ordinal: identity.ordinal, requestId,
        response(status) { tap(() => observer.clientResponse({ ordinal: identity.ordinal, status })); },
        close(outcome) { tap(() => observer.clientEnd({ ordinal: identity.ordinal, outcome })); },
      };
    },
    receipt(ordinal: number) { tap(() => observer.receiptWritten({ ordinal })); },
    middleware(request: Request, response: Response, next: NextFunction) {
      if (!observingCredentials) return next();
      tap(() => {
        const match = reference(request.headers['x-e01-observation-id']);
        if (!match) { invalid(); return; }
        requests.set(request, match.ordinal);
        observer.serverStart(match);
        response.once('finish', () => tap(() => observer.serverFinish({ ordinal: match.ordinal })));
        response.once('close', () => tap(() => observer.serverClose({ ordinal: match.ordinal })));
      });
      next();
    },
    decorateGuard(guard: ObservedGuard) {
      if (decorated.has(guard)) return;
      const original = guard.canActivate.bind(guard);
      guard.canActivate = async context => {
        let outcome: 'allowed' | 'rejected' = 'rejected';
        try {
          const result = await original(context);
          outcome = result ? 'allowed' : 'rejected';
          return result;
        } finally {
          tap(() => {
            const request = context.switchToHttp().getRequest<object>();
            const ordinal = requests.get(request);
            if (ordinal !== undefined) observer.guardEnd({ ordinal, outcome });
          });
        }
      };
      decorated.add(guard);
    },
    summary() { tap(() => observer.recordSummary()); },
    state: () => observer.state(),
  };
}
export type MainObservation = ReturnType<typeof createAccountObservation>;

export function createAllocatedObservation(
  allocation: MainAllocation,
  root: string,
  allocationFile: string,
  role: 'parent' | 'child',
  nodeFactory: typeof createLifecycleObserver,
) {
  if (typeof nodeFactory !== 'function' || !allocationFile
    || resolve(allocationFile) !== allocationFile || allocation.status !== 'ALLOCATED'
    || !allocation.coordinatorApproved || !allocation.mainIntegrated)
    throw Error('Allocated observation requires admitted input and the bound Node factory');
  for (const name of OBSERVATION_SOURCES) {
    if (!/^[0-9a-f]{64}$/.test(allocation.sources[name] || '')
      || sha(resolve(root, name)) !== allocation.sources[name])
      throw Error('Observation calling source is not bound: ' + name);
  }
  const actors = allocation.fixtures.flatMap(fixture => fixture.actors);
  const directory = dirname(allocationFile);
  const observer = nodeFactory({
    runId: allocation.execution, role, directory,
    allowedTarget: join(directory, `${allocation.execution}.${role}.observer.jsonl`),
    binding: { path: allocationFile, sha256: sha(allocationFile) },
    actorIds: actors,
  });
  observer.installProcessMonitors();
  if (!observer.recordStartup({
    backendPackageFile: resolve(root, 'backend/package.json'),
    programFiles: OBSERVATION_SOURCES.map(name => ({
      path: resolve(root, name), sha256: allocation.sources[name],
    })),
  })) throw Error('Observation startup evidence unavailable');
  return { observer, observation: createAccountObservation(observer) };
}

// Call inside the actual Jest VM. Node startup resolution stays in the Node factory.
export function resolveJestDrivers(root: string) {
  const runtime = resolve(root, 'backend/test/support/operator-account-main-runtime.ts');
  const docker = resolve(root, 'backend/test/support/operator-account-main-docker.ts');
  const references: Array<{ domain: string; from: string; request: string;
    resolved: string; realpath: string; sha256: string; loadedBeforeProbe: boolean }> = [];
  function record(from: string, request: string) {
    const resolved = createRequire(from).resolve(request);
    references.push({
      domain: 'jest-vm-createRequire', from, request, resolved,
      realpath: realpathSync.native(resolved), sha256: sha(resolved),
      loadedBeforeProbe: (require as unknown as NodeJS.Require).cache[resolved]?.loaded === true,
    });
    return resolved;
  }
  const adapter = record(runtime, '@prisma/adapter-pg');
  const nested = record(adapter, 'pg');
  record(nested, './client');
  record(nested, 'pg-pool');
  const top = record(docker, 'pg');
  record(top, './client');
  record(top, 'pg-pool');
  return {
    domain: 'jest-vm-createRequire', resolutionOnly: true,
    provesNaturalHostLoading: false, references,
  };
}
