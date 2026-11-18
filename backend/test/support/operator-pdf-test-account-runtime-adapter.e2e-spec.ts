import { Server, Socket } from 'node:net';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readAccountAdapterDmmf } from './operator-pdf-test-account-adapter-schema';
import { createAccountMemoryPrisma } from './operator-pdf-test-account-memory-prisma';
import { buildAccountFixture } from './operator-pdf-test-account-fixture-builder';
import { applyAccountFixture } from './operator-pdf-test-account-fixture-applicator';
import { startAccountRuntimeAdapter } from './operator-pdf-test-account-runtime-adapter';
import type { Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { createAccountNestModule } from './operator-pdf-test-account-host';
import {
  accountDelegate,
  recoverAccountFixture,
} from './operator-pdf-test-account-fixture-applicator';
import {
  accountFixtureId,
  accountJson,
} from './operator-pdf-test-account-adapter-schema';
import {
  buildAccountGraph,
  accountHistoryAdmission,
} from './operator-pdf-test-account-fixture-graphs';
import { reconcileAccountFacts } from './operator-pdf-test-account-support';

jest.setTimeout(60000);
async function closeWithDiagnostics(
  runtime: ReturnType<typeof startAccountRuntimeAdapter>,
) {
  try {
    await runtime.closeAndDrain();
  } catch (error) {
    const flatten = (item: unknown): string[] =>
      item instanceof AggregateError
        ? (item.errors as unknown[]).flatMap(flatten)
        : [item instanceof Error ? item.message : String(item)];
    throw new Error(flatten(error).join('\n'));
  }
}

let dmmf: Prisma.DMMF.Datamodel;
let listen: jest.SpyInstance;
let connect: jest.SpyInstance;
const input = {
  windowId: 'e0100000-1029-4000-8000-000000000011',
  executionId: 'e0100000-1029-4000-8000-000000000012',
  syntheticNow: new Date('2026-10-29T04:00:00.000Z'),
};
beforeAll(() => {
  listen = jest.spyOn(Server.prototype, 'listen').mockImplementation(() => {
    throw new Error('Offline adapter must never listen');
  });
  connect = jest.spyOn(Socket.prototype, 'connect').mockImplementation(() => {
    throw new Error('Offline adapter must never open TCP');
  });
  dmmf = readAccountAdapterDmmf();
});
afterAll(() => {
  expect(listen).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
  listen.mockRestore();
  connect.mockRestore();
});

it('applies the shuffled plan in FK order and commits facts and manifest together', async () => {
  const plan = buildAccountFixture(input, dmmf);
  plan.records.reverse();
  const memory = createAccountMemoryPrisma(dmmf, input.syntheticNow);
  const result = await applyAccountFixture(
    memory.client,
    plan,
    dmmf,
    () => undefined,
  );
  expect(result.actors).toHaveLength(12);
  expect(result.triggerFacts).toHaveLength(4);
  expect(result.subjectSnapshots).toHaveLength(
    plan.records.filter((row) => row.table === 'LessonLedgerEntry').length,
  );
  expect(await result.resolve()).toBe('OWNED');
  expect(memory.rows('AuditLog')).toHaveLength(1);
  expect(memory.trace.some((item) => item === 'commit:Serializable')).toBe(
    true,
  );
});

it('calls the actual account controller, guards, AuthService and saved Page without a socket', async () => {
  const runtime = startAccountRuntimeAdapter({ input, dmmf });
  try {
    await runtime.ready;
    await runtime.run('summaries');
    await runtime.run('directory-filters');
    expect(
      runtime
        .calls()
        .some((call) => call.path === '/me' && call.status === 200),
    ).toBe(true);
    expect(runtime.calls().some((call) => call.query.page === '2')).toBe(true);
  } finally {
    await runtime.closeAndDrain();
  }
  expect(runtime.state().closed).toBe(true);
  expect(runtime.state().cleanup.probes).toHaveLength(24);
  writeFileSync(
    resolve(
      __dirname,
      '../../../docs/verification/operator-independent-2026-10-27/e01-runtime-adapter-20261029',
      `call-evidence-${process.pid}.json`,
    ),
    accountJson({
      provenance: 'memory-provider',
      liveAcceptance: false,
      cases: ['summaries', 'directory-filters'],
      calls: runtime.calls().map((call) => ({
        path: call.path,
        query: call.query,
        status: call.status,
      })),
      accountResponse: runtime
        .calls()
        .find((call) => call.path.endsWith('/lesson-account'))?.responseBody,
      closeout: runtime.state(),
      providerTrace: runtime.memory.trace,
    }) + '\n',
    { flag: 'wx' },
  );
});

it.each(['User', 'AuditLog'])(
  'rolls back partial %s creation and all derived trigger facts',
  async (table) => {
    let users = 0;
    const memory = createAccountMemoryPrisma(dmmf, input.syntheticNow, {
      beforeCreate(name, data) {
        if (name === 'User') users++;
        if (name === table && (table !== 'User' || users === 3))
          throw new Error(`partial ${table}`);
        void data;
      },
    });
    const plan = buildAccountFixture(input, dmmf);
    const before = accountJson(memory.snapshot());
    await expect(
      applyAccountFixture(memory.client, plan, dmmf, () => undefined),
    ).rejects.toThrow(`partial ${table}`);
    expect(accountJson(memory.snapshot())).toBe(before);
    expect(await recoverAccountFixture(memory.client, plan)).toEqual({
      state: 'ABSENT',
    });
  },
);

it('rejects trigger snapshot disagreement and rolls back the whole fixture', async () => {
  const plan = buildAccountFixture(input, dmmf);
  const grant = plan.records.find((row) => row.key === 'grant-valid-MAIN')!;
  if (grant.table !== 'LessonLedgerEntry') throw new Error('Wrong fixture row');
  grant.data.subjectName = 'not-the-trigger-value';
  const memory = createAccountMemoryPrisma(dmmf, input.syntheticNow);
  await expect(
    applyAccountFixture(memory.client, plan, dmmf, () => undefined),
  ).rejects.toThrow('subject snapshots');
  expect(memory.rows('User')).toEqual([]);
  expect(memory.rows('PartnerRankingStudentFact')).toEqual([]);
});

it('recovers committed manifest when transaction acknowledgement fails, without applying twice', async () => {
  let failed = false;
  const memory = createAccountMemoryPrisma(dmmf, input.syntheticNow, {
    async afterCommit(level) {
      await Promise.resolve();
      if (level === 'Serializable' && !failed) {
        failed = true;
        throw new Error('commit acknowledgement lost');
      }
    },
  });
  const plan = buildAccountFixture(input, dmmf);
  await expect(
    applyAccountFixture(memory.client, plan, dmmf, () => undefined),
  ).rejects.toThrow('acknowledgement');
  expect((await recoverAccountFixture(memory.client, plan)).state).toBe(
    'OWNED',
  );
  await expect(
    applyAccountFixture(memory.client, plan, dmmf, () => undefined),
  ).rejects.toThrow('already manifested');
  expect(memory.rows('User')).toHaveLength(12);
});

it('runtime recovers lost commit acknowledgement and closes owned actors without issuing credentials', async () => {
  let first = true;
  const runtime = startAccountRuntimeAdapter({
    input,
    dmmf,
    faults: {
      async afterCommit(level) {
        await Promise.resolve();
        if (first && level === 'Serializable') {
          first = false;
          throw new Error('runtime acknowledgement lost');
        }
      },
    },
  });
  await expect(runtime.ready).rejects.toThrow('acknowledgement lost');
  await expect(runtime.closeAndDrain()).rejects.toBeInstanceOf(AggregateError);
  expect(runtime.state().issued).toEqual([]);
  expect(runtime.state().cleanup.ownership).toBe('OWNED');
  expect(runtime.state().cleanup.states).toHaveLength(12);
  expect(
    runtime.state().cleanup.states.every((row) => row.status === 'DISABLED'),
  ).toBe(true);
  expect(runtime.state().cleanup.factsVerified).toBe(true);
});

it('retains initialization and disconnect failures and reports the outstanding owner', async () => {
  const runtime = startAccountRuntimeAdapter({
    input,
    dmmf,
    faults: {
      async connect() {
        await Promise.resolve();
        throw new Error('connect acquisition failed');
      },
      async disconnect() {
        await Promise.resolve();
        throw new Error('disconnect release failed');
      },
    },
  });
  await expect(runtime.ready).rejects.toBeInstanceOf(AggregateError);
  let caught: unknown;
  try {
    await runtime.closeAndDrain();
  } catch (error) {
    caught = error;
  }
  const messages = ((caught as AggregateError).errors as Error[]).map(
    (error) => error.message,
  );
  expect(messages).toContain('connect acquisition failed');
  expect(messages).toContain('disconnect release failed');
  expect(runtime.state().closed).toBe(false);
  expect(runtime.state().host.outstanding).toContain('prisma');
});

it('drains an unfinished connect after cancellation and releases every acquired owner', async () => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const started = new Promise<void>((done) => {
    entered = done;
  });
  const runtime = startAccountRuntimeAdapter({
    input,
    dmmf,
    faults: {
      async connect() {
        entered();
        await gate;
      },
    },
  });
  await started;
  runtime.cancel(new Error('cancel during connect'));
  let settled = false;
  const closing = runtime
    .closeAndDrain()
    .catch((error) => error as Error)
    .finally(() => {
      settled = true;
    });
  await Promise.resolve();
  expect(settled).toBe(false);
  release();
  await expect(runtime.ready).rejects.toThrow('cancel during connect');
  expect(await closing).toBeInstanceOf(AggregateError);
  expect(
    runtime.memory.trace.filter((event) => event === 'disconnect'),
  ).toHaveLength(1);
  expect(runtime.state().cleanup.ownership).toBe('ABSENT');
});

it('retains compilation failure while closing a partly compiled real Nest module', async () => {
  let moduleClosed = 0;
  const runtime = startAccountRuntimeAdapter({
    input,
    dmmf,
    moduleFactory(client, settings) {
      const owner = createAccountNestModule(client, settings);
      return {
        ...owner,
        async compile() {
          await owner.compile();
          throw new Error('partial compile');
        },
        async close() {
          moduleClosed++;
          await owner.close();
        },
      };
    },
  });
  await expect(runtime.ready).rejects.toThrow('partial compile');
  await expect(runtime.closeAndDrain()).rejects.toBeInstanceOf(AggregateError);
  expect(moduleClosed).toBe(1);
  expect(runtime.memory.rows('User')).toEqual([]);
});

it('cleans every returned pair when a later AuthService Promise.all signature fails', async () => {
  let signatures = 0;
  const runtime = startAccountRuntimeAdapter({
    input,
    dmmf,
    moduleFactory(client, settings) {
      const owner = createAccountNestModule(client, settings);
      return {
        ...owner,
        async compile() {
          await owner.compile();
          const jwt = owner.get(JwtService);
          const original = jwt.signAsync.bind(jwt);
          jest
            .spyOn(jwt, 'signAsync')
            .mockImplementation((payload: object, options) => {
              signatures++;
              if (signatures === 3)
                return Promise.reject(
                  new Error('second actor access signing failed'),
                );
              return original(payload, options);
            });
        },
      };
    },
  });
  await expect(runtime.ready).rejects.toThrow('second actor');
  await expect(runtime.closeAndDrain()).rejects.toBeInstanceOf(AggregateError);
  expect(runtime.state().attemptedActors).toHaveLength(2);
  expect(runtime.state().issued).toHaveLength(2);
  expect(runtime.state().cleanup.probes).toHaveLength(2);
  expect(
    runtime.state().cleanup.probes.every((row) => row.status === 401),
  ).toBe(true);
  expect(
    runtime.state().cleanup.states.every((row) => row.status === 'DISABLED'),
  ).toBe(true);
  expect(signatures).toBe(4);
});

it('executes Page retry and all four late-success denial combinations', async () => {
  const runtime = startAccountRuntimeAdapter({ input, dmmf });
  try {
    await runtime.ready;
    await runtime.run('errors-retry');
  } finally {
    await runtime.closeAndDrain();
  }
  expect(runtime.state().cleanup.factsVerified).toBe(true);
});

it('calls the existing history group and keeps the two legal-scale cases explicitly blocked', async () => {
  const runtime = startAccountRuntimeAdapter({ input, dmmf });
  await runtime.ready;
  await expect(runtime.run('history')).rejects.toThrow(
    'invalid-current blocked',
  );
  await expect(runtime.closeAndDrain()).rejects.toBeInstanceOf(AggregateError);
  expect(runtime.state().cleanup.factsVerified).toBe(true);
});

it('rejects a non-memory Prisma provider before any live transaction can start', async () => {
  const transaction = jest.fn();
  const client = { $transaction: transaction };
  await expect(
    applyAccountFixture(
      client,
      buildAccountFixture(input, dmmf),
      dmmf,
      () => undefined,
    ),
  ).rejects.toThrow('unassigned');
  expect(transaction).not.toHaveBeenCalled();
});

it('refuses cleanup ownership when the persisted subject snapshot manifest is altered', async () => {
  const memory = createAccountMemoryPrisma(dmmf, input.syntheticNow);
  const plan = buildAccountFixture(input, dmmf);
  const applied = await applyAccountFixture(
    memory.client,
    plan,
    dmmf,
    () => undefined,
  );
  const manifest = memory.rows('AuditLog')[0];
  await accountDelegate(memory.client, 'AuditLog').updateMany({
    where: { id: applied.manifestId },
    data: {
      details: {
        ...(manifest.details as Record<string, unknown>),
        subjectSnapshots: [],
      },
    },
  });
  expect((await recoverAccountFixture(memory.client, plan)).state).toBe(
    'UNRESOLVED',
  );
});

it('does not claim an unexpected trigger fact by enumerating current rows', async () => {
  const runtime = startAccountRuntimeAdapter({ input, dmmf });
  await runtime.ready;
  const fact = runtime.memory.rows('PartnerRankingStudentFact')[0];
  await accountDelegate(
    runtime.memory.client,
    'PartnerRankingStudentFact',
  ).create({ data: { ...fact, id: 999999n } });
  await expect(runtime.closeAndDrain()).rejects.toBeInstanceOf(AggregateError);
  expect(runtime.state().cleanup.ownership).toBe('UNRESOLVED');
  expect(runtime.state().cleanup.factsVerified).toBe(false);
  expect(runtime.state().cleanup.failures).toContain(
    'E01 unowned addition: PartnerRankingStudentFact',
  );
});

it('rejects new business reads after cancellation while leaving cleanup admitted', async () => {
  const runtime = startAccountRuntimeAdapter({ input, dmmf });
  await runtime.ready;
  runtime.cancel(new Error('business stopped'));
  await expect(runtime.context().read('owner', '/me')).rejects.toThrow(
    'business stopped',
  );
  await runtime.closeAndDrain();
  expect(runtime.state().cleanup.probes).toHaveLength(24);
});

it('holds after repeatable-read commit and rechecks status and student ownership with fresh reads', async () => {
  const runtime = startAccountRuntimeAdapter({ input, dmmf });
  try {
    await runtime.ready;
    await runtime.run('scope-races');
    expect(runtime.memory.rows('PartnerRankingStudentFact')).toHaveLength(5);
  } finally {
    await runtime.closeAndDrain();
  }
  expect(runtime.calls().some((call) => call.status === 401)).toBe(true);
  expect(runtime.calls().some((call) => call.status === 404)).toBe(true);
  expect(
    runtime.memory.trace.filter((event) => event === 'commit:RepeatableRead')
      .length,
  ).toBeGreaterThan(0);
});

it('runs the saved cleanup case with the concrete full-table context', async () => {
  const runtime = startAccountRuntimeAdapter({ input, dmmf });
  try {
    await runtime.ready;
    await runtime.run('cleanup');
  } finally {
    await closeWithDiagnostics(runtime);
  }
  expect(runtime.state().cleanup.factsVerified).toBe(true);
});

it('continues all credential probes, exact states and fact comparison when disabling fails', async () => {
  const runtime = startAccountRuntimeAdapter({
    input,
    dmmf,
    faults: {
      beforeDisable() {
        throw new Error('disable failed');
      },
    },
  });
  await runtime.ready;
  await expect(runtime.closeAndDrain()).rejects.toBeInstanceOf(AggregateError);
  const result = runtime.state().cleanup;
  expect(result.probes).toHaveLength(24);
  expect(result.states).toHaveLength(12);
  expect(result.factsVerified).toBe(true);
  expect(
    result.probes
      .filter((row) => row.kind === 'access')
      .every((row) => row.status === 200),
  ).toBe(true);
  expect(result.failures).toContain('disable failed');
});

it('business cancellation keeps cleanup independent but failed lease admission forbids mutation', async () => {
  let lease = true;
  const runtime = startAccountRuntimeAdapter({
    input,
    dmmf,
    cleanupCheckpoint() {
      if (!lease) throw new Error('lease expired');
    },
  });
  await runtime.ready;
  runtime.cancel();
  lease = false;
  await expect(runtime.closeAndDrain()).rejects.toBeInstanceOf(AggregateError);
  expect(
    runtime.memory.rows('User').every((row) => row.status === 'ACTIVE'),
  ).toBe(true);
  expect(runtime.state().cleanup.probes).toEqual([]);
  expect(runtime.state().closed).toBe(true);
});

it('business cancellation alone still disables all owned actors and probes both credential kinds', async () => {
  const runtime = startAccountRuntimeAdapter({ input, dmmf });
  await runtime.ready;
  runtime.cancel();
  await runtime.closeAndDrain();
  expect(runtime.state().cleanup.probes).toHaveLength(24);
  expect(
    runtime.state().cleanup.states.every((row) => row.status === 'DISABLED'),
  ).toBe(true);
});

it.each([
  'expired',
  'inactive',
  'departed',
  'paid-unissued',
  'pending-refund',
  'approved-unpaid-refund',
  'executed-refund',
  'effective-correction',
  'invalid-historical',
] as const)(
  'reads independent %s graph through the actual account classes and checks the full oracle',
  async (graph) => {
    const runtime = startAccountRuntimeAdapter({
      input: {
        ...input,
        executionId: accountFixtureId(input.executionId, graph),
      },
      dmmf,
      graph,
    });
    try {
      await runtime.ready;
      await runtime.run('summaries');
    } finally {
      await closeWithDiagnostics(runtime);
    }
    expect(runtime.state().cleanup.factsVerified).toBe(true);
  },
);

it.each(['invalid-current', 'historical-overflow'])(
  'fails closed for unallocated legal-scale %s fixture',
  (name) => {
    expect(() => accountHistoryAdmission(name)).toThrow('legal Int/CHECK');
  },
);

it('includes APPROVED-without-payment and refund/correction events and audits in the same owned graph', () => {
  const base = buildAccountFixture(input, dmmf);
  const graph = buildAccountGraph(base, 'approved-unpaid-refund', dmmf);
  const refund = graph.records.find((row) => row.key === 'refund-reserved')!;
  expect(refund.data.status).toBe('APPROVED');
  expect(
    graph.records.some(
      (row) =>
        row.table === 'FinanceRefundPayment' &&
        row.data.refundId === refund.data.id,
    ),
  ).toBe(false);
  expect(
    graph.records.filter(
      (row) =>
        row.table === 'FinanceRefundEvent' &&
        row.data.refundId === refund.data.id,
    ),
  ).toHaveLength(2);
  expect(
    graph.records.some(
      (row) =>
        row.table === 'AuditLog' && row.data.resourceId === refund.data.id,
    ),
  ).toBe(true);
});

it('preserves old facts and rejects unknown additions and FK links to preexisting actors', async () => {
  const memory = createAccountMemoryPrisma(dmmf, input.syntheticNow);
  const old = {
    id: 'e0100000-1029-4000-8000-000000000099',
    displayName: 'Preexisting synthetic actor',
    status: 'ACTIVE',
    staffPhone: null,
    parentPhone: null,
    accountVersion: 1,
    createdAt: input.syntheticNow,
    updatedAt: input.syntheticNow,
  };
  await accountDelegate(memory.client, 'User').create({ data: old });
  const before = memory.snapshot();
  const plan = buildAccountFixture(input, dmmf);
  const result = await applyAccountFixture(
    memory.client,
    plan,
    dmmf,
    () => undefined,
  );
  const allowed: Record<string, string[]> = {};
  for (const row of result.owned) (allowed[row.table] ??= []).push(row.id);
  expect(
    reconcileAccountFacts(before, memory.snapshot(), allowed).preserved,
  ).toBe(1);
  await accountDelegate(memory.client, 'AuditLog').create({
    data: {
      id: accountFixtureId(input.executionId, 'unowned-audit'),
      campusId: null,
      actorUserId: old.id,
      action: 'UNKNOWN',
      resourceType: 'E01',
      resourceId: null,
      outcome: 'SUCCESS',
      details: {},
      createdAt: input.syntheticNow,
    },
  });
  expect(() =>
    reconcileAccountFacts(before, memory.snapshot(), allowed),
  ).toThrow('unowned addition');
  allowed.AuditLog.push(accountFixtureId(input.executionId, 'unowned-audit'));
  expect(() =>
    reconcileAccountFacts(before, memory.snapshot(), allowed),
  ).toThrow('FK ownership');
});
