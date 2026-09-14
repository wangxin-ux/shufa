import * as fs from "fs";
import * as path from "path";

interface LogoutComponent {
  methods: { onLogoutTap(): void };
}

const sessionService = {
  logout: jest.fn(),
  logoutDestination: "/pages/bootstrap/index",
};

jest.mock("../services/session.service", () => ({ sessionService }));

describe("role logout pages", () => {
  const originalComponent = Object.getOwnPropertyDescriptor(
    globalThis,
    "Component",
  );
  const originalWx = Object.getOwnPropertyDescriptor(globalThis, "wx");
  const reLaunch = jest.fn();
  const showModal = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    Object.defineProperty(globalThis, "wx", {
      configurable: true,
      value: {
        navigateTo: jest.fn(),
        reLaunch,
        showModal,
        showToast: jest.fn(),
        stopPullDownRefresh: jest.fn(),
      },
    });
  });

  afterAll(() => {
    if (originalWx) Object.defineProperty(globalThis, "wx", originalWx);
    else Reflect.deleteProperty(globalThis, "wx");
    if (originalComponent) {
      Object.defineProperty(globalThis, "Component", originalComponent);
    } else {
      Reflect.deleteProperty(globalThis, "Component");
    }
  });

  it("uses one shared logout control across all seven role clients", () => {
    const pages = [
      "pages/parent/profile",
      "pages/teacher/profile",
      "pages/campus-manager/profile",
      "pages/partner/profile",
      "pages/super-admin/profile",
      "pages/hr/profile",
      "pages/finance/profile",
    ];

    for (const pagePath of pages) {
      const pageDir = path.resolve(__dirname, "..", pagePath);
      const markup = fs.readFileSync(path.join(pageDir, "index.wxml"), "utf8");
      const config = JSON.parse(
        fs.readFileSync(path.join(pageDir, "index.json"), "utf8"),
      ) as { usingComponents?: Record<string, string> };
      expect(markup).toContain("<session-logout");
      expect(markup).toMatch(/<session-logout\s+id="sessionLogout"/);
      expect(config.usingComponents?.["session-logout"]).toBe(
        "/components/session-logout/session-logout",
      );
    }
  });

  it("does not expose a second test-account switch control on role pages", () => {
    const pages = [
      "pages/parent/profile",
      "pages/teacher/profile",
      "pages/campus-manager/profile",
      "pages/partner/profile",
      "pages/super-admin/profile",
      "pages/hr/profile",
      "pages/finance/home",
      "pages/finance/profile",
    ];

    for (const pagePath of pages) {
      const pageDir = path.resolve(__dirname, "..", pagePath);
      const source = ["index.ts", "index.wxml"]
        .map((fileName) =>
          fs.readFileSync(path.join(pageDir, fileName), "utf8"),
        )
        .join("\n");
      expect(source).not.toMatch(/切换(?:本地)?测试账号/);
      expect(source).not.toContain("prepareTestAccountSwitch");
      expect(source).not.toContain("onSwitchTestAccountTap");
      expect(source).not.toContain("onSwitchAccount");
    }
  });

  it("aligns the shared logout control with the role content width", () => {
    const componentDir = path.resolve(
      __dirname,
      "../components/session-logout",
    );
    expect(fs.existsSync(path.join(componentDir, "session-logout.ts"))).toBe(
      true,
    );
    const styles = fs.readFileSync(
      path.join(componentDir, "session-logout.wxss"),
      "utf8",
    );

    expect(styles).toMatch(/width:\s*100%/);
    expect(styles).toMatch(/max-width:\s*653rpx/);
    expect(styles).toMatch(/border-radius:\s*8rpx/);
    expect(styles).toMatch(/background:\s*rgba\(255,\s*215,\s*94,\s*0\.84\)/);
    expect(styles).toMatch(/font-family:\s*var\(--parent-font-display\)/);
    expect(styles).not.toMatch(/width:\s*280rpx/);
    expect(styles).not.toMatch(/background:\s*rgba\(255,\s*255,\s*255/);
    expect(styles).not.toContain("#8b201b");
  });

  it("keeps logout in the content flow instead of below decorative stages", () => {
    const pageExpectations = [
      {
        pagePath: "pages/teacher/profile",
        stageClass: "profile__actions-stage",
      },
      {
        pagePath: "pages/campus-manager/profile",
        stageClass: "profile-actions-stage",
      },
      {
        pagePath: "pages/partner/profile",
        stageClass: "profile-actions-stage",
      },
    ];

    for (const { pagePath, stageClass } of pageExpectations) {
      const pageDir = path.resolve(__dirname, "..", pagePath);
      const markup = fs.readFileSync(path.join(pageDir, "index.wxml"), "utf8");
      const stage = findViewBlock(markup, stageClass);

      expect(stage).toContain('<session-logout id="sessionLogout" />');
    }

    const partnerMarkup = fs.readFileSync(
      path.resolve(__dirname, "../pages/partner/profile/index.wxml"),
      "utf8",
    );
    const partnerStage = findViewBlock(partnerMarkup, "profile-actions-stage");
    expect(partnerStage.indexOf('class="profile-details"')).toBeLessThan(
      partnerStage.indexOf("<session-logout"),
    );
  });

  it("lets the shared control own the confirmation and session clearing", () => {
    const component = loadLogoutComponent();
    showModal.mockImplementationOnce(({ success }) => {
      success({ confirm: true, cancel: false });
    });

    component.methods.onLogoutTap();

    expect(showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "退出登录",
        content: "确定退出当前账号吗？",
      }),
    );
    expect(sessionService.logout).toHaveBeenCalledTimes(1);
    expect(reLaunch).toHaveBeenCalledWith({ url: "/pages/bootstrap/index" });
  });

  it("keeps the current session when shared logout is cancelled", () => {
    const component = loadLogoutComponent();
    showModal.mockImplementationOnce(({ success }) => {
      success({ confirm: false, cancel: true });
    });

    component.methods.onLogoutTap();

    expect(sessionService.logout).not.toHaveBeenCalled();
    expect(reLaunch).not.toHaveBeenCalled();
  });
});

function loadLogoutComponent(): LogoutComponent {
  let component: LogoutComponent | undefined;
  Object.defineProperty(globalThis, "Component", {
    configurable: true,
    value: (definition: LogoutComponent) => {
      component = definition;
    },
  });
  jest.isolateModules(() =>
    require("../components/session-logout/session-logout"),
  );
  if (!component)
    throw new Error("Session logout component was not registered");
  return component;
}

function findViewBlock(markup: string, className: string): string {
  const tagPattern = /<\/?view\b[^>]*>/g;
  let match: RegExpExecArray | null;
  let start = -1;
  let depth = 0;

  while ((match = tagPattern.exec(markup))) {
    const tag = match[0];
    if (start < 0) {
      if (
        !tag.startsWith("</") &&
        new RegExp(`class=["'][^"']*\\b${className}\\b`).test(tag)
      ) {
        start = match.index;
        depth = 1;
      }
      continue;
    }

    depth += tag.startsWith("</") ? -1 : 1;
    if (depth === 0) return markup.slice(start, tagPattern.lastIndex);
  }

  throw new Error(`Missing view block: ${className}`);
}
