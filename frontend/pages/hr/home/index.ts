import { createSessionService } from "../../../services/session.service";
import { createHrApi } from "../../../services/hr.service";

const HR_HOME_ACTIONS = [
  {
    key: "teaching",
    label: "课耗",
    icon: "/pages/hr/assets/icon-teaching.png",
  },
  {
    key: "earnings",
    label: "课时费",
    icon: "/pages/hr/assets/icon-earnings.png",
  },
  {
    key: "growth",
    label: "成长",
    icon: "/pages/hr/assets/icon-growth.png",
  },
  {
    key: "teachers",
    label: "档案",
    icon: "/pages/hr/assets/icon-teachers.png",
  },
] as const;

const HR_ROUTES: Readonly<Record<string, string>> = {
  teachers: "/pages/hr/teachers/index",
  reports: "/pages/hr/teaching/index",
  teaching: "/pages/hr/teaching/index",
  earnings: "/pages/hr/earnings/index",
  growth: "/pages/hr/teachers/index",
  profile: "/pages/hr/profile/index",
};

interface HomeMetric {
  key: string;
  label: string;
  value: string;
  unit: string;
  sub: string;
}

const EMPTY_HR_OVERVIEW: ReadonlyArray<HomeMetric> = [
  {
    key: "teachers",
    label: "教师总数",
    value: "0",
    unit: "人",
    sub: "总部名册",
  },
  {
    key: "teaching",
    label: "本月授课",
    value: "0",
    unit: "次",
    sub: "有效课次",
  },
  {
    key: "earnings",
    label: "课时费记录",
    value: "0",
    unit: "条",
    sub: "本月记录",
  },
];

Page({
  data: {
    viewState: "loading",
    errorMessage: "",
    displayName: "",
    roleLabel: "总部人力",
    actions: HR_HOME_ACTIONS,
    overviewItems: EMPTY_HR_OVERVIEW,
  },

  onLoad() {
    void this.initialize();
  },

  onPullDownRefresh() {
    void this.initialize().finally(() => wx.stopPullDownRefresh());
  },

  async initialize() {
    this.setData({
      viewState: "loading",
      errorMessage: "",
      displayName: "",
      overviewItems: EMPTY_HR_OVERVIEW,
    });
    try {
      const session = await createSessionService().load();
      if (
        !session ||
        session.roles.length !== 1 ||
        session.roles[0].code !== "HR" ||
        session.roles[0].campusId !== null
      ) {
        this.setData({
          viewState: "forbidden",
          errorMessage: "请使用总部人力账号",
        });
        return;
      }
      const { from, to } = currentMonthRange();
      const api = createHrApi();
      const [teachers, teaching, earnings] = await Promise.all([
        api.teachers({ page: 1, pageSize: 1 }),
        api.teaching({ from, to, page: 1, pageSize: 1 }),
        api.earnings({ from, to, page: 1, pageSize: 1 }),
      ]);
      this.setData({
        viewState: "ready",
        errorMessage: "",
        displayName: session.displayName,
        overviewItems: [
          { ...EMPTY_HR_OVERVIEW[0], value: String(teachers.total) },
          {
            ...EMPTY_HR_OVERVIEW[1],
            value: String(teaching.summary.completedCount),
          },
          { ...EMPTY_HR_OVERVIEW[2], value: String(earnings.total) },
        ],
      });
    } catch (error) {
      this.setData({
        viewState: "error",
        errorMessage:
          error instanceof Error ? error.message : "会话加载失败，请重试",
      });
    }
  },

  onRetry() {
    void this.initialize();
  },

  onActionTap(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key ?? "");
    const url = HR_ROUTES[key];
    if (!url) {
      wx.showToast({ title: "入口暂不可用", icon: "none" });
      return;
    }
    wx.navigateTo({ url });
  },

  onLogout() {
    createSessionService().logout();
    wx.reLaunch({ url: "/pages/bootstrap/index" });
  },
});

function currentMonthRange() {
  const to = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  return { from: `${to.slice(0, 7)}-01`, to };
}
