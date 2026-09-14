import * as fs from "fs";
import * as path from "path";
import {
  buildSuperAdminHomePageModel,
  resolveSuperAdminHomeAction,
  SUPER_ADMIN_HOME_ACTIONS,
} from "../services/super-admin-home.presenter";
import { SuperAdminDashboard } from "../types/super-admin";

const dashboard: SuperAdminDashboard = {
  administrator: { displayName: "系统管理员" },
  reportingTimeZone: "Asia/Shanghai",
  campusCount: 3,
  activeStudentCount: 106,
  monthCompletedLessonCount: 72,
  warningStudentCount: 18,
  featuredCampus: {
    id: "campus-1",
    name: "启明东校区",
    activeStudentCount: 103,
    monthCompletedLessonCount: 93,
    attendanceRatePercent: 96,
    warningStudentCount: 6,
  },
  revenue: {
    period: "TODAY",
    periodLabel: "今日",
    partnerCount: 1,
    countedAttendeeCount: 10,
    grossLessonRevenueFen: 10000,
    partnerEarningFen: 4000,
    headquartersRetainedFen: 6000,
    currency: "CNY",
    campuses: [],
  },
  serverTime: "2026-08-31T08:00:00+08:00",
};

describe("super admin home", () => {
  it("presents global and featured-campus facts without frontend calculation", () => {
    expect(buildSuperAdminHomePageModel(dashboard)).toMatchObject({
      administratorName: "系统管理员",
      featuredCampusName: "启明东校区",
      featuredStudentCount: "103",
      featuredSummary: "本月授课93节 出勤率96% 6人预警",
      stats: [
        { key: "students", label: "在读学员", value: "106", unit: "人" },
        { key: "lessons", label: "本月授课", value: "72", unit: "节" },
        { key: "warnings", label: "低课时", value: "18", unit: "人" },
      ],
    });
  });

  it("keeps the confirmed global dashboard in the home navigation", () => {
    expect(
      SUPER_ADMIN_HOME_ACTIONS.map(({ key, label }) => ({ key, label })),
    ).toEqual([
      { key: "campuses", label: "校区管理" },
      { key: "accounts", label: "账号管理" },
      { key: "students", label: "学员管理" },
      { key: "dashboard", label: "全局看板" },
    ]);
    expect(resolveSuperAdminHomeAction("campuses")).toEqual({
      kind: "navigate",
      url: "/pages/super-admin/campuses/index",
    });
    expect(resolveSuperAdminHomeAction("students")).toEqual({
      kind: "navigate",
      url: "/pages/super-admin/students/index",
    });
    expect(resolveSuperAdminHomeAction("accounts")).toEqual({
      kind: "navigate",
      url: "/pages/super-admin/staff-accounts/index",
    });
    expect(resolveSuperAdminHomeAction("dashboard")).toEqual({
      kind: "navigate",
      url: "/pages/super-admin/dashboard/index",
    });
    expect(resolveSuperAdminHomeAction("more")).toEqual({
      kind: "navigate",
      url: "/pages/super-admin/group-campaigns/index",
    });

    const root = path.resolve(__dirname, "..");
    expect(
      fs.existsSync(
        path.join(root, "pages/super-admin/assets/icon-students.png"),
      ),
    ).toBe(true);
    expect(
      fs.readFileSync(
        path.join(root, "pages/super-admin/profile/index.wxml"),
        "utf8",
      ),
    ).toContain("/pages/super-admin/brand/index");
  });

  it("registers all required states and excludes the banned page logo", () => {
    const page = path.resolve(__dirname, "../pages/super-admin/home");
    const source = ["index.wxml", "index.wxss", "index.json"]
      .map((file) => fs.readFileSync(path.join(page, file), "utf8"))
      .join("\n");
    for (const state of ["loading", "ready", "empty", "error", "forbidden"]) {
      expect(source).toContain(state);
    }
    expect(source).toContain("/pages/super-admin/assets/home-character.png");
    expect(source).toContain("/pages/super-admin/assets/home-mark-glyph.png");
    expect(source).not.toContain("/pages/super-admin/assets/home-mark.png");
    expect(source).not.toMatch(/凯曼|教育赋能|Kaiman|Empowering Education/i);
    expect(source).not.toContain("超级管理员 · 全部校区");
    expect(source).not.toContain('class="home__role"');
  });

  it("keeps the PSD glass transparent and balances the footer navigation", () => {
    const root = path.resolve(__dirname, "..");
    const markup = fs.readFileSync(
      path.join(root, "pages/super-admin/home/index.wxml"),
      "utf8",
    );
    const styles = fs.readFileSync(
      path.join(root, "pages/super-admin/home/index.wxss"),
      "utf8",
    );
    const statStyles = fs.readFileSync(
      path.join(
        root,
        "components/super-admin-stat-strip/super-admin-stat-strip.wxss",
      ),
      "utf8",
    );
    const extraction = fs.readFileSync(
      path.join(root, "scripts/extract-super-admin-assets.py"),
      "utf8",
    );
    const glassAsset = fs.readFileSync(
      path.join(root, "assets/super-admin/home-stat-glass.png"),
    );

    expect(statStyles).toMatch(/\.stats\s*\{[^}]*background:\s*transparent/s);
    expect(extraction).toContain(
      'select_layer(layers, "矩形 3", (72, 1686, 1050, 1951))',
    );
    expect(extraction).not.toContain("GaussianBlur(radius=16)");
    expect(glassAsset.readUInt32BE(16)).toBe(654);
    expect(glassAsset.readUInt32BE(20)).toBe(176);
    expect(markup).toMatch(/class="home__footer-more"[^>]*data-key="more"/s);
    expect(styles).toMatch(
      /\.home__footer\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*space-between/s,
    );
    expect(styles).toMatch(
      /\.home__stage\s*\{[^}]*height:\s*800rpx[^}]*margin:\s*-74rpx -32rpx 0/s,
    );
    expect(styles).toMatch(/\.home__stats\s*\{[^}]*bottom:\s*68rpx/s);
    expect(styles).toMatch(
      /\.home__footer\s*\{[^}]*min-height:\s*166rpx[^}]*margin-top:\s*-32rpx[^}]*padding:\s*0 16rpx/s,
    );
    expect(styles).toMatch(
      /\.quick-action\s*\{[^}]*box-sizing:\s*border-box[^}]*line-height:\s*1\.2/s,
    );
    expect(styles).toMatch(
      /\.quick-action__label\s*\{[^}]*text-align:\s*center/s,
    );
    expect(styles).toMatch(
      /\.home__character\s*\{[^}]*top:\s*-10rpx[^}]*left:\s*95rpx[^}]*width:\s*655rpx/s,
    );
    expect(styles).toMatch(/\.home__identity\s*\{[^}]*bottom:\s*218rpx/s);
  });
});
