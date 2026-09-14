import * as fs from "fs";
import * as path from "path";
import {
  ApiCampusManagerDataSource,
  CampusManagerHttpRequest,
} from "../data/api-campus-manager-data-source";
import { MockCampusManagerDataSource } from "../data/mock-campus-manager-data-source";
import {
  buildCampusManagerLessonItems,
  buildCampusManagerLessonQuery,
  mergeCampusManagerLessonItems,
} from "../services/campus-manager-schedule.presenter";
import {
  CampusManagerScheduleWorkflow,
  normalizeCampusManagerScheduleDraft,
  validateCampusManagerScheduleDraft,
} from "../services/campus-manager-schedule.workflow";
import {
  CampusManagerLessonSession,
  CampusManagerScheduleDraft,
  CampusManagerScheduleInput,
} from "../types/campus-manager";
import { RequestState } from "../utils/request-state";

const scheduleDraft: CampusManagerScheduleDraft = {
  classGroupId: "50000000-0000-4000-8000-000000000001",
  date: "2040-02-01",
  startsAt: "14:00",
  endsAt: "15:30",
  kind: "REGULAR",
};

const lesson: CampusManagerLessonSession = {
  id: "70000000-0000-4000-8000-000000000010",
  campusId: "10000000-0000-4000-8000-000000000001",
  classGroupId: scheduleDraft.classGroupId,
  className: "创意基础A班",
  courseName: "创意基础",
  teacherId: "30000000-0000-4000-8000-000000000001",
  teacherName: "王老师",
  startsAt: "2040-02-01T06:00:00.000Z",
  endsAt: "2040-02-01T07:30:00.000Z",
  kind: "REGULAR",
  lessonUnits: 100,
  status: "SCHEDULED",
  version: 1,
};

interface WorkflowService {
  createLessonSession(
    input: CampusManagerScheduleInput,
    idempotencyKey: string,
  ): Promise<RequestState<CampusManagerLessonSession>>;
  updateLessonSession(
    lessonSessionId: string,
    input: Omit<CampusManagerScheduleInput, "classGroupId"> & {
      version: number;
    },
    idempotencyKey: string,
  ): Promise<RequestState<CampusManagerLessonSession>>;
  cancelLessonSession(
    lessonSessionId: string,
    version: number,
    idempotencyKey: string,
  ): Promise<RequestState<CampusManagerLessonSession>>;
}

describe("campus manager schedule", () => {
  it("builds an inclusive/exclusive Shanghai date query and Chinese list models", () => {
    expect(
      buildCampusManagerLessonQuery("2040-02-01", "SCHEDULED", 2, 10),
    ).toEqual({
      page: 2,
      pageSize: 10,
      from: "2040-02-01T00:00:00+08:00",
      to: "2040-02-02T00:00:00+08:00",
      status: "SCHEDULED",
    });
    expect(buildCampusManagerLessonQuery("", "", 1, 20)).toEqual({
      page: 1,
      pageSize: 20,
    });
    expect(buildCampusManagerLessonItems([lesson])).toEqual([
      expect.objectContaining({
        id: lesson.id,
        dateLabel: "2040年2月1日",
        timeLabel: "14:00-15:30",
        className: "创意基础A班",
        courseName: "创意基础",
        teacherLabel: "王老师 · 1课时",
        kindLabel: "常规课",
        statusLabel: "待上课",
        canManage: true,
      }),
    ]);
    expect(
      mergeCampusManagerLessonItems(
        [],
        buildCampusManagerLessonItems([lesson]),
        1,
      ),
    ).toHaveLength(1);
  });

  it("validates local form values and normalizes only the approved create fields", () => {
    expect(normalizeCampusManagerScheduleDraft(scheduleDraft)).toEqual({
      classGroupId: scheduleDraft.classGroupId,
      startsAt: "2040-02-01T14:00:00+08:00",
      endsAt: "2040-02-01T15:30:00+08:00",
      kind: "REGULAR",
    });
    expect(
      validateCampusManagerScheduleDraft({
        ...scheduleDraft,
        classGroupId: "",
      }),
    ).toBe("请选择班级");
    expect(
      validateCampusManagerScheduleDraft({
        ...scheduleDraft,
        startsAt: "16:00",
        endsAt: "15:30",
      }),
    ).toBe("结束时间必须晚于开始时间");
    expect(validateCampusManagerScheduleDraft(scheduleDraft)).toBeNull();
    expect(
      JSON.stringify(normalizeCampusManagerScheduleDraft(scheduleDraft)),
    ).not.toMatch(/teacherId|lessonUnits/);
  });

  it("locks duplicate create taps, reuses a retry key, and exposes version conflicts", async () => {
    let release: (
      state: RequestState<CampusManagerLessonSession>,
    ) => void = () => undefined;
    const createLessonSession = jest.fn() as jest.MockedFunction<
      WorkflowService["createLessonSession"]
    >;
    createLessonSession
      .mockImplementationOnce(
        () =>
          new Promise<RequestState<CampusManagerLessonSession>>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce({ status: "error", message: "网络不可用" })
      .mockResolvedValueOnce({ status: "success", data: lesson });
    const updateLessonSession = jest
      .fn<
        ReturnType<WorkflowService["updateLessonSession"]>,
        Parameters<WorkflowService["updateLessonSession"]>
      >()
      .mockResolvedValue({
        status: "error",
        statusCode: 409,
        code: "LESSON_VERSION_CONFLICT",
        message: "数据已更新，请刷新后重试",
        details: { currentVersion: 2 },
      });
    const cancelLessonSession = jest.fn<
      ReturnType<WorkflowService["cancelLessonSession"]>,
      Parameters<WorkflowService["cancelLessonSession"]>
    >();
    const workflow = new CampusManagerScheduleWorkflow(
      {
        createLessonSession,
        updateLessonSession,
        cancelLessonSession,
      },
      { createIdempotencyKey: () => "schedule-key-1" },
    );

    const first = workflow.create(scheduleDraft);
    expect(workflow.create(scheduleDraft)).toBe(first);
    release({ status: "error", message: "网络不可用" });
    await expect(first).resolves.toMatchObject({ status: "error" });
    await expect(workflow.create(scheduleDraft)).resolves.toMatchObject({
      status: "error",
    });
    await expect(workflow.create(scheduleDraft)).resolves.toMatchObject({
      status: "success",
    });
    expect(createLessonSession.mock.calls.map((call) => call[1])).toEqual([
      "schedule-key-1",
      "schedule-key-1",
      "schedule-key-1",
    ]);

    await expect(workflow.update(lesson.id, 1, scheduleDraft)).resolves.toEqual(
      expect.objectContaining({
        status: "conflict",
        currentVersion: 2,
      }),
    );
  });

  it("sends list, create, update, and cancel contracts without client-derived fields", async () => {
    const requests: Parameters<CampusManagerHttpRequest>[0][] = [];
    const request: CampusManagerHttpRequest = (options) => {
      requests.push(options);
      options.success({
        statusCode: 200,
        data: options.url.includes("?")
          ? {
              data: [lesson],
              meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
              requestId: "schedule-list",
            }
          : { data: lesson, requestId: "schedule-mutation" },
      });
    };
    const source = new ApiCampusManagerDataSource({
      baseUrl: "https://example.test",
      accessToken: "manager-token",
      request,
    });
    const createInput = normalizeCampusManagerScheduleDraft(scheduleDraft);

    await source.listLessonSessions({
      page: 1,
      pageSize: 20,
      status: "SCHEDULED",
    });
    await source.createLessonSession(createInput, "schedule-create-1");
    await source.updateLessonSession(
      lesson.id,
      {
        version: 1,
        startsAt: createInput.startsAt,
        endsAt: createInput.endsAt,
        kind: "MAKEUP",
      },
      "schedule-update-1",
    );
    await source.cancelLessonSession(lesson.id, 2, "schedule-cancel-1");

    expect(requests[0].url).toBe(
      "https://example.test/campus-managers/me/lesson-sessions?page=1&pageSize=20&status=SCHEDULED",
    );
    expect(requests[1]).toMatchObject({
      method: "POST",
      data: createInput,
      header: { "Idempotency-Key": "schedule-create-1" },
    });
    expect(requests[2]).toMatchObject({
      method: "PATCH",
      data: {
        version: 1,
        startsAt: createInput.startsAt,
        endsAt: createInput.endsAt,
        kind: "MAKEUP",
      },
      header: { "Idempotency-Key": "schedule-update-1" },
    });
    expect(requests[3]).toMatchObject({
      method: "POST",
      data: { version: 2 },
      header: { "Idempotency-Key": "schedule-cancel-1" },
    });
    expect(
      JSON.stringify(requests.slice(1).map(({ data }) => data)),
    ).not.toMatch(/teacherId|lessonUnits/);
  });

  it("mock scheduling derives class facts and enforces versioned terminal states", async () => {
    const source = new MockCampusManagerDataSource();
    const created = await source.createLessonSession(
      normalizeCampusManagerScheduleDraft(scheduleDraft),
      "mock-schedule-create-1",
    );
    expect(created).toMatchObject({
      teacherName: "王老师",
      lessonUnits: 100,
      status: "SCHEDULED",
      version: 1,
    });
    const updated = await source.updateLessonSession(
      created.id,
      {
        version: 1,
        startsAt: "2040-02-01T15:00:00+08:00",
        endsAt: "2040-02-01T16:00:00+08:00",
        kind: "MAKEUP",
      },
      "mock-schedule-update-1",
    );
    expect(updated).toMatchObject({ kind: "MAKEUP", version: 2 });
    const cancelled = await source.cancelLessonSession(
      created.id,
      2,
      "mock-schedule-cancel-1",
    );
    expect(cancelled).toMatchObject({ status: "CANCELLED", version: 3 });
    await expect(
      source.cancelLessonSession(created.id, 3, "mock-schedule-cancel-2"),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("registers a Chinese themed page with retry, forms, and centered controls", () => {
    const root = path.resolve(__dirname, "..");
    const pageDir = path.join(root, "pages/campus-manager/schedule");
    const markup = fs.readFileSync(path.join(pageDir, "index.wxml"), "utf8");
    const logic = fs.readFileSync(path.join(pageDir, "index.ts"), "utf8");
    const styles = fs.readFileSync(path.join(pageDir, "index.wxss"), "utf8");
    const app = JSON.parse(
      fs.readFileSync(path.join(root, "app.json"), "utf8"),
    ) as { subPackages: Array<{ root: string; pages: string[] }> };
    const pages =
      app.subPackages.find((item) => item.root === "pages/campus-manager")
        ?.pages ?? [];
    const source = `${markup}\n${logic}`;

    expect(markup).toContain("排课管理");
    expect(markup).toContain("新增课次");
    expect(markup).toContain("课程类型");
    expect(markup).toContain("取消课次");
    expect(source).toMatch(/loading|empty|error|forbidden|submitting/);
    expect(source).toMatch(/onRetry|onCreateTap|onEditTap|onCancelTap/);
    expect(source).not.toMatch(/周期排课|批量复制|删除课次|更换教师|转移班级/);
    expect(styles).toMatch(
      /\.schedule-control[\s\S]*align-items:\s*center[\s\S]*justify-content:\s*center/,
    );
    expect(styles).toContain("var(--campus-manager-orange)");
    expect(pages).toContain("schedule/index");
  });

  it("centers both native picker labels inside stable filter rows", () => {
    const pageDir = path.resolve(
      __dirname,
      "../pages/campus-manager/schedule",
    );
    const markup = fs.readFileSync(path.join(pageDir, "index.wxml"), "utf8");
    const styles = fs.readFileSync(path.join(pageDir, "index.wxss"), "utf8");

    expect(markup.match(/class="schedule-filter__content"/g)).toHaveLength(2);
    expect(styles).toMatch(
      /\.schedule-filter__content\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*space-between[^}]*width:\s*100%[^}]*min-height:\s*var\(--campus-manager-touch-min\)/s,
    );
  });
});
