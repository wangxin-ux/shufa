import {
  createHrApi,
  HrTeacher,
  HrTeachingReport,
} from "../../../services/hr.service";
import { createSessionService } from "../../../services/session.service";

interface ReportRow {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  lines: string[];
}

interface Metric {
  label: string;
  value: string;
  unit: string;
}

const units = (value: number) => String(value / 100);

function dateLabel(value: string) {
  return new Date(new Date(value).getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}

function reportView(result: HrTeachingReport): {
  rows: ReportRow[];
  metrics: Metric[];
} {
  return {
    metrics: [
      {
        label: "有效课次",
        value: String(result.summary.completedCount),
        unit: "次",
      },
      {
        label: "授课人次",
        value: String(result.summary.attendeeCount),
        unit: "人次",
      },
      {
        label: "授课课时",
        value: units(result.summary.lessonUnits),
        unit: "节",
      },
      {
        label: "学员课耗",
        value: units(result.summary.consumedUnits),
        unit: "节",
      },
    ],
    rows: result.items.map((row) => ({
      id: row.id,
      title: `${row.teacherName} · ${row.courseName}`,
      subtitle: `${row.campusName} · ${dateLabel(row.completedAt)}`,
      status: row.status === "COMPLETED" ? "已完成" : "已撤销",
      lines: [
        `授课 ${units(row.lessonUnits)} 节 · 到课 ${row.attendeeCount} 人次`,
        `有效课耗 ${units(row.consumedUnits)} 节`,
      ],
    })),
  };
}

function teacherOption(row: HrTeacher) {
  return {
    id: row.id,
    campusId: row.campusId,
    name: `${row.name} · ${row.campusName}`,
  };
}

Page({
  revision: 0,
  requestedTeacherId: "",
  data: {
    headerTop: 28,
    headerRight: 100,
    authorized: false,
    viewState: "loading",
    errorMessage: "",
    from: "",
    to: "",
    campusIndex: 0,
    campuses: [{ id: "", name: "全部校区" }],
    teacherIndex: 0,
    teachers: [{ id: "", campusId: "", name: "全部教师" }],
    rows: [] as ReportRow[],
    metrics: [] as Metric[],
    total: 0,
    page: 1,
    hasMore: false,
    loadingMore: false,
    exporting: false,
    exportError: "",
  },

  onLoad(options: Record<string, string | undefined>) {
    const now = chinaDate();
    const info = wx.getWindowInfo();
    let headerTop = (info.statusBarHeight || 20) + 8;
    let headerRight = 100;
    try {
      const capsule = wx.getMenuButtonBoundingClientRect();
      headerTop = capsule.top;
      headerRight = info.windowWidth - capsule.left + 8;
    } catch {
      /* Use the status-bar fallback. */
    }
    this.requestedTeacherId = options.teacherId || "";
    this.setData({
      headerTop,
      headerRight,
      from: `${now.slice(0, 7)}-01`,
      to: now,
    });
    void this.initialize();
  },

  async initialize() {
    this.setData({ authorized: false, viewState: "loading", errorMessage: "" });
    try {
      const session = await createSessionService().load();
      if (
        !session ||
        session.roles.length !== 1 ||
        session.roles[0].code !== "HR" ||
        session.roles[0].campusId !== null
      ) {
        throw new Error("请使用总部人力账号");
      }
      const api = createHrApi();
      const [campuses, teachers] = await Promise.all([
        loadAllCampuses(api),
        loadAllTeachers(api),
      ]);
      const teacherIndex = Math.max(
        0,
        teachers.findIndex((item) => item.id === this.requestedTeacherId),
      );
      this.setData({
        authorized: true,
        campuses,
        teachers,
        campusIndex: 0,
        teacherIndex,
      });
      await this.load();
    } catch (error) {
      this.setData({ viewState: "error", errorMessage: message(error) });
    }
  },

  async load(append = false) {
    if (
      !this.data.authorized ||
      (append && (!this.data.hasMore || this.data.loadingMore))
    )
      return;
    const revision = ++this.revision;
    this.setData(
      append
        ? { loadingMore: true, errorMessage: "" }
        : { viewState: "loading", loadingMore: false, errorMessage: "" },
    );
    try {
      const page = append ? this.data.page + 1 : 1;
      const query = this.reportQuery({ page, pageSize: 20 });
      const result = await createHrApi().teaching(query);
      if (revision !== this.revision) return;
      const view = reportView(result);
      const rows = append ? [...this.data.rows, ...view.rows] : view.rows;
      this.setData({
        rows,
        metrics: view.metrics,
        total: result.total,
        page,
        hasMore: page * result.pageSize < result.total,
        viewState: rows.length ? "ready" : "empty",
        loadingMore: false,
        errorMessage: "",
      });
    } catch (error) {
      if (revision === this.revision) {
        this.setData({
          viewState: "error",
          loadingMore: false,
          errorMessage: message(error),
        });
      }
    }
  },

  reportQuery(extra: Record<string, string | number> = {}) {
    const query: Record<string, string | number> = { ...extra };
    if (this.data.from) query.from = this.data.from;
    if (this.data.to) query.to = this.data.to;
    const campus = this.data.campuses[this.data.campusIndex];
    if (campus?.id) query.campusId = campus.id;
    const teacher = this.data.teachers[this.data.teacherIndex];
    if (teacher?.id) query.teacherId = teacher.id;
    return query;
  },

  onDate(event: WechatMiniprogram.PickerChange) {
    const field = event.currentTarget.dataset.field;
    if (field === "from" || field === "to")
      this.setData({ [field]: event.detail.value });
  },

  onCampus(event: WechatMiniprogram.PickerChange) {
    const campusIndex = Number(event.detail.value);
    const campus = this.data.campuses[campusIndex];
    const teacher = this.data.teachers[this.data.teacherIndex];
    const teacherIndex =
      campus?.id && teacher?.campusId !== campus.id
        ? 0
        : this.data.teacherIndex;
    this.setData({ campusIndex, teacherIndex });
    void this.load();
  },

  onTeacher(event: WechatMiniprogram.PickerChange) {
    this.setData({ teacherIndex: Number(event.detail.value) });
    void this.load();
  },

  onSearch() {
    void this.load();
  },

  onMore() {
    void this.load(true);
  },

  async onExport() {
    if (!this.data.authorized || this.data.exporting) return;
    this.setData({ exporting: true, exportError: "" });
    try {
      await createHrApi().exportReport("teaching", this.reportQuery());
    } catch (error) {
      this.setData({ exportError: message(error) });
    } finally {
      this.setData({ exporting: false });
    }
  },

  onRetry() {
    if (this.data.authorized) void this.load();
    else void this.initialize();
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: "/pages/hr/home/index" });
  },
});

async function loadAllCampuses(api: ReturnType<typeof createHrApi>) {
  const items = [{ id: "", name: "全部校区" }];
  for (let page = 1; ; page += 1) {
    const result = await api.campuses({ page, pageSize: 50 });
    items.push(...result.items);
    if (page * result.pageSize >= result.total || !result.items.length) break;
  }
  return items;
}

async function loadAllTeachers(api: ReturnType<typeof createHrApi>) {
  const items = [{ id: "", campusId: "", name: "全部教师" }];
  for (let page = 1; ; page += 1) {
    const result = await api.teachers({ page, pageSize: 50 });
    items.push(...result.items.map(teacherOption));
    if (page * result.pageSize >= result.total || !result.items.length) break;
  }
  return items;
}

function chinaDate() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "课耗统计加载失败，请重试";
}
