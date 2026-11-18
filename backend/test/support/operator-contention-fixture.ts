import { randomUUID } from "node:crypto";
import { deepStrictEqual, strictEqual, ok } from "node:assert";
import type { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import * as original from "./operator-series-fixture";
import type {
  AuditEvidenceReader,
  Fixture as OriginalFixture,
} from "./operator-series-fixture";
import { requireSeries } from "./operator-series-admission";

export { requestHash, auditEvidence } from "./operator-series-fixture";
interface SessionState {
  id: string;
  classGroupId: string;
  teacherId: string;
  seriesId: string | null;
  startsAt: string;
  endsAt: string;
  kind: string;
  version: number;
  status: string;
  lessonUnits: number;
}
interface Audit {
  actor: string;
  action: string;
  type: string;
  id: string;
  details: Record<string, unknown>;
}
interface Auxiliary {
  actor: string;
  method: string;
  path: string;
  body: Record<string, unknown>;
  key: string;
  hash: string;
  receipt?: unknown;
}
export interface Fixture extends OriginalFixture {
  temporaryStudent: string;
  finance: string;
  commandAllowlist: Record<string, string>;
  auxiliary: Auxiliary[];
  expectedSessions: Record<string, SessionState>;
  expectedAudits: Audit[];
  observedReceipts: string[];
}
export const fixtureKey = (f: Fixture, name: string) => {
  const key = f.commandAllowlist[name];
  requireSeries(key, `command not in initial UUID allowlist: ${name}`);
  return key;
};
export function makeFixture(run: string): Fixture {
  const base = original.makeFixture(run);
  const f: Fixture = {
    ...base,
    temporaryStudent: randomUUID(),
    finance: randomUUID(),
    commandAllowlist: {},
    auxiliary: [],
    expectedSessions: {},
    expectedAudits: [],
    observedReceipts: [],
  };
  for (let n = 1; n <= 24; n++)
    for (const suffix of ["a", "b", "setup", "member"])
      f.commandAllowlist[`c${String(n).padStart(2, "0")}-${suffix}`] =
        randomUUID();
  const add = (table: string, value: Record<string, unknown>) => {
    (f.expected[table] ??= []).push(value);
    (f.ids[table] ??= []).push(String(value.id));
  };
  add("Student", {
    id: f.temporaryStudent,
    campusId: f.campusId,
    displayName: `F02 contention temporary ${run.slice(-8)}`,
    isActive: true,
    profileVersion: 1,
  });
  f.actors.push(f.finance);
  add("User", {
    id: f.finance,
    displayName: `F02 FINANCE ${run.slice(-6)}`,
    status: "ACTIVE",
    accountVersion: 1,
  });
  add("UserRole", {
    id: randomUUID(),
    userId: f.finance,
    roleCode: "FINANCE",
    campusId: null,
  });
  const coursePackageId = randomUUID();
  const proofId = randomUUID(),
    receiptId = randomUUID();
  const validFrom = new Date("2026-01-01T00:00:00Z");
  const packageName = `F02 isolated source fixture ${run}`;
  // Metadata-only synthetic provenance, matching FinanceService.issue.
  // No object upload or finance HTTP acceptance is represented by this fixture.
  add("StoredFile", {
    id: proofId,
    purpose: "FINANCE_RECEIPT_PROOF",
    storageKey: `isolated/${run}/${proofId}`,
    originalName: "synthetic-proof.png",
    mimeType: "image/png",
    sizeBytes: 1,
    sha256: "0".repeat(64),
    createdByUserId: f.finance,
  });
  add("FinanceReceipt", {
    id: receiptId,
    campusId: f.campusId,
    studentId: f.temporaryStudent,
    amountFen: 100,
    receivedOn: validFrom,
    channel: "CASH",
    proofFileId: proofId,
    note: `Synthetic fixture only ${run}`,
    createdByUserId: f.finance,
  });
  add("CoursePackage", {
    id: coursePackageId,
    campusId: f.campusId,
    studentId: f.temporaryStudent,
    name: packageName,
    mainBalanceUnits: 100,
    giftBalanceUnits: 200,
    mainReservedUnits: 0,
    giftReservedUnits: 0,
    paidAmountFen: 100,
    version: 1,
    validFrom,
    expiresAt: null,
    isActive: true,
    sourceOrderId: null,
  });
  add("FinancePackageIssuance", {
    id: randomUUID(),
    receiptId,
    coursePackageId,
    originalAmountFen: 100,
    initialMainUnits: 100,
    initialGiftUnits: 200,
    name: packageName,
    validFrom,
    expiresAt: null,
    issuedByUserId: f.finance,
  });
  for (const [bucket, units] of [
    ["MAIN", 100],
    ["GIFT", 200],
  ] as const)
    add("LessonLedgerEntry", {
      id: randomUUID(),
      campusId: f.campusId,
      studentId: f.temporaryStudent,
      coursePackageId,
      lessonSessionId: null,
      entryType: "GRANT",
      bucket,
      deltaUnits: units,
      balanceBeforeUnits: 0,
      balanceAfterUnits: units,
      idempotencyKey: `finance-issue:${receiptId}:${bucket}`,
      actorUserId: f.finance,
      reason: `Synthetic finance receipt issuance ${receiptId}; fixture only`,
    });
  for (const [action, details] of [
    [
      "FINANCE_RECEIPT_CREATE",
      {
        amountFen: 100,
        receivedOn: "2026-01-01",
        studentId: f.temporaryStudent,
      },
    ],
    [
      "FINANCE_PACKAGE_ISSUE",
      {
        coursePackageId,
        mainUnits: 100,
        giftUnits: 200,
      },
    ],
  ] as const) {
    add("AuditLog", {
      id: randomUUID(),
      campusId: f.campusId,
      actorUserId: f.finance,
      action,
      resourceType: "FinanceReceipt",
      resourceId: receiptId,
      outcome: "SUCCESS",
      details,
    });
    audit(f, f.finance, action, "FinanceReceipt", receiptId, details);
  }
  return f;
}
export function fixtureFromPlan(raw: unknown, execution: string): Fixture {
  requireSeries(raw && typeof raw === "object", "frozen fixture plan required");
  const f = structuredClone(raw) as Fixture;
  requireSeries(
    f.run === execution && /^f02-[0-9a-f-]{36}$/.test(execution),
    "fixture execution mismatch",
  );
  requireSeries(
    f.commands.length === 0 &&
      f.auxiliary.length === 0 &&
      f.keys.length === 0 &&
      f.observedReceipts.length === 0 &&
      Object.keys(f.expectedSessions).length === 0 &&
      Object.keys(f.syntheticSessions).length === 0,
    "frozen fixture plan must be fresh and unused",
  );
  const ids = Object.values(f.ids).flat();
  const keys = Object.values(f.commandAllowlist);
  requireSeries(
    ids.length > 0 &&
      keys.length === 96 &&
      new Set([...ids, ...keys]).size === ids.length + keys.length &&
      [...ids, ...keys].every((id) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          id,
        ),
      ),
    "fresh fixture and command UUID allowlists required",
  );
  for (const [table, rows] of Object.entries(f.expected))
    deepStrictEqual(
      rows.map((row) => String(row.id)).sort(),
      [...f.ids[table]].sort(),
    );
  const dates: Record<string, string[]> = {
    ClassMember: ["joinedAt"],
    CoursePackage: ["validFrom"],
    FinanceReceipt: ["receivedOn"],
    FinancePackageIssuance: ["validFrom"],
  };
  for (const [table, fields] of Object.entries(dates))
    for (const row of f.expected[table])
      for (const field of fields) {
        const date = new Date(String(row[field]));
        requireSeries(
          Number.isFinite(date.getTime()),
          "invalid frozen fixture date",
        );
        row[field] = date;
      }
  requireSeries(
    f.actors.length === 5 &&
      f.actors[0] === f.operator &&
      f.actors.includes(f.finance) &&
      new Set(f.actors).size === 5,
    "fixture actor allowlist",
  );
  return f;
}
export async function applyFixture(p: PrismaService, f: Fixture) {
  const delegates = [
    ["Campus", "campus"],
    ["User", "user"],
    ["UserRole", "userRole"],
    ["TeacherProfile", "teacherProfile"],
    ["CampusSubject", "campusSubject"],
    ["Student", "student"],
    ["ClassGroup", "classGroup"],
    ["ClassMember", "classMember"],
    ["ParentStudentBinding", "parentStudentBinding"],
    ["CoursePackage", "coursePackage"],
    ["StoredFile", "storedFile"],
    ["FinanceReceipt", "financeReceipt"],
    ["FinancePackageIssuance", "financePackageIssuance"],
    ["LessonLedgerEntry", "lessonLedgerEntry"],
    ["AuditLog", "auditLog"],
  ] as const;
  deepStrictEqual(
    Object.keys(f.expected).sort(),
    delegates.map(([table]) => table).sort(),
  );
  for (const [table] of delegates) {
    const rows = await p.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM "${table}" WHERE "id"::text=ANY($1::text[])`,
      f.ids[table],
    );
    strictEqual(rows[0].count, 0n, `fresh fixture collision: ${table}`);
  }
  await p.$transaction(async (tx) => {
    for (const [table, name] of delegates) {
      const delegate = tx[name] as unknown as {
        create(args: { data: unknown }): Promise<unknown>;
      };
      for (const data of f.expected[table]) await delegate.create({ data });
    }
  });
}
export function registerCommand(
  f: Fixture,
  method: string,
  path: string,
  body: unknown,
  key?: string,
) {
  requireSeries(
    key && Object.values(f.commandAllowlist).includes(key),
    "unallocated original command UUID",
  );
  return original.registerCommand(f, method, path, body, key);
}
const audit = (
  f: Fixture,
  actor: string,
  action: string,
  type: string,
  id: string,
  details: Record<string, unknown>,
) => f.expectedAudits.push({ actor, action, type, id, details });
export function registerReceipt(
  f: Fixture,
  key: string,
  route: string,
  value: unknown,
) {
  original.registerReceipt(f, key, route, value);
  const identity = `${key}:${route}`;
  if (f.observedReceipts.includes(identity)) return;
  const command = f.commands.find((c) => c.key === key && c.path === route)!;
  const body = value as {
    seriesId?: string | null;
    id?: string;
    version: number;
    startsAt: string;
    endsAt: string;
    kind: string;
    classGroupId: string;
    teacherId: string;
    lessonUnits: number;
    sessions?: Array<{
      id: string;
      version: number;
      startsAt: string;
      endsAt: string;
      status?: string;
    }>;
  };
  const input = command.body as Record<string, unknown>;
  if (route === "/operators/me/lesson-series") {
    ok(body.seriesId && body.sessions);
    for (const row of body.sessions) {
      strictEqual(row.version, 1);
      f.expectedSessions[row.id] = {
        ...row,
        classGroupId: String(input.classGroupId),
        teacherId: f.teacher,
        seriesId: body.seriesId,
        kind: String(input.kind),
        status: "SCHEDULED",
        lessonUnits: 100,
      };
      audit(
        f,
        f.operator,
        "OPERATOR_SCHEDULE_CREATE",
        "LessonSession",
        row.id,
        {
          seriesId: body.seriesId,
          ...row,
          classGroupId: input.classGroupId,
          teacherId: f.teacher,
          lessonUnits: 100,
          kind: input.kind,
        },
      );
    }
    audit(
      f,
      f.operator,
      "OPERATOR_SERIES_CREATE",
      "LessonSeries",
      body.seriesId,
      {
        sessionIds: body.sessions.map((r) => r.id),
        version: 1,
      },
    );
  } else if (route === "/operators/me/lesson-sessions") {
    ok(body.id);
    f.expectedSessions[body.id] = {
      id: body.id,
      version: body.version,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      classGroupId: body.classGroupId,
      teacherId: body.teacherId,
      seriesId: body.seriesId ?? null,
      kind: body.kind,
      lessonUnits: body.lessonUnits,
      status: "SCHEDULED",
    };
    audit(f, f.operator, "OPERATOR_SCHEDULE_CREATE", "LessonSession", body.id, {
      classGroupId: body.classGroupId,
      teacherId: body.teacherId,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      kind: body.kind,
      lessonUnits: body.lessonUnits,
      version: body.version,
    });
  } else if (route.endsWith("/cancel-selection")) {
    ok(body.sessions);
    for (const row of body.sessions) {
      const before = f.expectedSessions[row.id];
      ok(before);
      strictEqual(row.version, before.version + 1);
      strictEqual(before.status, "SCHEDULED");
      strictEqual(row.startsAt, before.startsAt);
      strictEqual(row.endsAt, before.endsAt);
      audit(
        f,
        f.operator,
        "OPERATOR_SCHEDULE_CANCEL",
        "LessonSession",
        row.id,
        {
          seriesId: body.seriesId,
          mode: input.mode,
          before: {
            id: before.id,
            version: before.version,
            startsAt: before.startsAt,
            endsAt: before.endsAt,
          },
          after: row,
        },
      );
      f.expectedSessions[row.id] = { ...before, ...row, status: "CANCELLED" };
    }
    if (body.seriesId) {
      const previous = f.expectedAudits.filter(
        (a) => a.id === body.seriesId && a.action === "OPERATOR_SERIES_CANCEL",
      ).length;
      audit(
        f,
        f.operator,
        "OPERATOR_SERIES_CANCEL",
        "LessonSeries",
        body.seriesId,
        {
          mode: input.mode,
          selectedId: route.split("/")[4],
          sessionIds: body.sessions.map((r) => r.id),
          version: previous + 2,
        },
      );
    }
  } else throw Error("F02 contention: unexpected schedule receipt");
  f.observedReceipts.push(identity);
}
export function auxiliaryRoute(path: string) {
  return (
    path.startsWith("/teachers/") ||
    path.startsWith("/parents/") ||
    path.includes("/members")
  );
}
export function registerAuxiliary(
  f: Fixture,
  actor: string,
  method: string,
  path: string,
  body: Record<string, unknown>,
  key?: string,
) {
  requireSeries(
    key && Object.values(f.commandAllowlist).includes(key),
    "auxiliary UUID not allocated",
  );
  requireSeries(f.actors.includes(actor), "foreign auxiliary actor");
  const allowed =
    (actor === f.teacherUser &&
      method === "PUT" &&
      /^\/teachers\/me\/lesson-sessions\/[0-9a-f-]+\/attendance$/.test(path)) ||
    (actor === f.parent &&
      method === "POST" &&
      path === "/parents/me/leave-requests") ||
    (actor === f.operator &&
      method === "POST" &&
      /^\/operators\/me\/lesson-sessions\/[0-9a-f-]+\/members(?:\/[0-9a-f-]+\/remove)?$/.test(
        path,
      ));
  requireSeries(allowed, "auxiliary actor/route mismatch");
  const old = f.auxiliary.find((x) => x.key === key && x.path === path);
  const hash = original.requestHash(body);
  if (old) {
    strictEqual(old.actor, actor);
    strictEqual(old.method, method);
    strictEqual(old.hash, hash);
  } else
    f.auxiliary.push({
      actor,
      method,
      path,
      body: structuredClone(body),
      key,
      hash,
    });
  return key;
}
export function registerAuxiliaryReceipt(
  f: Fixture,
  key: string,
  path: string,
  value: unknown,
) {
  const command = f.auxiliary.find((x) => x.key === key && x.path === path);
  ok(command);
  if (command.receipt !== undefined) {
    strictEqual(
      original.requestHash(command.receipt),
      original.requestHash(value),
    );
    return;
  }
  command.receipt = structuredClone(value);
  const body = value as Record<string, unknown>;
  const lessonId = String(command.body.lessonSessionId ?? path.split("/")[4]);
  if (path.includes("/members")) {
    const previous = f.expectedSessions[lessonId];
    ok(previous);
    strictEqual(previous.version, command.body.version);
    strictEqual(body.lessonVersion, previous.version + 1);
    f.expectedSessions[lessonId] = {
      ...previous,
      version: Number(body.lessonVersion),
    };
    const remove = path.endsWith("/remove");
    const studentId = remove
      ? path.split("/")[6]
      : String(command.body.studentId);
    audit(
      f,
      command.actor,
      `OPERATOR_LESSON_MEMBER_${remove ? "REMOVE" : "ADD"}`,
      "LessonSession",
      lessonId,
      {
        studentId,
        previousVersion: command.body.version,
        version: body.lessonVersion,
      },
    );
  } else if (path.endsWith("/attendance")) {
    audit(
      f,
      command.actor,
      "TEACHER_ATTENDANCE_SAVE",
      "LessonSession",
      lessonId,
      {
        lessonVersion: command.body.lessonVersion,
        attendanceCount: (command.body.attendance as unknown[]).length,
      },
    );
  } else if (path === "/parents/me/leave-requests") {
    ok(typeof body.id === "string");
    audit(
      f,
      command.actor,
      "PARENT_LEAVE_SUBMIT",
      "ParentLeaveRequest",
      body.id,
      {
        studentId: command.body.studentId,
        lessonSessionId: command.body.lessonSessionId,
      },
    );
  } else throw Error("F02 contention: unknown successful auxiliary route");
}
export async function recoverOwned(p: PrismaService, f: Fixture) {
  await original.recoverOwned(p, f);
  const add = (table: string, id: string) => {
    const ids = (f.ids[table] ??= []);
    if (!ids.includes(id)) ids.push(id);
  };
  const triggers = await p.$queryRawUnsafe<
    Array<{ id: string; studentId: string; campusId: string }>
  >(
    'SELECT "id"::text,"studentId"::text,"campusId"::text FROM "PartnerRankingStudentFact" WHERE "studentId"=$1::uuid',
    f.temporaryStudent,
  );
  for (const row of triggers) {
    requireSeries(
      row.studentId === f.temporaryStudent && row.campusId === f.campusId,
      "temporary student trigger ownership",
    );
    add("PartnerRankingStudentFact", row.id);
  }
  for (const command of f.auxiliary) {
    const row = await p.idempotencyRecord.findUnique({
      where: { key_route: { key: command.key, route: command.path } },
    });
    if (!row) {
      requireSeries(
        command.receipt === undefined,
        "successful auxiliary record missing",
      );
      continue;
    }
    requireSeries(
      row.actorUserId === command.actor &&
        row.campusId === f.campusId &&
        row.requestHash === command.hash &&
        row.status === "COMPLETED" &&
        row.responseStatus === 200 &&
        command.receipt !== undefined &&
        original.requestHash(row.responseBody) ===
          original.requestHash(command.receipt),
      "auxiliary original command/receipt ownership unresolved",
    );
    add("IdempotencyRecord", row.id);
    const lessonId = String(
      command.body.lessonSessionId ?? command.path.split("/")[4],
    );
    requireSeries(
      f.ids.LessonSession?.includes(lessonId),
      "auxiliary foreign lesson",
    );
    if (command.path.includes("/members")) {
      const rows = await p.lessonTemporaryMember.findMany({
        where: {
          campusId: f.campusId,
          lessonSessionId: lessonId,
          studentId: f.temporaryStudent,
        },
      });
      requireSeries(
        rows.length === 1 &&
          rows[0].addedByUserId === f.operator &&
          (!rows[0].removedByUserId || rows[0].removedByUserId === f.operator),
        "temporary episode provenance",
      );
      for (const member of rows) add("LessonTemporaryMember", member.id);
    } else if (command.path.endsWith("/attendance")) {
      const rows = await p.attendanceRecord.findMany({
        where: { campusId: f.campusId, lessonSessionId: lessonId },
      });
      requireSeries(
        rows.length === 1 &&
          rows[0].studentId === f.student &&
          rows[0].recordedByUserId === f.teacherUser &&
          rows[0].status === "PRESENT" &&
          rows[0].includedInFinalRoster === false,
        "draft attendance provenance",
      );
      for (const attendance of rows) add("AttendanceRecord", attendance.id);
    } else {
      const body = command.receipt as { id: string };
      const leave = await p.parentLeaveRequest.findUniqueOrThrow({
        where: { id: body.id },
      });
      requireSeries(
        leave.parentUserId === f.parent &&
          leave.studentId === f.student &&
          leave.lessonSessionId === lessonId &&
          leave.campusId === f.campusId &&
          leave.reason === command.body.reason &&
          leave.status === "PENDING" &&
          leave.temporaryMemberId === null,
        "leave provenance",
      );
      add("ParentLeaveRequest", leave.id);
    }
  }
  for (const expected of f.expectedAudits) {
    if (expected.action === "OPERATOR_SERIES_CREATE") {
      const series = await p.lessonSeries.findUniqueOrThrow({
        where: { id: expected.id },
      });
      const config = series.configuration as Record<
        string,
        Record<string, unknown>
      >;
      const command = f.commands.find(
        (x) =>
          (x.receipt as { seriesId?: string } | undefined)?.seriesId ===
            expected.id && x.path === "/operators/me/lesson-series",
      )!;
      const { previewHash: _ignored, ...pattern } = command.body as Record<
        string,
        unknown
      >;
      deepStrictEqual(config.pattern, pattern);
      strictEqual(config.class.id, pattern.classGroupId);
      strictEqual(config.class.teacherId, f.teacher);
      strictEqual(config.teacher.id, f.teacher);
      strictEqual(config.teacher.userId, f.teacherUser);
      expected.details.configuration = series.configuration;
    }
  }
  const actual = await p.auditLog.findMany({
    where: { campusId: f.campusId, actorUserId: { in: f.actors } },
  });
  const unmatched = [...f.expectedAudits];
  for (const row of actual) {
    const index = unmatched.findIndex(
      (expected) =>
        row.actorUserId === expected.actor &&
        row.action === expected.action &&
        row.resourceType === expected.type &&
        row.resourceId === expected.id &&
        row.outcome === "SUCCESS" &&
        original.requestHash(row.details) ===
          original.requestHash(expected.details),
    );
    requireSeries(index >= 0, "unexpected or duplicate contention audit");
    unmatched.splice(index, 1);
    add("AuditLog", row.id);
  }
  requireSeries(unmatched.length === 0, "missing contention audit");
}
export async function retireFixture(p: PrismaService, f: Fixture) {
  const ordinary = await original.retireFixture(p, {
    ...f,
    actors: f.actors.filter((id) => id !== f.finance),
  });
  try {
    const state = await p.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${f.finance}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "UserRole" WHERE "userId"=${f.finance}::uuid ORDER BY "id" FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: f.finance },
        include: { roles: true },
      });
      if (!user) return "ABSENT";
      const expected = f.expected.User.find((row) => row.id === f.finance)!;
      const role = f.expected.UserRole.find((row) => row.userId === f.finance)!;
      requireSeries(
        user.displayName === expected.displayName &&
          user.roles.length === 1 &&
          user.roles[0].id === role.id &&
          user.roles[0].roleCode === "FINANCE" &&
          user.roles[0].campusId === null,
        "finance fixture ownership changed; preserve and retain",
      );
      if (user.status !== "DISABLED")
        await tx.user.update({
          where: { id: f.finance },
          data: { status: "DISABLED", accountVersion: { increment: 1 } },
        });
      requireSeries(
        (await tx.user.findUniqueOrThrow({ where: { id: f.finance } }))
          .status === "DISABLED",
        "finance actor retirement failed",
      );
      return "DISABLED";
    });
    ordinary.push({ userId: f.finance, state });
  } catch {
    ordinary.push({ userId: f.finance, state: "UNRESOLVED" });
  }
  return ordinary;
}
export async function verifyOwnedAudits(p: AuditEvidenceReader, f: Fixture) {
  for (const [actor, commands] of [
    [f.operator, f.commands],
    ...[f.operator, f.teacherUser, f.parent].map(
      (id) =>
        [id, f.auxiliary.filter((command) => command.actor === id)] as const,
    ),
  ] as const) {
    const records = await p.idempotencyRecord.findMany({
      where: {
        campusId: f.campusId,
        actorUserId: actor,
        key: { in: commands.map((command) => command.key) },
      },
    });
    for (const command of commands) {
      const record = records.find(
        (row) => row.key === command.key && row.route === command.path,
      );
      if (!record) {
        requireSeries(
          command.receipt === undefined,
          "successful command missing final idempotency evidence",
        );
        continue;
      }
      requireSeries(
        record.actorUserId === actor &&
          record.requestHash === command.hash &&
          record.status === "COMPLETED" &&
          record.responseStatus === 200 &&
          command.receipt !== undefined &&
          original.requestHash(record.responseBody) ===
            original.requestHash(command.receipt),
        "final original command and receipt mismatch",
      );
    }
  }
  const actual = [];
  for (const actor of f.actors)
    actual.push(
      ...(await p.auditLog.findMany({
        where: { campusId: f.campusId, actorUserId: actor },
      })),
    );
  strictEqual(actual.length, f.expectedAudits.length);
  const unmatched = [...f.expectedAudits];
  for (const row of actual) {
    const index = unmatched.findIndex(
      (expected) =>
        row.actorUserId === expected.actor &&
        row.action === expected.action &&
        row.resourceType === expected.type &&
        row.resourceId === expected.id &&
        row.outcome === "SUCCESS" &&
        original.requestHash(row.details) ===
          original.requestHash(expected.details),
    );
    ok(index >= 0, "exact contention audit mismatch");
    unmatched.splice(index, 1);
  }
  strictEqual(unmatched.length, 0);
  deepStrictEqual(
    Object.keys(f.expectedSessions).sort(),
    [...(f.ids.LessonSession ?? [])].sort(),
  );
  for (const [id, expected] of Object.entries(f.expectedSessions)) {
    const row = await p.lessonSession.findUniqueOrThrow({ where: { id } });
    strictEqual(row.campusId, f.campusId);
    for (const [key, value] of Object.entries(expected)) {
      const current = (row as unknown as Record<string, unknown>)[key];
      strictEqual(
        current instanceof Date ? current.toISOString() : current,
        value,
        `${id}.${key}`,
      );
    }
  }
  for (const id of f.ids.LessonSeries ?? []) {
    const row = await p.lessonSeries.findUniqueOrThrow({ where: { id } });
    strictEqual(row.campusId, f.campusId);
    strictEqual(row.createdByUserId, f.operator);
    strictEqual(
      row.version,
      1 +
        f.expectedAudits.filter(
          (a) => a.action === "OPERATOR_SERIES_CANCEL" && a.id === id,
        ).length,
    );
  }
}
