import * as fs from "fs";
import * as path from "path";

const mockSession = {
  load: jest.fn(),
  logout: jest.fn(),
};
const mockHrApi = {
  teachers: jest.fn(),
  teaching: jest.fn(),
  earnings: jest.fn(),
};

jest.mock("../services/session.service", () => ({
  createSessionService: () => mockSession,
}));
jest.mock("../services/hr.service", () => ({
  createHrApi: () => mockHrApi,
}));

interface TestPage {
  data: Record<string, unknown>;
  setData(patch: Record<string, unknown>): void;
  initialize(): Promise<void>;
  onActionTap(event: { currentTarget: { dataset: { key: string } } }): void;
  onLogout(): void;
}

describe("HR home page", () => {
  let page: TestPage;
  const oldPage = Object.getOwnPropertyDescriptor(globalThis, "Page");
  const oldWx = Object.getOwnPropertyDescriptor(globalThis, "wx");
  const navigateTo = jest.fn();
  const reLaunch = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    mockHrApi.teachers.mockResolvedValue({
      items: [],
      total: 18,
      page: 1,
      pageSize: 1,
    });
    mockHrApi.teaching.mockResolvedValue({
      items: [],
      total: 32,
      page: 1,
      pageSize: 1,
      summary: {
        completedCount: 26,
        attendeeCount: 74,
        lessonUnits: 2600,
        consumedUnits: 7400,
      },
    });
    mockHrApi.earnings.mockResolvedValue({
      items: [],
      total: 21,
      page: 1,
      pageSize: 1,
      summary: {
        netFen: 120000,
        pendingFen: 20000,
        approvedFen: 100000,
        paidFen: 80000,
        processingFen: 20000,
      },
    });
    Object.defineProperty(globalThis, "wx", {
      configurable: true,
      value: {
        getWindowInfo: () => ({
          statusBarHeight: 20,
          windowWidth: 375,
        }),
        getMenuButtonBoundingClientRect: () => ({
          top: 28,
          left: 281,
          height: 32,
        }),
        navigateTo,
        reLaunch,
        showToast: jest.fn(),
      },
    });
    Object.defineProperty(globalThis, "Page", {
      configurable: true,
      value: (definition: TestPage) => {
        page = definition;
        page.setData = (patch) => Object.assign(page.data, patch);
      },
    });
    jest.isolateModules(() => require("../pages/hr/home/index"));
  });

  afterEach(() => {
    if (oldPage) Object.defineProperty(globalThis, "Page", oldPage);
    else Reflect.deleteProperty(globalThis, "Page");
    if (oldWx) Object.defineProperty(globalThis, "wx", oldWx);
    else Reflect.deleteProperty(globalThis, "wx");
  });

  it("opens only for a single headquarters HR session", async () => {
    mockSession.load.mockResolvedValue({
      displayName: "何主管",
      roles: [{ code: "HR", campusId: null }],
    });

    await page.initialize();

    expect(page.data).toMatchObject({
      viewState: "ready",
      displayName: "何主管",
      roleLabel: "总部人力",
      overviewItems: [
        { key: "teachers", label: "教师总数", value: "18", unit: "人" },
        { key: "teaching", label: "本月授课", value: "26", unit: "次" },
        { key: "earnings", label: "课时费记录", value: "21", unit: "条" },
      ],
    });
    expect(mockHrApi.teachers).toHaveBeenCalledWith({ page: 1, pageSize: 1 });
    expect(mockHrApi.teaching).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 1 }),
    );
    expect(mockHrApi.earnings).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 1 }),
    );
  });

  it("rejects campus-bound or non-HR sessions without exposing work entries", async () => {
    mockSession.load.mockResolvedValue({
      displayName: "其他账号",
      roles: [{ code: "HR", campusId: "campus-1" }],
    });

    await page.initialize();

    expect(page.data).toMatchObject({
      viewState: "forbidden",
      displayName: "",
      errorMessage: "请使用总部人力账号",
    });
  });

  it("does not present zeroes as real metrics when a dashboard request fails", async () => {
    mockSession.load.mockResolvedValue({
      displayName: "何主管",
      roles: [{ code: "HR", campusId: null }],
    });
    mockHrApi.teaching.mockRejectedValue(new Error("授课统计加载失败"));

    await page.initialize();

    expect(page.data).toMatchObject({
      viewState: "error",
      errorMessage: "授课统计加载失败",
      overviewItems: [
        expect.objectContaining({ value: "0" }),
        expect.objectContaining({ value: "0" }),
        expect.objectContaining({ value: "0" }),
      ],
    });
  });

  it.each([
    ["teachers", "/pages/hr/teachers/index"],
    ["reports", "/pages/hr/teaching/index"],
    ["teaching", "/pages/hr/teaching/index"],
    ["earnings", "/pages/hr/earnings/index"],
    ["growth", "/pages/hr/teachers/index"],
    ["profile", "/pages/hr/profile/index"],
  ])("routes %s to an existing HR page", (key, url) => {
    page.onActionTap({ currentTarget: { dataset: { key } } });
    expect(navigateTo).toHaveBeenCalledWith({ url });
  });

  it("opens profile from the name and keeps it out of bottom navigation", () => {
    expect(page.data.actions).toEqual([
      expect.objectContaining({ key: "teaching" }),
      expect.objectContaining({ key: "earnings" }),
      expect.objectContaining({ key: "growth", label: "成长" }),
      expect.objectContaining({ key: "teachers" }),
    ]);
    expect(page.data.actions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "home" }),
        expect.objectContaining({ key: "profile" }),
      ]),
    );
    const markup = fs.readFileSync(
      path.resolve(__dirname, "../pages/hr/home/index.wxml"),
      "utf8",
    );
    expect(markup).toMatch(
      /<button\s+class="home__identity"\s+data-key="profile"\s+bindtap="onActionTap"/s,
    );
  });

  it("logs out explicitly through the shared session service", () => {
    page.onLogout();
    expect(mockSession.logout).toHaveBeenCalledTimes(1);
    expect(reLaunch).toHaveBeenCalledWith({ url: "/pages/bootstrap/index" });
  });

  it("uses the established home composition without fake business statistics", () => {
    const pageDir = path.resolve(__dirname, "../pages/hr/home");
    const wxml = fs.readFileSync(path.join(pageDir, "index.wxml"), "utf8");
    const wxss = fs.readFileSync(path.join(pageDir, "index.wxss"), "utf8");
    const json = fs.readFileSync(path.join(pageDir, "index.json"), "utf8");
    const source = [wxml, wxss, json].join("\n");
    const config = JSON.parse(json) as {
      usingComponents?: Record<string, string>;
    };

    for (const state of ["loading", "ready", "error", "forbidden"]) {
      expect(source).toContain(state);
    }
    expect(config.usingComponents?.["super-admin-page-shell"]).toBe(
      "/components/super-admin-page-shell/super-admin-page-shell",
    );
    expect(wxml).toContain("<super-admin-page-shell");
    expect(wxml).toContain('class="home__overview"');
    expect(wxml).toContain('class="home__overview-glass"');
    expect(wxml).toContain("{{item.value}}");
    expect(wxml).toContain("{{item.unit}}");
    expect(wxml).toContain("/pages/hr/assets/home-character.png");
    expect(wxml).toContain("/pages/hr/assets/home-stat-glass.png");
    expect(wxml).toContain("/pages/hr/assets/home-mark-glyph.png");
    const logic = fs.readFileSync(path.join(pageDir, "index.ts"), "utf8");
    expect(logic).toContain("/pages/hr/assets/icon-teachers.png");
    expect(logic).toContain("/pages/hr/assets/icon-teaching.png");
    expect(logic).toContain("/pages/hr/assets/icon-earnings.png");
    expect(logic).toContain("/pages/hr/assets/icon-growth.png");
    expect(wxml).toContain('class="quick-actions"');
    expect(wxml).toContain(
      "item.key === 'teachers' ? 'quick-action--active' : ''",
    );
    expect(wxml).toContain('class="home__footer-more"');
    expect(wxml).toContain(">查看更多</button>");
    expect(wxml).not.toContain('class="home__logout"');
    expect(wxml).not.toContain('class="home__identity-row"');
    expect(wxml).toContain('data-key="teachers"');
    expect(wxml).toContain('data-key="reports"');
    expect(wxss).toContain("var(--role-home-glass-height)");
    expect(wxss).toMatch(
      /\.home__overview\s*\{[^}]*background:\s*var\(--role-home-glass-background\)/s,
    );
    expect(wxss).toMatch(
      /\.quick-actions\s*\{[^}]*width:\s*var\(--role-home-nav-width\)/s,
    );
    expect(wxss).toMatch(
      /\.quick-actions::before\s*\{[^}]*width:\s*var\(--role-home-nav-capsule-width\)/s,
    );
    expect(wxss).toContain("var(--role-home-nav-active-size)");
    expect(wxss).toContain("var(--role-home-more-height)");
    expect(wxss).toMatch(/\.home__stage\s*\{[^}]*overflow:\s*visible/s);
    expect(wxss).toMatch(
      /\.home__character\s*\{[^}]*top:\s*-20rpx[^}]*left:\s*28rpx[^}]*z-index:\s*0[^}]*width:\s*700rpx/s,
    );
    expect(wxss).toMatch(
      /\.home__identity\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*238rpx/s,
    );
    expect(wxss).toMatch(/\.home__footer\s*\{[^}]*z-index:\s*3/s);
    expect(source).not.toContain("shell__wave");
    const character = fs.readFileSync(
      path.resolve(__dirname, "../pages/hr/assets/home-character.png"),
    );
    expect(
      character.readUInt32BE(20) / character.readUInt32BE(16),
    ).toBeGreaterThan(1.5);
    expect(source).not.toMatch(/overview-action__value">(?:档案|维护|查看)</);
    expect(source).not.toMatch(/待结算\s*\d|实时更新/);
    expect(source).not.toMatch(/凯曼|教育赋能|Kaiman|Empowering Education/i);
  });
});
