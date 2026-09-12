import { SuperAdminRevenueView } from "../types/super-admin";
import { formatMoneyFen } from "../utils/super-admin-format";

export interface SuperAdminRevenueMetricView {
  key: "attendees" | "gross" | "partner" | "retained";
  label: string;
  value: string;
}

export interface SuperAdminRevenueCampusRowView {
  campusId: string;
  campusName: string;
  partnerCountLabel: string;
  countedAttendeeLabel: string;
  grossLessonRevenueLabel: string;
  partnerEarningLabel: string;
  headquartersRetainedLabel: string;
}

export function presentSuperAdminRevenue(revenue: SuperAdminRevenueView): {
  partnerCountLabel: string;
  metrics: SuperAdminRevenueMetricView[];
  campuses: SuperAdminRevenueCampusRowView[];
} {
  return {
    partnerCountLabel: `${revenue.partnerCount} 个合作方`,
    metrics: [
      {
        key: "attendees",
        label: "有效人次",
        value: `${revenue.countedAttendeeCount}人次`,
      },
      {
        key: "gross",
        label: "课耗流水",
        value: formatMoneyFen(revenue.grossLessonRevenueFen),
      },
      {
        key: "partner",
        label: "合作方收益",
        value: formatMoneyFen(revenue.partnerEarningFen),
      },
      {
        key: "retained",
        label: "总部留存",
        value: formatMoneyFen(revenue.headquartersRetainedFen),
      },
    ],
    campuses: revenue.campuses.map((campus) => ({
      campusId: campus.campusId,
      campusName: campus.campusName,
      partnerCountLabel: `${campus.partnerCount} 个合作方`,
      countedAttendeeLabel: `${campus.countedAttendeeCount}人次`,
      grossLessonRevenueLabel: formatMoneyFen(campus.grossLessonRevenueFen),
      partnerEarningLabel: formatMoneyFen(campus.partnerEarningFen),
      headquartersRetainedLabel: formatMoneyFen(campus.headquartersRetainedFen),
    })),
  };
}
