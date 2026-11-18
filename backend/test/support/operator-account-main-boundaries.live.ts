import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { runMainAccountWindow, buildMainPlans } from './operator-account-main-runtime';
import { exerciseMainAccountBoundaries } from './operator-account-main-cases';
import { requireMain, assertMainReady, type MainAllocation } from './operator-account-main-admission';
import type { AccountSnapshot } from './operator-pdf-test-account-support';
import { redactMainEvidence } from './operator-account-main-evidence';

const RealDate = Date;
function fingerprint(snapshot: AccountSnapshot) {
  return {
    foreignKeys: snapshot.foreignKeys,
    tables: Object.fromEntries(Object.entries(snapshot.rawRows ?? {}).map(([table, rows]) => [
      table, {
        count: rows.length,
        rawRowSHA256: rows.map(row => createHash('sha256').update(row).digest('hex')),
      },
    ])),
  };
}
test('allocated account return/loss boundaries after captured history/filter evidence', async () => {
  const filename = process.env.OPERATOR_ACCOUNT_MAIN_ALLOCATION;
  requireMain(filename && resolve(filename) === filename, 'absolute new boundary allocation required');
  const allocation = JSON.parse(readFileSync(filename, 'utf8')) as MainAllocation & { executionScope?: string };
  requireMain(allocation.executionScope ===
    'Corrected summary own-scope plus remaining loss/fresh-return/transfer boundaries; do not rerun eleven history/filter cases',
  'boundary continuation scope required');
  const root = resolve(__dirname, '../../..');
  assertMainReady(allocation, root, buildMainPlans(allocation));
  const evidence = dirname(filename);
  writeFileSync(resolve(evidence, allocation.execution + '-execution-claim.json'),
    JSON.stringify({ at: new RealDate().toISOString(), execution: allocation.execution,
      windowId: allocation.windowId, boundaryContinuationOnly: true,
      allocationSHA256: createHash('sha256').update(readFileSync(filename)).digest('hex') }),
    { flag: 'wx' });
  let sequence = 0;
  const record = (name: string, value: unknown) => {
    const safe = name.endsWith('-snapshot') ? fingerprint(value as AccountSnapshot) : redactMainEvidence(value);
    const label = name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
    writeFileSync(resolve(evidence, `${allocation.execution}-${String(++sequence).padStart(3, '0')}-${label}.json`),
      JSON.stringify({ at: new RealDate().toISOString(), name, value: safe }, null, 2) + '\n', { flag: 'wx' });
  };
  await runMainAccountWindow(allocation, root, exerciseMainAccountBoundaries, record);
}, 30 * 60_000);
