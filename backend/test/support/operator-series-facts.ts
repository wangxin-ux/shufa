import type { Client } from "pg";
import { requireSeries } from "./operator-series-admission";

export interface Fact {
  table: string;
  key: string;
  raw: string;
  value: Record<string, unknown>;
}
export interface Ownership {
  run: string;
  campusId: string;
  actors: string[];
  ids: Record<string, string[]>;
  keys: string[];
}
export const keyOf = (value: Record<string, unknown>) => {
  if (typeof value.id === "string") return value.id;
  return JSON.stringify(value);
};
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
export async function snapshotFacts(client: Client): Promise<Fact[]> {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const tables = await client.query<{ name: string }>(
      "SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    );
    const facts: Fact[] = [];
    const catalog = await client.query<{
      relation: string;
      column: string;
      type: string;
      required: boolean;
      definition: string | null;
    }>(
      `SELECT c.relname AS relation,a.attname AS column,format_type(a.atttypid,a.atttypmod) AS type,
        a.attnotnull AS required,pg_get_expr(d.adbin,d.adrelid) AS definition
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
       LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
       WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname,a.attnum`,
    );
    const constraints = await client.query<{
      relation: string;
      name: string;
      definition: string;
    }>(
      `SELECT c.relname AS relation,k.conname AS name,pg_get_constraintdef(k.oid) AS definition
       FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' ORDER BY c.relname,k.conname`,
    );
    const triggers = await client.query<{
      relation: string;
      name: string;
      definition: string;
    }>(
      `SELECT c.relname AS relation,t.tgname AS name,pg_get_triggerdef(t.oid) AS definition
       FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' ORDER BY c.relname,t.tgname`,
    );
    facts.push({
      table: "#catalog",
      key: "public",
      value: { id: "public" },
      raw: JSON.stringify({
        tables: tables.rows,
        columns: catalog.rows,
        constraints: constraints.rows,
        triggers: triggers.rows,
      }),
    });
    for (const { name } of tables.rows) {
      const int8 = await client.query<{ name: string }>(
        "SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND data_type='bigint'",
        [name],
      );
      const integers = int8.rows.flatMap(({ name: column }) => [
        `'${column.replace(/'/g, "''")}'`,
        `t.${quote(column)}::text`,
      ]);
      const safe = integers.length
        ? `to_jsonb(t)||jsonb_build_object(${integers.join(",")})`
        : "to_jsonb(t)";
      const result = await client.query<{ raw: string; safe: string }>(
        `SELECT to_jsonb(t)::text AS raw,(${safe})::text AS safe FROM public.${quote(name)} t`,
      );
      const seen = new Set<string>();
      for (const row of result.rows) {
        const value = JSON.parse(row.safe) as Record<string, unknown>;
        const key = keyOf(value);
        requireSeries(!seen.has(key), `ambiguous original fact key: ${name}`);
        seen.add(key);
        facts.push({ table: name, key, raw: row.raw, value });
      }
    }
    await client.query("COMMIT");
    return facts.sort((a, b) =>
      `${a.table}:${a.key}`.localeCompare(`${b.table}:${b.key}`),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
export function classifyOwned(f: Fact, o: Ownership): boolean {
  const v = f.value;
  if (o.ids[f.table]?.includes(f.key)) return true;
  if (f.table === "AuditLog")
    return (
      v.actorUserId === o.actors[0] &&
      v.campusId === o.campusId &&
      typeof v.resourceId === "string" &&
      (o.ids[String(v.resourceType)] ?? []).includes(v.resourceId)
    );
  if (f.table === "IdempotencyRecord")
    return (
      v.actorUserId === o.actors[0] &&
      v.campusId === o.campusId &&
      o.keys.includes(String(v.key))
    );
  return false;
}
export function compareFacts(before: Fact[], after: Fact[], o: Ownership) {
  const key = (f: Fact) => `${f.table}:${f.key}`;
  const original = new Map(before.map((f) => [key(f), f.raw]));
  const final = new Map(after.map((f) => [key(f), f.raw]));
  for (const [id, raw] of original)
    requireSeries(
      final.get(id) === raw,
      `original fact changed or missing: ${id}`,
    );
  for (const f of after)
    requireSeries(
      original.has(key(f)) || classifyOwned(f, o),
      `unowned new fact: ${key(f)}`,
    );
  return after.filter((f) => !original.has(key(f)));
}
export function verifyStaticFacts(
  after: Fact[],
  expected: Record<string, Record<string, unknown>[]>,
) {
  let present = 0,
    total = 0;
  for (const [table, entries] of Object.entries(expected)) {
    for (const input of entries) {
      total++;
      const fact = after.find(
        (f) => f.table === table && f.key === String(input.id),
      );
      if (!fact) continue;
      present++;
      for (const [field, value] of Object.entries(input)) {
        const actual = fact.value[field];
        if (table === "User" && field === "status")
          requireSeries(actual === "DISABLED", "owned user not retired");
        else if (table === "User" && field === "accountVersion")
          requireSeries(
            actual === Number(value) + 1,
            "unexpected owned user version",
          );
        else if (value instanceof Date)
          requireSeries(
            typeof actual === "string" &&
              Date.parse(actual) === value.getTime(),
            `static fixture date changed: ${table}.${field}`,
          );
        else
          requireSeries(
            JSON.stringify(actual) === JSON.stringify(value),
            `static fixture topology changed: ${table}.${field}`,
          );
      }
    }
  }
  requireSeries(
    present === 0 || present === total,
    "incomplete atomic static fixture graph",
  );
}
export function verifySyntheticFacts(
  after: Fact[],
  sessions: Record<string, Record<string, unknown>>,
) {
  for (const [id, expected] of Object.entries(sessions)) {
    const fact = after.find((f) => f.table === "LessonSession" && f.key === id);
    requireSeries(fact, "owned synthetic lesson missing");
    for (const [field, value] of Object.entries(expected))
      requireSeries(
        value instanceof Date
          ? typeof fact.value[field] === "string" &&
              Date.parse(String(fact.value[field])) === value.getTime()
          : JSON.stringify(fact.value[field]) === JSON.stringify(value),
        `synthetic lesson state/topology changed: ${id}.${field}`,
      );
  }
}
export function verifyStudentFacts(
  after: Fact[],
  expectedStudents: Record<string, unknown>[],
) {
  for (const student of expectedStudents) {
    const exists = after.some(
      (f) => f.table === "Student" && f.key === student.id,
    );
    const facts = after.filter(
      (f) =>
        f.table === "PartnerRankingStudentFact" &&
        f.value.studentId === student.id,
    );
    requireSeries(
      facts.length === (exists ? 1 : 0) &&
        facts.every(
          (f) =>
            f.value.campusId === student.campusId &&
            f.value.isActive === true &&
            typeof f.value.recordedAt === "string" &&
            Number.isFinite(Date.parse(f.value.recordedAt)),
        ),
      "missing or unexpected Student INSERT trigger facts",
    );
  }
}
export async function verifyMigrations(
  client: Client,
  files: Array<{ path: string; sha256: string }>,
) {
  const expected = files
    .filter((f) =>
      /^backend\/prisma\/migrations\/[^/]+\/migration\.sql$/.test(f.path),
    )
    .map((f) => ({ name: f.path.split("/")[3], checksum: f.sha256 }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const result = await client.query<{
    migration_name: string;
    checksum: string;
    finished: boolean;
    rolled: boolean;
  }>(
    'SELECT migration_name,checksum,finished_at IS NOT NULL AS finished,rolled_back_at IS NOT NULL AS rolled FROM "_prisma_migrations" ORDER BY migration_name',
  );
  requireSeries(
    expected.length > 0 &&
      result.rows.length === expected.length &&
      expected.every((f, i) => {
        const row = result.rows[i];
        return (
          row.migration_name === f.name &&
          row.checksum === f.checksum &&
          row.finished &&
          !row.rolled
        );
      }),
    "migration/source checksum mismatch; coordinator reconciliation required; no executor or checksum repair",
  );
}
