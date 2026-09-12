import type { FinanceReceipt } from "../services/finance.service";

const mockService = {
  campuses: jest.fn(),
  students: jest.fn(),
  list: jest.fn(),
  detail: jest.fn(),
  create: jest.fn(),
  issue: jest.fn(),
  upload: jest.fn(),
  proof: jest.fn(),
  exportReceipts: jest.fn(),
};
const mockCorrectionApi = {
  list: jest.fn(),
  detail: jest.fn(),
  submit: jest.fn(),
  act: jest.fn(),
  originalProof: jest.fn(),
  replacementProof: jest.fn(),
};
const mockSession = { load: jest.fn(), logout: jest.fn() };
jest.mock("../services/finance.service", () => ({
  ...jest.requireActual("../services/finance.service"),
  createFinanceService: () => mockService,
}));
jest.mock("../services/session.service", () => ({
  createSessionService: () => mockSession,
}));
jest.mock("../services/finance-corrections.service", () => ({
  ...jest.requireActual("../services/finance-corrections.service"),
  createCorrectionApi: () => mockCorrectionApi,
}));
jest.mock("../config/teacher-env", () => ({
  createTeacherRuntimeEnv: () => ({ dataDriver: "api" }),
}));

interface TestPage {
  data: Record<string, unknown>;
  setData(patch: Record<string, unknown>): void;
  initializeApi(): Promise<void>;
  reloadApi(append?: boolean): Promise<void>;
  onCreate(): void;
  onIssue(): void;
  onCorrection(): void;
  onCorrectionType(event: {
    currentTarget: { dataset: { type: "VOID" | "REPLACE" } };
  }): void;
  onCorrectionAction(event: {
    currentTarget: { dataset: { action: "WITHDRAW" | "APPLY" } };
  }): void;
  onSubmit(): Promise<void>;
  onExport(): Promise<void>;
  onCloseForm(): void;
  loadStudents(append?: boolean): Promise<void>;
  openApiDetail(id: string): Promise<void>;
}
const receipt: FinanceReceipt = {
  id: "receipt-1",
  campusId: "campus-1",
  campusName: "测试校区",
  studentId: "student-1",
  studentName: "测试学员",
  amountFen: 120000,
  receivedOn: "2026-09-01",
  channel: "CASH",
  note: "",
  createdAt: "2026-09-06T03:00:00Z",
  status: "UNLINKED",
  recordKind: "ORIGINAL",
  replacementOfCorrectionId: null,
  correctionEffectFen: 0,
  correction: null,
  issuance: null,
};
const linkedReceipt: FinanceReceipt = {
  ...receipt,
  status: "LINKED",
  issuance: {
    id: "issuance-1",
    coursePackageId: "package-1",
    originalAmountFen: 120000,
    initialMainUnits: 1200,
    initialGiftUnits: 300,
    name: "原课程包",
    validFrom: "2026-09-01T00:00:00+08:00",
    expiresAt: null,
    createdAt: "2026-09-06T03:00:00Z",
    unitPriceFen: 10000,
  },
};
const replacementReceipt: FinanceReceipt = {
  ...linkedReceipt,
  id: "receipt-2",
  recordKind: "REPLACEMENT",
  replacementOfCorrectionId: "correction-1",
};
const correction = {
  id: "correction-1",
  originalReceiptId: linkedReceipt.id,
  originalCoursePackageId: "package-1",
  type: "REPLACE",
  status: "APPROVED",
  version: 4,
  reason: "原记录录入错误",
  requestedByUserId: "finance-user",
  createdAt: "2026-09-09T01:00:00Z",
  original: {
    campusId: "campus-1",
    campusName: "测试校区",
    studentId: "student-1",
    studentName: "测试学员",
    amountFen: 120000,
    receivedOn: "2026-09-01",
    channel: "CASH",
    note: "",
    proofAvailable: true,
    package: {
      name: "原课程包",
      mainUnits: 1200,
      giftUnits: 300,
      validFrom: "2026-09-01T00:00:00+08:00",
      expiresAt: null,
    },
  },
  proposedReplacement: null,
  replacementReceiptId: null,
  correctionEffectFen: -120000,
  events: [],
};

describe("finance API page interactions", () => {
  let page: TestPage;
  const oldPage = Object.getOwnPropertyDescriptor(globalThis, "Page");
  const oldWx = Object.getOwnPropertyDescriptor(globalThis, "wx");
  beforeEach(() => {
    jest.resetAllMocks();
    Object.defineProperty(globalThis, "wx", {
      configurable: true,
      value: { showToast: jest.fn() },
    });
    Object.defineProperty(globalThis, "Page", {
      configurable: true,
      value: (definition: TestPage) => {
        page = definition;
        page.setData = (patch) => Object.assign(page.data, patch);
      },
    });
    jest.isolateModules(() => require("../pages/finance/receipts/index"));
    mockSession.load.mockResolvedValue({
      roles: [{ code: "FINANCE", campusId: null }],
    });
    mockService.campuses.mockResolvedValue({
      items: [{ id: "campus-1", name: "测试校区" }],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    mockService.students.mockResolvedValue({
      items: [{ id: "student-1", name: "测试学员" }],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    mockService.list.mockResolvedValue({
      items: [receipt],
      total: 1,
      page: 1,
      pageSize: 20,
      summary: {
        amountFen: 120000,
        correctionEffectFen: 0,
        netAmountFen: 120000,
        unlinkedCount: 1,
      },
    });
    mockService.detail.mockResolvedValue(receipt);
    mockService.upload.mockResolvedValue({ id: "proof-1" });
    mockCorrectionApi.list.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    mockCorrectionApi.detail.mockResolvedValue(correction);
  });
  afterEach(() => {
    if (oldPage) Object.defineProperty(globalThis, "Page", oldPage);
    else Reflect.deleteProperty(globalThis, "Page");
    if (oldWx) Object.defineProperty(globalThis, "wx", oldWx);
    else Reflect.deleteProperty(globalThis, "wx");
  });

  it("does not load business data for a non-finance account", async () => {
    mockSession.load.mockResolvedValue({
      roles: [{ code: "SUPER_ADMIN", campusId: null }],
    });
    await page.initializeApi();
    expect(page.data.viewState).toBe("forbidden");
    expect(mockService.campuses).not.toHaveBeenCalled();
    expect(mockService.list).not.toHaveBeenCalled();
  });

  it("uses API data instead of preview fixtures and server summary", async () => {
    await page.initializeApi();
    await page.reloadApi();
    expect(page.data.previewEnabled).toBe(false);
    expect(page.data.apiEnabled).toBe(true);
    expect(page.data.rows).toEqual([
      expect.objectContaining({
        studentName: "测试学员",
        amountLabel: "1200.00",
      }),
    ]);
    expect(page.data.summary).toEqual({
      receiptsLabel: "1200.00",
      correctionEffectLabel: "0.00",
      netAmountLabel: "1200.00",
      linkedCount: 0,
      unlinkedCount: 1,
    });
  });

  it("preserves receipt draft and idempotency key after a network failure", async () => {
    await page.initializeApi();
    page.onCreate();
    page.setData({
      createCampusIndex: 1,
      studentOptions: [{ id: "student-1", name: "测试学员" }],
      studentIndex: 0,
      proofPath: "/local/receipt.png",
      amount: "1200.00",
      receivedOn: "2026-09-01",
    });
    mockService.create
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockResolvedValueOnce(receipt);
    await page.onSubmit();
    expect(page.data).toMatchObject({
      formMode: "receipt",
      amount: "1200.00",
      formError: "网络中断",
      submitting: false,
    });
    const first = mockService.create.mock.calls[0];
    await page.onSubmit();
    expect(mockService.create.mock.calls[1]).toEqual(first);
    expect(mockService.upload).toHaveBeenCalledTimes(1);
    expect(page.data.formMode).toBe("");
  });

  it("blocks concurrent submits and keeps gift lessons independent", async () => {
    await page.initializeApi();
    page.setData({ detail: { id: "receipt-1", linked: false } });
    page.onIssue();
    page.setData({
      packageName: "课程包",
      mainLessons: "12",
      giftLessons: "3",
      validFrom: "2026-09-01",
    });
    let finish!: () => void;
    mockService.issue.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const pending = page.onSubmit();
    await page.onSubmit();
    page.onCloseForm();
    expect(page.data.formMode).toBe("issue");
    expect(mockService.issue).toHaveBeenCalledTimes(1);
    expect(mockService.issue.mock.calls[0][1]).toMatchObject({
      mainUnits: 1200,
      giftUnits: 300,
      expiresAt: null,
    });
    finish();
    await pending;
    expect(page.data.submitting).toBe(false);
  });

  it("ignores stale list responses when filters change", async () => {
    await page.initializeApi();
    let finish!: (value: unknown) => void;
    mockService.list.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const stale = page.reloadApi();
    mockService.list.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      summary: {
        amountFen: 0,
        correctionEffectFen: 0,
        netAmountFen: 0,
        unlinkedCount: 0,
      },
    });
    await page.reloadApi();
    finish({
      items: [receipt],
      total: 1,
      page: 1,
      pageSize: 20,
      summary: {
        amountFen: 120000,
        correctionEffectFen: 0,
        netAmountFen: 120000,
        unlinkedCount: 1,
      },
    });
    await stale;
    expect(page.data.viewState).toBe("empty");
    expect(page.data.rows).toEqual([]);
  });

  it("exports the current filters once and keeps a failed export out of list state", async () => {
    await page.initializeApi();
    page.setData({
      campusIndex: 1,
      keyword: "测试学员",
      startDate: "2026-09-01",
      endDate: "2026-09-08",
      status: "UNLINKED",
    });
    let fail!: (error: Error) => void;
    mockService.exportReceipts.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
    );
    const pending = page.onExport();
    await page.onExport();
    expect(mockService.exportReceipts).toHaveBeenCalledTimes(1);
    expect(mockService.exportReceipts).toHaveBeenCalledWith({
      campusId: "campus-1",
      query: "测试学员",
      from: "2026-09-01",
      to: "2026-09-08",
      status: "UNLINKED",
    });
    fail(new Error("收款明细下载失败"));
    await pending;
    expect(page.data).toMatchObject({
      exporting: false,
      exportError: "收款明细下载失败",
      viewState: "ready",
    });
  });

  it("clears a cancelled student request loading flag before reopening the form", async () => {
    await page.initializeApi();
    page.onCreate();
    page.setData({ createCampusIndex: 1 });
    let finish!: (value: unknown) => void;
    mockService.students.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = page.loadStudents();
    expect(page.data.choicesLoading).toBe(true);
    page.onCloseForm();
    page.onCreate();
    finish({
      items: [{ id: "old-student", name: "旧选择" }],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    await pending;
    expect(page.data.choicesLoading).toBe(false);
    expect(page.data.studentOptions).toEqual([]);
  });

  it("opens correction only for an issued API receipt", async () => {
    await page.initializeApi();
    await page.openApiDetail(receipt.id);
    page.onCorrection();
    expect(page.data.formMode).toBe("");

    mockService.detail.mockResolvedValueOnce(linkedReceipt);
    await page.openApiDetail(linkedReceipt.id);
    page.onCorrection();
    expect(page.data).toMatchObject({
      formMode: "correction",
      correctionType: "VOID",
      correctionReason: "",
      proofPath: "",
      proofFileId: "",
    });
    expect(mockCorrectionApi.submit).not.toHaveBeenCalled();
  });

  it("does not open another correction for a generated replacement receipt", async () => {
    await page.initializeApi();
    mockService.detail.mockResolvedValueOnce(replacementReceipt);
    await page.openApiDetail(replacementReceipt.id);

    page.onCorrection();

    expect(page.data.formMode).toBe("");
  });

  it("prefills replacement from the immutable original and requires a new proof", async () => {
    await page.initializeApi();
    mockService.detail.mockResolvedValueOnce(linkedReceipt);
    await page.openApiDetail(linkedReceipt.id);
    page.onCorrection();
    page.onCorrectionType({
      currentTarget: { dataset: { type: "REPLACE" } },
    });
    expect(page.data).toMatchObject({
      correctionType: "REPLACE",
      createCampusIndex: 1,
      studentOptions: [{ id: "student-1", name: "测试学员" }],
      studentIndex: 0,
      amount: "1200.00",
      receivedOn: "2026-09-01",
      channelIndex: 3,
      note: "",
      packageName: "原课程包",
      mainLessons: "12",
      giftLessons: "3",
      validFrom: "2026-09-01",
      expiresOn: "",
      proofPath: "",
      proofFileId: "",
    });

    page.setData({ correctionReason: "更正学员和金额" });
    await page.onSubmit();
    expect(page.data.formError).toBe("更正替代必须选择新的收款凭证");
    expect(mockService.upload).not.toHaveBeenCalled();
    expect(mockCorrectionApi.submit).not.toHaveBeenCalled();
  });

  it("submits void with only the correction type and reason", async () => {
    await page.initializeApi();
    mockService.detail.mockResolvedValueOnce(linkedReceipt);
    await page.openApiDetail(linkedReceipt.id);
    page.onCorrection();
    page.setData({ correctionReason: "整笔收款登记错误" });
    mockCorrectionApi.submit.mockResolvedValueOnce({
      ...correction,
      type: "VOID",
      status: "SUBMITTED",
      version: 1,
    });

    await page.onSubmit();
    expect(mockCorrectionApi.submit).toHaveBeenCalledWith(
      linkedReceipt.id,
      { type: "VOID", reason: "整笔收款登记错误" },
      expect.any(String),
    );
    expect(mockService.upload).not.toHaveBeenCalled();
  });

  it("retries the same replacement payload and key without uploading proof twice", async () => {
    await page.initializeApi();
    mockService.detail.mockResolvedValue(linkedReceipt);
    await page.openApiDetail(linkedReceipt.id);
    page.onCorrection();
    page.onCorrectionType({
      currentTarget: { dataset: { type: "REPLACE" } },
    });
    page.setData({
      correctionReason: "更正原收款与课包",
      proofPath: "/local/replacement.png",
    });
    mockCorrectionApi.submit
      .mockRejectedValueOnce(new Error("网络连接失败，原表单已保留"))
      .mockResolvedValueOnce({
        ...correction,
        status: "SUBMITTED",
        version: 1,
      });

    await page.onSubmit();
    expect(page.data).toMatchObject({
      formMode: "correction",
      correctionReason: "更正原收款与课包",
      proofFileId: "proof-1",
      formError: "网络连接失败，原表单已保留",
    });
    const firstCall = mockCorrectionApi.submit.mock.calls[0];

    await page.onSubmit();
    expect(mockCorrectionApi.submit.mock.calls[1]).toEqual(firstCall);
    expect(mockService.upload).toHaveBeenCalledTimes(1);
    expect(firstCall[1]).toEqual({
      type: "REPLACE",
      reason: "更正原收款与课包",
      replacement: {
        campusId: "campus-1",
        studentId: "student-1",
        amountFen: 120000,
        receivedOn: "2026-09-01",
        channel: "CASH",
        proofFileId: "proof-1",
        note: "",
        package: {
          name: "原课程包",
          mainUnits: 1200,
          giftUnits: 300,
          validFrom: "2026-09-01T00:00:00+08:00",
          expiresAt: null,
        },
      },
    });
  });

  it("applies an approved correction with the current version", async () => {
    await page.initializeApi();
    mockService.detail.mockResolvedValueOnce({
      ...linkedReceipt,
      correction: {
        id: correction.id,
        type: "REPLACE",
        status: "APPROVED",
        replacementReceiptId: null,
      },
    });
    mockCorrectionApi.detail.mockResolvedValueOnce(correction);
    mockCorrectionApi.act.mockResolvedValueOnce({
      ...correction,
      status: "APPLIED",
      version: 5,
      replacementReceiptId: "receipt-2",
    });
    await page.openApiDetail(linkedReceipt.id);
    page.onCorrectionAction({
      currentTarget: { dataset: { action: "APPLY" } },
    });
    page.setData({ correctionReason: "按审核结果执行账面纠错" });

    await page.onSubmit();
    expect(mockCorrectionApi.act).toHaveBeenCalledWith(
      correction.id,
      {
        action: "APPLY",
        expectedVersion: 4,
        reason: "按审核结果执行账面纠错",
      },
      expect.any(String),
    );
  });
});
