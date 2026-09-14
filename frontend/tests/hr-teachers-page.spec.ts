import * as fs from "fs";
import * as path from "path";
import type { HrTeacherDetail } from "../services/hr.service";

const mockApi = {
  campuses: jest.fn(),
  teachers: jest.fn(),
  teacher: jest.fn(),
};
const mockRecordsApi = {
  list: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  archive: jest.fn(),
  uploadAttachment: jest.fn(),
  previewAttachment: jest.fn(),
};
const mockSession = { load: jest.fn() };
jest.mock("../services/hr.service", () => ({ createHrApi: () => mockApi }));
jest.mock("../services/hr-records.service", () => ({
  createHrRecordsApi: () => mockRecordsApi,
}));
jest.mock("../services/session.service", () => ({
  createSessionService: () => mockSession,
}));

interface TestPage {
  data: Record<string, unknown>;
  setData(patch: Record<string, unknown>): void;
  initialize(): Promise<void>;
  load(append?: boolean): Promise<void>;
  onDetail(event: {
    currentTarget: { dataset: { id: string } };
  }): Promise<void>;
  loadRecords(): Promise<void>;
  onMoreRecords(): Promise<void>;
  onRecordKind(event: { detail: { value: string } }): void;
  onNewRecord(): void;
  onRecordField(event: {
    currentTarget: { dataset: { field: string } };
    detail: { value: string };
  }): void;
  onChooseRecordAttachment(): void;
  onSaveRecord(): Promise<void>;
  onEditRecord(event: { currentTarget: { dataset: { id: string } } }): void;
  onStartArchive(event: { currentTarget: { dataset: { id: string } } }): void;
  onArchiveReason(event: { detail: { value: string } }): void;
  onConfirmArchive(): Promise<void>;
  onPreviewRecordAttachment(event: {
    currentTarget: { dataset: { id: string } };
  }): Promise<void>;
  onTeachingReport(): void;
  onEarningReport(): void;
  onClose(): void;
}
const teacher: HrTeacherDetail = {
  id: "teacher-1",
  name: "林老师",
  campusId: "campus-1",
  campusName: "东校区",
  employeeCode: "T001",
  active: true,
  specialties: ["美术"],
  activeClassCount: 2,
  completedLessonCount: 3,
  createdAt: "2026-09-06T18:00:00Z",
};
const result = { items: [teacher], total: 1, page: 1, pageSize: 20 };
const record = {
  id: "record-1",
  teacherId: teacher.id,
  kind: "QUALIFICATION" as const,
  title: "家庭教育指导师",
  organization: "本地培训中心",
  occurredOn: "2026-08-01",
  expiresOn: null,
  note: "",
  attachmentFileId: "file-1",
  attachment: {
    id: "file-1",
    originalName: "qualification.pdf",
    mimeType: "application/pdf" as const,
    sizeBytes: 100,
  },
  version: 1,
  status: "ACTIVE" as const,
  archivedAt: null,
  createdByName: "总部人力",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};

describe("HR teacher directory page", () => {
  let page: TestPage;
  const oldPage = Object.getOwnPropertyDescriptor(globalThis, "Page");
  const oldWx = Object.getOwnPropertyDescriptor(globalThis, "wx");
  const relaunch = jest.fn();
  const navigateTo = jest.fn();
  beforeEach(() => {
    jest.resetAllMocks();
    Object.defineProperty(globalThis, "wx", {
      configurable: true,
      value: {
        reLaunch: relaunch,
        navigateTo,
        chooseMessageFile: jest.fn((options) =>
          options.success({
            tempFiles: [
              {
                path: "wxfile://qualification.pdf",
                name: "qualification.pdf",
                size: 100,
              },
            ],
          }),
        ),
      },
    });
    Object.defineProperty(globalThis, "Page", {
      configurable: true,
      value: (definition: TestPage) => {
        page = definition;
        page.setData = (patch) => Object.assign(page.data, patch);
      },
    });
    jest.isolateModules(() => require("../pages/hr/teachers/index"));
    mockSession.load.mockResolvedValue({
      displayName: "总部人力",
      roles: [{ code: "HR", campusId: null }],
    });
    mockApi.campuses.mockResolvedValue({
      items: [{ id: "campus-1", name: "东校区" }],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    mockApi.teachers.mockResolvedValue(result);
    mockApi.teacher.mockResolvedValue(teacher);
    mockRecordsApi.list.mockResolvedValue({
      items: [record],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    mockRecordsApi.uploadAttachment.mockResolvedValue({
      id: "file-1",
      originalName: "qualification.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
    });
    mockRecordsApi.create.mockResolvedValue({
      ...record,
      attachmentFileId: "file-1",
    });
    mockRecordsApi.update.mockResolvedValue({
      ...record,
      title: "已编辑",
      version: 2,
    });
    mockRecordsApi.archive.mockResolvedValue({
      ...record,
      status: "ARCHIVED",
      version: 2,
    });
  });
  afterEach(() => {
    if (oldPage) Object.defineProperty(globalThis, "Page", oldPage);
    else Reflect.deleteProperty(globalThis, "Page");
    if (oldWx) Object.defineProperty(globalThis, "wx", oldWx);
    else Reflect.deleteProperty(globalThis, "wx");
  });

  it("loads the directory and sends name, campus and status filters to the API", async () => {
    await page.initialize();
    expect(page.data).toMatchObject({
      authorized: true,
      viewState: "ready",
      total: 1,
      rows: [expect.objectContaining({ name: "林老师", statusLabel: "启用" })],
    });
    page.setData({ keyword: " 林 ", campusIndex: 1, statusIndex: 1 });
    await page.load();
    expect(mockApi.teachers).toHaveBeenLastCalledWith({
      query: "林",
      campusId: "campus-1",
      status: "ACTIVE",
      page: 1,
      pageSize: 20,
    });
  });

  it("rejects another role before loading HR data", async () => {
    mockSession.load.mockResolvedValue({
      roles: [{ code: "FINANCE", campusId: null }],
    });
    await page.initialize();
    expect(page.data).toMatchObject({ authorized: false, viewState: "error" });
    expect(mockApi.campuses).not.toHaveBeenCalled();
    expect(mockApi.teachers).not.toHaveBeenCalled();
  });

  it("appends the next page and ignores a superseded search result", async () => {
    mockApi.teachers.mockResolvedValueOnce({ ...result, total: 21 });
    await page.initialize();
    mockApi.teachers.mockResolvedValueOnce({
      ...result,
      items: [{ ...teacher, id: "teacher-2" }],
      page: 2,
      total: 21,
    });
    await page.load(true);
    expect(mockApi.teachers).toHaveBeenLastCalledWith({
      page: 2,
      pageSize: 20,
    });
    expect(page.data.rows).toHaveLength(2);
    expect(page.data.hasMore).toBe(false);
    let finish!: (value: unknown) => void;
    mockApi.teachers.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = page.load();
    mockApi.teachers.mockResolvedValueOnce({ ...result, items: [], total: 0 });
    await page.load();
    finish(result);
    await pending;
    expect(page.data).toMatchObject({ viewState: "empty", rows: [], total: 0 });
  });

  it("shows server teaching totals and does not reopen a closed detail sheet", async () => {
    await page.initialize();
    await page.onDetail({ currentTarget: { dataset: { id: teacher.id } } });
    expect(page.data.detail).toMatchObject({
      completedLessonCount: 3,
      createdLabel: "2026-09-07",
    });
    let finish!: (value: unknown) => void;
    mockApi.teacher.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = page.onDetail({
      currentTarget: { dataset: { id: teacher.id } },
    });
    page.onClose();
    finish(teacher);
    await pending;
    expect(page.data).toMatchObject({ detail: null, detailLoading: false });
  });

  it("loads teacher records with the detail and applies record filters", async () => {
    await page.initialize();
    await page.onDetail({ currentTarget: { dataset: { id: teacher.id } } });
    expect(mockRecordsApi.list).toHaveBeenCalledWith(teacher.id, {
      page: 1,
      pageSize: 20,
      status: "ACTIVE",
    });
    expect(page.data).toMatchObject({ recordsState: "ready", recordTotal: 1 });
    page.onRecordKind({ detail: { value: "3" } });
    await Promise.resolve();
    expect(mockRecordsApi.list).toHaveBeenLastCalledWith(teacher.id, {
      page: 1,
      pageSize: 20,
      status: "ACTIVE",
      kind: "GROWTH",
    });
  });

  it("opens the two independent report modules with the selected teacher", async () => {
    await page.initialize();
    await page.onDetail({ currentTarget: { dataset: { id: teacher.id } } });

    page.onTeachingReport();
    page.onEarningReport();

    const teacherQuery =
      "teacherId=teacher-1&teacherName=%E6%9E%97%E8%80%81%E5%B8%88";
    expect(navigateTo).toHaveBeenNthCalledWith(1, {
      url: `/pages/hr/teaching/index?${teacherQuery}`,
    });
    expect(navigateTo).toHaveBeenNthCalledWith(2, {
      url: `/pages/hr/earnings/index?${teacherQuery}`,
    });
  });

  it("keeps report and logout actions inside their owning views", () => {
    const markup = fs.readFileSync(
      path.resolve(__dirname, "../pages/hr/teachers/index.wxml"),
      "utf8",
    );
    const styles = fs.readFileSync(
      path.resolve(__dirname, "../pages/hr/teachers/index.wxss"),
      "utf8",
    );
    const [roster, detailSheet = ""] = markup.split(
      '<view wx:if="{{detail || detailLoading || detailError}}"',
    );

    expect(roster).not.toContain('bindtap="onTeachingReport"');
    expect(roster).not.toContain('bindtap="onEarningReport"');
    expect(roster).not.toContain('bindtap="onLogout"');
    expect(detailSheet).toContain(
      'bindtap="onTeachingReport">查看课耗统计</button>',
    );
    expect(detailSheet).toContain(
      'bindtap="onEarningReport">查看课时费与结算</button>',
    );
    expect(detailSheet.indexOf("{{detail.name}}")).toBeLessThan(
      detailSheet.indexOf('bindtap="onTeachingReport"'),
    );
    expect(detailSheet).toContain(
      'class="workspace__head hr-detail__identity"',
    );
    expect(detailSheet).toContain('class="toolbar hr-detail__reports"');
    expect(styles).toMatch(
      /\.hr-detail__identity\s*\{[^}]*width:\s*calc\(100% \+ 32rpx\)[^}]*margin-left:\s*-16rpx/s,
    );
    expect(styles).toMatch(
      /\.hr-detail__reports\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s,
    );
    expect(styles).toMatch(
      /\.hr-detail__reports \.button\s*\{[^}]*width:\s*100%/s,
    );
  });

  it("appends later teacher-record pages without replacing the current rows", async () => {
    mockRecordsApi.list.mockResolvedValueOnce({
      items: [record],
      total: 21,
      page: 1,
      pageSize: 20,
    });
    await page.initialize();
    await page.onDetail({ currentTarget: { dataset: { id: teacher.id } } });
    expect(page.data).toMatchObject({ recordPage: 1, recordHasMore: true });
    mockRecordsApi.list.mockResolvedValueOnce({
      items: [{ ...record, id: "record-21", title: "第二页记录" }],
      total: 21,
      page: 2,
      pageSize: 20,
    });
    await page.onMoreRecords();
    expect(mockRecordsApi.list).toHaveBeenLastCalledWith(teacher.id, {
      page: 2,
      pageSize: 20,
      status: "ACTIVE",
    });
    expect(page.data).toMatchObject({ recordPage: 2, recordHasMore: false });
    expect(page.data.records).toHaveLength(2);
  });

  it("uploads and creates a record once while a submission is pending", async () => {
    await page.initialize();
    await page.onDetail({ currentTarget: { dataset: { id: teacher.id } } });
    page.onNewRecord();
    page.onRecordField({
      currentTarget: { dataset: { field: "title" } },
      detail: { value: "新资质" },
    });
    page.onRecordField({
      currentTarget: { dataset: { field: "occurredOn" } },
      detail: { value: "2026-09-08" },
    });
    page.onChooseRecordAttachment();
    await Promise.resolve();
    let finish!: (value: typeof record) => void;
    mockRecordsApi.create.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = page.onSaveRecord();
    await Promise.resolve();
    await page.onSaveRecord();
    expect(mockRecordsApi.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(mockRecordsApi.create).toHaveBeenCalledTimes(1);
    finish(record);
    await pending;
    expect(page.data).toMatchObject({
      recordSubmitting: false,
      recordFormVisible: false,
    });
  });

  it("keeps the original edit target while an attachment upload is pending", async () => {
    await page.initialize();
    await page.onDetail({ currentTarget: { dataset: { id: teacher.id } } });
    page.onEditRecord({ currentTarget: { dataset: { id: record.id } } });
    page.onChooseRecordAttachment();
    let finishUpload!: (value: {
      id: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
    }) => void;
    mockRecordsApi.uploadAttachment.mockReturnValueOnce(
      new Promise((resolve) => {
        finishUpload = resolve;
      }),
    );
    const pending = page.onSaveRecord();
    await Promise.resolve();

    page.onClose();
    page.onNewRecord();
    await page.onDetail({
      currentTarget: { dataset: { id: "teacher-2" } },
    });
    expect(page.data).toMatchObject({
      detail: expect.objectContaining({ id: teacher.id }),
      editingRecordId: record.id,
      recordSubmitting: true,
    });
    expect(mockApi.teacher).toHaveBeenCalledTimes(1);

    finishUpload({
      id: "replacement-file",
      originalName: "replacement.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
    });
    await pending;
    expect(mockRecordsApi.update).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({
        expectedVersion: record.version,
        attachmentFileId: "replacement-file",
      }),
      expect.any(String),
    );
    expect(mockRecordsApi.create).not.toHaveBeenCalled();
  });

  it("reuses a create key after an unknown response and rotates it after the user edits", async () => {
    await page.initialize();
    await page.onDetail({ currentTarget: { dataset: { id: teacher.id } } });
    page.onNewRecord();
    page.onRecordField({
      currentTarget: { dataset: { field: "title" } },
      detail: { value: "可重试资质" },
    });
    mockRecordsApi.create
      .mockRejectedValueOnce(new Error("网络连接失败，请重试"))
      .mockRejectedValueOnce(new Error("网络连接失败，请重试"));

    await page.onSaveRecord();
    await page.onSaveRecord();
    const firstKey = mockRecordsApi.create.mock.calls[0][2] as string;
    const retryKey = mockRecordsApi.create.mock.calls[1][2] as string;
    expect(retryKey).toBe(firstKey);

    page.onRecordField({
      currentTarget: { dataset: { field: "title" } },
      detail: { value: "修改后的资质" },
    });
    await page.onSaveRecord();
    expect(mockRecordsApi.create.mock.calls[2][2]).not.toBe(firstKey);
  });

  it("reuses update and archive keys when their responses are unknown", async () => {
    await page.initialize();
    await page.onDetail({ currentTarget: { dataset: { id: teacher.id } } });
    page.onEditRecord({ currentTarget: { dataset: { id: record.id } } });
    mockRecordsApi.update.mockRejectedValueOnce(
      new Error("网络连接失败，请重试"),
    );
    await page.onSaveRecord();
    await page.onSaveRecord();
    expect(mockRecordsApi.update.mock.calls[1][2]).toBe(
      mockRecordsApi.update.mock.calls[0][2],
    );

    page.onStartArchive({ currentTarget: { dataset: { id: record.id } } });
    page.onArchiveReason({ detail: { value: "历史归档" } });
    mockRecordsApi.archive.mockRejectedValueOnce(
      new Error("网络连接失败，请重试"),
    );
    await page.onConfirmArchive();
    await page.onConfirmArchive();
    expect(mockRecordsApi.archive.mock.calls[1][2]).toBe(
      mockRecordsApi.archive.mock.calls[0][2],
    );
  });

  it("edits, archives and previews records through the record API", async () => {
    await page.initialize();
    await page.onDetail({ currentTarget: { dataset: { id: teacher.id } } });
    page.onEditRecord({ currentTarget: { dataset: { id: record.id } } });
    page.onRecordField({
      currentTarget: { dataset: { field: "title" } },
      detail: { value: "已编辑" },
    });
    await page.onSaveRecord();
    expect(mockRecordsApi.update).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({ title: "已编辑", expectedVersion: 1 }),
      expect.any(String),
    );
    page.onStartArchive({ currentTarget: { dataset: { id: record.id } } });
    page.onArchiveReason({ detail: { value: "历史归档" } });
    await page.onConfirmArchive();
    expect(mockRecordsApi.archive).toHaveBeenCalledWith(
      record.id,
      { expectedVersion: 1, reason: "历史归档" },
      expect.any(String),
    );
    await page.onPreviewRecordAttachment({
      currentTarget: { dataset: { id: record.id } },
    });
    expect(mockRecordsApi.previewAttachment).toHaveBeenCalledWith(
      expect.objectContaining(record),
    );
  });

  it("retains search criteria after an API failure", async () => {
    await page.initialize();
    page.setData({ keyword: "林" });
    mockApi.teachers.mockRejectedValueOnce(new Error("网络连接失败，请重试"));
    await page.load();
    expect(page.data).toMatchObject({
      keyword: "林",
      viewState: "error",
      errorMessage: "网络连接失败，请重试",
    });
    await page.load();
    expect(page.data.viewState).toBe("ready");
  });
});
