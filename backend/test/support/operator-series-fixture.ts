import { randomUUID } from "node:crypto";
import type {
  IdempotencyRecord,
  AuditLog,
  LessonSeries,
  LessonSession,
} from "@prisma/client";
import type { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import type { Fact, Ownership } from "./operator-series-facts";
import { digest, requireSeries } from "./operator-series-admission";

export interface Command {
  method: string;
  path: string;
  key: string;
  body: unknown;
  hash: string;
  receipt?: unknown;
}
export interface Fixture extends Ownership {
  campusB: string;
  operator: string;
  teacherUser: string;
  otherTeacherUser: string;
  parent: string;
  teacher: string;
  otherTeacher: string;
  student: string;
  unboundStudent: string;
  classA: string;
  classB: string;
  commands: Command[];
  expected: Record<string, Record<string, unknown>[]>;
  syntheticSessions: Record<string, Record<string, unknown>>;
}
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;
export function requestHash(v: unknown) {
  return digest(JSON.stringify(canonical(v)));
}
export function makeFixture(run: string): Fixture {
  const f: Fixture = {
    run,
    campusId: randomUUID(),
    campusB: randomUUID(),
    operator: randomUUID(),
    teacherUser: randomUUID(),
    otherTeacherUser: randomUUID(),
    parent: randomUUID(),
    teacher: randomUUID(),
    otherTeacher: randomUUID(),
    student: randomUUID(),
    unboundStudent: randomUUID(),
    classA: randomUUID(),
    classB: randomUUID(),
    actors: [],
    ids: {},
    keys: [],
    commands: [],
    expected: {},
    syntheticSessions: {},
  };
  f.actors = [f.operator, f.teacherUser, f.otherTeacherUser, f.parent];
  const add = (table: string, value: Record<string, unknown>) => {
    (f.expected[table] ??= []).push(value);
    (f.ids[table] ??= []).push(String(value.id));
  };
  for (const id of [f.campusId, f.campusB])
    add("Campus", {
      id,
      code: `${run}-${id.slice(0, 4)}`,
      name: `F02 ${id.slice(0, 8)}`,
      timezone: "Asia/Shanghai",
    });
  for (const [id, role] of [
    [f.operator, "OPERATOR"],
    [f.teacherUser, "TEACHER"],
    [f.otherTeacherUser, "TEACHER"],
    [f.parent, "PARENT"],
  ]) {
    add("User", {
      id,
      displayName: `F02 ${role} ${run.slice(-6)}`,
      status: "ACTIVE",
      accountVersion: 1,
    });
    add("UserRole", {
      id: randomUUID(),
      userId: id,
      roleCode: role,
      campusId: f.campusId,
    });
  }
  for (const [id, userId] of [
    [f.teacher, f.teacherUser],
    [f.otherTeacher, f.otherTeacherUser],
  ])
    add("TeacherProfile", {
      id,
      userId,
      campusId: f.campusId,
      employeeCode: `${run}-${id.slice(0, 4)}`,
      isActive: true,
    });
  const subject = randomUUID();
  add("CampusSubject", {
    id: subject,
    campusId: f.campusId,
    name: `F02 ${run.slice(-6)}`,
    isActive: true,
    version: 1,
  });
  for (const [id, campusId] of [
    [f.student, f.campusId],
    [f.unboundStudent, f.campusB],
  ])
    add("Student", {
      id,
      campusId,
      displayName: `F02 student ${id.slice(0, 6)}`,
      isActive: true,
      profileVersion: 1,
    });
  for (const id of [f.classA, f.classB])
    add("ClassGroup", {
      id,
      campusId: f.campusId,
      teacherId: f.teacher,
      subjectId: subject,
      subjectVersion: 1,
      name: `F02 ${id.slice(0, 8)}`,
      courseName: "F02 course",
      defaultLessonUnits: 100,
      status: "ACTIVE",
    });
  add("ClassMember", {
    id: randomUUID(),
    campusId: f.campusId,
    classGroupId: f.classA,
    studentId: f.student,
    joinedAt: new Date("2026-01-01T00:00:00Z"),
  });
  add("ParentStudentBinding", {
    id: randomUUID(),
    campusId: f.campusId,
    parentUserId: f.parent,
    studentId: f.student,
    isPrimary: true,
  });
  return f;
}
export function registerCommand(
  f: Fixture,
  method: string,
  path: string,
  body: unknown,
  key: string = randomUUID(),
) {
  const old = f.commands.find((c) => c.key === key && c.path === path);
  requireSeries(
    !old || (old.hash === requestHash(body) && old.method === method),
    "original command changed",
  );
  if (!old) {
    f.commands.push({
      method,
      path,
      body: structuredClone(body),
      key,
      hash: requestHash(body),
    });
    f.keys.push(key);
  }
  return key;
}
export function registerReceipt(
  f: Fixture,
  key: string,
  route: string,
  body: unknown,
) {
  const command = f.commands.find((x) => x.key === key && x.path === route);
  requireSeries(command, "unregistered actual HTTP write receipt");
  requireSeries(
    command.receipt === undefined ||
      requestHash(command.receipt) === requestHash(body),
    "original successful HTTP receipt changed on replay",
  );
  command.receipt = structuredClone(body);
}
export async function applyFixture(p: PrismaService, f: Fixture) {
  for (const table of Object.keys(f.expected)) {
    const collision = await p.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM "${table}" WHERE "id"::text=ANY($1::text[])`,
      f.ids[table],
    );
    requireSeries(
      collision[0]?.count === 0n,
      `fixture UUID collision: ${table}`,
    );
  }
  await p.$transaction(async (tx) => {
    // Explicit delegates retain generated Prisma validation and transaction semantics.
    for (const x of f.expected.Campus)
      await tx.campus.create({
        data: x as Parameters<typeof tx.campus.create>[0]["data"],
      });
    for (const x of f.expected.User)
      await tx.user.create({
        data: x as Parameters<typeof tx.user.create>[0]["data"],
      });
    for (const x of f.expected.UserRole)
      await tx.userRole.create({
        data: x as Parameters<typeof tx.userRole.create>[0]["data"],
      });
    for (const x of f.expected.TeacherProfile)
      await tx.teacherProfile.create({
        data: x as Parameters<typeof tx.teacherProfile.create>[0]["data"],
      });
    for (const x of f.expected.CampusSubject)
      await tx.campusSubject.create({
        data: x as Parameters<typeof tx.campusSubject.create>[0]["data"],
      });
    for (const x of f.expected.Student)
      await tx.student.create({
        data: x as Parameters<typeof tx.student.create>[0]["data"],
      });
    for (const x of f.expected.ClassGroup)
      await tx.classGroup.create({
        data: x as Parameters<typeof tx.classGroup.create>[0]["data"],
      });
    for (const x of f.expected.ClassMember)
      await tx.classMember.create({
        data: x as Parameters<typeof tx.classMember.create>[0]["data"],
      });
    for (const x of f.expected.ParentStudentBinding)
      await tx.parentStudentBinding.create({
        data: x as Parameters<typeof tx.parentStudentBinding.create>[0]["data"],
      });
  });
}
export async function recoverOwned(p: PrismaService, f: Fixture) {
  const records = await p.idempotencyRecord.findMany({
    where: {
      campusId: f.campusId,
      actorUserId: f.operator,
      key: { in: f.keys },
    },
  });
  for (const record of records) {
    const command = f.commands.find(
      (c) => c.key === record.key && c.path === record.route,
    );
    requireSeries(
      command &&
        record.requestHash === command.hash &&
        record.status === "COMPLETED" &&
        record.responseStatus === 200 &&
        record.responseBody,
      "unresolved or mismatched owned command",
    );
    const body = record.responseBody as unknown as {
      seriesId?: string | null;
      id?: string;
      sessions?: Array<{ id: string }>;
    };
    const ids = body.sessions?.map((x) => x.id) ?? (body.id ? [body.id] : []);
    requireSeries(
      ids.length > 0 && ids.length <= 50,
      "invalid original command receipt",
    );
    for (const id of ids) {
      const row = await p.lessonSession.findUniqueOrThrow({ where: { id } });
      requireSeries(
        row.campusId === f.campusId &&
          [f.classA, f.classB].includes(row.classGroupId) &&
          [f.teacher, f.otherTeacher].includes(row.teacherId),
        "receipt session ownership",
      );
      if (body.seriesId)
        requireSeries(
          row.seriesId === body.seriesId,
          "receipt series ownership",
        );
      (f.ids.LessonSession ??= []).push(id);
    }
    if (body.seriesId) {
      const series = await p.lessonSeries.findUniqueOrThrow({
        where: { id: body.seriesId },
      });
      requireSeries(
        series.campusId === f.campusId && series.createdByUserId === f.operator,
        "series ownership",
      );
      (f.ids.LessonSeries ??= []).push(body.seriesId);
    }
  }
  const triggers = await p.$queryRawUnsafe<
    Array<{ id: string; studentId: string; campusId: string }>
  >(
    'SELECT "id"::text,"studentId"::text,"campusId"::text FROM "PartnerRankingStudentFact" WHERE "studentId"=ANY($1::uuid[])',
    [f.student, f.unboundStudent],
  );
  for (const row of triggers) {
    requireSeries(
      (row.studentId === f.student && row.campusId === f.campusId) ||
        (row.studentId === f.unboundStudent && row.campusId === f.campusB),
      "student trigger ownership",
    );
    (f.ids.PartnerRankingStudentFact ??= []).push(row.id);
  }
  for (const table of Object.keys(f.ids))
    f.ids[table] = [...new Set(f.ids[table])].sort();
}
export async function retireFixture(p: PrismaService, f: Fixture) {
  const results: Array<{ userId: string; state: string }> = [];
  for (const id of f.actors) {
    try {
      const state = await p.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${id}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "UserRole" WHERE "userId"=${id}::uuid ORDER BY "id" FOR UPDATE`;
        const expected = f.expected.User.find((u) => u.id === id)!;
        const user = await tx.user.findUnique({
          where: { id },
          include: { roles: true },
        });
        if (!user) return "ABSENT";
        const role = f.expected.UserRole.find((r) => r.userId === id)!;
        requireSeries(
          user.displayName === expected.displayName &&
            user.roles.length === 1 &&
            user.roles[0].id === role.id &&
            user.roles[0].roleCode === role.roleCode &&
            user.roles[0].campusId === f.campusId,
          "actor ownership changed; preserve and retain",
        );
        if (user.status !== "DISABLED")
          await tx.user.update({
            where: { id },
            data: { status: "DISABLED", accountVersion: { increment: 1 } },
          });
        requireSeries(
          (await tx.user.findUniqueOrThrow({ where: { id } })).status ===
            "DISABLED",
          "retirement failed",
        );
        return "DISABLED";
      });
      results.push({ userId: id, state });
    } catch {
      results.push({ userId: id, state: "UNRESOLVED" });
    }
  }
  return results;
}
export interface AuditEvidenceReader {
  idempotencyRecord: {
    findMany(input: {
      where: { campusId: string; actorUserId: string; key: { in: string[] } };
    }): Promise<IdempotencyRecord[]>;
  };
  auditLog: {
    findMany(input: {
      where: { campusId: string; actorUserId: string };
    }): Promise<AuditLog[]>;
  };
  lessonSeries: {
    findUniqueOrThrow(input: { where: { id: string } }): Promise<LessonSeries>;
  };
  lessonSession: {
    findUniqueOrThrow(input: { where: { id: string } }): Promise<LessonSession>;
  };
}
export function auditEvidence(after: Fact[]): AuditEvidenceReader {
  // Evidence projection only: these rows came from one real read-only DB snapshot.
  // It is never registered as a Prisma/provider implementation in the product host.
  const read = (table: string, id: string) => {
    const fact = after.find((x) => x.table === table && x.key === id);
    requireSeries(fact, `final evidence row missing: ${table}:${id}`);
    return fact.value;
  };
  return {
    idempotencyRecord: {
      async findMany({ where }) {
        return after
          .filter(
            (x) =>
              x.table === "IdempotencyRecord" &&
              x.value.campusId === where.campusId &&
              x.value.actorUserId === where.actorUserId &&
              where.key.in.includes(String(x.value.key)),
          )
          .map((x) => x.value as unknown as IdempotencyRecord);
      },
    },
    auditLog: {
      async findMany({ where }) {
        return after
          .filter(
            (x) =>
              x.table === "AuditLog" &&
              x.value.campusId === where.campusId &&
              x.value.actorUserId === where.actorUserId,
          )
          .map((x) => x.value as unknown as AuditLog);
      },
    },
    lessonSeries: {
      async findUniqueOrThrow({ where }) {
        return read("LessonSeries", where.id) as unknown as LessonSeries;
      },
    },
    lessonSession: {
      async findUniqueOrThrow({ where }) {
        const row = read("LessonSession", where.id);
        return {
          ...row,
          startsAt: new Date(String(row.startsAt)),
          endsAt: new Date(String(row.endsAt)),
        } as unknown as LessonSession;
      },
    },
  };
}
export async function verifyOwnedAudits(p: AuditEvidenceReader, f: Fixture) {
  const records = await p.idempotencyRecord.findMany({
    where: {
      campusId: f.campusId,
      actorUserId: f.operator,
      key: { in: f.keys },
    },
  });
  const expected = new Map<string, unknown[]>();
  const versions = new Map<string, number>();
  const states = new Map<
    string,
    {
      id: string;
      version: number;
      startsAt: string;
      endsAt: string;
      kind: string;
      classGroupId: string;
      teacherId: string;
      seriesId: string | null;
      status: string;
    }
  >();
  const add = (action: string, type: string, id: string, details: unknown) => {
    const k = `${action}:${type}:${id}`;
    (expected.get(k) ?? (expected.set(k, []), expected.get(k)!)).push(details);
  };
  for (const command of f.commands) {
    const record = records.find(
      (x) => x.key === command.key && x.route === command.path,
    );
    if (!record) {
      requireSeries(
        command.receipt === undefined,
        "successful HTTP receipt missing final idempotency record",
      );
      continue;
    }
    requireSeries(
      command.hash === record.requestHash &&
        record.status === "COMPLETED" &&
        record.responseStatus === 200 &&
        command.receipt !== undefined &&
        requestHash(command.receipt) === requestHash(record.responseBody),
      "audit receipt ownership",
    );
    const body = record.responseBody as unknown as {
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
    const input = command.body as {
      classGroupId?: string;
      kind: string;
      mode?: string;
      version?: number;
    };
    if (record.route === "/operators/me/lesson-series") {
      requireSeries(body.seriesId && body.sessions, "creation receipt missing");
      const series = await p.lessonSeries.findUniqueOrThrow({
        where: { id: body.seriesId },
      });
      const configuration = series.configuration as {
        pattern?: { classGroupId?: string };
        class?: { id?: string; teacherId?: string };
        teacher?: { id?: string; userId?: string };
      };
      requireSeries(
        configuration.pattern?.classGroupId === input.classGroupId &&
          configuration.class?.id === input.classGroupId &&
          configuration.class?.teacherId === f.teacher &&
          configuration.teacher?.id === f.teacher &&
          configuration.teacher?.userId === f.teacherUser,
        "series configuration logical ownership",
      );
      const { previewHash: _hash, ...submitted } = command.body as Record<
        string,
        unknown
      >;
      requireSeries(
        requestHash(configuration.pattern) === requestHash(submitted),
        "series configuration/request mismatch",
      );
      versions.set(body.seriesId, 1);
      add("OPERATOR_SERIES_CREATE", "LessonSeries", body.seriesId, {
        configuration: series.configuration,
        sessionIds: body.sessions.map((x) => x.id),
        version: 1,
      });
      for (const row of body.sessions) {
        states.set(row.id, {
          ...row,
          kind: input.kind,
          classGroupId: input.classGroupId!,
          teacherId: f.teacher,
          seriesId: body.seriesId,
          status: "SCHEDULED",
        });
        add("OPERATOR_SCHEDULE_CREATE", "LessonSession", row.id, {
          seriesId: body.seriesId,
          ...row,
          classGroupId: input.classGroupId,
          teacherId: f.teacher,
          lessonUnits: 100,
          kind: input.kind,
        });
      }
    } else if (/\/cancel-selection$/.test(record.route)) {
      requireSeries(body.sessions, "cancellation receipt missing");
      for (const row of body.sessions) {
        const previous = states.get(row.id);
        requireSeries(
          previous &&
            previous.version === row.version - 1 &&
            previous.startsAt === row.startsAt &&
            previous.endsAt === row.endsAt,
          "cancellation history mismatch",
        );
        add("OPERATOR_SCHEDULE_CANCEL", "LessonSession", row.id, {
          seriesId: body.seriesId,
          mode: input.mode,
          before: {
            id: previous.id,
            version: previous.version,
            startsAt: previous.startsAt,
            endsAt: previous.endsAt,
          },
          after: row,
        });
        states.set(row.id, { ...previous, ...row, status: "CANCELLED" });
      }
      if (body.seriesId) {
        const next = (versions.get(body.seriesId) ?? 0) + 1;
        versions.set(body.seriesId, next);
        add("OPERATOR_SERIES_CANCEL", "LessonSeries", body.seriesId, {
          mode: input.mode,
          selectedId: record.route.split("/")[4],
          sessionIds: body.sessions.map((x) => x.id),
          version: next,
        });
      }
    } else if (record.route === "/operators/me/lesson-sessions") {
      requireSeries(body.id, "single creation receipt missing");
      states.set(body.id, {
        id: body.id,
        version: body.version,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        kind: body.kind,
        classGroupId: body.classGroupId,
        teacherId: body.teacherId,
        seriesId: body.seriesId ?? null,
        status: "SCHEDULED",
      });
      add("OPERATOR_SCHEDULE_CREATE", "LessonSession", body.id, {
        classGroupId: body.classGroupId,
        teacherId: body.teacherId,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        kind: body.kind,
        lessonUnits: body.lessonUnits,
        version: body.version,
      });
    } else if (command.method === "PATCH") {
      requireSeries(body.id, "single update receipt missing");
      const old = states.get(body.id);
      requireSeries(
        old &&
          old.version === input.version &&
          body.version === old.version + 1,
        "single update history mismatch",
      );
      add("OPERATOR_SCHEDULE_UPDATE", "LessonSession", body.id, {
        before: {
          startsAt: old.startsAt,
          endsAt: old.endsAt,
          kind: old.kind,
          version: old.version,
        },
        after: {
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          kind: body.kind,
          version: body.version,
        },
      });
      states.set(body.id, {
        ...old,
        id: body.id,
        version: body.version,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        kind: body.kind,
      });
    } else {
      throw Error("F02: unexpected successful owned write");
    }
  }
  const rows = await p.auditLog.findMany({
    where: { actorUserId: f.operator, campusId: f.campusId },
  });
  for (const row of rows) {
    requireSeries(row.outcome === "SUCCESS", "unexpected owned audit outcome");
    const k = `${row.action}:${row.resourceType}:${row.resourceId}`;
    const candidates = expected.get(k);
    requireSeries(
      candidates && candidates.length > 0,
      "unexpected or duplicate owned audit",
    );
    const index = candidates.findIndex(
      (details) => requestHash(details) === requestHash(row.details),
    );
    requireSeries(index >= 0, "owned audit logical details mismatch");
    candidates.splice(index, 1);
  }
  requireSeries(
    [...expected.values()].every((list) => list.length === 0),
    "missing owned audit",
  );
  for (const [id, version] of versions)
    requireSeries(
      (await p.lessonSeries.findUniqueOrThrow({ where: { id } })).version ===
        version,
      "series version/audit mismatch",
    );
  for (const [id, state] of states) {
    const row = await p.lessonSession.findUniqueOrThrow({ where: { id } });
    requireSeries(
      row.campusId === f.campusId &&
        row.classGroupId === state.classGroupId &&
        row.teacherId === state.teacherId &&
        row.seriesId === state.seriesId &&
        row.status === state.status &&
        row.kind === state.kind &&
        row.lessonUnits === 100 &&
        row.version === state.version &&
        row.startsAt.toISOString() === state.startsAt &&
        row.endsAt.toISOString() === state.endsAt,
      "final dynamic session state/topology mismatch",
    );
  }
}
