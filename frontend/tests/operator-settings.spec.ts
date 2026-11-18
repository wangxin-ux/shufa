import * as fs from "fs";
import * as path from "path";
import {
  ApiOperatorDataSource,
  OperatorHttpRequest,
} from "../pages/operator/runtime/data/api-operator-data-source";
import { MockOperatorDataSource } from "../pages/operator/runtime/data/mock-operator-data-source";
import {
  OperatorSettingsWorkflow,
  formatOperatorLessonHours,
  normalizeOperatorSettingsDraft,
  validateOperatorSettingsDraft,
} from "../pages/operator/runtime/services/operator-settings.workflow";
import {
  OperatorCampusSettings,
  OperatorSettingsDraft,
} from "../pages/operator/runtime/types/operator";
import { RequestState } from "../utils/request-state";

const campus: OperatorCampusSettings = {
  id: "10000000-0000-4000-8000-000000000001",
  code: "campus-demo-east",
  name: "启明东校区",
  timezone: "Asia/Shanghai",
  contactPhone: "0731-88886666",
  address: "长沙市岳麓区启明路 18 号",
  lessonWarningThresholdUnits: 500,
  version: 1,
};

const draft: OperatorSettingsDraft = {
  name: " 启明东校区新址 ",
  contactPhone: " 13800138000 ",
  address: " 长沙市岳麓区未来路 8 号 ",
  lessonWarningThresholdHours: "5.25",
};

describe("campus manager settings", () => {
  it("converts display lesson hours to exact hundredth units", () => {
    expect(formatOperatorLessonHours(0)).toBe("0");
    expect(formatOperatorLessonHours(500)).toBe("5");
    expect(formatOperatorLessonHours(525)).toBe("5.25");
    expect(normalizeOperatorSettingsDraft(draft, 3)).toEqual({
      version: 3,
      name: "启明东校区新址",
      contactPhone: "13800138000",
      address: "长沙市岳麓区未来路 8 号",
      lessonWarningThresholdUnits: 525,
    });
  });

  it("validates editable fields and accepts blank nullable values", () => {
    expect(validateOperatorSettingsDraft(draft)).toBeNull();
    expect(
      validateOperatorSettingsDraft({ ...draft, name: "  " }),
    ).toBe("请填写校区名称");
    expect(
      validateOperatorSettingsDraft({ ...draft, contactPhone: "12345" }),
    ).toBe("请输入正确的手机号或固定电话");
    expect(
      validateOperatorSettingsDraft({
        ...draft,
        address: "地".repeat(301),
      }),
    ).toBe("校区地址不能超过 300 字");
    expect(
      validateOperatorSettingsDraft({
        ...draft,
        contactPhone: "",
        address: "",
        lessonWarningThresholdHours: "0",
      }),
    ).toBeNull();
    expect(
      validateOperatorSettingsDraft({
        ...draft,
        lessonWarningThresholdHours: "1.234",
      }),
    ).toBe("预警阈值最多保留两位小数");
  });

  it("locks duplicate submits and reuses the key for a retry", async () => {
    let release: (state: RequestState<OperatorCampusSettings>) => void =
      () => undefined;
    const updateCampusSettings = jest
      .fn<
        Promise<RequestState<OperatorCampusSettings>>,
        [
          ReturnType<typeof normalizeOperatorSettingsDraft>,
          string,
        ]
      >()
      .mockImplementationOnce(
        () =>
          new Promise<RequestState<OperatorCampusSettings>>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce({ status: "error", message: "网络不可用" })
      .mockResolvedValueOnce({
        status: "success",
        data: { ...campus, name: "启明东校区新址", version: 2 },
      });
    const workflow = new OperatorSettingsWorkflow(
      { updateCampusSettings },
      { createIdempotencyKey: () => "settings-key-1" },
    );

    const first = workflow.submit(draft, 1);
    expect(workflow.submit(draft, 1)).toBe(first);
    release({ status: "error", message: "网络不可用" });
    await expect(first).resolves.toMatchObject({ status: "error" });
    await workflow.submit(draft, 1);
    await expect(workflow.submit(draft, 1)).resolves.toMatchObject({
      status: "success",
      data: { version: 2 },
    });
    expect(updateCampusSettings.mock.calls.map((call) => call[1])).toEqual([
      "settings-key-1",
      "settings-key-1",
      "settings-key-1",
    ]);
  });

  it("sends only the four mutable values plus version to the API", async () => {
    const requests: Parameters<OperatorHttpRequest>[0][] = [];
    const request: OperatorHttpRequest = (options) => {
      requests.push(options);
      options.success({
        statusCode: 200,
        data: { data: { ...campus, version: 2 }, requestId: "settings-1" },
      });
    };
    const source = new ApiOperatorDataSource({
      baseUrl: "https://example.test",
      accessToken: "manager-token",
      request,
    });
    const input = normalizeOperatorSettingsDraft(draft, 1);

    await source.getCampusSettings();
    await source.updateCampusSettings(input, "settings-update-1");

    expect(requests[0]).toMatchObject({
      method: "GET",
      url: "https://example.test/operators/me/campus",
    });
    expect(requests[1]).toMatchObject({
      method: "PATCH",
      url: "https://example.test/operators/me/campus",
      data: input,
      header: { "Idempotency-Key": "settings-update-1" },
    });
    expect(JSON.stringify(requests[1].data)).not.toMatch(
      /campusId|code|timezone|balance/i,
    );
  });

  it("updates Mock settings with version and idempotency protection", async () => {
    const source = new MockOperatorDataSource();
    const input = normalizeOperatorSettingsDraft(draft, 1);
    const first = await source.updateCampusSettings(input, "mock-settings-1");
    const replay = await source.updateCampusSettings(input, "mock-settings-1");
    expect(first).toEqual(replay);
    expect(first).toMatchObject({ version: 2, lessonWarningThresholdUnits: 525 });
    await expect(
      source.updateCampusSettings(
        { ...input, version: 1, name: "旧版本覆盖" },
        "mock-settings-2",
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("registers a centered, stateful settings form", () => {
    const root = path.resolve(__dirname, "..");
    const pageDir = path.join(root, "pages/operator/campus-settings");
    const markup = fs.readFileSync(path.join(pageDir, "index.wxml"), "utf8");
    const logic = fs.readFileSync(path.join(pageDir, "index.ts"), "utf8");
    const styles = fs.readFileSync(path.join(pageDir, "index.wxss"), "utf8");
    const app = JSON.parse(
      fs.readFileSync(path.join(root, "app.json"), "utf8"),
    ) as { subPackages: Array<{ root: string; pages: string[] }> };
    const pages =
      app.subPackages.find((item) => item.root === "pages/operator")
        ?.pages ?? [];
    const source = `${markup}\n${logic}`;

    for (const label of ["校区名称", "联系电话", "校区地址", "预警阈值"]){
      expect(markup).toContain(label);
    }
    expect(source).toMatch(/loading|ready|error|forbidden|submitting/);
    expect(source).toMatch(/onSubmit|onRetry|onNameInput|onThresholdInput/);
    expect(styles).toMatch(
      /\.settings-submit[\s\S]*align-items:\s*center[\s\S]*justify-content:\s*center/,
    );
    expect(styles).toMatch(/max-width:\s*100%/);
    expect(pages).toContain("campus-settings/index");
  });
});
