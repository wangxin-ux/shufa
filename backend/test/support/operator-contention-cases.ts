import { deepStrictEqual, strictEqual, ok } from "node:assert";
import type { OperatorSeriesPatternDto } from "../../src/modules/operator/dto/operator-lesson-series.dto";
import type {
  CaseContext as OriginalContext,
  Call,
  WireResponse,
} from "./operator-series-cases";
import {
  fixtureKey,
  recoverOwned,
  type Fixture,
} from "./operator-contention-fixture";
import {
  observation,
  tagged,
  resourceLock,
  rowLock,
} from "./operator-contention-witness";
export type { Call, WireResponse } from "./operator-series-cases";
export interface CaseContext extends Omit<OriginalContext, "fixture" | "mark"> {
  fixture: Fixture;
  mark(name: string, details?: unknown): void;
}
interface Session {
  id: string;
  version: number;
  startsAt: string;
  endsAt: string;
}
interface Preview {
  previewHash: string;
  sessions: Array<{ date: string; startsAt: string; endsAt: string }>;
  conflictDates: string[];
}
interface Created {
  seriesId: string;
  sessions: Session[];
}
interface Spec {
  id: string;
  family: "create" | "deactivate" | "cancel" | "same-key";
  resource?: "class" | "teacher";
  rival: string;
  first: "a" | "b";
}
const specs: Spec[] = [];
function add(spec: Omit<Spec, "id">) {
  specs.push({ id: `c${String(specs.length + 1).padStart(2, "0")}`, ...spec });
}
for (const resource of ["class", "teacher"] as const)
  for (const rival of ["series", "single"])
    for (const first of ["a", "b"] as const)
      add({ family: "create", resource, rival, first });
for (const resource of ["class", "teacher"] as const)
  for (const first of ["a", "b"] as const)
    add({ family: "deactivate", resource, rival: "state-sql", first });
for (const rival of [
  "attendance-draft",
  "member-add",
  "member-remove",
  "parent-leave",
])
  for (const first of ["a", "b"] as const)
    add({ family: "cancel", rival, first });
for (const rival of ["create", "cancel"])
  for (const first of ["a", "b"] as const)
    add({ family: "same-key", rival, first });
export const MATRIX = specs;
const name = (spec: Spec) =>
  `${spec.id}-${spec.family}-${spec.resource ? spec.resource + "-" : ""}${spec.rival}-${spec.first}-first`;
export const CASES = [
  ...specs.map(name),
  "credential-retirement",
  "original-facts-preserved",
];
const series = "/operators/me/lesson-series";
const lesson = "/operators/me/lesson-sessions";
const data = <T>(response: WireResponse): T => {
  strictEqual(response.status, 200, JSON.stringify(response.body));
  return (response.body as { data: T }).data;
};
const patternFor = (
  c: CaseContext,
  spec: Spec,
  classGroupId = c.fixture.classA,
): OperatorSeriesPatternDto => {
  const day = new Date(Date.UTC(2048, 0, 1 + Number(spec.id.slice(1)) * 21));
  const end = new Date(day.getTime() + 7 * 86_400_000);
  ok(
    day.getTime() > Date.now() + 3 * 86_400_000,
    "future fixture horizon exhausted",
  );
  return {
    classGroupId,
    startDate: day.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    intervalWeeks: 1,
    weekdays: [((day.getUTCDay() + 6) % 7) + 1],
    startTime: "10:00",
    endTime: "11:00",
    kind: "REGULAR",
  };
};
async function preview(c: CaseContext, pattern: OperatorSeriesPatternDto) {
  const result = data<Preview>(
    await c.call("POST", `${series}/preview`, pattern),
  );
  strictEqual(result.sessions.length, 2);
  deepStrictEqual(result.conflictDates, []);
  return result;
}
async function create(c: CaseContext, spec: Spec) {
  const pattern = patternFor(c, spec);
  const shown = await preview(c, pattern);
  const made = data<Created>(
    await c.call(
      "POST",
      series,
      { ...pattern, previewHash: shown.previewHash },
      c.tokens.operator,
      fixtureKey(c.fixture, `${spec.id}-setup`),
    ),
  );
  deepStrictEqual(
    made.sessions.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
    shown.sessions.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
  );
  await recoverOwned(c.p, c.fixture);
  return made;
}
async function cancelCommand(c: CaseContext, made: Created) {
  const path = `${lesson}/${made.sessions[0].id}/cancel-selection`;
  const shown = data<{ previewHash: string; sessions: Session[] }>(
    await c.call(
      "POST",
      `${lesson}/${made.sessions[0].id}/cancellation-preview`,
      { mode: "FOLLOWING" },
    ),
  );
  const actual = await c.p.lessonSession.findMany({
    where: { seriesId: made.seriesId },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
  deepStrictEqual(
    shown.sessions,
    actual.map((r) => ({
      id: r.id,
      version: r.version,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
    })),
  );
  ok(
    actual.every(
      (r) => r.status === "SCHEDULED" && r.startsAt.getTime() > Date.now(),
    ),
  );
  return {
    path,
    body: { mode: "FOLLOWING", previewHash: shown.previewHash },
    shown,
  };
}
async function bounded<T>(pending: Promise<T>, timeout: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Error(`F02 contention: ${label} drain unconfirmed`)),
          timeout,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
type Match = ReturnType<typeof rowLock>;
async function race(
  spec: Spec,
  actionA: () => Promise<WireResponse>,
  actionB: () => Promise<WireResponse>,
  matcherA: Match,
  matcherB: Match,
) {
  const observer = observation();
  const tags = [`${spec.id}-a`, `${spec.id}-b`];
  const first = spec.first === "a" ? 0 : 1;
  const actors = [
    observer.register(tags[0], first === 0 ? matcherA : undefined),
    observer.register(tags[1], first === 1 ? matcherB : undefined),
  ];
  const actions = [actionA, actionB];
  const pending: Array<Promise<WireResponse> | undefined> = [];
  try {
    pending[first] = observer.track(tagged(tags[first], actions[first]));
    void pending[first]!.catch(() => undefined);
    const acquired = await actors[first].gate!.wait();
    pending[1 - first] = observer.track(
      tagged(tags[1 - first], actions[1 - first]),
    );
    void pending[1 - first]!.catch(() => undefined);
    const wait = await observer.witness(tags[first], tags[1 - first]);
    observer.release(tags[first]);
    const responses = await bounded(
      Promise.all(pending as Promise<WireResponse>[]),
      35000,
      spec.id,
    );
    return { responses, acquired, wait };
  } finally {
    for (const tag of tags) observer.release(tag);
    await bounded(
      Promise.allSettled(pending.filter(Boolean) as Promise<WireResponse>[]),
      35000,
      spec.id,
    );
  }
}
async function unchangedLedgers(c: CaseContext) {
  const f = c.fixture;
  const ledger = await c.p.lessonLedgerEntry.findMany({
    where: { campusId: f.campusId },
  });
  strictEqual(
    ledger.length,
    2,
    "only the two declared initial issuance grants may exist",
  );
  for (const expected of f.expected.LessonLedgerEntry) {
    const actual = ledger.find((row) => row.id === expected.id);
    ok(actual);
    for (const [key, value] of Object.entries(expected))
      strictEqual(
        (actual as unknown as Record<string, unknown>)[key],
        value,
        `initial grant ${key}`,
      );
  }
  const packages = await c.p.coursePackage.findMany({
    where: { campusId: f.campusId },
  });
  strictEqual(packages.length, 1);
  strictEqual(packages[0].giftBalanceUnits, 200);
  strictEqual(packages[0].mainBalanceUnits, 100);
  strictEqual(packages[0].version, 1);
  for (const delegate of [
    c.p.teachingRecord,
    c.p.teacherEarningBasis,
    c.p.teacherEarningEntry,
    c.p.partnerEarningBasis,
    c.p.partnerEarningEntry,
  ]) {
    strictEqual(
      await (delegate as { count(args: unknown): Promise<number> }).count({
        where: { campusId: f.campusId },
      }),
      0,
      "draft/member/leave/cancel contention must not create teaching or earnings facts",
    );
  }
}
async function creationRace(c: CaseContext, spec: Spec) {
  const a = patternFor(c, spec);
  const b = {
    ...a,
    classGroupId:
      spec.resource === "teacher" ? c.fixture.classB : c.fixture.classA,
    kind: "MAKEUP" as const,
  };
  const shownA = await preview(c, a);
  const shownB = await preview(c, b);
  const commandA = { ...a, previewHash: shownA.previewHash };
  const commandB =
    spec.rival === "series"
      ? { ...b, previewHash: shownB.previewHash }
      : {
          classGroupId: b.classGroupId,
          startsAt: shownB.sessions[0].startsAt,
          endsAt: shownB.sessions[0].endsAt,
          kind: b.kind,
        };
  const routeB = spec.rival === "series" ? series : lesson;
  const baseSessions = await c.p.lessonSession.count({
    where: { campusId: c.fixture.campusId },
  });
  const baseSeries = await c.p.lessonSeries.count({
    where: { campusId: c.fixture.campusId },
  });
  const lock = resourceLock(
    spec.resource!,
    spec.resource === "class" ? c.fixture.classA : c.fixture.teacher,
  );
  const result = await race(
    spec,
    () =>
      c.call(
        "POST",
        series,
        commandA,
        c.tokens.operator,
        fixtureKey(c.fixture, `${spec.id}-a`),
      ),
    () =>
      c.call(
        "POST",
        routeB,
        commandB,
        c.tokens.operator,
        fixtureKey(c.fixture, `${spec.id}-b`),
      ),
    lock,
    lock,
  );
  const first = spec.first === "a" ? 0 : 1;
  strictEqual(result.responses[first].status, 200);
  strictEqual(result.responses[1 - first].status, 409);
  const winningSeries = first === 0 || spec.rival === "series";
  const winning = data<Created & Session>(result.responses[first]);
  const ids = winningSeries ? winning.sessions.map((r) => r.id) : [winning.id];
  const exactTimes = winningSeries
    ? (first === 0 ? shownA : shownB).sessions
    : shownB.sessions.slice(0, 1);
  const rows = await c.p.lessonSession.findMany({
    where: {
      campusId: c.fixture.campusId,
      startsAt: {
        gte: new Date(shownA.sessions[0].startsAt),
        lte: new Date(shownA.sessions.at(-1)!.startsAt),
      },
    },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
  deepStrictEqual(rows.map((r) => r.id).sort(), [...ids].sort());
  deepStrictEqual(
    rows.map((r) => ({
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
    })),
    exactTimes.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
  );
  strictEqual(
    await c.p.lessonSession.count({ where: { campusId: c.fixture.campusId } }),
    baseSessions + ids.length,
  );
  strictEqual(
    await c.p.lessonSeries.count({ where: { campusId: c.fixture.campusId } }),
    baseSeries + Number(winningSeries),
  );
  const loser = fixtureKey(c.fixture, `${spec.id}-${first === 0 ? "b" : "a"}`);
  strictEqual(
    await c.p.idempotencyRecord.count({ where: { key: loser } }),
    0,
    "loser must have no partial transaction",
  );
  await recoverOwned(c.p, c.fixture);
  c.mark(name(spec), {
    winner: spec.first,
    exactSessionIds: ids,
    originalCommands: [commandA, commandB],
    wait: result.wait,
  });
}
async function deactivate(c: CaseContext, spec: Spec) {
  const observer = observation();
  const pattern = patternFor(c, spec);
  const shown = await preview(c, pattern);
  const baseline = await c.p.lessonSession.count({
    where: { campusId: c.fixture.campusId },
  });
  const controlAction = async (): Promise<WireResponse> => {
    observer.assertMutation();
    const tag = `${spec.id}-b`,
      client = observer.control(tag);
    let committed = false;
    try {
      await client.connect();
      await client.query("BEGIN");
      const identity = (
        await client.query<{ pid: number; xid: string }>(
          "SELECT pg_backend_pid()::int AS pid,txid_current()::text AS xid",
        )
      ).rows[0];
      observer.bindControl(tag, identity.pid, identity.xid);
      if (spec.resource === "teacher") {
        await client.query(
          'SELECT "id" FROM "User" WHERE "id"=$1::uuid FOR UPDATE',
          [c.fixture.teacherUser],
        );
        const updated = await client.query(
          'UPDATE "TeacherProfile" SET "isActive"=false,"updatedAt"=clock_timestamp() WHERE "id"=$1::uuid AND "campusId"=$2::uuid RETURNING "id"',
          [c.fixture.teacher, c.fixture.campusId],
        );
        strictEqual(updated.rowCount, 1);
      } else {
        const updated = await client.query(
          `UPDATE "ClassGroup" SET "status"='ARCHIVED',"updatedAt"=clock_timestamp() WHERE "id"=$1::uuid AND "campusId"=$2::uuid RETURNING "id"`,
          [c.fixture.classA, c.fixture.campusId],
        );
        strictEqual(updated.rowCount, 1);
      }
      if (spec.first === "b") {
        const actor = observer.participant(tag);
        await actor.gate!.acquired({
          pid: identity.pid,
          xid: identity.xid,
          tag: observer.application(tag),
          sql:
            spec.resource === "teacher"
              ? "owned User FOR UPDATE; TeacherProfile isActive=false"
              : "owned ClassGroup UPDATE ARCHIVED",
        });
      }
      await client.query("COMMIT");
      committed = true;
      return { status: 200, body: { data: { committed: true } } };
    } finally {
      if (!committed) await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
      observer.controlClosed(client);
    }
  };
  try {
    const result = await race(
      spec,
      () =>
        c.call(
          "POST",
          series,
          { ...pattern, previewHash: shown.previewHash },
          c.tokens.operator,
          fixtureKey(c.fixture, `${spec.id}-a`),
        ),
      controlAction,
      rowLock("ClassGroup", "SHARE"),
      () => false,
    );
    strictEqual(result.responses[1].status, 200);
    strictEqual(result.responses[0].status, spec.first === "a" ? 200 : 404);
    strictEqual(
      await c.p.lessonSession.count({
        where: { campusId: c.fixture.campusId },
      }),
      baseline + (spec.first === "a" ? shown.sessions.length : 0),
    );
    if (spec.first === "b")
      strictEqual(
        await c.p.idempotencyRecord.count({
          where: { key: fixtureKey(c.fixture, `${spec.id}-a`) },
        }),
        0,
      );
    await recoverOwned(c.p, c.fixture);
    c.mark(name(spec), {
      first: spec.first,
      creationStatus: result.responses[0].status,
      mutation:
        "exact fresh fixture state SQL, not staff-management HTTP authorization acceptance",
      wait: result.wait,
    });
  } finally {
    observer.assertMutation(true);
    await c.p.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout='2500ms'");
        if (spec.resource === "teacher")
          await tx.teacherProfile.update({
            where: { id: c.fixture.teacher },
            data: { isActive: true },
          });
        else
          await tx.classGroup.update({
            where: { id: c.fixture.classA },
            data: { status: "ACTIVE" },
          });
      },
      { timeout: 5000, maxWait: 3000 },
    );
  }
}
export function assertCancellationResponses(
  spec: Spec,
  responses: WireResponse[],
  version: number,
) {
  const membership = spec.rival.startsWith("member-");
  const expected =
    spec.first === "a"
      ? [200, spec.rival === "parent-leave" ? 403 : 409]
      : [membership ? 409 : 200, 200];
  deepStrictEqual(
    responses.map((row) => row.status),
    expected,
  );
  if (expected[0] !== 200)
    strictEqual((responses[0].body as { code: string }).code, "CONFLICT");
  if (expected[1] !== 200) {
    const failure = responses[1].body as {
      code: string;
      details: { currentVersion?: number };
    };
    strictEqual(
      failure.code,
      spec.rival === "parent-leave"
        ? "FORBIDDEN"
        : membership
          ? "LESSON_VERSION_CONFLICT"
          : "CONFLICT",
    );
    if (membership) strictEqual(failure.details.currentVersion, version + 1);
  }
  return expected;
}
async function cancellationRace(c: CaseContext, spec: Spec) {
  const made = await create(c, spec);
  const selected = made.sessions[0];
  if (spec.rival === "member-remove") {
    data(
      await c.call(
        "POST",
        `${lesson}/${selected.id}/members`,
        { studentId: c.fixture.temporaryStudent, version: selected.version },
        c.tokens.operator,
        fixtureKey(c.fixture, `${spec.id}-member`),
      ),
    );
    await recoverOwned(c.p, c.fixture);
  }
  const cancel = await cancelCommand(c, made);
  const version = cancel.shown.sessions[0].version;
  const rivalPath =
    spec.rival === "attendance-draft"
      ? `/teachers/me/lesson-sessions/${selected.id}/attendance`
      : spec.rival === "parent-leave"
        ? "/parents/me/leave-requests"
        : spec.rival === "member-remove"
          ? `${lesson}/${selected.id}/members/${c.fixture.temporaryStudent}/remove`
          : `${lesson}/${selected.id}/members`;
  const rivalBody =
    spec.rival === "attendance-draft"
      ? {
          lessonVersion: version,
          attendance: [{ studentId: c.fixture.student, status: "PRESENT" }],
        }
      : spec.rival === "parent-leave"
        ? {
            studentId: c.fixture.student,
            lessonSessionId: selected.id,
            reason: `F02 contention ${spec.id}`,
          }
        : spec.rival === "member-remove"
          ? { version }
          : { version, studentId: c.fixture.temporaryStudent };
  const rivalToken =
    spec.rival === "attendance-draft"
      ? c.tokens.teacher
      : spec.rival === "parent-leave"
        ? c.tokens.parent
        : c.tokens.operator;
  const result = await race(
    spec,
    () =>
      c.call(
        "POST",
        cancel.path,
        cancel.body,
        c.tokens.operator,
        fixtureKey(c.fixture, `${spec.id}-a`),
      ),
    () =>
      c.call(
        spec.rival === "attendance-draft" ? "PUT" : "POST",
        rivalPath,
        rivalBody,
        rivalToken,
        fixtureKey(c.fixture, `${spec.id}-b`),
      ),
    rowLock("LessonSession", "UPDATE"),
    rowLock("LessonSession", "UPDATE"),
  );
  const membership = spec.rival.startsWith("member-");
  const expected = assertCancellationResponses(spec, result.responses, version);
  const rows = await c.p.lessonSession.findMany({
    where: { seriesId: made.seriesId },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
  const cancelled = expected[0] === 200;
  for (const row of rows) {
    const original = cancel.shown.sessions.find((r) => r.id === row.id)!;
    strictEqual(row.status, cancelled ? "CANCELLED" : "SCHEDULED");
    strictEqual(
      row.version,
      original.version +
        Number(
          cancelled ||
            (membership && spec.first === "b" && row.id === selected.id),
        ),
    );
  }
  if (cancelled)
    deepStrictEqual(
      data<{ sessions: Session[] }>(result.responses[0]).sessions.map(
        (r) => r.id,
      ),
      cancel.shown.sessions.map((r) => r.id),
    );
  const draft = await c.p.attendanceRecord.findMany({
    where: { lessonSessionId: selected.id },
  });
  strictEqual(
    draft.length,
    Number(spec.rival === "attendance-draft" && spec.first === "b"),
  );
  const members = data<{
    status: string;
    canChange: boolean;
    members: Array<{ studentId: string; source: string; canRemove: boolean }>;
  }>(await c.call("GET", `${lesson}/${selected.id}/members`));
  strictEqual(members.status, cancelled ? "CANCELLED" : "SCHEDULED");
  strictEqual(members.canChange, !cancelled);
  const activeTemporary = members.members.find(
    (r) => r.studentId === c.fixture.temporaryStudent,
  );
  const shouldHaveTemporary =
    (spec.rival === "member-add" && spec.first === "b") ||
    (spec.rival === "member-remove" && spec.first === "a");
  strictEqual(Boolean(activeTemporary), shouldHaveTemporary);
  if (activeTemporary) {
    strictEqual(activeTemporary.source, "TEMPORARY");
    strictEqual(activeTemporary.canRemove, !cancelled);
  }
  const leaves = await c.p.parentLeaveRequest.findMany({
    where: { lessonSessionId: selected.id },
  });
  strictEqual(
    leaves.length,
    Number(spec.rival === "parent-leave" && spec.first === "b"),
  );
  const visible = data<{
    lessons: Array<{ id: string }>;
    records: Array<{ id: string; status: string }>;
  }>(
    await c.call(
      "GET",
      `/parents/me/leave?studentId=${c.fixture.student}`,
      undefined,
      c.tokens.parent,
    ),
  );
  if (cancelled)
    for (const row of rows)
      strictEqual(
        visible.lessons.some((r) => r.id === row.id),
        false,
      );
  for (const leave of leaves) {
    strictEqual(leave.status, "PENDING");
    strictEqual(
      visible.records.find((r) => r.id === leave.id)?.status,
      "PENDING",
    );
  }
  await recoverOwned(c.p, c.fixture);
  await unchangedLedgers(c);
  c.mark(name(spec), {
    expectedStatuses: expected,
    selectedId: selected.id,
    exactAffectedIds: cancel.shown.sessions.map((r) => r.id),
    originalCommands: [cancel.body, rivalBody],
    wait: result.wait,
    draftCount: draft.length,
    pendingLeaves: leaves.length,
    activeTemporary: shouldHaveTemporary,
  });
}
async function sameKey(c: CaseContext, spec: Spec) {
  const key = fixtureKey(c.fixture, `${spec.id}-a`);
  let path: string, body: unknown, expectedCount: number;
  const before = await c.p.lessonSession.count({
    where: { campusId: c.fixture.campusId },
  });
  if (spec.rival === "create") {
    const pattern = patternFor(c, spec),
      shown = await preview(c, pattern);
    path = series;
    body = { ...pattern, previewHash: shown.previewHash };
    expectedCount = shown.sessions.length;
  } else {
    const made = await create(c, spec),
      cancel = await cancelCommand(c, made);
    path = cancel.path;
    body = cancel.body;
    expectedCount = made.sessions.length;
  }
  const original = JSON.stringify({ path, body, key });
  const matcher =
    spec.rival === "create"
      ? resourceLock("class", c.fixture.classA)
      : rowLock("LessonSession", "UPDATE");
  const result = await race(
    spec,
    () => c.call("POST", path, body, c.tokens.operator, key),
    () => c.call("POST", path, body, c.tokens.operator, key),
    matcher,
    matcher,
  );
  strictEqual(JSON.stringify({ path, body, key }), original);
  const first = spec.first === "a" ? 0 : 1,
    second = result.responses[1 - first];
  const winning = data<Created>(result.responses[first]);
  if (second.status === 200) deepStrictEqual(data(second), winning);
  else {
    strictEqual(second.status, 409);
    strictEqual((second.body as { code: string }).code, "IDEMPOTENCY_CONFLICT");
    ok(
      /still being processed/.test(
        (second.body as { message: string }).message,
      ),
    );
  }
  strictEqual(
    await c.p.idempotencyRecord.count({
      where: { key, route: path, status: "COMPLETED" },
    }),
    1,
  );
  strictEqual(
    await c.p.lessonSession.count({ where: { campusId: c.fixture.campusId } }),
    before + expectedCount,
  );
  const originalCommand = c.fixture.commands.find(
    (x) => x.key === key && x.path === path,
  )!;
  strictEqual(JSON.stringify(originalCommand.body), JSON.stringify(body));
  const affected = winning.sessions;
  strictEqual(affected.length, expectedCount);
  strictEqual(
    await c.p.lessonSession.count({
      where: {
        id: { in: affected.map((r) => r.id) },
        status: spec.rival === "cancel" ? "CANCELLED" : "SCHEDULED",
      },
    }),
    expectedCount,
  );
  await recoverOwned(c.p, c.fixture);
  c.mark(name(spec), {
    originalKey: key,
    originalPayload: body,
    responseStatuses: result.responses.map((r) => r.status),
    exactAffectedIds: affected.map((r) => r.id),
    wait: result.wait,
  });
}
export async function runSeriesCases(c: CaseContext) {
  for (const spec of specs) {
    observation().assertMutation();
    if (spec.family === "create") await creationRace(c, spec);
    else if (spec.family === "deactivate") await deactivate(c, spec);
    else if (spec.family === "cancel") await cancellationRace(c, spec);
    else await sameKey(c, spec);
    await unchangedLedgers(c);
  }
  await recoverOwned(c.p, c.fixture);
}
