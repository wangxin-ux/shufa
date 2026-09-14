import * as fs from "fs";
import * as path from "path";

interface HrProfilePage {
  data: Record<string, any>;
  setData(patch: Record<string, unknown>): void;
  loadProfile(): Promise<void>;
  onActionTap(event: { currentTarget: { dataset: { key?: string } } }): void;
}

const sessionService = {
  load: jest.fn(),
};

jest.mock("../services/session.service", () => ({ sessionService }));

describe("HR profile page", () => {
  const originalPage = Object.getOwnPropertyDescriptor(globalThis, "Page");
  const originalWx = Object.getOwnPropertyDescriptor(globalThis, "wx");
  const navigateTo = jest.fn();
  let page: HrProfilePage;

  beforeEach(() => {
    jest.resetAllMocks();
    Object.defineProperty(globalThis, "wx", {
      configurable: true,
      value: { navigateTo, stopPullDownRefresh: jest.fn() },
    });
    Object.defineProperty(globalThis, "Page", {
      configurable: true,
      value: (definition: HrProfilePage) => {
        page = definition;
        page.setData = (patch) => Object.assign(page.data, patch);
      },
    });
    jest.isolateModules(() => require("../pages/hr/profile/index"));
  });

  afterAll(() => {
    if (originalPage) Object.defineProperty(globalThis, "Page", originalPage);
    else Reflect.deleteProperty(globalThis, "Page");
    if (originalWx) Object.defineProperty(globalThis, "wx", originalWx);
    else Reflect.deleteProperty(globalThis, "wx");
  });

  it("shows only a single headquarters HR account", async () => {
    sessionService.load.mockResolvedValue({
      userId: "hr-1",
      displayName: "总部人力账号",
      roles: [{ code: "HR", campusId: null }],
    });

    await page.loadProfile();

    expect(page.data).toMatchObject({
      viewState: "ready",
      displayName: "总部人力账号",
      roleCode: "HR",
      roleLabel: "总部人力",
      accountLabel: "总部账号 · 无校区绑定",
    });
  });

  it("rejects non-HR and campus-bound sessions", async () => {
    sessionService.load.mockResolvedValue({
      userId: "hr-1",
      displayName: "错误账号",
      roles: [{ code: "HR", campusId: "campus-1" }],
    });

    await page.loadProfile();

    expect(page.data).toMatchObject({
      viewState: "forbidden",
      displayName: "",
      errorMessage: "当前账号无总部人力端访问权限",
    });
  });

  it("keeps service errors out of the ready account card", async () => {
    sessionService.load.mockRejectedValue(new Error("会话加载失败"));

    await page.loadProfile();

    expect(page.data).toMatchObject({
      viewState: "error",
      displayName: "",
      errorMessage: "会话加载失败",
    });
  });

  it.each([
    ["teachers", "/pages/hr/teachers/index"],
    ["teaching", "/pages/hr/teaching/index"],
    ["earnings", "/pages/hr/earnings/index"],
  ])("routes %s to an existing HR page", (key, url) => {
    page.onActionTap({ currentTarget: { dataset: { key } } });
    expect(navigateTo).toHaveBeenCalledWith({ url });
  });

  it("reuses the approved profile shell without any identity switcher", () => {
    const pageDir = path.resolve(__dirname, "../pages/hr/profile");
    const wxml = fs.readFileSync(path.join(pageDir, "index.wxml"), "utf8");
    const wxss = fs.readFileSync(path.join(pageDir, "index.wxss"), "utf8");
    const json = JSON.parse(
      fs.readFileSync(path.join(pageDir, "index.json"), "utf8"),
    ) as {
      usingComponents?: Record<string, string>;
    };
    const source = `${wxml}\n${wxss}`;

    expect(json.usingComponents?.["super-admin-page-shell"]).toBe(
      "/components/super-admin-page-shell/super-admin-page-shell",
    );
    expect(json.usingComponents?.["session-logout"]).toBe(
      "/components/session-logout/session-logout",
    );
    expect(wxml).toContain('mark-title="我的"');
    expect(wxml).toContain("show-back");
    expect(wxml).toContain("surface-page");
    expect(wxml).toContain('plain-mark="{{true}}"');
    expect(wxml).toContain("/pages/hr/assets/home-character.png");
    expect(wxml).toContain("<session-logout");
    expect(source).not.toMatch(/切换|选择身份|测试账号/);
    expect(wxss).toContain("var(--super-admin-font-display)");
    expect(wxss).not.toMatch(
      /role-profile-mark-(?:width|height|icon-size|font-size)\s*:/,
    );
  });
});
