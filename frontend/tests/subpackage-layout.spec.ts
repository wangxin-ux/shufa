import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");

const ROLE_PACKAGES: ReadonlyArray<{
  root: string;
  pages: readonly string[];
}> = [
  {
    root: "pages/parent",
    pages: [
      "home/index",
      "hours/index",
      "leave/index",
      "profile/index",
      "student-profile/index",
      "updates/index",
      "group-campaigns/index",
      "group-detail/index",
      "group-orders/index",
      "campuses/index",
    ],
  },
  {
    root: "pages/teacher",
    pages: [
      "home/index",
      "schedule/index",
      "students/index",
      "student-detail/index",
      "lesson/index",
      "feedback/index",
      "feedback-detail/index",
      "records/index",
      "ledger/index",
      "profile/index",
      "settings/index",
      "earnings/index",
      "group-campaigns/index",
      "group-detail/index",
    ],
  },
  {
    root: "pages/campus-manager",
    pages: [
      "home/index",
      "students/index",
      "teachers/index",
      "student-detail/index",
      "schedule/index",
      "leave-requests/index",
      "warnings/index",
      "campus-settings/index",
      "profile/index",
    ],
  },
  {
    root: "pages/super-admin",
    pages: [
      "home/index",
      "dashboard/index",
      "students/index",
      "teachers/index",
      "student-detail/index",
      "campuses/index",
      "campus-detail/index",
      "lesson-ledger/index",
      "lesson-adjust/index",
      "earnings/index",
      "withdrawals/index",
      "earning-rules/index",
      "partner-earning-rules/index",
      "partner-earnings/index",
      "withdrawal-policies/index",
      "profile/index",
      "settings/index",
      "role-permissions/index",
      "audit-logs/index",
      "brand/index",
      "group-campaigns/index",
      "group-orders/index",
      "staff-accounts/index",
      "finance-review/index",
    ],
  },
  {
    root: "pages/partner",
    pages: [
      "home/index",
      "students/index",
      "student-detail/index",
      "warnings/index",
      "attendance/index",
      "teachers/index",
      "profile/index",
      "earnings/index",
      "operations/index",
      "group-campaigns/index",
      "group-detail/index",
    ],
  },
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
];

const SHARED_ROLE_ASSETS = [
  "assets/teacher/home-mascot.png",
  "assets/teacher/home-stat-glass.png",
  "assets/campus-manager/home-stat-glass.png",
  "assets/super-admin/home-stat-glass.png",
  "assets/partner/home-stat-glass.png",
];

const MIGRATED_ASSETS: Record<string, readonly string[]> = {
  parent: [
    "home-mascot.png",
    "home-metric-glass.png",
    "hours-ledger-mascot.png",
    "hours-mascot.png",
    "icon-mark-home.png",
    "icon-mark-hours.png",
    "icon-mark-leave.png",
    "icon-mark-profile.png",
    "icon-qa-hours.png",
    "icon-qa-leave.png",
    "icon-qa-remind.png",
    "icon-qa-team.png",
    "icon-qa-campus.png",
    "map-marker.png",
    "leave-mascot.png",
    "profile-backdrop.png",
    "profile-mascot.png",
  ],
  teacher: [
    "icon-confirm.png",
    "icon-schedule.png",
    "icon-student-record.png",
    "icon-students.png",
    "profile-card-mascot.png",
    "profile-footer-mascot.png",
  ],
  "campus-manager": [
    "home-character.png",
    "home-mark.png",
    "home-mark-glyph.png",
    "icon-approvals.png",
    "icon-schedule.png",
    "icon-student-create.png",
    "icon-warnings.png",
    "profile-lower-character.png",
    "profile-mark-glyph.png",
    "profile-mark.png",
    "profile-top-character.png",
  ],
  "super-admin": [
    "home-character.png",
    "home-mark.png",
    "home-mark-glyph.png",
    "icon-brand.png",
    "icon-campuses.png",
    "icon-dashboard.png",
    "icon-ledger.png",
    "ledger-flow-character.png",
    "ledger-top-character.png",
    "profile-lower-character.png",
    "profile-top-character.png",
  ],
  partner: [
    "home-character.png",
    "home-mark.png",
    "home-mark-glyph.png",
    "icon-attendance.png",
    "icon-students.png",
    "icon-teachers.png",
    "icon-warnings.png",
    "lesson-account-lower-character.png",
    "lesson-account-mark.png",
    "lesson-account-mark-glyph.png",
    "lesson-account-top-character.png",
    "profile-lower-character.png",
    "profile-mark.png",
    "profile-mark-glyph.png",
    "profile-top-character.png",
  ],
  finance: [
    "home-character.png",
    "home-mark-glyph.png",
    "icon-receipts.png",
    "icon-refunds.png",
    "icon-reports.png",
  ],
  hr: [
    "home-character.png",
    "home-mark-glyph.png",
    "icon-teachers.png",
    "icon-teaching.png",
    "icon-earnings.png",
  ],
};

function readApp(): {
  pages: string[];
  subPackages?: Array<{
    root: string;
    pages: string[];
    independent?: boolean;
  }>;
} {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, "app.json"), "utf8"),
  ) as ReturnType<typeof readApp>;
}

function walkFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

describe("role subpackage layout", () => {
  it("keeps bootstrap in main and registers existing roles plus the finance standard page", () => {
    const app = readApp();
    expect(app.pages).toEqual(["pages/bootstrap/index"]);
    expect(app.subPackages).toEqual(
      ROLE_PACKAGES.map(({ root, pages }) => ({ root, pages: [...pages] })),
    );
    expect(
      app.subPackages?.every(({ independent }) => independent !== true),
    ).toBe(true);
  });

  it("keeps every registered route backed by complete page files", () => {
    const app = readApp();
    const registered = [
      ...app.pages,
      ...(app.subPackages ?? []).flatMap(({ root, pages }) =>
        pages.map((page) => `${root}/${page}`),
      ),
    ];
    expect(registered).toHaveLength(87);
    for (const page of registered) {
      for (const extension of ["ts", "json", "wxml", "wxss"]) {
        expect(fs.existsSync(path.join(ROOT, `${page}.${extension}`))).toBe(
          true,
        );
      }
    }
  });

  it("keeps shared component images in main and role-only images private", () => {
    for (const asset of SHARED_ROLE_ASSETS) {
      expect(fs.existsSync(path.join(ROOT, asset))).toBe(true);
    }
    for (const [role, assets] of Object.entries(MIGRATED_ASSETS)) {
      for (const asset of assets) {
        expect(fs.existsSync(path.join(ROOT, "assets", role, asset))).toBe(
          false,
        );
        expect(
          fs.existsSync(path.join(ROOT, "pages", role, "assets", asset)),
        ).toBe(true);
      }
    }
  });

  it("resolves every absolute PNG reference in runtime source", () => {
    const runtimeRoots = ["pages", "components", "services"];
    const sourceFiles = runtimeRoots.flatMap((root) =>
      walkFiles(path.join(ROOT, root)).filter((file) =>
        /\.(?:ts|wxml)$/.test(file),
      ),
    );
    const assetPattern =
      /["'](\/(?:assets|pages\/[^/]+\/assets)\/[^"']+\.png)["']/g;

    for (const sourceFile of sourceFiles) {
      const source = fs.readFileSync(sourceFile, "utf8");
      for (const match of source.matchAll(assetPattern)) {
        expect(
          fs.existsSync(path.join(ROOT, match[1].replace(/^\//, ""))),
        ).toBe(true);
      }
    }
  });

  it("keeps estimated main and role packages within upload budgets", () => {
    const ignoredTopLevel = new Set(["node_modules", "tests", "scripts"]);
    const packageRoots = ROLE_PACKAGES.map(({ root }) => path.join(ROOT, root));
    const sourceFiles = fs
      .readdirSync(ROOT, { withFileTypes: true })
      .filter((entry) => !ignoredTopLevel.has(entry.name))
      .flatMap((entry) => {
        const fullPath = path.join(ROOT, entry.name);
        return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
      });
    const packageSizes = packageRoots.map((packageRoot) =>
      sourceFiles
        .filter((file) => file.startsWith(`${packageRoot}${path.sep}`))
        .reduce((total, file) => total + fs.statSync(file).size, 0),
    );
    const mainSize = sourceFiles
      .filter(
        (file) =>
          !packageRoots.some((packageRoot) =>
            file.startsWith(`${packageRoot}${path.sep}`),
          ),
      )
      .reduce((total, file) => total + fs.statSync(file).size, 0);

    expect(mainSize).toBeLessThanOrEqual(1.5 * 1024 * 1024);
    for (const packageSize of packageSizes) {
      expect(packageSize).toBeLessThanOrEqual(2 * 1024 * 1024);
    }
    expect(
      mainSize + packageSizes.reduce((sum, size) => sum + size, 0),
    ).toBeLessThanOrEqual(20 * 1024 * 1024);
  });
});
