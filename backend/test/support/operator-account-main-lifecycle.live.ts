import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { runMainAccountWindow, buildMainPlans } from './operator-account-main-runtime';
import { requireMain, assertMainReady, type MainAllocation } from './operator-account-main-admission';
import type { AccountSnapshot } from './operator-pdf-test-account-support';
import { redactMainEvidence } from './operator-account-main-evidence';
import type { createLifecycleObserver } from './operator-account-lifecycle-observer';
import { createAllocatedObservation, OBSERVATION_SCOPE, resolveJestDrivers } from './operator-account-main-observation';

const RealDate = Date;
function fingerprint(snapshot: AccountSnapshot) {
  return {
    foreignKeys: snapshot.foreignKeys,
    tables: Object.fromEntries(Object.entries(snapshot.rawRows ?? {}).map(([table, rows]) => [
      table, { count: rows.length,
        rawRowSHA256: rows.map(row => createHash('sha256').update(row).digest('hex')) },
    ])),
  };
}
test('allocated new account lifecycle observation only', async () => {
  const filename = process.env.OPERATOR_ACCOUNT_MAIN_ALLOCATION;
  requireMain(filename && resolve(filename) === filename, 'absolute new observer allocation required');
  const allocation = JSON.parse(readFileSync(filename, 'utf8')) as MainAllocation & { executionScope?: string };
  requireMain(allocation.executionScope === OBSERVATION_SCOPE, 'new lifecycle observation scope required');
  const root = resolve(__dirname, '../../..');
  assertMainReady(allocation, root, buildMainPlans(allocation));
  const factory = (process as typeof process & {
    accountObserverNodeFactory?: { create: typeof createLifecycleObserver; path: string; sha256: string };
  }).accountObserverNodeFactory;
  const observerPath = resolve(root, 'backend/test/support/operator-account-lifecycle-observer.ts');
  requireMain(factory?.path === observerPath
    && factory.sha256 === allocation.sources['backend/test/support/operator-account-lifecycle-observer.ts'],
  'bound Node observer factory required; Jest virtual createRequire is separate');
  const { observation } = createAllocatedObservation(allocation, root, filename, 'child', factory.create);
  const evidence = dirname(filename);
  writeFileSync(resolve(evidence, allocation.execution + '-execution-claim.json'),
    JSON.stringify({ at: new RealDate().toISOString(), execution: allocation.execution,
      windowId: allocation.windowId, lifecycleObservationOnly: true,
      allocationSHA256: createHash('sha256').update(readFileSync(filename)).digest('hex') }),
    { flag: 'wx' });
  writeFileSync(resolve(evidence, allocation.execution + '-jest-drivers.json'),
    JSON.stringify({ at: new RealDate().toISOString(), ...resolveJestDrivers(root) }, null, 2) + '\n',
    { flag: 'wx' });
  let sequence = 0;
  const record = (name: string, value: unknown) => {
    const safe = name.endsWith('-snapshot') ? fingerprint(value as AccountSnapshot) : redactMainEvidence(value);
    const label = name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
    writeFileSync(resolve(evidence, `${allocation.execution}-${String(++sequence).padStart(3, '0')}-${label}.json`),
      JSON.stringify({ at: new RealDate().toISOString(), name, value: safe }, null, 2) + '\n', { flag: 'wx' });
  };
  // Previously captured account reads/transfers are not replayed in a lifecycle-only window.
  await runMainAccountWindow(allocation, root, async () => undefined, record, observation);
}, 30 * 60_000);
