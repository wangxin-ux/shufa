import { deepStrictEqual, strictEqual, ok } from "node:assert";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import type { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import type { OperatorSeriesPatternDto } from "../../src/modules/operator/dto/operator-lesson-series.dto";
import { snapshotFacts } from "./operator-series-facts";
import { recoverOwned, type Fixture } from "./operator-series-fixture";
import {
  captureSeriesPages,
  change,
  tap,
  type Transport,
  type ActualPage,
  type HttpRecord,
} from "./operator-series-pages";

export const CASES = [
  "limits-84-85-and-50-51",
  "alternate-week-monday-anchor",
  "page-preview-create",
  "same-key-replay",
  "class-and-teacher-conflicts",
  "concurrent-single-series",
  "teacher-deactivation",
  "mid-batch-rollback",
  "higher-single-edit-version",
  "page-this-cancellation",
  "page-following-actual-set",
  "cross-role-reads",
  "permission-denials",
  "credential-retirement",
  "original-facts-preserved",
] as const;
export interface WireResponse {
  status: number;
  body: unknown;
}
export type Call = (
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  key?: string,
) => Promise<WireResponse>;
interface Session {
  id: string;
  version: number;
  startsAt: string;
  endsAt: string;
  status?: string;
}
interface Preview {
  previewHash: string;
  sessions: Array<{ date: string; startsAt: string; endsAt: string }>;
  conflictDates: string[];
}
interface Created {
  seriesId: string;
  version: number;
  sessions: Session[];
}
export interface CaseContext {
  root: string;
  base: string;
  p: PrismaService;
  audit: Client;
  fixture: Fixture;
  tokens: {
    operator: string;
    teacher: string;
    otherTeacher: string;
    parent: string;
  };
  call: Call;
  pageTransport: Transport;
  armFault(count: number): void;
  faultEvidence(): { inserted: string[]; triggered: boolean };
  pageEvidence(records: HttpRecord[]): void;
  mark(name: (typeof CASES)[number], details?: unknown): void;
}
const data = <T>(r: WireResponse): T => {
  strictEqual(r.status, 200, JSON.stringify(r.body));
  return (r.body as { data: T }).data;
};
const series = "/operators/me/lesson-series";
const lesson = "/operators/me/lesson-sessions";
const view = (x: {
  id: string;
  version: number;
  startsAt: Date;
  endsAt: Date;
}) => ({
  id: x.id,
  version: x.version,
  startsAt: x.startsAt.toISOString(),
  endsAt: x.endsAt.toISOString(),
});
function setPattern(editor: ActualPage, pattern: OperatorSeriesPatternDto) {
  const index = editor.data.classOptions.findIndex(
    (x: { classGroupId: string }) => x.classGroupId === pattern.classGroupId,
  );
  ok(index >= 0);
  editor.onClassChange(change(String(index)));
  editor.onScheduleModeTap(tap("series"));
  editor.onFormDateChange(change(pattern.startDate));
  editor.onSeriesEndDateChange(change(pattern.endDate));
  editor.onIntervalChange(change(pattern.intervalWeeks === 2 ? "1" : "0"));
  editor.onWeekdayChange(change(pattern.weekdays.map(String)));
  editor.onStartTimeChange(change(pattern.startTime));
  editor.onEndTimeChange(change(pattern.endTime));
  editor.onKindChange(change("0"));
}
function assertCompleteRecovery(records: HttpRecord[]) {
  ok(records.length > 0);
  ok(
    records.every(
      (r) =>
        r.method === "GET" &&
        (r.path === "/me" ||
          r.path.startsWith("/operators/me/lesson-sessions?")),
    ),
  );
  const reads = records.filter((r) => r.path !== "/me");
  ok(reads.length > 0);
  const pages: number[] = [];
  for (const read of reads) {
    const url = new URL(read.path, "http://f02.invalid");
    ok(
      [...url.searchParams.keys()].every((k) =>
        ["page", "pageSize"].includes(k),
      ),
    );
    strictEqual(read.status, 200);
    const body = read.response as {
      data: unknown[];
      meta: { page: number; total: number; totalPages: number };
    };
    pages.push(body.meta.page);
    strictEqual(body.meta.page, Number(url.searchParams.get("page")));
  }
  const last = reads.at(-1)!.response as { meta: { totalPages: number } };
  deepStrictEqual(
    pages,
    Array.from({ length: Math.max(1, last.meta.totalPages) }, (_, i) => i + 1),
  );
}
export async function runSeriesCases(c: CaseContext) {
  const { p, fixture: f, call } = c;
  const snapshot = () => snapshotFacts(c.audit);
  const preview = async (pattern: OperatorSeriesPatternDto) =>
    data<Preview>(await call("POST", `${series}/preview`, pattern));
  const pattern: OperatorSeriesPatternDto = {
    classGroupId: f.classA,
    startDate: "2040-01-02",
    endDate: "2040-03-25",
    intervalWeeks: 1,
    weekdays: [1],
    startTime: "10:00",
    endTime: "11:00",
    kind: "REGULAR",
  };
  ok(new Date("2040-01-02T00:00:00+08:00").getTime() > Date.now() + 86_400_000);
  const beforeRead = await snapshot();
  strictEqual((await preview(pattern)).sessions.length, 12);
  strictEqual(
    (
      await call("POST", `${series}/preview`, {
        ...pattern,
        endDate: "2040-03-26",
      })
    ).status,
    400,
  );
  const daily = {
    ...pattern,
    endDate: "2040-02-20",
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  };
  strictEqual((await preview(daily)).sessions.length, 50);
  strictEqual(
    (
      await call("POST", `${series}/preview`, {
        ...daily,
        endDate: "2040-02-21",
      })
    ).status,
    400,
  );
  deepStrictEqual(await snapshot(), beforeRead);
  c.mark("limits-84-85-and-50-51");
  const alternate = await preview({
    ...pattern,
    startDate: "2040-01-04",
    endDate: "2040-01-18",
    intervalWeeks: 2,
    weekdays: [1, 3],
  });
  deepStrictEqual(
    alternate.sessions.map((x) => x.date),
    ["2040-01-04", "2040-01-16", "2040-01-18"],
  );
  c.mark("alternate-week-monday-anchor");

  const pages = await captureSeriesPages(
    c.root,
    c.tokens.operator,
    c.base,
    c.pageTransport,
  );
  try {
    const editor = await pages.editor();
    const main = {
      ...pattern,
      startDate: "2040-07-02",
      endDate: "2040-08-06",
      weekdays: [1, 3],
    };
    setPattern(editor, main);
    const beforePreview = await snapshot();
    await editor.onSeriesPreview();
    await pages.settle();
    ok(editor.data.seriesPreview);
    ok(editor.data.seriesRows.length >= 8);
    deepStrictEqual(await snapshot(), beforePreview);
    const shown = structuredClone(editor.data.seriesPreview) as Preview;
    pages.loseNextSuccess(series);
    editor.onSeriesCreate();
    strictEqual(pages.modalCount(), 1);
    deepStrictEqual(await snapshot(), beforePreview);
    await pages.confirm();
    strictEqual(editor.data.recoveryAvailable, true);
    strictEqual(editor.data.recoveryReady, false);
    const committed = pages.records.find(
      (r) => r.path === series && r.deliberatelyLost,
    );
    ok(committed?.key);
    strictEqual(committed.status, 200);
    const created = data<Created>({
      status: committed.status,
      body: committed.response,
    });
    deepStrictEqual(
      created.sessions.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
      shown.sessions.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
    );
    await recoverOwned(p, f);
    strictEqual(
      await p.lessonSession.count({ where: { seriesId: created.seriesId } }),
      shown.sessions.length,
    );
    c.mark("page-preview-create", {
      seriesId: created.seriesId,
      count: created.sessions.length,
    });

    // A legitimate later single-session edit must not make original series replay unreadable.
    const first = created.sessions[0];
    data(
      await call("PATCH", `${lesson}/${first.id}`, {
        version: first.version,
        startsAt: "2040-08-13T10:00:00+08:00",
        endsAt: "2040-08-13T11:00:00+08:00",
        kind: "REGULAR",
      }),
    );
    const n = pages.records.filter((r) => r.path === series).length;
    const recoveryStart = pages.records.length;
    editor.onRetryWrite();
    await pages.settle();
    assertCompleteRecovery(pages.records.slice(recoveryStart));
    strictEqual(editor.data.recoveryReady, true);
    strictEqual(pages.records.filter((r) => r.path === series).length, n);
    const beforeReplay = await snapshot();
    editor.onRetryWrite();
    await pages.settle();
    const replays = pages.records.filter((r) => r.path === series);
    strictEqual(replays.length, n + 1);
    deepStrictEqual(
      { key: replays.at(-1)!.key, body: replays.at(-1)!.body },
      { key: committed.key, body: committed.body },
    );
    deepStrictEqual(
      (replays.at(-1)!.response as { data: unknown }).data,
      (committed.response as { data: unknown }).data,
    );
    strictEqual(editor.data.viewState, "saved");
    strictEqual(editor.data.verified, true);
    strictEqual(editor.data.savedCount, created.sessions.length);
    deepStrictEqual(await snapshot(), beforeReplay);
    c.mark("same-key-replay");
    await pages.back(editor);
    await pages.allScheduleRows();
    ok(pages.schedule.data.savedNotice);
    const second = created.sessions[1],
      edit = await pages.editor(second.id);
    edit.onStartTimeChange(change("14:00"));
    edit.onEndTimeChange(change("15:00"));
    edit.onSubmit();
    await pages.confirm();
    strictEqual(edit.data.verified, true);
    const edited = await p.lessonSession.findUniqueOrThrow({
      where: { id: second.id },
    });
    strictEqual(edited.seriesId, created.seriesId);
    strictEqual(edited.version, second.version + 1);
    await pages.back(edit);
    await pages.allScheduleRows();
    c.mark("higher-single-edit-version");

    const crossReads = async () => {
      const rows = await p.lessonSession.findMany({
        where: { seriesId: created.seriesId },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      });
      const teacherRows: Array<Session> = [];
      for (let page = 1; page <= 100; page++) {
        const response = await call(
          "GET",
          `/teachers/me/lesson-sessions?page=${page}&pageSize=100`,
          undefined,
          c.tokens.teacher,
        );
        strictEqual(response.status, 200);
        const body = response.body as {
          data: Session[];
          meta: { totalPages: number };
        };
        teacherRows.push(...body.data);
        if (page >= body.meta.totalPages) break;
      }
      for (const row of rows) {
        const read = teacherRows.find((x) => x.id === row.id);
        ok(read);
        deepStrictEqual(
          { ...view(row), status: row.status },
          {
            id: read.id,
            version: read.version,
            startsAt: read.startsAt,
            endsAt: read.endsAt,
            status: read.status,
          },
        );
      }
      const parent = data<{ lessons: Array<{ id: string; startsAt: string }> }>(
        await call(
          "GET",
          `/parents/me/leave?studentId=${f.student}`,
          undefined,
          c.tokens.parent,
        ),
      );
      for (const row of rows) {
        const read = parent.lessons.find((x) => x.id === row.id);
        const eligible =
          ["SCHEDULED", "IN_PROGRESS"].includes(row.status) &&
          row.startsAt.getTime() > Date.now() + 7_200_000;
        strictEqual(Boolean(read), eligible);
        if (read) strictEqual(read.startsAt, row.startsAt.toISOString());
      }
      strictEqual(
        (
          await call(
            "GET",
            `/parents/me/leave?studentId=${f.unboundStudent}`,
            undefined,
            c.tokens.parent,
          )
        ).status,
        403,
      );
      const other = await call(
        "GET",
        "/teachers/me/lesson-sessions?page=1&pageSize=100",
        undefined,
        c.tokens.otherTeacher,
      );
      strictEqual(other.status, 200);
      strictEqual(
        (other.body as { data: Session[] }).data.some((x) =>
          rows.some((row) => row.id === x.id),
        ),
        false,
      );
      strictEqual(
        (await call("GET", lesson, undefined, c.tokens.teacher)).status,
        403,
      );
      strictEqual(
        (await call("POST", `${series}/preview`, main, c.tokens.parent)).status,
        403,
      );
    };
    await crossReads();
    const thisTarget = created.sessions[2];
    pages.schedule.onCancelTap(tap(thisTarget.id));
    await pages.settle();
    deepStrictEqual(pages.schedule.data.cancellation.preview.sessions, [
      view(
        await p.lessonSession.findUniqueOrThrow({
          where: { id: thisTarget.id },
        }),
      ),
    ]);
    const beforeThis = await snapshot();
    pages.schedule.onConfirmCancellation();
    deepStrictEqual(await snapshot(), beforeThis);
    await pages.confirm();
    strictEqual(
      (
        await p.lessonSession.findUniqueOrThrow({
          where: { id: thisTarget.id },
        })
      ).status,
      "CANCELLED",
    );
    c.mark("page-this-cancellation");

    // Owned synthetic history sentinels test exclusion; no teaching/financial claim is made.
    const sentinels = [];
    for (const [i, status] of (
      ["SCHEDULED", "COMPLETED", "REVERSED", "CANCELLED"] as const
    ).entries()) {
      const id = randomUUID();
      (f.ids.LessonSession ??= []).push(id);
      const past = new Date(Date.now() - (10 + i) * 86_400_000);
      const startsAt =
        status === "CANCELLED" ? new Date("2040-08-20T18:00:00+08:00") : past;
      const input = {
        id,
        campusId: f.campusId,
        classGroupId: f.classA,
        teacherId: f.teacher,
        seriesId: created.seriesId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        status,
        lessonUnits: 100,
        kind: "REGULAR" as const,
        ...(["COMPLETED", "REVERSED"].includes(status)
          ? { completedAt: new Date(past.getTime() + 3_600_000) }
          : {}),
        ...(status === "REVERSED"
          ? {
              reversedAt: new Date(),
              reversalReason: "F02 synthetic exclusion sentinel",
            }
          : {}),
      };
      f.syntheticSessions[id] = input;
      const sentinel = await p.lessonSession.create({ data: input });
      f.syntheticSessions[id] = { ...sentinel };
      sentinels.push(sentinel);
    }
    await pages.allScheduleRows();
    const target = await p.lessonSession.findUniqueOrThrow({
      where: { id: second.id },
    });
    const expected = await p.lessonSession.findMany({
      where: {
        campusId: f.campusId,
        seriesId: created.seriesId,
        status: "SCHEDULED",
        startsAt: { gt: new Date(), gte: target.startsAt },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    });
    ok(expected.some((x) => x.id === first.id));
    pages.schedule.onCancelTap(tap(second.id));
    await pages.settle();
    pages.schedule.onCancellationModeChange(change("FOLLOWING"));
    await pages.settle();
    deepStrictEqual(
      pages.schedule.data.cancellation.preview.sessions,
      expected.map(view),
    );
    const beforeCancellation = await snapshot();
    pages.schedule.onConfirmCancellation();
    deepStrictEqual(await snapshot(), beforeCancellation);
    const cancelPath = `${lesson}/${second.id}/cancel-selection`;
    pages.loseNextSuccess(cancelPath);
    await pages.confirm();
    strictEqual(pages.schedule.data.recoveryAvailable, true);
    const cancelRecoveryStart = pages.records.length;
    pages.schedule.onRetryWrite();
    await pages.settle();
    assertCompleteRecovery(pages.records.slice(cancelRecoveryStart));
    strictEqual(pages.schedule.data.recoveryReady, true);
    const afterCancel = await snapshot();
    pages.schedule.onRetryWrite();
    await pages.settle();
    deepStrictEqual(await snapshot(), afterCancel);
    const attempts = pages.records.filter((r) => r.path === cancelPath);
    strictEqual(attempts.length, 2);
    deepStrictEqual(
      {
        key: attempts[0].key,
        body: attempts[0].body,
        data: (attempts[0].response as { data: unknown }).data,
      },
      {
        key: attempts[1].key,
        body: attempts[1].body,
        data: (attempts[1].response as { data: unknown }).data,
      },
    );
    for (const row of expected) {
      const final = await p.lessonSession.findUniqueOrThrow({
        where: { id: row.id },
      });
      strictEqual(final.status, "CANCELLED");
      strictEqual(final.version, row.version + 1);
    }
    for (const row of sentinels)
      deepStrictEqual(
        await p.lessonSession.findUniqueOrThrow({ where: { id: row.id } }),
        row,
      );
    await crossReads();
    c.mark("cross-role-reads");
    c.mark("permission-denials");
    c.mark("page-following-actual-set", { ids: expected.map((x) => x.id) });

    const fifty = {
      ...pattern,
      classGroupId: f.classB,
      startDate: "2044-01-02",
      endDate: "2044-02-20",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    };
    const limitEditor = await pages.editor();
    setPattern(limitEditor, fifty);
    await limitEditor.onSeriesPreview();
    await pages.settle();
    strictEqual(limitEditor.data.seriesPreview.sessions.length, 50);
    limitEditor.onSeriesCreate();
    await pages.confirm();
    strictEqual(limitEditor.data.savedCount, 50);
    strictEqual(limitEditor.data.verified, true);
    const maxSeries = pages.records
      .filter((r) => r.path === series && r.status === 200)
      .at(-1)!;
    const maxCreated = data<Created>({
      status: maxSeries.status,
      body: maxSeries.response,
    });
    await pages.back(limitEditor);
    await pages.allScheduleRows();
    ok(pages.schedule.data.page >= 3);
    const verifiedPages = pages.schedule.data.page;
    deepStrictEqual(
      pages.schedule.currentLessons.map((x: { id: string }) => x.id).sort(),
      (
        await p.lessonSession.findMany({
          where: { campusId: f.campusId },
          select: { id: true },
        })
      )
        .map((x) => x.id)
        .sort(),
    );
    const maxTarget = maxCreated.sessions[0];
    pages.schedule.onCancelTap(tap(maxTarget.id));
    await pages.settle();
    pages.schedule.onCancellationModeChange(change("FOLLOWING"));
    await pages.settle();
    deepStrictEqual(
      pages.schedule.data.cancellation.preview.sessions,
      maxCreated.sessions,
    );
    const maxCancelPath = `${lesson}/${maxTarget.id}/cancel-selection`;
    pages.loseNextSuccess(maxCancelPath);
    pages.schedule.onConfirmCancellation();
    await pages.confirm();
    const fullRecoveryStart = pages.records.length;
    pages.schedule.onRetryWrite();
    await pages.settle();
    assertCompleteRecovery(pages.records.slice(fullRecoveryStart));
    ok(
      pages.records.slice(fullRecoveryStart).filter((r) => r.path !== "/me")
        .length >= 3,
    );
    strictEqual(pages.schedule.data.recoveryReady, true);
    const maxAfter = await snapshot();
    pages.schedule.onRetryWrite();
    await pages.settle();
    deepStrictEqual(await snapshot(), maxAfter);
    const maxAttempts = pages.records.filter((r) => r.path === maxCancelPath);
    strictEqual(maxAttempts.length, 2);
    strictEqual(maxAttempts[0].key, maxAttempts[1].key);
    deepStrictEqual(maxAttempts[0].body, maxAttempts[1].body);
    strictEqual(
      await p.lessonSession.count({
        where: { seriesId: maxCreated.seriesId, status: "CANCELLED" },
      }),
      50,
    );
    c.mark("limits-84-85-and-50-51", {
      realPageCreatedAndCancelled: 50,
      listPages: verifiedPages,
    });
  } finally {
    await pages.close();
    c.pageEvidence(pages.records);
  }

  for (const [classGroupId, teacherId, date] of [
    [f.classA, f.otherTeacher, "2042-08-04"],
    [f.classB, f.teacher, "2042-08-11"],
  ]) {
    const id = randomUUID();
    (f.ids.LessonSession ??= []).push(id);
    const input = {
      id,
      campusId: f.campusId,
      classGroupId,
      teacherId,
      startsAt: new Date(`${date}T10:00:00+08:00`),
      endsAt: new Date(`${date}T11:00:00+08:00`),
    };
    f.syntheticSessions[id] = input;
    const anchor = await p.lessonSession.create({ data: input });
    f.syntheticSessions[id] = { ...anchor };
    const conflict = {
      ...pattern,
      startDate: date,
      endDate: date,
      weekdays: [((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1],
    };
    const result = await preview(conflict);
    deepStrictEqual(result.conflictDates, [date]);
    const before = await snapshot();
    const failed = await call("POST", series, {
      ...conflict,
      previewHash: result.previewHash,
    });
    strictEqual(failed.status, 409);
    deepStrictEqual(
      (failed.body as { details: { conflictDates: string[] } }).details
        .conflictDates,
      [date],
    );
    deepStrictEqual(await snapshot(), before);
  }
  c.mark("class-and-teacher-conflicts");
  const competing = {
    ...pattern,
    startDate: "2042-09-01",
    endDate: "2042-09-15",
    weekdays: [1, 3],
  };
  const pv = await preview(competing);
  const baseline = await p.lessonSession.count({
    where: { campusId: f.campusId },
  });
  const racing = await Promise.all([
    call("POST", series, { ...competing, previewHash: pv.previewHash }),
    call("POST", lesson, {
      classGroupId: f.classA,
      ...pv.sessions[0],
      date: undefined,
      kind: "REGULAR",
    }),
  ]);
  deepStrictEqual(racing.map((x) => x.status).sort(), [200, 409]);
  const winner = racing.find((x) => x.status === 200)!;
  const won = data<{ sessions?: Session[] }>(winner);
  strictEqual(
    (await p.lessonSession.count({ where: { campusId: f.campusId } })) -
      baseline,
    won.sessions?.length ?? 1,
  );
  await recoverOwned(p, f);
  c.mark("concurrent-single-series");

  const inactive = {
    ...pattern,
    startDate: "2043-02-02",
    endDate: "2043-02-16",
    weekdays: [1, 3],
  };
  const inactivePreview = await preview(inactive);
  await p.teacherProfile.update({
    where: { id: f.teacher },
    data: { isActive: false },
  });
  try {
    const before = await snapshot();
    ok(
      [404, 409].includes(
        (
          await call("POST", series, {
            ...inactive,
            previewHash: inactivePreview.previewHash,
          })
        ).status,
      ),
    );
    deepStrictEqual(await snapshot(), before);
  } finally {
    await p.teacherProfile.update({
      where: { id: f.teacher },
      data: { isActive: true },
    });
  }
  c.mark("teacher-deactivation");
  const failing = {
    ...pattern,
    startDate: "2043-04-01",
    endDate: "2043-04-22",
    weekdays: [1, 3],
  };
  const failurePreview = await preview(failing),
    beforeFailure = await snapshot();
  c.armFault(2);
  strictEqual(
    (
      await call("POST", series, {
        ...failing,
        previewHash: failurePreview.previewHash,
      })
    ).status,
    500,
  );
  const injected = c.faultEvidence();
  strictEqual(injected.triggered, true);
  strictEqual(injected.inserted.length, 2);
  strictEqual(new Set(injected.inserted).size, 2);
  for (const id of injected.inserted)
    strictEqual(await p.lessonSession.findUnique({ where: { id } }), null);
  c.armFault(0);
  deepStrictEqual(await snapshot(), beforeFailure);
  c.mark("mid-batch-rollback", {
    injection:
      "throw after second actual PostgreSQL LessonSession insert, inside real transaction",
    insertedAndRolledBack: injected.inserted,
  });
  await recoverOwned(p, f);
}
