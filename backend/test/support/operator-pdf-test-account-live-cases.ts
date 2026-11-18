import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type {
  OperatorAccount,
  OperatorAccountEntryType,
} from '../../../frontend/pages/operator/runtime/types/operator-account';
import { OPERATOR_ACCOUNT_CATEGORIES } from '../../../frontend/pages/operator/runtime/types/operator-account';
import { presentOperatorAccountSummary } from '../../../frontend/pages/operator/runtime/services/operator-account.presenter';
import { createAccountValidator } from './operator-pdf-test-account-contract';
import {
  AccountPageWire,
  captureAccountPage,
  type AccountTestPage,
  type AccountWireCall,
} from './operator-pdf-test-account-pages';
import {
  reconcileAccountFacts,
  runAccountScope,
  type AccountCredential,
  type AccountSnapshot,
} from './operator-pdf-test-account-support';
import { accountLiveAdmission } from './operator-pdf-test-account-window';

const accountPath = '/operators/me/lesson-account';
const subjectsPath = '/operators/me/subjects';
type Provenance = 'memory-provider' | 'allocated-http-postgres';
interface Observed {
  status: number;
  body: unknown;
  provenance: Provenance;
}
interface HeldRead {
  entered: Promise<void>;
  response: Promise<Observed>;
  release(): void;
  closeAndDrain(): Promise<void>;
}
export interface AccountScenarioSession {
  page: AccountTestPage & { onRefresh(): void; onRetrySubjects(): void };
  calls: Array<
    Pick<AccountWireCall, 'path' | 'query' | 'status' | 'responseBody'>
  >;
  settle(): Promise<void>;
  close: () => Promise<void> | void;
}
export const ACCOUNT_HISTORY_CASES = [
  'expired',
  'inactive',
  'departed',
  'paid-unissued',
  'pending-refund',
  'approved-unpaid-refund',
  'executed-refund',
  'effective-correction',
  'invalid-current',
  'invalid-historical',
  'historical-overflow',
] as const;
export interface AccountCaseContext {
  provenance: Provenance;
  root: string;
  checkpoint(): void;
  cleanupCheckpoint: () => void;
  open(actor: string): AccountScenarioSession;
  read(
    actor: string,
    path: string,
    query?: Record<string, string>,
  ): Promise<Observed>;
  arm503(
    session: AccountScenarioSession,
    path: string,
  ): { ready: Promise<void>; closeAndDrain(): Promise<void> };
  denyWithLateSuccess(
    session: AccountScenarioSession,
    path: string,
    status: 401 | 403,
  ): {
    denialReady: Promise<Observed>;
    release(): void;
    closeAndDrain(): Promise<void>;
  };
  historyFixture(name: (typeof ACCOUNT_HISTORY_CASES)[number]): Promise<{
    actor: string;
    status: number;
    expected?: OperatorAccount;
  }>;
  holdBeforeReturn(actor: 'return-revocation' | 'student-move'): HeldRead;
  mutateOwned(
    kind: 'revoke-before-return' | 'move-student-before-return',
  ): Promise<void>;
  resolveOwnership(): Promise<'OWNED' | 'UNRESOLVED'>;
  disableOwnedAccounts: (ids: readonly string[]) => Promise<void>;
  accountStates(): Promise<Array<{ id: string; status: string }>>;
  probeCredential: (credential: AccountCredential) => Promise<Observed>;
  snapshot(): Promise<AccountSnapshot>;
  flushCallbacks(): Promise<void>;
  oracle: {
    account: OperatorAccount;
    archivedSubjectId: string;
    filteredSubjectId: string;
    subjectTotal: number;
    otherCampusSubjectId: string;
    filteredTotal: number;
    filteredRowIds: string[];
    filteredEntryType: OperatorAccountEntryType;
    manifestActorIds: string[];
    credentials: AccountCredential[];
    baseline: AccountSnapshot;
    allowed: Record<string, readonly string[]>;
  };
}

// No allocation has been issued. Even an explicit call cannot open this adapter today.
// Once coordinated resource probes are wired, this body uses the saved real Page and TCP wire.
export function openAllocatedAccountPage(
  origin: string,
  token: string,
  checkpoint: () => void,
): AccountScenarioSession {
  requireAccountAllocation();
  const wire = new AccountPageWire(
    origin,
    new Map([[token, 'owned-actor']]),
    checkpoint,
  );
  let captured: ReturnType<typeof captureAccountPage> | undefined;
  try {
    const owned = captureAccountPage(origin, token, wire);
    captured = owned;
    const page =
      owned.instantiate() as unknown as AccountScenarioSession['page'];
    if (
      typeof page.onRefresh !== 'function' ||
      typeof page.onRetrySubjects !== 'function'
    )
      throw new Error('Actual account Page handlers are unavailable');
    return {
      page,
      calls: wire.calls,
      settle: () => wire.idle(),
      async close() {
        const failures: unknown[] = [];
        try {
          owned.close();
        } catch (error) {
          failures.push(error);
        }
        try {
          await wire.closeAndDrain();
        } catch (error) {
          failures.push(error);
        }
        if (failures.length)
          throw new AggregateError(failures, 'E01 scenario Page close failed');
      },
    };
  } catch (error) {
    // No Page reads have started, so the wire owns no outgoing work at this point.
    try {
      captured?.close();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'E01 Page acquisition and close failed',
      );
    }
    throw error;
  }
}
function requireAccountAllocation(): void {
  accountLiveAdmission(process.env, resolve(__dirname, '../../..'));
}

async function step<T>(
  ctx: AccountCaseContext,
  operation: () => Promise<T>,
): Promise<T> {
  ctx.checkpoint();
  const result = await operation();
  ctx.checkpoint();
  return result;
}
function latest(session: AccountScenarioSession, path = accountPath) {
  const call = session.calls.findLast((item) => item.path === path);
  assert.ok(call, `Missing actual response for ${path}`);
  return call;
}
function summaries(value: OperatorAccount) {
  const {
    mainBalanceUnits,
    giftBalanceUnits,
    totalBalanceUnits,
    mainReservedUnits,
    giftReservedUnits,
    reservedTotalUnits,
    mainAvailableUnits,
    giftAvailableUnits,
    availableTotalUnits,
    enrollmentSummary,
    lessonActivityTotals,
  } = value;
  return {
    mainBalanceUnits,
    giftBalanceUnits,
    totalBalanceUnits,
    mainReservedUnits,
    giftReservedUnits,
    reservedTotalUnits,
    mainAvailableUnits,
    giftAvailableUnits,
    availableTotalUnits,
    enrollmentSummary,
    lessonActivityTotals,
  };
}
function sameJson(actual: unknown, expected: unknown) {
  assert.deepEqual(
    JSON.parse(JSON.stringify(actual)) as unknown,
    JSON.parse(JSON.stringify(expected)) as unknown,
  );
}
function privateEmpty(session: AccountScenarioSession) {
  assert.equal(session.page.data.viewState, 'forbidden');
  assert.equal(session.page.data.summary, null);
  sameJson(session.page.data.rows, []);
  sameJson(session.page.data.subjectOptions, []);
  assert.equal(session.page.data.total, 0);
}
function validObservation(ctx: AccountCaseContext, response: Observed) {
  assert.equal(
    response.provenance,
    ctx.provenance,
    'Evidence transport changed',
  );
}
async function withPage<T>(
  ctx: AccountCaseContext,
  actor: string,
  operation: (session: AccountScenarioSession) => Promise<T> | T,
) {
  return runAccountScope(async (resources) => {
    ctx.checkpoint();
    const session = ctx.open(actor);
    resources.register('page-session', async () => {
      await session.close();
    });
    session.page.onLoad();
    session.page.onShow();
    await step(ctx, () => session.settle());
    return operation(session);
  });
}
async function summaryCase(ctx: AccountCaseContext) {
  await withPage(ctx, 'owner', (session) => {
    const call = latest(session);
    assert.equal(call.status, 200);
    const value = createAccountValidator(ctx.root).account(call.responseBody);
    sameJson(summaries(value), summaries(ctx.oracle.account));
    sameJson(session.page.data.summary, presentOperatorAccountSummary(value));
  });
}
async function directoryCase(ctx: AccountCaseContext) {
  await withPage(ctx, 'owner', async (session) => {
    assert.ok(
      session.calls.some(
        (call) =>
          call.path === subjectsPath &&
          call.query.page === '2' &&
          call.status === 200,
      ),
    );
    assert.ok(
      ctx.oracle.subjectTotal > 100,
      'Directory oracle must span more than one page',
    );
    assert.equal(
      session.page.data.subjectOptions.length,
      ctx.oracle.subjectTotal + 2,
    );
    const index = session.page.data.subjectOptions.findIndex(
      (option) => option.value === ctx.oracle.archivedSubjectId,
    );
    assert.ok(index >= 0, 'Archived directory subject missing');
    const original = structuredClone(session.page.data.summary);
    session.page.onSubjectChange({ detail: { value: String(index) } });
    await step(ctx, () => session.settle());
    assert.equal(latest(session).query.subjectId, ctx.oracle.archivedSubjectId);
    const filteredIndex = session.page.data.subjectOptions.findIndex(
      (option) => option.value === ctx.oracle.filteredSubjectId,
    );
    assert.ok(filteredIndex >= 0, 'Filtered directory subject missing');
    session.page.onSubjectChange({ detail: { value: String(filteredIndex) } });
    await step(ctx, () => session.settle());
    assert.equal(latest(session).query.subjectId, ctx.oracle.filteredSubjectId);
    const category = OPERATOR_ACCOUNT_CATEGORIES.findIndex(
      (item) => item.value === ctx.oracle.filteredEntryType,
    );
    assert.ok(category > 0);
    session.page.onCategoryChange({ detail: { value: String(category) } });
    await step(ctx, () => session.settle());
    assert.equal(latest(session).query.subjectId, ctx.oracle.filteredSubjectId);
    assert.equal(latest(session).query.entryType, ctx.oracle.filteredEntryType);
    session.page.onLoadMore();
    await step(ctx, () => session.settle());
    assert.equal(latest(session).query.page, '2');
    assert.equal(latest(session).status, 200);
    assert.equal(latest(session).query.subjectId, ctx.oracle.filteredSubjectId);
    assert.equal(latest(session).query.entryType, ctx.oracle.filteredEntryType);
    assert.equal(session.page.data.rows.length, ctx.oracle.filteredTotal);
    assert.equal(ctx.oracle.filteredRowIds.length, ctx.oracle.filteredTotal);
    sameJson(
      session.page.data.rows.map((row) => (row as { id?: unknown }).id),
      ctx.oracle.filteredRowIds,
    );
    const second = createAccountValidator(ctx.root).account(
      latest(session).responseBody,
    );
    sameJson(
      second.items.map((row) => row.id),
      ctx.oracle.filteredRowIds.slice(20),
    );
    sameJson(session.page.data.summary, original);
  });
}
async function errorsCase(ctx: AccountCaseContext) {
  await withPage(ctx, 'owner', async (session) =>
    runAccountScope(async (resources) => {
      const rows = structuredClone(session.page.data.rows);
      ctx.checkpoint();
      const fault = ctx.arm503(session, accountPath);
      resources.register('503-fault', () => fault.closeAndDrain());
      await step(ctx, () => fault.ready);
      session.page.onLoadMore();
      await step(ctx, () => session.settle());
      const failed = latest(session);
      assert.equal(failed.status, 503);
      sameJson(session.page.data.rows, rows);
      assert.ok(session.page.data.detailError);
      const query = { ...failed.query };
      session.page.onRetryDetail();
      await step(ctx, () => session.settle());
      assert.equal(latest(session).status, 200);
      sameJson(latest(session).query, query);
    }),
  );
  for (const path of [accountPath, subjectsPath]) {
    for (const status of [401, 403] as const) {
      const actor = `denial-${path === accountPath ? 'account' : 'subjects'}-${status}`;
      await withPage(ctx, actor, async (session) =>
        runAccountScope(async (resources) => {
          assert.ok(session.page.data.summary);
          assert.ok(session.page.data.rows.length);
          const pending = ctx.denyWithLateSuccess(session, path, status);
          resources.register('late-response', () => pending.closeAndDrain());
          session.page.onRefresh();
          session.page.onRetrySubjects();
          const response = await step(ctx, () => pending.denialReady);
          validObservation(ctx, response);
          assert.equal(response.status, status);
          await ctx.flushCallbacks();
          privateEmpty(session);
          pending.release();
          await step(ctx, () => session.settle());
          privateEmpty(session);
        }),
      );
    }
  }
}
async function historyCase(ctx: AccountCaseContext) {
  const validator = createAccountValidator(ctx.root);
  for (const name of ACCOUNT_HISTORY_CASES) {
    const fixture = await step(ctx, () => ctx.historyFixture(name));
    assert.equal(
      fixture.status,
      name === 'invalid-current' ? 500 : 200,
      `Incorrect expected source status: ${name}`,
    );
    const result = await step(ctx, () =>
      ctx.read(fixture.actor, accountPath, { page: '1', pageSize: '20' }),
    );
    validObservation(ctx, result);
    assert.equal(result.status, fixture.status, name);
    if (fixture.status === 200) {
      assert.ok(fixture.expected, `Missing independent oracle: ${name}`);
      sameJson(
        summaries(validator.account(result.body)),
        summaries(fixture.expected),
      );
    }
  }
}
async function racesCase(ctx: AccountCaseContext) {
  for (const actor of ['teacher', 'unscoped', 'mixed', 'parent']) {
    for (const path of [accountPath, subjectsPath]) {
      const response = await step(ctx, () => ctx.read(actor, path));
      validObservation(ctx, response);
      assert.equal(response.status, 403);
    }
  }
  for (const path of [accountPath, subjectsPath]) {
    const response = await step(ctx, () =>
      ctx.read('owner', path, { campusId: 'not-owned-caller-scope' }),
    );
    validObservation(ctx, response);
    assert.equal(response.status, 400);
  }
  const crossCampus = await step(ctx, () =>
    ctx.read('owner', accountPath, {
      subjectId: ctx.oracle.otherCampusSubjectId,
    }),
  );
  validObservation(ctx, crossCampus);
  assert.equal(crossCampus.status, 404);
  for (const actor of ['return-revocation', 'student-move'] as const) {
    await runAccountScope(async (resources) => {
      ctx.checkpoint();
      const held = ctx.holdBeforeReturn(actor);
      resources.register('held-read', () => held.closeAndDrain());
      await step(ctx, () => held.entered);
      await step(ctx, () =>
        ctx.mutateOwned(
          actor === 'return-revocation'
            ? 'revoke-before-return'
            : 'move-student-before-return',
        ),
      );
      held.release();
      const result = await step(ctx, () => held.response);
      validObservation(ctx, result);
      assert.equal(result.status, actor === 'return-revocation' ? 401 : 404);
    });
  }
}
async function cleanupCase(ctx: AccountCaseContext) {
  const cleanupStep = async <T>(operation: () => Promise<T>): Promise<T> => {
    ctx.cleanupCheckpoint();
    const result = await operation();
    ctx.cleanupCheckpoint();
    return result;
  };
  assert.equal(
    await cleanupStep(() => ctx.resolveOwnership()),
    'OWNED',
    'E01 fixture ownership unresolved',
  );
  assert.ok(ctx.oracle.manifestActorIds.length, 'Missing manifest accounts');
  assert.equal(
    new Set(ctx.oracle.manifestActorIds).size,
    ctx.oracle.manifestActorIds.length,
  );
  const failures: unknown[] = [];
  try {
    await cleanupStep(() =>
      ctx.disableOwnedAccounts(ctx.oracle.manifestActorIds),
    );
  } catch (error) {
    failures.push(error);
  }
  for (const credential of ctx.oracle.credentials) {
    try {
      assert.ok(
        ctx.oracle.manifestActorIds.includes(credential.userId),
        'Unowned issued account',
      );
      const response = await cleanupStep(() => ctx.probeCredential(credential));
      validObservation(ctx, response);
      assert.equal(response.status, 401, `${credential.kind} credential`);
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    const states = await cleanupStep(() => ctx.accountStates());
    sameJson(
      states.map((row) => row.id).sort(),
      [...ctx.oracle.manifestActorIds].sort(),
    );
    assert.ok(states.every((row) => row.status === 'DISABLED'));
  } catch (error) {
    failures.push(error);
  }
  try {
    reconcileAccountFacts(
      ctx.oracle.baseline,
      await cleanupStep(() => ctx.snapshot()),
      ctx.oracle.allowed,
    );
  } catch (error) {
    failures.push(error);
  }
  if (failures.length)
    throw new AggregateError(failures, 'E01 cleanup evidence incomplete');
}

export const ACCOUNT_CASES = {
  summaries: summaryCase,
  'directory-filters': directoryCase,
  'errors-retry': errorsCase,
  history: historyCase,
  'scope-races': racesCase,
  cleanup: cleanupCase,
} as const;
export async function runAccountCase(
  name: keyof typeof ACCOUNT_CASES,
  ctx: AccountCaseContext,
) {
  const check = () =>
    name === 'cleanup' ? ctx.cleanupCheckpoint() : ctx.checkpoint();
  check();
  await ACCOUNT_CASES[name](ctx);
  check();
  return { name, provenance: ctx.provenance, liveAcceptance: false as const };
}
