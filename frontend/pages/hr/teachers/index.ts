import {
  createHrApi,
  HrTeacher,
  HrTeacherDetail,
} from "../../../services/hr.service";
import {
  createHrRecordsApi,
  HrTeacherRecord,
  HrTeacherRecordInput,
  HrTeacherRecordKind,
} from "../../../services/hr-records.service";
import { createSessionService } from "../../../services/session.service";

function teacherView(row: HrTeacher) {
  return {
    ...row,
    statusLabel: row.active ? "启用" : "停用",
    specialtiesLabel: row.specialties.join("、") || "未填写",
  };
}
const recordKinds: Array<{ code: "" | HrTeacherRecordKind; name: string }> = [
  { code: "", name: "全部类型" },
  { code: "QUALIFICATION", name: "资质" },
  { code: "TRAINING", name: "培训" },
  { code: "GROWTH", name: "成长" },
];
const recordStatuses = [
  { code: "ACTIVE" as const, name: "当前记录" },
  { code: "ARCHIVED" as const, name: "归档历史" },
  { code: "ALL" as const, name: "全部状态" },
];
const recordFormKinds = recordKinds.slice(1);
const emptyRecordForm = (): HrTeacherRecordInput => ({
  kind: "QUALIFICATION",
  title: "",
  organization: null,
  occurredOn: chinaDate(),
  expiresOn: null,
  note: "",
  attachmentFileId: null,
});
function recordView(record: HrTeacherRecord) {
  return {
    ...record,
    kindLabel:
      recordKinds.find((item) => item.code === record.kind)?.name ??
      record.kind,
    statusLabel: record.status === "ARCHIVED" ? "已归档" : "有效",
    organizationLabel: record.organization || "未填写机构",
    expiryLabel: record.expiresOn ? `有效至 ${record.expiresOn}` : "长期有效",
  };
}
Page({
  revision: 0,
  detailRevision: 0,
  recordRevision: 0,
  recordMutationKey: "",
  archiveMutationKey: "",
  data: {
    headerTop: 28,
    headerRight: 100,
    authorized: false,
    displayName: "",
    viewState: "loading",
    errorMessage: "",
    keyword: "",
    campusIndex: 0,
    statusIndex: 0,
    campuses: [{ id: "", name: "全部校区" }],
    statuses: [
      { code: "", name: "全部状态" },
      { code: "ACTIVE", name: "启用" },
      { code: "INACTIVE", name: "停用" },
    ],
    rows: [] as ReturnType<typeof teacherView>[],
    page: 1,
    total: 0,
    hasMore: false,
    loadingMore: false,
    detail: null as
      | (HrTeacherDetail &
          ReturnType<typeof teacherView> & { createdLabel: string })
      | null,
    detailLoading: false,
    detailError: "",
    recordKinds,
    recordKindIndex: 0,
    recordStatuses,
    recordStatusIndex: 0,
    recordFormKinds,
    recordFormKindIndex: 0,
    records: [] as ReturnType<typeof recordView>[],
    recordsState: "empty",
    recordsError: "",
    recordTotal: 0,
    recordPage: 1,
    recordHasMore: false,
    recordLoadingMore: false,
    recordFormVisible: false,
    editingRecordId: "",
    recordForm: emptyRecordForm(),
    recordAttachmentDraft: null as {
      path: string;
      name: string;
      size: number;
    } | null,
    recordSubmitting: false,
    recordSubmitError: "",
    recordArchiveId: "",
    archiveReason: "",
    archiveSubmitting: false,
    previewingRecordId: "",
  },
  onLoad() {
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
    this.setData({ headerTop, headerRight });
    void this.initialize();
  },
  async initialize() {
    this.setData({ viewState: "loading", errorMessage: "", authorized: false });
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
      const campuses = [{ id: "", name: "全部校区" }];
      let page = 1;
      while (true) {
        const result = await createHrApi().campuses({ page, pageSize: 50 });
        campuses.push(...result.items);
        if (page * result.pageSize >= result.total || !result.items.length)
          break;
        page += 1;
      }
      this.setData({
        campuses,
        campusIndex: 0,
        authorized: true,
        displayName: session.displayName,
      });
      await this.load(false);
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
      const query: Record<string, string | number> = { page, pageSize: 20 };
      if (this.data.keyword.trim()) query.query = this.data.keyword.trim();
      const campus = this.data.campuses[this.data.campusIndex];
      if (campus?.id) query.campusId = campus.id;
      const status = this.data.statuses[this.data.statusIndex];
      if (status?.code) query.status = status.code;
      const result = await createHrApi().teachers(query);
      if (revision !== this.revision) return;
      const rows = append
        ? [...this.data.rows, ...result.items.map(teacherView)]
        : result.items.map(teacherView);
      this.setData({
        rows,
        page,
        total: result.total,
        hasMore: page * result.pageSize < result.total,
        loadingMore: false,
        viewState: rows.length ? "ready" : "empty",
      });
    } catch (error) {
      if (revision === this.revision)
        this.setData({
          viewState: "error",
          loadingMore: false,
          errorMessage: message(error),
        });
    }
  },
  onKeyword(event: WechatMiniprogram.Input) {
    this.setData({ keyword: event.detail.value });
  },
  onSearch() {
    void this.load(false);
  },
  onCampus(event: WechatMiniprogram.PickerChange) {
    this.setData({ campusIndex: Number(event.detail.value) });
    void this.load(false);
  },
  onStatus(event: WechatMiniprogram.PickerChange) {
    this.setData({ statusIndex: Number(event.detail.value) });
    void this.load(false);
  },
  onMore() {
    void this.load(true);
  },
  onRetry() {
    if (this.data.authorized) void this.load(false);
    else void this.initialize();
  },
  async onDetail(event: WechatMiniprogram.TouchEvent) {
    if (
      !this.data.authorized ||
      this.data.recordSubmitting ||
      this.data.archiveSubmitting
    )
      return;
    const revision = ++this.detailRevision;
    this.setData({ detailLoading: true, detail: null, detailError: "" });
    try {
      const row = await createHrApi().teacher(
        String(event.currentTarget.dataset.id),
      );
      if (revision !== this.detailRevision) return;
      this.setData({
        detailLoading: false,
        detail: {
          ...row,
          ...teacherView(row),
          createdLabel: new Date(
            new Date(row.createdAt).getTime() + 8 * 3600000,
          )
            .toISOString()
            .slice(0, 10),
        },
      });
      await this.loadRecords();
    } catch (error) {
      if (revision === this.detailRevision)
        this.setData({ detailLoading: false, detailError: message(error) });
    }
  },
  async loadRecords(append = false) {
    const teacherId = this.data.detail?.id;
    if (
      !teacherId ||
      (append && (!this.data.recordHasMore || this.data.recordLoadingMore))
    )
      return;
    const revision = ++this.recordRevision;
    this.setData(
      append
        ? { recordLoadingMore: true, recordsError: "" }
        : {
            recordsState: "loading",
            recordLoadingMore: false,
            recordsError: "",
          },
    );
    try {
      const page = append ? this.data.recordPage + 1 : 1;
      const query: {
        page: number;
        pageSize: number;
        kind?: HrTeacherRecordKind;
        status: "ACTIVE" | "ARCHIVED" | "ALL";
      } = {
        page,
        pageSize: 20,
        status: this.data.recordStatuses[this.data.recordStatusIndex].code,
      };
      const kind = this.data.recordKinds[this.data.recordKindIndex]?.code;
      if (kind) query.kind = kind;
      const result = await createHrRecordsApi().list(teacherId, query);
      if (
        revision !== this.recordRevision ||
        this.data.detail?.id !== teacherId
      )
        return;
      const records = append
        ? [...this.data.records, ...result.items.map(recordView)]
        : result.items.map(recordView);
      this.setData({
        records,
        recordTotal: result.total,
        recordPage: page,
        recordHasMore: page * result.pageSize < result.total,
        recordLoadingMore: false,
        recordsState: records.length ? "ready" : "empty",
        recordsError: "",
      });
    } catch (error) {
      if (
        revision === this.recordRevision &&
        this.data.detail?.id === teacherId
      ) {
        this.setData(
          append
            ? { recordLoadingMore: false, recordsError: message(error) }
            : {
                recordsState: "error",
                recordLoadingMore: false,
                recordsError: message(error),
              },
        );
      }
    }
  },
  async onMoreRecords() {
    if (this.data.recordSubmitting || this.data.archiveSubmitting) return;
    await this.loadRecords(true);
  },
  onRecordKind(event: WechatMiniprogram.PickerChange) {
    if (this.data.recordSubmitting || this.data.archiveSubmitting) return;
    this.setData({ recordKindIndex: Number(event.detail.value) });
    void this.loadRecords();
  },
  onRecordStatus(event: WechatMiniprogram.PickerChange) {
    if (this.data.recordSubmitting || this.data.archiveSubmitting) return;
    this.setData({ recordStatusIndex: Number(event.detail.value) });
    void this.loadRecords();
  },
  onNewRecord() {
    if (this.data.recordSubmitting || this.data.archiveSubmitting) return;
    this.recordMutationKey = "";
    this.archiveMutationKey = "";
    this.setData({
      recordFormVisible: true,
      editingRecordId: "",
      recordForm: emptyRecordForm(),
      recordFormKindIndex: 0,
      recordAttachmentDraft: null,
      recordSubmitError: "",
      recordArchiveId: "",
      archiveReason: "",
    });
  },
  onEditRecord(event: WechatMiniprogram.TouchEvent) {
    if (this.data.recordSubmitting || this.data.archiveSubmitting) return;
    const record = this.data.records.find(
      (item) => item.id === String(event.currentTarget.dataset.id),
    );
    if (!record || record.status === "ARCHIVED") return;
    this.recordMutationKey = "";
    this.archiveMutationKey = "";
    this.setData({
      recordFormVisible: true,
      editingRecordId: record.id,
      recordFormKindIndex: ["QUALIFICATION", "TRAINING", "GROWTH"].indexOf(
        record.kind,
      ),
      recordForm: {
        kind: record.kind,
        title: record.title,
        organization: record.organization,
        occurredOn: record.occurredOn,
        expiresOn: record.expiresOn,
        note: record.note,
        attachmentFileId: record.attachmentFileId,
      },
      recordAttachmentDraft: null,
      recordSubmitError: "",
      recordArchiveId: "",
      archiveReason: "",
    });
  },
  onCancelRecordForm() {
    if (this.data.recordSubmitting) return;
    this.recordMutationKey = "";
    this.setData({
      recordFormVisible: false,
      editingRecordId: "",
      recordAttachmentDraft: null,
      recordSubmitError: "",
    });
  },
  onRecordField(
    event: WechatMiniprogram.Input | WechatMiniprogram.PickerChange,
  ) {
    if (this.data.recordSubmitting) return;
    this.recordMutationKey = "";
    const field = String(
      event.currentTarget.dataset.field,
    ) as keyof HrTeacherRecordInput;
    this.setData({
      recordForm: { ...this.data.recordForm, [field]: event.detail.value },
    });
  },
  onRecordFormKind(event: WechatMiniprogram.PickerChange) {
    if (this.data.recordSubmitting) return;
    this.recordMutationKey = "";
    const kinds: HrTeacherRecordKind[] = [
      "QUALIFICATION",
      "TRAINING",
      "GROWTH",
    ];
    const recordFormKindIndex = Number(event.detail.value);
    this.setData({
      recordFormKindIndex,
      recordForm: {
        ...this.data.recordForm,
        kind: kinds[recordFormKindIndex] ?? "QUALIFICATION",
      },
    });
  },
  onClearRecordExpiry() {
    if (this.data.recordSubmitting) return;
    this.recordMutationKey = "";
    this.setData({ recordForm: { ...this.data.recordForm, expiresOn: null } });
  },
  onRemoveRecordAttachment() {
    if (this.data.recordSubmitting) return;
    this.recordMutationKey = "";
    this.setData({
      recordForm: { ...this.data.recordForm, attachmentFileId: null },
      recordAttachmentDraft: null,
    });
  },
  onChooseRecordAttachment() {
    if (this.data.recordSubmitting) return;
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["png", "jpg", "jpeg", "pdf"],
      success: (result) => {
        const file = result.tempFiles[0];
        if (!file) return;
        if (file.size > 3 * 1024 * 1024) {
          wx.showToast({ title: "附件不能超过 3MB", icon: "none" });
          return;
        }
        this.recordMutationKey = "";
        this.setData({
          recordAttachmentDraft: {
            path: file.path,
            name: file.name,
            size: file.size,
          },
          recordSubmitError: "",
        });
      },
    });
  },
  async onSaveRecord() {
    if (this.data.recordSubmitting || !this.data.detail) return;
    const teacherId = this.data.detail.id;
    const recordId = this.data.editingRecordId || null;
    const current = recordId
      ? this.data.records.find((item) => item.id === recordId)
      : null;
    if (recordId && !current) {
      this.setData({ recordSubmitError: "记录已刷新，请重新选择" });
      return;
    }
    const expectedVersion = current?.version ?? null;
    const form = { ...this.data.recordForm };
    const draft = this.data.recordAttachmentDraft
      ? { ...this.data.recordAttachmentDraft }
      : null;
    if (!form.title.trim() || !form.occurredOn) {
      this.setData({ recordSubmitError: "请填写记录名称和发生日期" });
      return;
    }
    if (form.expiresOn && form.expiresOn < form.occurredOn) {
      this.setData({ recordSubmitError: "有效期不能早于发生日期" });
      return;
    }
    const key =
      this.recordMutationKey || operationKey(recordId ? "update" : "create");
    this.recordMutationKey = key;
    this.setData({ recordSubmitting: true, recordSubmitError: "" });
    try {
      let attachmentFileId = form.attachmentFileId ?? null;
      if (draft) {
        const attachment = await createHrRecordsApi().uploadAttachment(
          draft.path,
        );
        attachmentFileId = attachment.id;
        this.setData({
          recordForm: { ...form, attachmentFileId },
          recordAttachmentDraft: null,
        });
      }
      const input: HrTeacherRecordInput = {
        kind: form.kind,
        title: form.title.trim(),
        organization: form.organization?.trim() || null,
        occurredOn: form.occurredOn,
        expiresOn: form.expiresOn || null,
        note: form.note?.trim() ?? "",
        attachmentFileId,
      };
      const api = createHrRecordsApi();
      if (recordId && expectedVersion !== null) {
        await api.update(recordId, { ...input, expectedVersion }, key);
      } else {
        await api.create(teacherId, input, key);
      }
      this.recordMutationKey = "";
      this.setData({
        recordSubmitting: false,
        recordFormVisible: false,
        editingRecordId: "",
        recordSubmitError: "",
      });
      await this.loadRecords();
    } catch (error) {
      this.setData({
        recordSubmitting: false,
        recordSubmitError: message(error),
      });
    }
  },
  onStartArchive(event: WechatMiniprogram.TouchEvent) {
    if (this.data.recordSubmitting || this.data.archiveSubmitting) return;
    const record = this.data.records.find(
      (item) => item.id === String(event.currentTarget.dataset.id),
    );
    if (!record || record.status === "ARCHIVED") return;
    this.archiveMutationKey = "";
    this.recordMutationKey = "";
    this.setData({
      recordArchiveId: record.id,
      archiveReason: "",
      recordFormVisible: false,
      recordSubmitError: "",
    });
  },
  onArchiveReason(event: WechatMiniprogram.Input) {
    if (this.data.archiveSubmitting) return;
    this.archiveMutationKey = "";
    this.setData({ archiveReason: event.detail.value });
  },
  onCancelArchive() {
    if (!this.data.archiveSubmitting) {
      this.archiveMutationKey = "";
      this.setData({ recordArchiveId: "", archiveReason: "" });
    }
  },
  async onConfirmArchive() {
    if (this.data.archiveSubmitting || !this.data.recordArchiveId) return;
    const record = this.data.records.find(
      (item) => item.id === this.data.recordArchiveId,
    );
    if (!record) return;
    const recordId = record.id;
    const expectedVersion = record.version;
    const reason = this.data.archiveReason.trim();
    if (!reason) {
      this.setData({ recordSubmitError: "请填写归档原因" });
      return;
    }
    const key = this.archiveMutationKey || operationKey("archive");
    this.archiveMutationKey = key;
    this.setData({ archiveSubmitting: true, recordSubmitError: "" });
    try {
      await createHrRecordsApi().archive(
        recordId,
        { expectedVersion, reason },
        key,
      );
      this.archiveMutationKey = "";
      this.setData({
        archiveSubmitting: false,
        recordArchiveId: "",
        archiveReason: "",
      });
      await this.loadRecords();
    } catch (error) {
      this.setData({
        archiveSubmitting: false,
        recordSubmitError: message(error),
      });
    }
  },
  async onPreviewRecordAttachment(event: WechatMiniprogram.TouchEvent) {
    if (
      this.data.previewingRecordId ||
      this.data.recordSubmitting ||
      this.data.archiveSubmitting
    )
      return;
    const record = this.data.records.find(
      (item) => item.id === String(event.currentTarget.dataset.id),
    );
    if (!record?.attachment) return;
    this.setData({ previewingRecordId: record.id, recordsError: "" });
    try {
      await createHrRecordsApi().previewAttachment(record);
    } catch (error) {
      this.setData({ recordsError: message(error) });
    } finally {
      this.setData({ previewingRecordId: "" });
    }
  },
  onClose() {
    if (this.data.recordSubmitting || this.data.archiveSubmitting) return;
    this.recordMutationKey = "";
    this.archiveMutationKey = "";
    this.detailRevision += 1;
    this.recordRevision += 1;
    this.setData({
      detail: null,
      detailLoading: false,
      detailError: "",
      records: [],
      recordsState: "empty",
      recordsError: "",
      recordTotal: 0,
      recordPage: 1,
      recordHasMore: false,
      recordLoadingMore: false,
      recordKindIndex: 0,
      recordStatusIndex: 0,
      recordFormVisible: false,
      recordFormKindIndex: 0,
      editingRecordId: "",
      recordAttachmentDraft: null,
      recordSubmitting: false,
      recordSubmitError: "",
      recordArchiveId: "",
      archiveReason: "",
      archiveSubmitting: false,
      previewingRecordId: "",
    });
  },
  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: "/pages/hr/home/index" });
  },
  onTeachingReport() {
    wx.navigateTo({ url: this.reportUrl("/pages/hr/teaching/index") });
  },
  onEarningReport() {
    wx.navigateTo({ url: this.reportUrl("/pages/hr/earnings/index") });
  },
  reportUrl(path: string) {
    if (!this.data.detail) return path;
    return `${path}?teacherId=${encodeURIComponent(this.data.detail.id)}&teacherName=${encodeURIComponent(this.data.detail.name)}`;
  },
  stopTap() {},
});
function message(error: unknown) {
  return error instanceof Error ? error.message : "加载失败，请重试";
}
function chinaDate() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}
function operationKey(action: string) {
  return `hr-record-${action}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
