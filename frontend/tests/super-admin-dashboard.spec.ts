import * as fs from "fs";
import * as path from "path";
import { presentSuperAdminRevenue } from "../services/super-admin-dashboard.presenter";
import { SuperAdminRevenueView } from "../types/super-admin";

describe("super admin revenue dashboard", () => {
  const revenue: SuperAdminRevenueView = {
    period: "HISTORY",
    periodLabel: "历史",
    partnerCount: 1,
    countedAttendeeCount: 50,
    grossLessonRevenueFen: 500_000,
    partnerEarningFen: 100_000,
    headquartersRetainedFen: 400_000,
    currency: "CNY",
    campuses: [
      {
        campusId: "campus-a",
        campusName: "启明东校区",
        partnerCount: 1,
        countedAttendeeCount: 50,
        grossLessonRevenueFen: 500_000,
        partnerEarningFen: 100_000,
        headquartersRetainedFen: 400_000,
      },
    ],
  };

  it("formats backend-calculated totals and campus rows without recalculating them", () => {
    expect(presentSuperAdminRevenue(revenue)).toEqual({
      partnerCountLabel: "1 个合作方",
      metrics: [
        { key: "attendees", label: "有效人次", value: "50人次" },
        { key: "gross", label: "课耗流水", value: "¥5000.00" },
        { key: "partner", label: "合作方收益", value: "¥1000.00" },
        { key: "retained", label: "总部留存", value: "¥4000.00" },
      ],
      campuses: [
        {
          campusId: "campus-a",
          campusName: "启明东校区",
          partnerCountLabel: "1 个合作方",
          countedAttendeeLabel: "50人次",
          grossLessonRevenueLabel: "¥5000.00",
          partnerEarningLabel: "¥1000.00",
          headquartersRetainedLabel: "¥4000.00",
        },
      ],
    });
  });

  it("renders four period controls, the accounting note and campus bindings", () => {
    const root = path.resolve(__dirname, "..");
    const markup = fs.readFileSync(
      path.join(root, "pages/super-admin/dashboard/index.wxml"),
      "utf8",
    );
    const script = fs.readFileSync(
      path.join(root, "pages/super-admin/dashboard/index.ts"),
      "utf8",
    );

    for (const label of ["今日", "近7天", "本月", "历史"]) {
      expect(markup).toContain(label);
    }
    for (const label of ["有效人次", "课耗流水", "合作方收益", "总部留存"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("内部课耗口径，未扣教师课时费及其他成本");
    expect(markup).toContain("revenueCampuses");
    expect(markup).toContain('bindtap="onRevenuePeriodTap"');
    expect(script).toContain("presentSuperAdminRevenue");
    expect(script).toMatch(
      /loadDashboard\(\s*this\.data\.selectedRevenuePeriod,?\s*\)/s,
    );
  });
});
