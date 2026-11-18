import { OperatorPageContext } from "../runtime/operator-page-context";
import { loadOperatorPdfDisplayFont } from "../runtime/operator-pdf-font";
import { readOperatorLesson } from "../runtime/operator-schedule-read";
import { buildOperatorLessonItems } from "../runtime/services/operator-schedule.presenter";
import {
  OperatorScheduleWorkflow,
  OperatorScheduleWorkflowOutcome,
  validateOperatorScheduleDraft,
} from "../runtime/services/operator-schedule.workflow";
import { createSessionService } from "../../../services/session.service";
import {
  OperatorLessonSeriesWorkflow, readOperatorSeriesAuthority, OperatorSeriesOutcome,
} from "../runtime/services/operator-lesson-series.workflow";
import { validateSeriesPattern, seriesDateLabels } from "../runtime/services/operator-lesson-series.presenter";
import type {
  OperatorLessonKind,
  OperatorLessonSession,
  OperatorScheduleDraft,
  OperatorSeriesPattern, OperatorSeriesPreview, OperatorSeriesCreated,
} from "../runtime/types/operator";

const KIND_OPTIONS: Array<{ value: OperatorLessonKind; label: string }> = [
  { value: "REGULAR", label: "常规课" },
  { value: "MAKEUP", label: "补课" },
  { value: "TRIAL", label: "体验课" },
];
interface ClassOption {
  classGroupId: string;
  label: string;
  teacherLabel: string;
  lessonUnitsLabel: string;
}
function campusDate(offsetDays = 0): string {
  return new Date(Date.now() + (offsetDays * 24 + 8) * 3600000).toISOString().slice(0, 10);
}
function unitsLabel(units: number): string {
  return `${Number((units / 100).toFixed(2))}课时`;
}
function manageable(lesson: OperatorLessonSession): boolean {
  return lesson.status === "SCHEDULED" && Date.parse(lesson.startsAt) > Date.now();
}
type Outcome = OperatorScheduleWorkflowOutcome | OperatorSeriesOutcome<OperatorSeriesCreated>;
type Invoke = () => Promise<Outcome>;
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"].map((label, index) =>
  ({ value: String(index + 1), label: `周${label}`, checked: false }));

Page({
  context: undefined as OperatorPageContext | undefined,
  workflow: undefined as OperatorScheduleWorkflow | undefined,
  seriesWorkflow: undefined as OperatorLessonSeriesWorkflow | undefined,
  seriesReceipt: undefined as OperatorSeriesCreated | undefined,
  hiddenForm: undefined as Record<string, unknown> | undefined,
  record: undefined as OperatorLessonSession | undefined,
  receipt: undefined as OperatorLessonSession | undefined,
  verified: undefined as OperatorLessonSession | undefined,
  opener: undefined as WechatMiniprogram.EventChannel | undefined,
  pendingRead: undefined as Promise<void> | undefined,
  pendingWrite: undefined as Promise<void> | undefined,
  uncertainWrite: undefined as Invoke | undefined,
  deferredResult: undefined as Outcome | undefined,
  seriesSequence: 0,
  baseline: "",
  readSequence: 0,
  modalSequence: 0,
  navigationSequence: 0,
  alertSequence: 0,
  alertEnabled: undefined as boolean | undefined,
  confirming: false,
  navigating: false,
  emitted: false,
  initialShowPending: true,
  data: {
    mode: "create" as "create" | "edit",
    title: "新增单次课",
    viewState: "loading",
    errorMessage: "",
    reading: false,
    readError: "",
    classOptions: [] as ClassOption[],
    classIndex: -1,
    selectedClassId: "",
    selectedClassLabel: "",
    selectedTeacherLabel: "",
    selectedLessonUnitsLabel: "",
    editingId: "",
    editingVersion: 0,
    formDate: "",
    minDate: "",
    startsAt: "14:00",
    endsAt: "15:30",
    kindOptions: KIND_OPTIONS,
    kindIndex: 0,
    kindLabel: KIND_OPTIONS[0].label,
    formError: "",
    dirty: false,
    optionsOpen: false,
    stale: false,
    confirming: false,
    navigating: false,
    submitting: false,
    recoveryAvailable: false,
    recoveryReady: false,
    recoveryMessage: "",
    savedId: "",
    readbackError: "",
    verified: false,
    scheduleMode: "single" as "single" | "series",
    seriesEndDate: "",
    intervalOptions: ["每周", "隔周"],
    intervalIndex: 0,
    weekdayOptions: WEEKDAYS,
    weekdays: [] as number[],
    seriesPreview: null as OperatorSeriesPreview | null,
    seriesRows: [] as Array<{ label: string; date: string; conflict: boolean }>,
    seriesBusy: false,
    savedCount: 0,
    headerTopPx: 28,
    headerHeightPx: 52,
    headerRightPx: 16,
  },

  onOpenOptions() {
    if (this.context?.isActive() && !this.data.submitting && !this.data.confirming) this.setData({ optionsOpen: true });
  },
  onCloseOptions() { if (!this.data.submitting && !this.data.confirming) this.setData({ optionsOpen: false }); },
  onRosterInfo() {
    if (!this.context?.isActive()) return;
    wx.showModal({ title: '学员信息', content: '按所选班级的在读学员生成课次名单。保存后可打开课次名单，查看和调整临时学员。', showCancel: false });
  },

  onLoad(query: Record<string, string | undefined>) {
    void loadOperatorPdfDisplayFont();
    // Match the existing shell geometry while keeping return events in this Page.
    try {
      const windowInfo = wx.getWindowInfo();
      this.setData({ headerTopPx: (windowInfo.statusBarHeight ?? 20) + 8 });
      const capsule = wx.getMenuButtonBoundingClientRect();
      if (capsule.height > 0) this.setData({
        headerTopPx: capsule.top, headerHeightPx: capsule.height + 16,
        headerRightPx: windowInfo.windowWidth - capsule.left + 8,
      });
    } catch { /* Keep the shell's status-bar fallback if native geometry is unavailable. */ }
    const mode = query.mode === "edit" || query.id !== undefined ? "edit" : "create";
    this.setData({
      mode, title: mode === "edit" ? "编辑单次课" : "新增单次课",
      editingId: mode === "edit" ? (query.id ?? "").trim() : "",
      formDate: campusDate(1), minDate: campusDate(),
    });
    this.context = new OperatorPageContext((errorMessage) => {
      this.readSequence += 1;
      this.navigationSequence += 1;
      this.invalidateConfirmation();
      this.pendingRead = undefined;
      this.workflow = undefined;
      this.seriesWorkflow = undefined;
      this.seriesReceipt = undefined;
      this.hiddenForm = undefined;
      this.seriesSequence += 1;
      this.record = undefined;
      this.receipt = undefined;
      this.verified = undefined;
      this.opener = undefined;
      this.uncertainWrite = undefined;
      this.deferredResult = undefined;
      this.baseline = "";
      this.navigating = false;
      this.setData({
        viewState: "forbidden", errorMessage, readError: "", reading: false, optionsOpen: false,
        classOptions: [], classIndex: -1, selectedClassId: "", selectedClassLabel: "",
        selectedTeacherLabel: "", selectedLessonUnitsLabel: "", editingId: "", editingVersion: 0,
        formDate: "", minDate: "", startsAt: "", endsAt: "", kindIndex: 0, kindLabel: KIND_OPTIONS[0].label,
        formError: "", dirty: false, stale: false, submitting: false, recoveryAvailable: false,
        recoveryMessage: "", savedId: "", readbackError: "", verified: false, navigating: false,
        recoveryReady: false, seriesPreview: null, seriesRows: [], seriesBusy: false,
        seriesEndDate: "", weekdays: [], weekdayOptions: WEEKDAYS, savedCount: 0,
      });
      this.syncAlert();
    });
    this.workflow = new OperatorScheduleWorkflow(this.context.service);
    this.seriesWorkflow = new OperatorLessonSeriesWorkflow(this.context.service);
    const opener = this.getOpenerEventChannel?.();
    this.opener = typeof opener?.emit === "function" ? opener as WechatMiniprogram.EventChannel : undefined;
    this.baseline = this.draftSignature();
    void this.loadSource();
  },

  onShow() {
    if (!this.context?.show()) return;
    if (this.hiddenForm) {
      this.setData(this.hiddenForm);
      this.hiddenForm = undefined;
    }
    this.navigationSequence += 1;
    this.navigating = false;
    this.setData({
      minDate: campusDate(), navigating: false, submitting: Boolean(this.pendingWrite),
      recoveryAvailable: Boolean(this.uncertainWrite), recoveryReady: false,
    });
    this.syncAlert();
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    if (this.deferredResult) {
      const result = this.deferredResult;
      this.deferredResult = undefined;
      this.applyWriteResult(result);
    }
    if (this.receipt || this.seriesReceipt) {
      if (!this.verified) void this.readback();
      return;
    }
    void this.loadSource();
  },

  onHide() {
    this.context?.hide();
    this.readSequence += 1;
    this.pendingRead = undefined;
    this.initialShowPending = false;
    this.navigationSequence += 1;
    this.invalidateConfirmation();
    this.seriesSequence += 1;
    this.hiddenForm = Object.fromEntries([
      "classOptions", "classIndex", "selectedClassId", "selectedClassLabel", "selectedTeacherLabel",
      "selectedLessonUnitsLabel", "editingId", "editingVersion", "formDate", "startsAt", "endsAt",
      "seriesEndDate", "weekdays", "weekdayOptions", "kindIndex", "kindLabel",
    ].map(key => [key, this.data[key as keyof typeof this.data]]));
    this.setData({
      classOptions: [], classIndex: -1, selectedClassId: "", selectedClassLabel: "",
      selectedTeacherLabel: "", selectedLessonUnitsLabel: "", editingId: "", editingVersion: 0,
      formDate: "", minDate: "", startsAt: "", endsAt: "", seriesEndDate: "", weekdays: [],
      weekdayOptions: WEEKDAYS, seriesPreview: null, seriesRows: [], seriesBusy: false,
      formError: "", readError: "", recoveryMessage: "", recoveryReady: false, savedId: "", readbackError: "", optionsOpen: false,
    });
  },

  onUnload() {
    this.onHide();
    this.context?.dispose();
    this.readSequence += 1;
    this.navigationSequence += 1;
    this.invalidateConfirmation();
    this.workflow = undefined;
    this.seriesWorkflow = undefined;
    this.seriesReceipt = undefined;
    this.hiddenForm = undefined;
    this.seriesSequence += 1;
    this.record = undefined;
    this.receipt = undefined;
    this.verified = undefined;
    this.opener = undefined;
    this.uncertainWrite = undefined;
    this.deferredResult = undefined;
    this.syncAlert();
  },

  draft(): OperatorScheduleDraft {
    return {
      classGroupId: this.data.mode === "edit" ? this.record?.classGroupId ?? "" : this.data.selectedClassId,
      date: this.data.formDate, startsAt: this.data.startsAt, endsAt: this.data.endsAt,
      kind: KIND_OPTIONS[this.data.kindIndex]?.value ?? "REGULAR",
    };
  },
  seriesPattern(): OperatorSeriesPattern {
    return {
      classGroupId: this.data.selectedClassId, startDate: this.data.formDate,
      endDate: this.data.seriesEndDate, intervalWeeks: this.data.intervalIndex === 1 ? 2 : 1,
      weekdays: [...this.data.weekdays], startTime: this.data.startsAt, endTime: this.data.endsAt,
      kind: KIND_OPTIONS[this.data.kindIndex]?.value ?? "REGULAR",
    };
  },
  draftSignature(): string {
    return JSON.stringify([this.data.scheduleMode, this.draft(), this.seriesPattern()]);
  },
  changed(patch: Record<string, unknown>) {
    this.invalidateConfirmation();
    this.seriesSequence += 1;
    this.setData({ ...patch, formError: "", seriesPreview: null, seriesRows: [], seriesBusy: false });
    this.setData({ dirty: this.draftSignature() !== this.baseline });
    this.syncAlert();
  },
  canEdit(): boolean {
    return Boolean(this.context?.isActive() && this.data.viewState === "ready" &&
      !this.data.reading && !this.navigating && !this.pendingWrite && !this.uncertainWrite && !this.receipt && !this.seriesReceipt);
  },
  onScheduleModeTap(event: WechatMiniprogram.TouchEvent) {
    const scheduleMode = event.currentTarget.dataset.key;
    if (this.canEdit() && this.data.mode === "create" && ["single", "series"].includes(scheduleMode))
      this.changed({ scheduleMode, title: scheduleMode === "series" ? "新增周期课" : "新增单次课" });
  },
  onSeriesEndDateChange(event: WechatMiniprogram.PickerChange) {
    if (this.canEdit()) this.changed({ seriesEndDate: String(event.detail.value) });
  },
  onIntervalChange(event: WechatMiniprogram.PickerChange) {
    const index = Number(event.detail.value);
    if (this.canEdit() && [0, 1].includes(index)) this.changed({ intervalIndex: index });
  },
  onWeekdayChange(event: { detail: { value: string[] } }) {
    if (!this.canEdit()) return;
    const weekdays = event.detail.value.map(Number).sort((a, b) => a - b);
    this.changed({ weekdays, weekdayOptions: WEEKDAYS.map(day => ({ ...day, checked: weekdays.includes(Number(day.value)) })) });
  },
  async onSeriesPreview() {
    const context = this.context;
    if (!this.canEdit() || this.confirming || this.data.seriesBusy || this.data.scheduleMode !== "series" || !context) return;
    const input = this.seriesPattern();
    try { validateSeriesPattern(input); }
    catch (error) { this.setData({ formError: (error as Error).message }); return; }
    if (!this.data.classOptions.some(row => row.classGroupId === input.classGroupId) || this.data.readError) return;
    const sequence = ++this.seriesSequence;
    this.setData({ seriesBusy: true, seriesPreview: null, seriesRows: [], formError: "" });
    const state = await context.service.previewLessonSeries(input);
    if (!context.isCurrent()) return;
    if (state.status === "error" && [401, 403].includes(state.statusCode ?? 0)) {
      context.invalidate(state.message); return;
    }
    if (!context.isActive() || sequence !== this.seriesSequence) return;
    this.setData({ seriesBusy: false });
    if (state.status === "success") this.setData({
      seriesPreview: state.data,
      seriesRows: seriesDateLabels(state.data.sessions).map(row => ({
        ...row, conflict: state.data.conflictDates.includes(row.date),
      })),
    });
    else this.setData({ formError: state.status === "error" ? state.message : "预览尚未完成，请重试" });
  },
  onSeriesCreate() {
    const workflow = this.seriesWorkflow, preview = this.data.seriesPreview;
    if (!this.canEdit() || this.confirming || !workflow || !preview || preview.conflictDates.length ||
      this.data.scheduleMode !== "series" || this.data.readError || this.data.seriesBusy) return;
    const signature = this.draftSignature();
    const input = { ...this.seriesPattern(), previewHash: preview.previewHash };
    this.confirm("确认创建周期课", `确认创建预览中的全部 ${preview.sessions.length} 节课吗？`, () => {
      if (signature !== this.draftSignature() || this.data.seriesPreview !== preview) return;
      void this.runWrite(() => workflow.create(input));
    });
  },

  loadSource(replace = false): Promise<void> {
    const context = this.context;
    if (!context?.isActive() || this.receipt || this.seriesReceipt || this.pendingRead) return this.pendingRead ?? Promise.resolve();
    if (this.data.mode === "edit" && !this.data.editingId) {
      this.setData({ viewState: "error", errorMessage: "缺少课次编号，无法编辑", reading: false });
      return Promise.resolve();
    }
    const sequence = ++this.readSequence;
    const accepts = () => Boolean(context.isActive() && sequence === this.readSequence);
    this.setData({ reading: true, readError: "" });
    const request = Promise.resolve().then(async () => {
      if (!accepts()) return;
      if (this.data.mode === "edit") {
        const state = await readOperatorLesson(context, this.data.editingId, accepts);
        if (!state || !accepts()) return;
        if (state.status === "success") {
          if (this.record && !replace && (this.data.dirty || this.data.stale || this.uncertainWrite || this.pendingWrite)) {
            const stale = this.data.stale || state.data.version !== this.record.version || !manageable(state.data);
            this.setData({ reading: false, stale, readError: "" });
          } else {
            this.applyRecord(state.data);
          }
        } else if (state.status === "error") this.readFailed(state.message, state.statusCode === 404);
      } else {
        const state = await context.service.loadSchedulingOptions();
        if (!context.isCurrent()) return;
        if (state.status === "error" && (state.statusCode === 401 || state.statusCode === 403)) {
          context.invalidate(state.message);
          return;
        }
        if (!accepts()) return;
        if (state.status === "success" || state.status === "empty") {
          const classOptions = state.data.classes.map((item) => ({
            classGroupId: item.classGroupId, label: `${item.className} · ${item.courseName}`,
            teacherLabel: item.teacherName, lessonUnitsLabel: unitsLabel(item.defaultLessonUnits),
          }));
          const classIndex = classOptions.findIndex((item) => item.classGroupId === this.data.selectedClassId);
          const selected = classOptions[classIndex];
          this.setData({
            reading: false, viewState: classOptions.length ? "ready" : "empty", errorMessage: "", readError: "",
            classOptions, classIndex, selectedClassLabel: selected?.label ?? "",
            selectedTeacherLabel: selected?.teacherLabel ?? "", selectedLessonUnitsLabel: selected?.lessonUnitsLabel ?? "",
          });
        } else if (state.status === "error") {
          this.setData({ classOptions: [], classIndex: -1 });
          this.readFailed(state.message);
        }
      }
    }).finally(() => {
      if (this.pendingRead === request) this.pendingRead = undefined;
    });
    this.pendingRead = request;
    return request;
  },
  readFailed(message: string, missing = false) {
    this.setData({
      reading: false,
      ...(this.data.viewState === "ready"
        ? { readError: message, stale: this.data.stale || (missing && this.data.mode === "edit") }
        : { viewState: "error", errorMessage: message }),
    });
  },
  applyRecord(record: OperatorLessonSession) {
    this.record = record;
    const item = buildOperatorLessonItems([record])[0];
    const kindIndex = Math.max(0, KIND_OPTIONS.findIndex((option) => option.value === record.kind));
    this.setData({
      viewState: "ready", errorMessage: "", reading: false, readError: "", formError: "",
      editingVersion: record.version, selectedClassId: record.classGroupId,
      selectedClassLabel: `${record.className} · ${record.courseName}`,
      selectedTeacherLabel: record.teacherName, selectedLessonUnitsLabel: unitsLabel(record.lessonUnits),
      formDate: item.draft.date, startsAt: item.draft.startsAt, endsAt: item.draft.endsAt,
      kindIndex, kindLabel: KIND_OPTIONS[kindIndex].label, dirty: false, stale: !manageable(record),
    });
    this.baseline = this.draftSignature();
    this.syncAlert();
  },

  onClassChange(event: WechatMiniprogram.PickerChange) {
    if (!this.canEdit() || this.data.mode === "edit" || this.data.reading || this.data.readError) return;
    const classIndex = Number(event.detail.value);
    const option = this.data.classOptions[classIndex];
    if (option) this.changed({
      classIndex, selectedClassId: option.classGroupId, selectedClassLabel: option.label,
      selectedTeacherLabel: option.teacherLabel, selectedLessonUnitsLabel: option.lessonUnitsLabel,
    });
  },
  onFormDateChange(event: WechatMiniprogram.PickerChange) {
    if (this.canEdit()) this.changed({ formDate: String(event.detail.value) });
  },
  onStartTimeChange(event: WechatMiniprogram.PickerChange) {
    if (this.canEdit()) this.changed({ startsAt: String(event.detail.value) });
  },
  onEndTimeChange(event: WechatMiniprogram.PickerChange) {
    if (this.canEdit()) this.changed({ endsAt: String(event.detail.value) });
  },
  onKindChange(event: WechatMiniprogram.PickerChange) {
    const kindIndex = Number(event.detail.value);
    if (this.canEdit() && KIND_OPTIONS[kindIndex]) this.changed({ kindIndex, kindLabel: KIND_OPTIONS[kindIndex].label });
  },

  onSubmit() {
    const workflow = this.workflow;
    if (!this.canEdit() || this.confirming || this.data.scheduleMode !== "single" ||
      !workflow || this.data.reading || this.data.readError || this.data.stale) return;
    if (this.data.mode === "edit" && (!this.record || !manageable(this.record))) {
      this.setData({ stale: true, formError: "只能修改尚未开始的待上课课次" });
      return;
    }
    const draft = this.draft();
    const validation = validateOperatorScheduleDraft(draft);
    if (validation) { this.setData({ formError: validation }); return; }
    if (this.data.mode === "create" && !this.data.classOptions.some((option) => option.classGroupId === draft.classGroupId)) {
      this.setData({ formError: "所选班级已不可用，请重新选择" });
      return;
    }
    const mode = this.data.mode;
    const id = this.data.editingId;
    const version = this.data.editingVersion;
    const signature = this.draftSignature();
    this.confirm("确认保存", mode === "edit" ? "确认保存本次课次修改吗？" : "确认新增这节单次课吗？", () => {
      if (signature !== this.draftSignature()) return;
      // Validation is repeated after the modal because the start time may have passed.
      const error = validateOperatorScheduleDraft(draft);
      if (error || (mode === "edit" && (!this.record || !manageable(this.record)))) {
        this.setData({ formError: error ?? "课次已变化，请重新载入" });
        return;
      }
      void this.runWrite(() => mode === "edit" ? workflow.update(id, version, draft) : workflow.create(draft));
    });
  },
  confirm(title: string, content: string, accept: () => void) {
    if (!this.context?.isActive() || this.confirming || this.navigating) return;
    this.confirming = true;
    this.setData({ confirming: true });
    const sequence = ++this.modalSequence;
    const current = () => sequence === this.modalSequence && Boolean(this.context?.isActive());
    const release = () => {
      if (!current()) return;
      this.confirming = false;
      this.setData({ confirming: false });
    };
    const fail = () => {
      if (!current()) return;
      release();
      this.setData({ formError: "确认框打开失败，请重试" });
    };
    try {
      wx.showModal({
        title, content, confirmText: "确认", cancelText: "取消",
        success: (result) => { if (current()) { release(); if (result.confirm) accept(); } },
        fail, complete: release,
      });
    } catch { fail(); }
  },
  invalidateConfirmation() {
    this.modalSequence += 1;
    this.confirming = false;
    this.setData({ confirming: false });
  },

  runWrite(invoke: Invoke): Promise<void> {
    const context = this.context;
    if (!context?.isActive() || this.pendingWrite || this.receipt || this.seriesReceipt) return Promise.resolve();
    this.invalidateConfirmation();
    this.setData({ submitting: true, formError: "", recoveryReady: false });
    const request = Promise.resolve().then(() => context.isActive() ? invoke() : undefined).then((outcome) => {
      if (!outcome || !context.isCurrent()) return;
      if (outcome.status === "forbidden") { context.invalidate(outcome.message); return; }
      this.uncertainWrite = outcome.status === "error" && outcome.retryable ? invoke : undefined;
      if (!context.isActive()) { this.deferredResult = outcome; return; }
      this.applyWriteResult(outcome);
    }).finally(() => {
      if (this.pendingWrite === request) {
        this.pendingWrite = undefined;
        if (context.isActive()) { this.setData({ submitting: false }); this.syncAlert(); }
      }
    });
    this.pendingWrite = request;
    this.syncAlert();
    return request;
  },
  applyWriteResult(outcome: Outcome) {
    this.setData({
      recoveryAvailable: Boolean(this.uncertainWrite),
      recoveryMessage: this.uncertainWrite && outcome.status === "error" ? outcome.message : "",
      recoveryReady: false,
    });
    if (outcome.status === "success") {
      if ("seriesId" in outcome.data && "sessions" in outcome.data) this.seriesReceipt = outcome.data;
      else this.receipt = outcome.data as OperatorLessonSession;
      const id = this.seriesReceipt?.sessions[0].id ?? this.receipt!.id;
      this.readSequence += 1;
      this.pendingRead = undefined;
      this.invalidateConfirmation();
      this.setData({ viewState: "saved", savedId: id, savedCount: this.seriesReceipt?.sessions.length ?? 1,
        seriesPreview: null, seriesRows: [], dirty: false, reading: false, readError: "", formError: "" });
      this.syncAlert();
      void this.readback();
    } else if (outcome.status === "conflict") {
      this.setData({ stale: this.data.mode === "edit", seriesPreview: null, seriesRows: [],
        formError: `排课条件或课次已变化，请重新${this.data.scheduleMode === "series" ? "预览" : "载入"}${outcome.conflictDates?.length ? `：${outcome.conflictDates.join("、")}` : ""}` });
      this.readSequence += 1;
      this.pendingRead = undefined;
      void this.loadSource();
    } else if (outcome.status === "forbidden") this.context?.invalidate(outcome.message);
    else this.setData({ formError: this.uncertainWrite ? "" : outcome.message });
    this.syncAlert();
  },
  onRetryWrite() {
    const context = this.context, invoke = this.uncertainWrite;
    if (!context?.isActive() || !invoke || this.pendingRead || this.pendingWrite || this.navigating || this.confirming) return;
    if (this.data.recoveryReady) { void this.runWrite(invoke); return; }
    const sequence = ++this.readSequence;
    const accepts = () => Boolean(context.isActive() && sequence === this.readSequence);
    this.setData({ reading: true, recoveryReady: false });
    const request = readOperatorSeriesAuthority(context.service, accepts).then(state => {
      if (!state || !accepts()) return;
      if (state.status === "error" && [401, 403].includes(state.statusCode ?? 0)) {
        context.invalidate(state.message); return;
      }
      this.setData({ reading: false, recoveryReady: state.status === "success",
        recoveryMessage: state.status === "success" ? "已读取最新课表，可重试确认原操作" :
          state.status === "error" ? state.message : "课表尚未完整读取" });
    }).finally(() => { if (this.pendingRead === request) this.pendingRead = undefined; });
    this.pendingRead = request;
  },

  readback(): Promise<void> {
    const context = this.context;
    const receipt = this.receipt;
    const series = this.seriesReceipt;
    if (!context?.isActive() || (!receipt && !series) || this.pendingRead || this.verified) return this.pendingRead ?? Promise.resolve();
    const sequence = ++this.readSequence;
    const accepts = () => Boolean(context.isActive() && sequence === this.readSequence);
    this.setData({ reading: true, readbackError: "" });
    const read = series ? readOperatorSeriesAuthority(context.service, accepts) :
      readOperatorLesson(context, receipt!.id, accepts);
    const request = read.then((state) => {
      if (!state || !accepts()) return;
      if (state.status === "error" && [401, 403].includes(state.statusCode ?? 0)) {
        context.invalidate(state.message); return;
      }
      const rows = state.status === "success" ? Array.isArray(state.data) ? state.data : [state.data] : [];
      const expected = series?.sessions ?? [receipt!];
      const complete = expected.every(item => rows.some(row => row.id === item.id && row.version >= item.version &&
        (!series || (row.seriesId === series.seriesId &&
          (row.version > item.version || (Date.parse(row.startsAt) === Date.parse(item.startsAt) &&
            Date.parse(row.endsAt) === Date.parse(item.endsAt)))))));
      if (complete && rows.length) {
        this.verified = rows.find(row => row.id === expected[0].id);
        this.setData({ reading: false, verified: true });
        this.onReturn();
      } else {
        this.setData({
          reading: false,
          readbackError: state.status === "error" ? state.message : "已保存，最新课次尚未读到，请重试读取",
        });
      }
    }).finally(() => { if (this.pendingRead === request) this.pendingRead = undefined; });
    this.pendingRead = request;
    return request;
  },
  onRetryReadback() { void this.readback(); },
  onReturn() {
    if (!this.context?.isActive() || !this.verified || this.navigating) return;
    if (!this.emitted) {
      this.emitted = true;
      this.opener?.emit("scheduleSaved", { id: this.verified.id, version: this.verified.version });
    }
    this.navigate();
  },
  onBack() {
    if (!this.context?.isActive() || this.pendingWrite || this.confirming || this.navigating) return;
    if (this.receipt || this.seriesReceipt) { this.onReturn(); return; }
    if (this.data.dirty || this.uncertainWrite) {
      this.confirm("确认离开", this.uncertainWrite
        ? "操作结果尚未确认，离开后请先核对课表。确认离开吗？"
        : "修改尚未保存，确认放弃并离开吗？", () => this.navigate());
    } else this.navigate();
  },
  navigate() {
    if (!this.context?.isActive() || this.navigating) return;
    this.navigating = true;
    const sequence = ++this.navigationSequence;
    this.setData({ navigating: true });
    this.syncAlert();
    const fail = () => {
      if (sequence !== this.navigationSequence || !this.context?.isActive()) return;
      this.navigating = false;
      this.setData({
        navigating: false,
        ...(this.receipt || this.seriesReceipt ? { readbackError: "返回失败，请重试返回" } : { formError: "返回失败，请重试" }),
      });
      this.syncAlert();
    };
    try {
      const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
      if (pages.length > 1 && pages[pages.length - 2].route === "pages/operator/schedule/index") {
        wx.navigateBack({ delta: 1, fail });
      } else wx.reLaunch({ url: "/pages/operator/home/index", fail });
    } catch { fail(); }
  },
  syncAlert() {
    if (typeof wx.enableAlertBeforeUnload !== "function" || typeof wx.disableAlertBeforeUnload !== "function") return;
    const enabled = Boolean(this.context?.isActive() && !this.navigating && !this.receipt && !this.seriesReceipt &&
      (this.data.dirty || this.pendingWrite || this.uncertainWrite));
    if (enabled === this.alertEnabled) return;
    const sequence = ++this.alertSequence;
    this.alertEnabled = enabled;
    const fail = () => { if (sequence === this.alertSequence) this.alertEnabled = undefined; };
    try {
      if (enabled) wx.enableAlertBeforeUnload({ message: "修改尚未保存或操作结果待确认，离开前请核对。", fail });
      else wx.disableAlertBeforeUnload({ fail });
    } catch { fail(); }
  },
  onRetry() { if (!this.confirming && !this.navigating) void this.loadSource(); },
  onReload() {
    if (!this.context?.isActive() || this.pendingWrite || this.uncertainWrite || this.receipt ||
      this.pendingRead || this.navigating) return;
    const reload = () => { void this.loadSource(true); };
    if (this.data.dirty) this.confirm("重新载入", "确认放弃本次修改，重新载入最新课次吗？", reload);
    else reload();
  },
  onLogin() {
    if (!this.context) return;
    if (this.context.ownsRuntime()) createSessionService().logout();
    this.context.invalidate("请重新登录");
    wx.reLaunch({ url: "/pages/bootstrap/index" });
  },
});
