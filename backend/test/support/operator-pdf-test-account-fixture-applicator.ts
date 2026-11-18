import type { Prisma } from '@prisma/client';
import type { AccountFixturePlan } from './operator-pdf-test-account-fixture-builder';
import {
  accountFixtureId,
  accountFixtureOrder,
  accountJson,
  accountClone,
  type AdapterRecord,
  type AdapterRow,
} from './operator-pdf-test-account-adapter-schema';
import { isAccountMemoryPrisma } from './operator-pdf-test-account-memory-prisma';
import { accountLiveAdmission } from './operator-pdf-test-account-window';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { DomainError } from '../../src/common/errors/domain-error';
import { ErrorCode } from '../../src/common/errors/error-codes';
import {
  issueAccountSessions,
  runAccountScope,
  type AccountSessionRegistry,
} from './operator-pdf-test-account-support';

function matchesCapturedTriggerFact(
  actual: AdapterRow | null,
  captured: AdapterRow,
) {
  if (
    !actual ||
    typeof actual.id !== 'bigint' ||
    actual.id <= 0n ||
    !(actual.recordedAt instanceof Date) ||
    !Number.isFinite(actual.recordedAt.getTime()) ||
    typeof captured.id !== 'string' ||
    typeof captured.recordedAt !== 'string'
  )
    return false;
  // Only these two fields cross applyAccountFixture's explicit audit JSON boundary.
  return isDeepStrictEqual(
    {
      ...actual,
      id: actual.id.toString(),
      recordedAt: actual.recordedAt.toISOString(),
    },
    captured,
  );
}

function requireOfflineClient(client: AccountAdapterClient) {
  if (!isAccountMemoryPrisma(client))
    accountLiveAdmission(process.env, resolve(__dirname, '../../..'));
}

export interface AccountAdapterDelegate {
  create(args: { data: AdapterRow }): Promise<AdapterRow>;
  findMany(args?: AdapterRow): Promise<AdapterRow[]>;
  findUnique(args: AdapterRow): Promise<AdapterRow | null>;
  findFirst(args: AdapterRow): Promise<AdapterRow | null>;
  updateMany(args: AdapterRow): Promise<{ count: number }>;
  count(args?: AdapterRow): Promise<number>;
}
export interface AccountAdapterClient {
  $transaction<T>(
    operation: (tx: AccountAdapterClient) => Promise<T>,
    options: {
      isolationLevel: 'Serializable' | 'RepeatableRead' | 'ReadCommitted';
      timeout: number;
    },
  ): Promise<T>;
}
export function accountDelegate(
  client: AccountAdapterClient,
  table: string,
): AccountAdapterDelegate {
  const name = table[0].toLowerCase() + table.slice(1);
  const delegate = (
    client as unknown as Record<string, AccountAdapterDelegate>
  )[name];
  if (!delegate) throw new Error(`Missing Prisma delegate ${table}`);
  return delegate;
}
export interface AccountApplicableFixture {
  windowId: string;
  executionId: string;
  syntheticNow: Date;
  records: readonly AdapterRecord[];
  accounts: AccountFixturePlan['accounts'];
  actors: AccountFixturePlan['actors'];
}

export async function withAccountMixedIdentity<T>(
  client: AccountAdapterClient,
  plan: AccountApplicableFixture & Pick<AccountFixturePlan, 'races'>,
  operation: () => Promise<T>,
  checkpoint: () => void,
  cleanupCheckpoint: () => void,
) {
  requireOfflineClient(client);
  const changes = plan.races.filter((row) => row.kind === 'mixed-role-identity');
  const change = changes[0];
  const source = plan.records.find(
    (row) => row.table === 'UserRole' && row.data.id === change?.id,
  );
  if (
    changes.length !== 1 ||
    change.table !== 'UserRole' ||
    change.field !== 'userId' ||
    change.expectedStatus !== 401 ||
    !source ||
    source.data.userId !== change.before ||
    source.data.roleCode !== 'TEACHER' ||
    change.before !== plan.actors.teacher.userId ||
    change.after !== plan.actors.mixed.userId ||
    change.before === change.after
  )
    throw new Error('Exact owned mixed-role transition required');
  const before = source.data;
  const after = { ...before, userId: change.after };
  const roleWhere = (row: AdapterRow) => ({
    id: row.id,
    userId: row.userId,
    roleCode: row.roleCode,
    campusId: row.campusId,
  });
  let attempted = false;
  return runAccountScope(async (resources) => {
    resources.register('restore-mixed-role', async () => {
      if (!attempted) return;
      cleanupCheckpoint();
      await client.$transaction(
        async (tx) => {
          cleanupCheckpoint();
          const roles = accountDelegate(tx, 'UserRole');
          const current = await roles.findUnique({ where: { id: before.id } });
          if (!isDeepStrictEqual(current, before)) {
            if (!isDeepStrictEqual(current, after))
              throw new Error('Mixed-role restoration ownership changed');
            const restored = await roles.updateMany({
              where: roleWhere(after),
              data: { userId: change.before },
            });
            if (restored.count !== 1)
              throw new Error('Mixed-role restoration count changed');
          }
          if ((await recoverAccountFixture(tx, plan)).state !== 'OWNED')
            throw new Error('Mixed-role restored fixture unresolved');
          cleanupCheckpoint();
        },
        { isolationLevel: 'Serializable', timeout: 15000 },
      );
      cleanupCheckpoint();
    });
    checkpoint();
    await client.$transaction(
      async (tx) => {
        checkpoint();
        if ((await recoverAccountFixture(tx, plan)).state !== 'OWNED')
          throw new Error('Mixed-role fixture ownership unresolved');
        const roles = accountDelegate(tx, 'UserRole');
        const current = await roles.findUnique({ where: { id: before.id } });
        if (!isDeepStrictEqual(current, before))
          throw new Error('Mixed-role source row changed');
        attempted = true;
        const changed = await roles.updateMany({
          where: roleWhere(before),
          data: { userId: change.after },
        });
        if (changed.count !== 1)
          throw new Error('Mixed-role transition count changed');
        checkpoint();
      },
      { isolationLevel: 'Serializable', timeout: 15000 },
    );
    checkpoint();
    return operation();
  });
}

export async function expectAccountAuthRefusal(
  userId: string,
  issue: Parameters<typeof issueAccountSessions>[1],
  registry: AccountSessionRegistry,
  checkpoint: () => void,
) {
  const issued = registry.issued.length;
  try {
    await issueAccountSessions([userId], issue, registry, checkpoint);
  } catch (error) {
    if (
      error instanceof DomainError &&
      error.statusCode === 401 &&
      error.code === ErrorCode.UNAUTHORIZED &&
      registry.issued.length === issued
    )
      return {
        userId,
        status: 401 as const,
        code: ErrorCode.UNAUTHORIZED,
        issuedCredentials: 0 as const,
      };
    throw error;
  }
  throw new Error('Malformed mixed-role identity unexpectedly received a session');
}

export async function applyAccountFixture(
  client: AccountAdapterClient,
  plan: AccountApplicableFixture,
  dmmf: Prisma.DMMF.Datamodel,
  checkpoint: () => void,
) {
  requireOfflineClient(client);
  const order = accountFixtureOrder(plan.records, dmmf);
  const manifestId = accountFixtureId(
    plan.windowId,
    plan.executionId,
    'manifest',
  );
  const actors = plan.accounts.map((account) => account.userId);
  const actorRows = plan.records
    .filter((row) => row.table === 'User')
    .map((row) => row.data.id);
  if (
    new Set(actors).size !== actors.length ||
    accountJson([...actors].sort()) !== accountJson(actorRows.sort())
  )
    throw new Error('Manifest actor set differs from fixture users');
  const capture = async (tx: AccountAdapterClient) => {
    const students = plan.records.filter((row) => row.table === 'Student');
    const facts = await accountDelegate(
      tx,
      'PartnerRankingStudentFact',
    ).findMany({
      where: { studentId: { in: students.map((row) => row.data.id) } },
      orderBy: { id: 'asc' },
    });
    if (
      facts.length !== students.length ||
      new Set(facts.map((fact) => String(fact.id))).size !== facts.length ||
      students.some(
        (student) =>
          facts.filter((fact) => fact.studentId === student.data.id).length !==
          1,
      ) ||
      facts.some(
        (fact) =>
          typeof fact.id !== 'bigint' ||
          fact.id <= 0n ||
          !(fact.recordedAt instanceof Date) ||
          !Number.isFinite(fact.recordedAt.getTime()) ||
          !students.some(
            (row) =>
              row.data.id === fact.studentId &&
              row.data.campusId === fact.campusId &&
              row.data.isActive === fact.isActive,
          ),
      )
    )
      throw new Error('Unowned or missing initial trigger facts');
    const ledger = await accountDelegate(tx, 'LessonLedgerEntry').findMany({
      where: {
        id: {
          in: plan.records
            .filter((row) => row.table === 'LessonLedgerEntry')
            .map((row) => row.data.id),
        },
      },
      select: { id: true, subjectId: true, subjectName: true },
      orderBy: { id: 'asc' },
    });
    const expected = plan.records.filter(
      (row) => row.table === 'LessonLedgerEntry',
    );
    if (
      ledger.length !== expected.length ||
      ledger.some(
        (row) =>
          !expected.some(
            (item) =>
              item.data.id === row.id &&
              item.data.subjectId === row.subjectId &&
              item.data.subjectName === row.subjectName,
          ),
      )
    )
      throw new Error('Actual ledger subject snapshots differ from fixture');
    return { triggerFacts: facts, subjectSnapshots: ledger };
  };
  checkpoint();
  const captured = await client.$transaction(
    async (tx) => {
      checkpoint();
      if (
        await accountDelegate(tx, 'AuditLog').findUnique({
          where: { id: manifestId },
        })
      )
        throw new Error('Fixture execution already manifested');
      for (const row of order) {
        checkpoint();
        await accountDelegate(tx, row.table).create({
          data: accountClone(row.data),
        });
        checkpoint();
      }
      const result = await capture(tx);
      checkpoint();
      const owned = [
        ...order.map((row) => ({ table: row.table, id: String(row.data.id) })),
        ...result.triggerFacts.map((row) => ({
          table: 'PartnerRankingStudentFact',
          id: String(row.id),
        })),
        { table: 'AuditLog', id: manifestId },
      ];
      await accountDelegate(tx, 'AuditLog').create({
        data: {
          id: manifestId,
          campusId: null,
          actorUserId: null,
          action: 'E01_FIXTURE_MANIFEST',
          resourceType: 'E01_FIXTURE',
          resourceId: plan.executionId,
          outcome: 'SUCCESS',
          details: JSON.parse(
            accountJson({
              windowId: plan.windowId,
              executionId: plan.executionId,
              actors,
              owned,
              triggerFacts: result.triggerFacts,
              subjectSnapshots: result.subjectSnapshots,
            }),
          ) as Prisma.InputJsonObject,
          createdAt: plan.syntheticNow,
        },
      });
      checkpoint();
      return { ...result, owned };
    },
    { isolationLevel: 'Serializable', timeout: 30000 },
  );
  // No cancellation checkpoint here: a committed manifest must remain observable.
  return {
    manifestId,
    actors,
    ...captured,
    async resolve(): Promise<'OWNED' | 'UNRESOLVED'> {
      return (await recoverAccountFixture(client, plan)).state === 'OWNED'
        ? 'OWNED'
        : 'UNRESOLVED';
    },
  };
}

export async function recoverAccountFixture(
  client: AccountAdapterClient,
  plan: AccountApplicableFixture,
) {
  requireOfflineClient(client);
  const id = accountFixtureId(plan.windowId, plan.executionId, 'manifest');
  const manifest = await accountDelegate(client, 'AuditLog').findUnique({
    where: { id },
  });
  const users = await accountDelegate(client, 'User').findMany({
    where: { id: { in: plan.accounts.map((account) => account.userId) } },
  });
  if (!manifest && !users.length) return { state: 'ABSENT' as const };
  const details = manifest?.details as
    | {
        windowId?: string;
        executionId?: string;
        actors?: string[];
        owned?: Array<{ table: string; id: string }>;
        triggerFacts?: AdapterRow[];
        subjectSnapshots?: AdapterRow[];
      }
    | undefined;
  const actors = plan.accounts.map((account) => account.userId);
  if (
    manifest?.action !== 'E01_FIXTURE_MANIFEST' ||
    manifest.resourceType !== 'E01_FIXTURE' ||
    manifest.outcome !== 'SUCCESS' ||
    manifest.actorUserId !== null ||
    manifest.campusId !== null ||
    manifest.resourceId !== plan.executionId ||
    details?.windowId !== plan.windowId ||
    details.executionId !== plan.executionId ||
    !isDeepStrictEqual(details?.actors, actors) ||
    users.length !== actors.length ||
    !details?.owned ||
    !details.triggerFacts ||
    !details.subjectSnapshots
  )
    return { state: 'UNRESOLVED' as const };
  const expected = [
    ...plan.records.map((row) => ({
      table: row.table,
      id: String(row.data.id),
    })),
    ...details.triggerFacts.map((row) => ({
      table: 'PartnerRankingStudentFact',
      id: String(row.id),
    })),
    { table: 'AuditLog', id },
  ];
  const sort = (rows: Array<{ table: string; id: string }>) =>
    [...rows].sort((a, b) =>
      `${a.table}:${a.id}`.localeCompare(`${b.table}:${b.id}`),
    );
  if (!isDeepStrictEqual(sort(expected), sort(details.owned)))
    return { state: 'UNRESOLVED' as const };
  const students = plan.records.filter((row) => row.table === 'Student');
  if (
    details.triggerFacts.length !== students.length ||
    new Set(details.triggerFacts.map((fact) => String(fact.id))).size !==
      students.length ||
    students.some(
      (student) =>
        details.triggerFacts!.filter(
          (fact) => fact.studentId === student.data.id,
        ).length !== 1,
    ) ||
    details.triggerFacts.some(
      (fact) =>
        !students.some(
          (row) =>
            row.data.id === fact.studentId &&
            row.data.campusId === fact.campusId &&
            row.data.isActive === fact.isActive,
        ) ||
        !/^[1-9][0-9]*$/.test(String(fact.id)) ||
        !Number.isFinite(Date.parse(String(fact.recordedAt))),
    )
  )
    return { state: 'UNRESOLVED' as const };
  const subjectSnapshots = plan.records
    .filter((row) => row.table === 'LessonLedgerEntry')
    .map((row) => ({
      id: row.data.id,
      subjectId: row.data.subjectId,
      subjectName: row.data.subjectName,
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!isDeepStrictEqual(details.subjectSnapshots, subjectSnapshots))
    return { state: 'UNRESOLVED' as const };
  const movementId = accountFixtureId(
    plan.windowId,
    plan.executionId,
    'student-move',
  );
  const movement = await accountDelegate(client, 'AuditLog').findUnique({
    where: { id: movementId },
  });
  const movementDetails = movement?.details as
    | {
        windowId?: string;
        executionId?: string;
        studentId?: string;
        campusId?: string;
        triggerFact?: AdapterRow;
      }
    | undefined;
  let moved: string | undefined;
  if (movement) {
    const fact = movementDetails?.triggerFact;
    const target = students.find(
      (row) => row.data.id === movementDetails?.studentId,
    );
    const campus = plan.records.find(
      (row) =>
        row.table === 'Campus' && row.data.id === movementDetails?.campusId,
    );
    if (
      movement.action !== 'E01_FIXTURE_STUDENT_MOVE' ||
      movement.actorUserId !== plan.actors['student-move'].userId ||
      movement.resourceType !== 'E01_FIXTURE' ||
      movement.outcome !== 'SUCCESS' ||
      movement.campusId !== null ||
      !(movement.createdAt instanceof Date) ||
      !Number.isFinite(movement.createdAt.getTime()) ||
      movement.createdAt.getTime() !== plan.syntheticNow.getTime() ||
      movement.resourceId !== plan.executionId ||
      movementDetails?.windowId !== plan.windowId ||
      movementDetails.executionId !== plan.executionId ||
      !target ||
      !campus ||
      target.data.campusId === campus.data.id ||
      !fact ||
      fact.studentId !== target.data.id ||
      fact.campusId !== campus.data.id ||
      fact.isActive !== target.data.isActive ||
      !/^[1-9][0-9]*$/.test(String(fact.id)) ||
      !Number.isFinite(Date.parse(String(fact.recordedAt))) ||
      details.triggerFacts.some(
        (original) => String(original.id) === String(fact.id),
      )
    )
      return { state: 'UNRESOLVED' as const };
    const actual = await accountDelegate(
      client,
      'PartnerRankingStudentFact',
    ).findUnique({ where: { id: BigInt(String(fact.id)) } });
    if (!matchesCapturedTriggerFact(actual, fact))
      return { state: 'UNRESOLVED' as const };
    moved = movementDetails.studentId;
  }
  for (const record of plan.records) {
    const actual = await accountDelegate(client, record.table).findUnique({
      where: { id: record.data.id },
    });
    if (
      !actual ||
      Object.entries(record.data).some(([name, value]) => {
        if (record.table === 'User' && name === 'status')
          return actual.status !== 'ACTIVE' && actual.status !== 'DISABLED';
        if (
          record.table === 'Student' &&
          name === 'campusId' &&
          record.data.id === moved
        )
          return actual.campusId !== movementDetails?.campusId;
        return !isDeepStrictEqual(actual[name], value);
      })
    )
      return { state: 'UNRESOLVED' as const };
  }
  for (const fact of details.triggerFacts) {
    const actual = await accountDelegate(
      client,
      'PartnerRankingStudentFact',
    ).findUnique({ where: { id: BigInt(String(fact.id)) } });
    if (!matchesCapturedTriggerFact(actual, fact))
      return { state: 'UNRESOLVED' as const };
  }
  const allTriggerFacts = await accountDelegate(
    client,
    'PartnerRankingStudentFact',
  ).findMany({
    where: { studentId: { in: students.map((row) => row.data.id) } },
  });
  const knownTriggerIds = [
    ...details.triggerFacts.map((fact) => String(fact.id)),
    ...(movementDetails?.triggerFact
      ? [String(movementDetails.triggerFact.id)]
      : []),
  ];
  if (
    allTriggerFacts.length !== knownTriggerIds.length ||
    allTriggerFacts.some((fact) => !knownTriggerIds.includes(String(fact.id)))
  )
    return { state: 'UNRESOLVED' as const };
  for (const owned of details.owned) {
    const rows = await accountDelegate(client, owned.table).findMany({
      where: {
        id:
          owned.table === 'PartnerRankingStudentFact'
            ? BigInt(owned.id)
            : owned.id,
      },
    });
    if (rows.length !== 1) return { state: 'UNRESOLVED' as const };
  }
  for (const account of plan.accounts) {
    const roles = await accountDelegate(client, 'UserRole').findMany({
      where: { userId: account.userId },
      select: { roleCode: true, campusId: true },
      orderBy: { roleCode: 'asc' },
    });
    if (
      !isDeepStrictEqual(
        roles,
        [...account.roles].sort((a, b) => a.roleCode.localeCompare(b.roleCode)),
      )
    )
      return { state: 'UNRESOLVED' as const };
  }
  return {
    state: 'OWNED' as const,
    manifestId: id,
    actors,
    owned: [
      ...details.owned,
      ...(movement
        ? [
            { table: 'AuditLog', id: movementId },
            {
              table: 'PartnerRankingStudentFact',
              id: String(movementDetails!.triggerFact!.id),
            },
          ]
        : []),
    ],
  };
}
