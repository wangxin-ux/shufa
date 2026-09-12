import * as fs from "fs";
import * as path from "path";

const FRONTEND_ROOT = path.resolve(__dirname, "..");

function readJson(relPath: string): Record<string, unknown> {
  const full = path.join(FRONTEND_ROOT, relPath);
  expect(fs.existsSync(full)).toBe(true);
  return JSON.parse(fs.readFileSync(full, "utf-8")) as Record<string, unknown>;
}

describe("mini program project structure", () => {
  const PARENT_PAGES = [
    "pages/parent/home/index",
    "pages/parent/hours/index",
    "pages/parent/leave/index",
    "pages/parent/profile/index",
    "pages/parent/student-profile/index",
    "pages/parent/updates/index",
    "pages/parent/group-campaigns/index",
    "pages/parent/group-detail/index",
    "pages/parent/group-orders/index",
    "pages/parent/campuses/index",
  ];

  it("app.json keeps bootstrap in main and parent pages in one subpackage", () => {
    const appJson = readJson("app.json");
    expect(appJson.pages).toEqual(["pages/bootstrap/index"]);
    const parentPackage = (
      appJson.subPackages as Array<{ root: string; pages: string[] }>
    ).find(({ root }) => root === "pages/parent");
    expect(parentPackage?.pages.map((page) => `pages/parent/${page}`)).toEqual(
      PARENT_PAGES,
    );
  });

  it("every registered page has ts/json/wxml/wxss files", () => {
    for (const page of PARENT_PAGES) {
      for (const ext of ["ts", "json", "wxml", "wxss"]) {
        expect(fs.existsSync(path.join(FRONTEND_ROOT, `${page}.${ext}`))).toBe(
          true,
        );
      }
    }
  });

  it("registers finance and the HR teacher workspace", () => {
    const appJson = readJson("app.json");
    const packages = appJson.subPackages as Array<{
      root: string;
      pages: string[];
    }>;
    expect(packages.filter(({ root }) => /\/(hr|finance)$/.test(root))).toEqual(
      [
        {
          root: "pages/finance",
          pages: [
            "home/index",
            "packages/index",
            "receipts/index",
            "hours/index",
            "refunds/index",
            "reports/index",
            "profile/index",
            "more/index",
            "orders/index",
            "earnings/index",
            "payouts/index",
            "cash-flow/index",
            "profitability/index",
          ],
        },
        {
          root: "pages/hr",
          pages: [
            "home/index",
            "teachers/index",
            "teaching/index",
            "earnings/index",
            "profile/index",
          ],
        },
      ],
    );
    const session = fs.readFileSync(
      path.join(FRONTEND_ROOT, "services/session.service.ts"),
      "utf8",
    );
    expect(session).toMatch(/code:\s*['"]FINANCE['"]/);
    expect(session).toMatch(/code:\s*['"]HR['"]/);
    const preview = fs.readFileSync(
      path.join(FRONTEND_ROOT, "pages/finance/receipts/index.ts"),
      "utf8",
    );
    expect(preview).toContain("canPreviewFinance(version, query.preview)");
    expect(preview).not.toMatch(/requestPayment|setStorageSync|wx\.request/);
    const template = fs.readFileSync(
      path.join(FRONTEND_ROOT, "pages/finance/receipts/index.wxml"),
      "utf8",
    );
    expect(template).not.toMatch(/\{\{[^}]*&amp;/);
  });

  it("project.config.json uses the temporarily approved appid without secrets", () => {
    const config = readJson("project.config.json");
    const serialized = JSON.stringify(config);
    expect(serialized).not.toMatch(/appsecret/i);
    expect(serialized).not.toMatch(/private[_-]?key/i);
    expect(config.appid).toBe("wx2796dc17144731b5");
  });

  const COMPONENTS = [
    "parent-page-mark",
    "parent-action-card",
    "view-state",
    "parent-page-shell",
    "parent-metric-card",
    "parent-primary-button",
    "parent-record-card",
  ];

  it("every shared component has ts/json/wxml/wxss files", () => {
    for (const name of COMPONENTS) {
      for (const ext of ["ts", "json", "wxml", "wxss"]) {
        expect(
          fs.existsSync(
            path.join(FRONTEND_ROOT, "components", name, `${name}.${ext}`),
          ),
        ).toBe(true);
      }
    }
  });

  it("no page or shared component renders the removed brand logo or brand text", () => {
    // 2026-08-28 用户决定：右上角狗头 logo 整体移除，不再使用。
    const targets = [
      path.join(
        FRONTEND_ROOT,
        "components",
        "parent-page-shell",
        "parent-page-shell.wxml",
      ),
      ...PARENT_PAGES.map((page) => path.join(FRONTEND_ROOT, `${page}.wxml`)),
    ];
    for (const target of targets) {
      const wxml = fs.readFileSync(target, "utf-8");
      expect(wxml).not.toContain("parent-brand-mark");
      expect(wxml).not.toContain("brand-dog-head");
      expect(wxml).not.toMatch(/凯曼|KAIMAN|EDUCATION/i);
    }
    expect(
      fs.existsSync(
        path.join(FRONTEND_ROOT, "components", "parent-brand-mark"),
      ),
    ).toBe(false);
  });

  it("home page uses page shell and mascot asset, no brand text or backend urls", () => {
    const wxml = fs.readFileSync(
      path.join(FRONTEND_ROOT, "pages/parent/home/index.wxml"),
      "utf-8",
    );
    expect(wxml).toContain("parent-page-shell");
    expect(wxml).toContain("home-mascot.png");
    expect(wxml).not.toMatch(/凯曼|KAIMAN|EDUCATION/i);
    expect(wxml).not.toMatch(/https?:\/\//);
    const json = readJson("pages/parent/home/index.json") as {
      usingComponents?: Record<string, string>;
    };
    const used = Object.keys(json.usingComponents ?? {});
    expect(used).toEqual(
      expect.arrayContaining(["parent-page-shell", "parent-metric-card"]),
    );
  });

  it("hours page wires shared components and never invokes real payment", () => {
    const wxml = fs.readFileSync(
      path.join(FRONTEND_ROOT, "pages/parent/hours/index.wxml"),
      "utf-8",
    );
    const pageTs = fs.readFileSync(
      path.join(FRONTEND_ROOT, "pages/parent/hours/index.ts"),
      "utf-8",
    );
    const json = readJson("pages/parent/hours/index.json") as {
      usingComponents?: Record<string, string>;
    };
    const used = Object.keys(json.usingComponents ?? {});

    expect(wxml).toContain("parent-page-shell");
    expect(wxml).toContain("hours-mascot.png");
    expect(wxml).toContain("view-state");
    expect(wxml).toContain("parent-record-card");
    expect(wxml).toContain("parent-primary-button");
    expect(used).toEqual(
      expect.arrayContaining([
        "parent-page-shell",
        "parent-record-card",
        "parent-primary-button",
        "view-state",
      ]),
    );
    expect(pageTs).toContain("parentService.loadHoursView");
    expect(pageTs).not.toMatch(/requestPayment|mch[_-]?id|商户号/i);
  });

  it("leave page wires the validated workflow and shared visual components", () => {
    const wxml = fs.readFileSync(
      path.join(FRONTEND_ROOT, "pages/parent/leave/index.wxml"),
      "utf-8",
    );
    const pageTs = fs.readFileSync(
      path.join(FRONTEND_ROOT, "pages/parent/leave/index.ts"),
      "utf-8",
    );
    const json = readJson("pages/parent/leave/index.json") as {
      usingComponents?: Record<string, string>;
    };
    const used = Object.keys(json.usingComponents ?? {});

    expect(wxml).toContain("parent-page-shell");
    expect(wxml).toContain("leave-mascot.png");
    expect(wxml).toContain("parent-action-card");
    expect(wxml).toContain("parent-primary-button");
    expect(wxml).toContain("parent-record-card");
    expect(wxml).toContain("view-state");
    expect(used).toEqual(
      expect.arrayContaining([
        "parent-page-shell",
        "parent-action-card",
        "parent-primary-button",
        "parent-record-card",
        "view-state",
      ]),
    );
    expect(pageTs).toContain("ParentLeaveWorkflow");
  });

  it("profile page wires dynamic profile data and the existing hours route", () => {
    const wxml = fs.readFileSync(
      path.join(FRONTEND_ROOT, "pages/parent/profile/index.wxml"),
      "utf-8",
    );
    const pageTs = fs.readFileSync(
      path.join(FRONTEND_ROOT, "pages/parent/profile/index.ts"),
      "utf-8",
    );
    const json = readJson("pages/parent/profile/index.json") as {
      usingComponents?: Record<string, string>;
    };
    const used = Object.keys(json.usingComponents ?? {});

    expect(wxml).toContain("parent-page-shell");
    expect(wxml).toContain("profile-mascot.png");
    expect(wxml).toContain("parent-action-card");
    expect(wxml).toContain("view-state");
    expect(used).toEqual(
      expect.arrayContaining([
        "parent-page-shell",
        "parent-action-card",
        "view-state",
      ]),
    );
    expect(pageTs).toContain("parentService.loadProfile");
    expect(pageTs).toContain("resolveParentProfileAction");
  });

  it("shows a shared back control on every parent subpage but not on home", () => {
    const shellWxml = fs.readFileSync(
      path.join(
        FRONTEND_ROOT,
        "components/parent-page-shell",
        "parent-page-shell.wxml",
      ),
      "utf-8",
    );
    expect(shellWxml).toContain("showBack");
    expect(shellWxml).toContain("onBackTap");
    expect(shellWxml).toContain("<button");
    expect(shellWxml).toContain('catchtap="onBackTap"');

    const home = fs.readFileSync(
      path.join(FRONTEND_ROOT, "pages/parent/home/index.wxml"),
      "utf-8",
    );
    expect(home).not.toContain("showBack");

    for (const page of ["hours", "leave", "profile", "updates"]) {
      const wxml = fs.readFileSync(
        path.join(FRONTEND_ROOT, "pages/parent", page, "index.wxml"),
        "utf-8",
      );
      expect(wxml).toContain('showBack="{{true}}"');
    }
  });

  it("classroom updates use real parent service data and shared themed components", () => {
    const wxml = fs.readFileSync(
      path.join(FRONTEND_ROOT, "pages/parent/updates/index.wxml"),
      "utf-8",
    );
    const pageTs = fs.readFileSync(
      path.join(FRONTEND_ROOT, "pages/parent/updates/index.ts"),
      "utf-8",
    );
    const json = readJson("pages/parent/updates/index.json") as {
      usingComponents?: Record<string, string>;
    };

    expect(wxml).toContain("parent-page-shell");
    expect(wxml).toContain("view-state");
    expect(wxml).not.toMatch(/凯曼|KAIMAN|EDUCATION/i);
    expect(Object.keys(json.usingComponents ?? {})).toEqual(
      expect.arrayContaining(["parent-page-shell", "view-state"]),
    );
    expect(pageTs).toContain("parentService.loadUpdates");
  });

  it("keeps the parent font roles aligned with the PSD typography", () => {
    const tokens = fs.readFileSync(
      path.join(FRONTEND_ROOT, "styles", "tokens.wxss"),
      "utf-8",
    );
    const appWxss = fs.readFileSync(
      path.join(FRONTEND_ROOT, "app.wxss"),
      "utf-8",
    );
    const appTs = fs.readFileSync(path.join(FRONTEND_ROOT, "app.ts"), "utf-8");

    expect(tokens).toContain("--parent-font-display");
    expect(tokens).toContain("ParentDisplay");
    expect(tokens).not.toContain("eryamianhuatang");
    expect(tokens).toContain("--parent-font-body");
    expect(tokens).toContain("DengXian");
    expect(tokens).toContain("--parent-font-nav");
    expect(appWxss).toContain("font-family: var(--parent-font-body)");
    expect(appTs).toContain("loadParentDisplayFont");
  });
});
