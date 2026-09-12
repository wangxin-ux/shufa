import {
  buildCampusManagerLessonItems,
  buildCampusManagerLessonQuery,
  CampusManagerLessonItemModel,
  mergeCampusManagerLessonItems,
} from "../../../services/campus-manager-schedule.presenter";
import { campusManagerService } from "../../../services/campus-manager-runtime";
import { CampusManagerScheduleWorkflow } from "../../../services/campus-manager-schedule.workflow";
import {
  CampusManagerLessonKind,
  CampusManagerLessonStatus,
  CampusManagerSchedulingOption,
} from "../../../types/campus-manager";

const PAGE_SIZE = 20;
const workflow = new CampusManagerScheduleWorkflow(campusManagerService);
let requestSequence = 0;

interface ClassOptionModel {
  classGroupId: string;
  label: string;
  teacherLabel: string;
  lessonUnitsLabel: string;
}

interface StatusOptionModel {
  value: CampusManagerLessonStatus | "";
  label: string;
}

interface KindOptionModel {
  value: CampusManagerLessonKind;
  label: string;
}

const STATUS_OPTIONS: StatusOptionModel[] = [
  { value: "", label: "全部状态" },
  { value: "SCHEDULED", label: "待上课" },
  { value: "IN_PROGRESS", label: "进行中" },
  { value: "COMPLETED", label: "已完成" },
  { value: "REVERSED", label: "已撤销" },
  { value: "CANCELLED", label: "已取消" },
];

const KIND_OPTIONS: KindOptionModel[] = [
  { value: "REGULAR", label: "常规课" },
  { value: "MAKEUP", label: "补课" },
  { value: "TRIAL", label: "体验课" },
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function localDate(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function lessonUnitsLabel(units: number): string {
  const value = units / 100;
  return Number.isInteger(value)
    ? `${value}课时`
    : `${value.toFixed(2).replace(/0+$/, "")}课时`;
}

function buildClassOptions(
  classes: readonly CampusManagerSchedulingOption[],
): ClassOptionModel[] {
  return classes.map((item) => ({
    classGroupId: item.classGroupId,
    label: `${item.className} · ${item.courseName}`,
    teacherLabel: item.teacherName,
    lessonUnitsLabel: lessonUnitsLabel(item.defaultLessonUnits),
  }));
}

Page({
  data: {
    viewState: "loading",
    errorMessage: "",
    items: [] as CampusManagerLessonItemModel[],
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
    filterDate: "",
    statusOptions: STATUS_OPTIONS,
    statusIndex: 0,
    statusLabel: STATUS_OPTIONS[0].label,
    optionsState: "loading",
    optionsError: "",
    classOptions: [] as ClassOptionModel[],
    formVisible: false,
    formMode: "create" as "create" | "edit",
    editingId: "",
    editingVersion: 0,
    classIndex: 0,
    selectedClassLabel: "",
    selectedTeacherLabel: "",
    selectedLessonUnitsLabel: "",
    formDate: localDate(1),
    minDate: localDate(),
    startsAt: "14:00",
    endsAt: "15:30",
    kindOptions: KIND_OPTIONS,
    kindIndex: 0,
    kindLabel: KIND_OPTIONS[0].label,
    formError: "",
    submitting: false,
  },

  onLoad() {
    void this.loadOptions();
    void this.loadLessons(true);
  },

  onPullDownRefresh() {
    void Promise.all([this.loadOptions(), this.loadLessons(true)]).finally(() =>
      wx.stopPullDownRefresh(),
    );
  },

  async loadOptions() {
    this.setData({ optionsState: "loading", optionsError: "" });
    const state = await campusManagerService.loadSchedulingOptions();
    if (state.status === "success" || state.status === "empty") {
      const classOptions = buildClassOptions(state.data.classes);
      const first = classOptions[0];
      this.setData({
        optionsState: classOptions.length === 0 ? "empty" : "ready",
        optionsError: "",
        classOptions,
        classIndex: 0,
        selectedClassLabel: first?.label ?? "",
        selectedTeacherLabel: first?.teacherLabel ?? "",
        selectedLessonUnitsLabel: first?.lessonUnitsLabel ?? "",
      });
      return;
    }
    if (state.status === "error") {
      this.setData({
        optionsState: state.statusCode === 403 ? "forbidden" : "error",
        optionsError:
          state.statusCode === 403
            ? "当前账号无权管理本校区排课"
            : state.message,
      });
    }
  },

  async loadLessons(reset: boolean) {
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) {
      return;
    }
    const page = reset ? 1 : this.data.page + 1;
    const status = this.data.statusOptions[this.data.statusIndex]?.value ?? "";
    const sequence = ++requestSequence;
    this.setData(
      reset
        ? {
            viewState: "loading",
            errorMessage: "",
            items: [],
            loadingMore: false,
          }
        : { loadingMore: true, errorMessage: "" },
    );
    const state = await campusManagerService.loadLessonSessions(
      buildCampusManagerLessonQuery(
        this.data.filterDate,
        status,
        page,
        PAGE_SIZE,
      ),
    );
    if (sequence !== requestSequence) {
      return;
    }
    if (state.status === "success" || state.status === "empty") {
      const incoming = buildCampusManagerLessonItems(state.data.data);
      const items = mergeCampusManagerLessonItems(
        this.data.items,
        incoming,
        page,
      );
      this.setData({
        items,
        page: state.data.meta.page,
        total: state.data.meta.total,
        hasMore: state.data.meta.page < state.data.meta.totalPages,
        loadingMore: false,
        viewState: items.length === 0 ? "empty" : "ready",
        errorMessage: "",
      });
      return;
    }
    if (state.status === "error") {
      this.setData({
        loadingMore: false,
        viewState: state.statusCode === 403 ? "forbidden" : "error",
        errorMessage:
          state.statusCode === 403
            ? "当前账号无权查看本校区排课"
            : state.message,
      });
    }
  },

  onFilterDateChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ filterDate: String(event.detail.value) });
    void this.loadLessons(true);
  },

  onClearFilterDate() {
    this.setData({ filterDate: "" });
    void this.loadLessons(true);
  },

  onStatusChange(event: WechatMiniprogram.PickerChange) {
    const statusIndex = Number(event.detail.value);
    const option = this.data.statusOptions[statusIndex];
    if (!option) {
      return;
    }
    this.setData({ statusIndex, statusLabel: option.label });
    void this.loadLessons(true);
  },

  onCreateTap() {
    const first = this.data.classOptions[0];
    if (!first) {
      wx.showToast({
        title:
          this.data.optionsState === "loading"
            ? "正在加载班级"
            : "暂无可排课班级",
        icon: "none",
      });
      return;
    }
    this.setData({
      formVisible: true,
      formMode: "create",
      editingId: "",
      editingVersion: 0,
      classIndex: 0,
      selectedClassLabel: first.label,
      selectedTeacherLabel: first.teacherLabel,
      selectedLessonUnitsLabel: first.lessonUnitsLabel,
      formDate: localDate(1),
      startsAt: "14:00",
      endsAt: "15:30",
      kindIndex: 0,
      kindLabel: this.data.kindOptions[0].label,
      formError: "",
    });
  },

  onEditTap(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const item = this.data.items.find((candidate) => candidate.id === id);
    if (!item || !item.canManage) {
      return;
    }
    const classIndex = this.data.classOptions.findIndex(
      (option) => option.classGroupId === item.draft.classGroupId,
    );
    const classOption = this.data.classOptions[classIndex];
    const kindIndex = this.data.kindOptions.findIndex(
      (option) => option.value === item.draft.kind,
    );
    this.setData({
      formVisible: true,
      formMode: "edit",
      editingId: item.id,
      editingVersion: item.version,
      classIndex: Math.max(0, classIndex),
      selectedClassLabel: classOption?.label ?? item.className,
      selectedTeacherLabel:
        classOption?.teacherLabel ?? item.teacherLabel.split(" · ")[0],
      selectedLessonUnitsLabel:
        classOption?.lessonUnitsLabel ?? item.teacherLabel.split(" · ")[1],
      formDate: item.draft.date,
      startsAt: item.draft.startsAt,
      endsAt: item.draft.endsAt,
      kindIndex: Math.max(0, kindIndex),
      kindLabel:
        this.data.kindOptions[Math.max(0, kindIndex)]?.label ?? item.kindLabel,
      formError: "",
    });
  },

  onClassChange(event: WechatMiniprogram.PickerChange) {
    if (this.data.formMode === "edit") {
      return;
    }
    const classIndex = Number(event.detail.value);
    const option = this.data.classOptions[classIndex];
    if (!option) {
      return;
    }
    this.setData({
      classIndex,
      selectedClassLabel: option.label,
      selectedTeacherLabel: option.teacherLabel,
      selectedLessonUnitsLabel: option.lessonUnitsLabel,
      formError: "",
    });
  },

  onFormDateChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ formDate: String(event.detail.value), formError: "" });
  },

  onStartTimeChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ startsAt: String(event.detail.value), formError: "" });
  },

  onEndTimeChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ endsAt: String(event.detail.value), formError: "" });
  },

  onKindChange(event: WechatMiniprogram.PickerChange) {
    const kindIndex = Number(event.detail.value);
    const option = this.data.kindOptions[kindIndex];
    if (!option) {
      return;
    }
    this.setData({ kindIndex, kindLabel: option.label, formError: "" });
  },

  onCloseForm() {
    if (!this.data.submitting) {
      this.setData({ formVisible: false, formError: "" });
    }
  },

  async onSubmit() {
    if (this.data.submitting) {
      return;
    }
    const classOption = this.data.classOptions[this.data.classIndex];
    const draft = {
      classGroupId:
        this.data.formMode === "edit"
          ? (this.data.items.find((item) => item.id === this.data.editingId)
              ?.draft.classGroupId ?? "")
          : (classOption?.classGroupId ?? ""),
      date: this.data.formDate,
      startsAt: this.data.startsAt,
      endsAt: this.data.endsAt,
      kind: this.data.kindOptions[this.data.kindIndex]?.value ?? "REGULAR",
    };
    this.setData({ submitting: true, formError: "" });
    const outcome =
      this.data.formMode === "edit"
        ? await workflow.update(
            this.data.editingId,
            this.data.editingVersion,
            draft,
          )
        : await workflow.create(draft);
    if (outcome.status === "success") {
      this.setData({ submitting: false, formVisible: false });
      wx.showToast({
        title: this.data.formMode === "edit" ? "课次已更新" : "课次已新增",
        icon: "success",
      });
      await this.loadLessons(true);
      return;
    }
    if (outcome.status === "conflict") {
      this.setData({
        submitting: false,
        formVisible: false,
        formError: "",
      });
      wx.showToast({ title: "课次已变化，列表已刷新", icon: "none" });
      await this.loadLessons(true);
      return;
    }
    this.setData({
      submitting: false,
      formError: outcome.message,
      ...(outcome.status === "forbidden" ? { optionsState: "forbidden" } : {}),
    });
  },

  onCancelTap(event: WechatMiniprogram.TouchEvent) {
    if (this.data.submitting) {
      return;
    }
    const id = String(event.currentTarget.dataset.id ?? "");
    const item = this.data.items.find((candidate) => candidate.id === id);
    if (!item || !item.canManage) {
      return;
    }
    wx.showModal({
      title: "取消课次",
      content: `确认取消 ${item.dateLabel} ${item.timeLabel} 的课程吗？`,
      confirmText: "确认取消",
      confirmColor: "#990a04",
      success: (result) => {
        if (result.confirm) {
          void this.cancelLesson(item);
        }
      },
    });
  },

  async cancelLesson(item: CampusManagerLessonItemModel) {
    this.setData({ submitting: true });
    const outcome = await workflow.cancel(item.id, item.version);
    this.setData({ submitting: false });
    if (outcome.status === "success") {
      wx.showToast({ title: "课次已取消", icon: "success" });
      await this.loadLessons(true);
      return;
    }
    if (outcome.status === "conflict") {
      wx.showToast({ title: "课次已变化，列表已刷新", icon: "none" });
      await this.loadLessons(true);
      return;
    }
    wx.showToast({ title: outcome.message, icon: "none" });
  },

  onRetry() {
    void this.loadLessons(true);
  },

  onRetryOptions() {
    void this.loadOptions();
  },

  onLoadMore() {
    void this.loadLessons(false);
  },
});
