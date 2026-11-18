import type { Prisma } from '@prisma/client';
import type { AccountHostClient } from './operator-pdf-test-account-host';
import type {
  AccountAdapterClient,
  AccountAdapterDelegate,
} from './operator-pdf-test-account-fixture-applicator';
import {
  accountJson,
  accountClone,
  type AdapterRow,
} from './operator-pdf-test-account-adapter-schema';

type Query = {
  where?: AdapterRow;
  select?: Record<string, boolean | Query>;
  orderBy?: Record<string, string> | Record<string, string>[];
  skip?: number;
  take?: number;
};
type Store = Record<string, AdapterRow[]>;
const offlineClients = new WeakSet<object>();
export const isAccountMemoryPrisma = (client: object) =>
  offlineClients.has(client);
export interface AccountMemoryFaults {
  beforeCreate?: (table: string, row: AdapterRow) => void;
  beforeDisable?: () => void;
  connect?: () => Promise<void>;
  disconnect?: () => Promise<void>;
  afterCommit?: (level: string) => Promise<void>;
}
export function createAccountMemoryPrisma(
  dmmf: Prisma.DMMF.Datamodel,
  now: Date,
  faults: AccountMemoryFaults = {},
) {
  let store: Store = Object.fromEntries(
    dmmf.models.map((model) => [model.name, []]),
  );
  let sequence = 0n;
  const trace: string[] = [];
  const delegateName = (name: string) => name[0].toLowerCase() + name.slice(1);
  function relation(rows: Store, table: string, row: AdapterRow, name: string) {
    const field = dmmf.models
      .find((model) => model.name === table)!
      .fields.find((field) => field.name === name);
    if (!field || field.kind !== 'object') return undefined;
    const from = field.relationFromFields!;
    if (from.length) {
      if (from.some((key) => row[key] === null)) return { field, rows: [] };
      return {
        field,
        rows: rows[field.type].filter((target) =>
          from.every(
            (key, index) => row[key] === target[field.relationToFields![index]],
          ),
        ),
      };
    }
    const other = dmmf.models
      .find((model) => model.name === field.type)!
      .fields.find(
        (other) =>
          other.relationName === field.relationName &&
          other.relationFromFields?.length,
      );
    if (!other) throw new Error(`Unsupported relation ${table}.${name}`);
    return {
      field,
      rows: rows[field.type].filter((target) =>
        other.relationFromFields!.every(
          (key, index) => target[key] === row[other.relationToFields![index]],
        ),
      ),
    };
  }
  function matches(
    rows: Store,
    table: string,
    row: AdapterRow,
    where: AdapterRow = {},
  ): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (key === 'OR' || key === 'AND') {
        const parts = (Array.isArray(value) ? value : [value]) as AdapterRow[];
        return key === 'OR'
          ? parts.some((part) => matches(rows, table, row, part))
          : parts.every((part) => matches(rows, table, row, part));
      }
      const rel = relation(rows, table, row, key);
      if (rel) {
        if (value === null) return rel.rows.length === 0;
        return rel.rows.some((target) =>
          matches(rows, rel.field.type, target, value as AdapterRow),
        );
      }
      if (
        value !== null &&
        typeof value === 'object' &&
        !(value instanceof Date)
      ) {
        const condition = value as AdapterRow;
        return Object.entries(condition).every(([operator, operand]) => {
          const actual = row[key];
          if (operator === 'in') return (operand as unknown[]).includes(actual);
          if (operator === 'lte')
            return (actual as number) <= (operand as number);
          if (operator === 'gte')
            return (actual as number) >= (operand as number);
          if (operator === 'contains')
            return String(actual)
              .toLowerCase()
              .includes(String(operand).toLowerCase());
          if (operator === 'mode') return operand === 'insensitive';
          throw new Error(`Unsupported memory predicate ${operator}`);
        });
      }
      return row[key] === value;
    });
  }
  function select(
    rows: Store,
    table: string,
    source: AdapterRow[],
    query: Query = {},
  ): AdapterRow[] {
    let result = source.filter((row) => matches(rows, table, row, query.where));
    const orders = query.orderBy
      ? Array.isArray(query.orderBy)
        ? query.orderBy
        : [query.orderBy]
      : [];
    result = [...result]
      .sort((a, b) => {
        for (const order of orders)
          for (const [key, direction] of Object.entries(order)) {
            const left = a[key] as string,
              right = b[key] as string;
            if (left < right) return direction === 'desc' ? 1 : -1;
            if (left > right) return direction === 'desc' ? -1 : 1;
          }
        return 0;
      })
      .slice(
        query.skip ?? 0,
        query.take === undefined ? undefined : (query.skip ?? 0) + query.take,
      );
    return result.map((row) => {
      if (!query.select) return accountClone(row);
      return Object.fromEntries(
        Object.entries(query.select)
          .filter(([, enabled]) => enabled)
          .map(([name, spec]) => {
            const rel = relation(rows, table, row, name);
            if (!rel) return [name, accountClone(row[name])];
            const related = select(
              rows,
              rel.field.type,
              rel.rows,
              typeof spec === 'boolean' ? {} : spec,
            );
            return [name, rel.field.isList ? related : (related[0] ?? null)];
          }),
      );
    });
  }
  function check(
    rows: Store,
    table: string,
    row: AdapterRow,
    old?: AdapterRow,
  ) {
    const model = dmmf.models.find((model) => model.name === table)!;
    for (const field of model.fields) {
      const value = row[field.name];
      if (
        field.kind !== 'object' &&
        field.isRequired &&
        (value === null || value === undefined)
      )
        throw new Error(`Required ${table}.${field.name}`);
      if (
        field.type === 'Int' &&
        value !== null &&
        value !== undefined &&
        (typeof value !== 'number' ||
          !Number.isInteger(value) ||
          value < -2147483648 ||
          value > 2147483647)
      )
        throw new Error(`Int bounds ${table}.${field.name}`);
      if (
        field.relationFromFields?.length &&
        !field.relationFromFields.some((key) => row[key] === null) &&
        !rows[field.type].some((target) =>
          field.relationFromFields!.every(
            (key, index) => row[key] === target[field.relationToFields![index]],
          ),
        )
      )
        throw new Error(`Foreign key ${table}.${field.name}`);
    }
    const unique = [
      ...model.fields
        .filter((field) => field.isId || field.isUnique)
        .map((field) => [field.name]),
      ...model.uniqueFields,
    ];
    if (
      unique.some(
        (fields) =>
          fields.every((key) => row[key] !== null) &&
          rows[table].some(
            (other) =>
              other !== old &&
              fields.every(
                (key) => accountJson(other[key]) === accountJson(row[key]),
              ),
          ),
      )
    )
      throw new Error(`Unique ${table}`);
    if (
      table === 'CoursePackage' &&
      (Number(row.mainBalanceUnits) < Number(row.mainReservedUnits) ||
        Number(row.giftBalanceUnits) < Number(row.giftReservedUnits) ||
        [
          'mainBalanceUnits',
          'giftBalanceUnits',
          'mainReservedUnits',
          'giftReservedUnits',
        ].some((key) => Number(row[key]) < 0))
    )
      throw new Error('CoursePackage balance CHECK');
    if (
      table === 'LessonLedgerEntry' &&
      (Number(row.balanceBeforeUnits) < 0 ||
        Number(row.balanceAfterUnits) < 0 ||
        Number(row.balanceBeforeUnits) + Number(row.deltaUnits) !==
          row.balanceAfterUnits)
    )
      throw new Error('LessonLedgerEntry arithmetic CHECK');
  }
  function studentFact(rows: Store, student: AdapterRow) {
    rows.PartnerRankingStudentFact.push({
      id: ++sequence,
      studentId: student.id,
      campusId: student.campusId,
      isActive: student.isActive,
      recordedAt: new Date(now),
    });
  }
  function makeClient(
    getStore: () => Store,
  ): AccountAdapterClient & AccountHostClient {
    const methods: Record<string, unknown> = {
      async $connect() {
        trace.push('connect');
        await faults.connect?.();
      },
      async $disconnect() {
        trace.push('disconnect');
        await faults.disconnect?.();
      },
      $queryRawUnsafe() {
        return Promise.resolve([
          { replicationRole: 'origin', searchPath: 'public' },
        ]);
      },
      $queryRaw(
        sql:
          | { strings?: readonly string[]; values?: readonly unknown[] }
          | TemplateStringsArray,
        ...values: unknown[]
      ) {
        const text = Array.isArray(sql)
          ? sql.join('')
          : (sql as { strings: readonly string[] }).strings.join('');
        if (text.includes('FOR UPDATE') || text.includes('FOR SHARE')) {
          trace.push('memory-lock-only');
          return Promise.resolve([]);
        }
        if (!text.includes('SUM(l."deltaUnits")'))
          throw new Error('Unexpected raw query');
        const campusId = (
          Array.isArray(sql)
            ? values
            : (sql as { values: readonly unknown[] }).values
        )[0];
        const groups = new Map<
          string,
          {
            entryType: unknown;
            bucket: unknown;
            delta: bigint;
            invalidCount: bigint;
          }
        >();
        const current = getStore();
        for (const row of current.LessonLedgerEntry.filter(
          (row) => row.campusId === campusId,
        )) {
          const key = `${String(row.entryType)}:${String(row.bucket)}`;
          const group = groups.get(key) ?? {
            entryType: row.entryType,
            bucket: row.bucket,
            delta: 0n,
            invalidCount: 0n,
          };
          const pack = current.CoursePackage.find(
            (pack) => pack.id === row.coursePackageId,
          );
          const validDirection = ['GRANT', 'REVERSAL'].includes(
            String(row.entryType),
          )
            ? Number(row.deltaUnits) > 0
            : ['CONSUME', 'REFUND', 'CORRECTION'].includes(
                  String(row.entryType),
                )
              ? Number(row.deltaUnits) < 0
              : true;
          if (
            !pack ||
            pack.campusId !== row.campusId ||
            pack.studentId !== row.studentId ||
            Number(row.balanceBeforeUnits) < 0 ||
            Number(row.balanceAfterUnits) < 0 ||
            Number(row.balanceBeforeUnits) + Number(row.deltaUnits) !==
              row.balanceAfterUnits ||
            !validDirection
          )
            group.invalidCount++;
          group.delta += BigInt(row.deltaUnits as number);
          groups.set(key, group);
        }
        return Promise.resolve([...groups.values()]);
      },
      async $transaction<T>(
        operation: (tx: AccountAdapterClient) => Promise<T>,
        options: { isolationLevel: string },
      ) {
        const draft = accountClone(getStore());
        trace.push(`begin:${options.isolationLevel}`);
        let changed = false;
        const tx = makeClient(() => draft) as unknown as Record<
          string,
          AccountAdapterDelegate
        >;
        for (const model of dmmf.models) {
          const delegate = tx[delegateName(model.name)];
          const create = delegate.create.bind(delegate),
            update = delegate.updateMany.bind(delegate);
          delegate.create = (args) => {
            changed = true;
            return create(args);
          };
          delegate.updateMany = (args) => {
            changed = true;
            return update(args);
          };
        }
        try {
          const result = await operation(tx as unknown as AccountAdapterClient);
          if (changed) store = draft;
          trace.push(`commit:${options.isolationLevel}`);
          await faults.afterCommit?.(options.isolationLevel);
          return result;
        } catch (error) {
          trace.push(`failure:${options.isolationLevel}`);
          throw error;
        }
      },
    };
    for (const model of dmmf.models) {
      const table = model.name;
      const delegate: AccountAdapterDelegate = {
        create({ data }) {
          faults.beforeCreate?.(table, data);
          const current = getStore(),
            row = accountClone(data);
          for (const field of model.fields.filter(
            (field) => field.kind !== 'object',
          )) {
            if (row[field.name] !== undefined) continue;
            if (
              field.isUpdatedAt ||
              (field.type === 'DateTime' && field.hasDefaultValue)
            )
              row[field.name] = new Date(now);
            else if (!field.isRequired) row[field.name] = null;
            else if (field.isList) row[field.name] = [];
            else if (field.hasDefaultValue && typeof field.default !== 'object')
              row[field.name] = field.default;
          }
          if (table === 'LessonLedgerEntry') {
            const source = row.reversalOfId
              ? current.LessonLedgerEntry.find(
                  (original) =>
                    original.id === row.reversalOfId &&
                    original.campusId === row.campusId &&
                    original.studentId === row.studentId &&
                    original.coursePackageId === row.coursePackageId,
                )
              : current.CoursePackage.find(
                  (pack) =>
                    pack.id === row.coursePackageId &&
                    pack.campusId === row.campusId &&
                    pack.studentId === row.studentId,
                );
            row.subjectId = source?.subjectId ?? null;
            row.subjectName = row.reversalOfId
              ? (source?.subjectName ?? null)
              : (current.CampusSubject.find(
                  (subject) => subject.id === row.subjectId,
                )?.name ?? null);
          }
          check(current, table, row);
          current[table].push(row);
          trace.push(`create:${table}`);
          if (table === 'Student') studentFact(current, row);
          return Promise.resolve(accountClone(row));
        },
        findMany(args) {
          return Promise.resolve(
            select(getStore(), table, getStore()[table], args as Query),
          );
        },
        findFirst(args) {
          return Promise.resolve(
            select(getStore(), table, getStore()[table], {
              ...args,
              take: 1,
            })[0] ?? null,
          );
        },
        findUnique(args) {
          return delegate.findFirst(args);
        },
        count(args) {
          return Promise.resolve(
            getStore()[table].filter((row) =>
              matches(getStore(), table, row, (args as Query)?.where),
            ).length,
          );
        },
        updateMany(args) {
          const current = getStore(),
            { where, data } = args as { where: AdapterRow; data: AdapterRow };
          if (table === 'User' && data.status === 'DISABLED')
            faults.beforeDisable?.();
          let count = 0;
          for (const row of current[table].filter((row) =>
            matches(current, table, row, where),
          )) {
            const next = { ...row, ...accountClone(data) };
            check(current, table, next, row);
            const moved =
              table === 'Student' &&
              (row.campusId !== next.campusId ||
                row.isActive !== next.isActive);
            Object.assign(row, next);
            if (moved) studentFact(current, row);
            count++;
          }
          return Promise.resolve({ count });
        },
      };
      methods[delegateName(table)] = delegate;
    }
    offlineClients.add(methods);
    return methods as unknown as AccountAdapterClient & AccountHostClient;
  }
  const client = makeClient(() => store);
  return {
    client,
    trace,
    rows: (table: string) => accountClone(store[table]),
    snapshot() {
      return {
        tables: JSON.parse(accountJson(store)) as Store,
        foreignKeys: dmmf.models.flatMap((model) =>
          model.fields
            .filter((field) => field.relationFromFields?.length)
            .map((field) => ({
              table: model.name,
              columns: [...field.relationFromFields!],
              targetTable: field.type,
              targetColumns: [...field.relationToFields!],
              nullable: field.relationFromFields!.map(
                (name) =>
                  !model.fields.find((item) => item.name === name)!.isRequired,
              ),
            })),
        ),
      };
    },
  };
}
