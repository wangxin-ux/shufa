import { superAdminService } from "../../../services/super-admin-runtime";
import {
  presentSuperAdminRevenue,
  SuperAdminRevenueCampusRowView,
  SuperAdminRevenueMetricView,
} from "../../../services/super-admin-dashboard.presenter";
import { SuperAdminRevenuePeriod } from "../../../types/super-admin";

const REVENUE_PERIODS: SuperAdminRevenuePeriod[] = [
  "TODAY",
  "LAST_7_DAYS",
  "CURRENT_MONTH",
  "HISTORY",
];

Page({
  data: {
    viewState: "loading",
    errorMessage: "",
    metrics: [] as Array<{ label: string; value: string }>,
    selectedRevenuePeriod: "TODAY" as SuperAdminRevenuePeriod,
    revenuePeriodLabel: "",
    partnerCountLabel: "",
    revenueMetrics: [] as SuperAdminRevenueMetricView[],
    revenueCampuses: [] as SuperAdminRevenueCampusRowView[],
  },
  onLoad() {
    void this.load();
  },
  async load() {
    this.setData({ viewState: "loading", errorMessage: "" });
    const state = await superAdminService.loadDashboard(
      this.data.selectedRevenuePeriod,
    );
    if (state.status === "success" || state.status === "empty") {
      const revenue = presentSuperAdminRevenue(state.data.revenue);
      this.setData({
        viewState: state.status,
        metrics: [
          { label: "校区总数", value: `${state.data.campusCount}所` },
          { label: "在读学员", value: `${state.data.activeStudentCount}人` },
          {
            label: "本月授课",
            value: `${state.data.monthCompletedLessonCount}节`,
          },
          { label: "低课时预警", value: `${state.data.warningStudentCount}人` },
        ],
        revenuePeriodLabel: state.data.revenue.periodLabel,
        partnerCountLabel: revenue.partnerCountLabel,
        revenueMetrics: revenue.metrics,
        revenueCampuses: revenue.campuses,
      });
    } else if (state.status === "error")
      this.setData({
        viewState: state.statusCode === 403 ? "forbidden" : "error",
        errorMessage: state.message,
      });
  },
  onRevenuePeriodTap(event: WechatMiniprogram.TouchEvent) {
    const period = String(
      event.currentTarget.dataset.period ?? "",
    ) as SuperAdminRevenuePeriod;
    if (
      !REVENUE_PERIODS.includes(period) ||
      period === this.data.selectedRevenuePeriod
    )
      return;
    this.setData({ selectedRevenuePeriod: period });
    void this.load();
  },
  onNavigate(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: String(event.currentTarget.dataset.url ?? "") });
  },
  onRetry() {
    void this.load();
  },
});
