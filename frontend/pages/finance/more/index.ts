const DAILY_ENTRIES = [
  { key: "packages", title: "课包录入", description: "按收款为学员登记购买课时与赠送课时", url: "/pages/finance/packages/index" },
  { key: "receipts", title: "收款总览", description: "按期间核对每位学员的收款与录包情况", url: "/pages/finance/receipts/index" },
  { key: "hours", title: "课时一览", description: "查看学员耗课、课程单价与剩余课时", url: "/pages/finance/hours/index" },
  { key: "refunds", title: "退课明细", description: "查看学生退课课次、退费金额与办理进度", url: "/pages/finance/refunds/index" },
] as const;

const OVERSIGHT_ENTRIES = [
  { key: "orders", title: "订单与凭证", description: "全平台订单、收款凭证与审核状态", url: "/pages/finance/orders/index" },
  { key: "earnings", title: "经营收益", description: "各校区课耗营收、平台留存与合作方收益", url: "/pages/finance/earnings/index" },
  { key: "payouts", title: "提现记录", description: "家长退费、教师课时费提现及合作方出款范围", url: "/pages/finance/payouts/index" },
  { key: "cash-flow", title: "资金流水", description: "真实收支事实、手续费状态与报表导出", url: "/pages/finance/cash-flow/index" },
  { key: "profitability", title: "成本收益", description: "按期间、地区和单个或多个校区汇总", url: "/pages/finance/profitability/index" },
] as const;

const ALL_ENTRIES = [...DAILY_ENTRIES, ...OVERSIGHT_ENTRIES];

Page({
  data: {
    dailyEntries: DAILY_ENTRIES,
    oversightEntries: OVERSIGHT_ENTRIES,
  },
  onNavigate(event: WechatMiniprogram.TouchEvent) {
    const item = ALL_ENTRIES.find(
      (entry) => entry.key === String(event.currentTarget.dataset.key),
    );
    if (item) wx.navigateTo({ url: item.url });
  },
});
