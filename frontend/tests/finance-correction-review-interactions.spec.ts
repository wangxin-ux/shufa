export {};

const mockRefundApi = {
  list: jest.fn(),
  detail: jest.fn(),
  quote: jest.fn(),
  submit: jest.fn(),
  act: jest.fn(),
  upload: jest.fn(),
};
const mockCorrectionApi = {
  list: jest.fn(),
  detail: jest.fn(),
  submit: jest.fn(),
  act: jest.fn(),
  replacementProof: jest.fn(),
};
const mockSession = { load: jest.fn() };

jest.mock("../services/session.service", () => ({
  createSessionService: () => mockSession,
}));
jest.mock("../services/finance-refunds.service", () => ({
  ...jest.requireActual("../services/finance-refunds.service"),
  createRefundApi: () => mockRefundApi,
}));
jest.mock("../services/finance-corrections.service", () => ({
  CORRECTION_ACTION_LABELS: {
    APPROVE: "批准纠错",
    REJECT: "驳回纠错",
    WITHDRAW: "撤回申请",
    APPLY: "执行纠错",
  },
  CORRECTION_STATUS_LABELS: {
    SUBMITTED: "待审核",
    APPROVED: "待执行",
    REJECTED: "已驳回",
    WITHDRAWN: "已撤回",
    APPLIED: "已替代",
  },
  CORRECTION_TYPE_LABELS: {
    VOID: "撤销收款",
    REPLACE: "更正替代",
  },
  correctionActions: (role: string, status: string) => {
    const codes =
      role === "SUPER_ADMIN" && status === "SUBMITTED"
        ? ["APPROVE", "REJECT"]
        : role === "FINANCE" && status === "SUBMITTED"
          ? ["WITHDRAW"]
          : role === "FINANCE" && status === "APPROVED"
            ? ["APPLY"]
            : [];
    return codes.map((code) => ({ code, name: code }));
  },
  correctionActionGroups: (role: string, status: string) => {
    const codes =
      role === "SUPER_ADMIN" && status === "SUBMITTED"
        ? ["APPROVE", "REJECT"]
        : role === "FINANCE" && status === "SUBMITTED"
          ? ["WITHDRAW"]
          : role === "FINANCE" && status === "APPROVED"
            ? ["APPLY"]
            : [];
    const actions = codes.map((code) => ({ code, name: code }));
    return { actions, primaryActions: actions, secondaryActions: [] };
  },
  createCorrectionApi: () => mockCorrectionApi,
}));

interface ReviewPage {
  data: Record<string, unknown> & {
    reviewKind?: string;
    detail?: { id: string; version: number } | null;
    primaryActions?: Array<{ code: string }>;
    formMode?: string;
    formError?: string;
  };
  setData(patch: Record<string, unknown>): void;
  onLoad(query: Record<string, string>): Promise<void>;
  onReviewKind(event: {
    currentTarget: { dataset: { kind: "REFUND" | "CORRECTION" } };
  }): Promise<void>;
  onDetail(event: {
    currentTarget: { dataset: { id: string } };
  }): Promise<void>;
  onAction(event: {
    currentTarget: { dataset: { action: string } };
  }): void;
  onSubmit(): Promise<void>;
}

const originalSnapshot = {
  campusId: "campus-1",
  campusName: "东城校区",
  studentId: "student-1",
  studentName: "陈晨",
  amountFen: 120000,
  receivedOn: "2026-09-01",
  channel: "CASH",
  note: "",
  package: {
    name: "创意课程包",
    mainUnits: 1200,
    giftUnits: 300,
    validFrom: "2026-09-01T00:00:00+08:00",
    expiresAt: null,
  },
};
const correction = {
  id: "correction-1",
  originalReceiptId: "receipt-1",
  originalCoursePackageId: "package-1",
  type: "REPLACE",
  status: "SUBMITTED",
  version: 1,
  reason: "原学员和金额录入错误",
  requestedByUserId: "finance-user",
  createdAt: "2026-09-09T01:00:00Z",
  original: originalSnapshot,
  proposedReplacement: {
    ...originalSnapshot,
    studentId: "student-2",
    studentName: "李明",
    amountFen: 100000,
    proofAvailable: true,
  },
  replacementReceiptId: null,
  events: [],
};

describe("headquarters correction review interactions", () => {
  let page: ReviewPage;
  const oldPage = Object.getOwnPropertyDescriptor(globalThis, "Page");
  const oldWx = Object.getOwnPropertyDescriptor(globalThis, "wx");

  beforeEach(() => {
    jest.resetAllMocks();
    Object.defineProperty(globalThis, "wx", {
      configurable: true,
      value: {
        getWindowInfo: () => ({ windowWidth: 430 }),
        getMenuButtonBoundingClientRect: () => ({ top: 20, left: 300 }),
        showActionSheet: jest.fn(),
        showToast: jest.fn(),
      },
    });
    Object.defineProperty(globalThis, "Page", {
      configurable: true,
      value: (definition: ReviewPage) => {
        page = definition;
        page.setData = (patch) => Object.assign(page.data, patch);
      },
    });
    jest.isolateModules(() =>
      require("../services/finance-refunds.page").registerRefundPage(
        "SUPER_ADMIN",
      ),
    );
    mockSession.load.mockResolvedValue({
      roles: [{ code: "SUPER_ADMIN", campusId: null }],
    });
    mockRefundApi.list.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    mockCorrectionApi.list.mockResolvedValue({
      items: [correction],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    mockCorrectionApi.detail.mockResolvedValue(correction);
  });

  afterEach(() => {
    if (oldPage) Object.defineProperty(globalThis, "Page", oldPage);
    else Reflect.deleteProperty(globalThis, "Page");
    if (oldWx) Object.defineProperty(globalThis, "wx", oldWx);
    else Reflect.deleteProperty(globalThis, "wx");
  });

  async function openCorrection() {
    await page.onLoad({});
    await page.onReviewKind({
      currentTarget: { dataset: { kind: "CORRECTION" } },
    });
    await page.onDetail({
      currentTarget: { dataset: { id: correction.id } },
    });
  }

  it("loads corrections in a separate review segment", async () => {
    await page.onLoad({});
    expect(page.data.reviewKind).toBe("REFUND");
    expect(mockRefundApi.list).toHaveBeenCalledTimes(1);

    await page.onReviewKind({
      currentTarget: { dataset: { kind: "CORRECTION" } },
    });
    expect(page.data.reviewKind).toBe("CORRECTION");
    expect(mockCorrectionApi.list).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
    });
    expect(mockRefundApi.list).toHaveBeenCalledTimes(1);
  });

  it("shows review actions without exposing refund payment commands", async () => {
    await openCorrection();
    expect(mockCorrectionApi.detail).toHaveBeenCalledWith(correction.id);
    expect(page.data.detail).toMatchObject({
      id: correction.id,
      version: 1,
      original: expect.objectContaining({ studentName: "陈晨" }),
      proposedReplacement: expect.objectContaining({ studentName: "李明" }),
    });
    expect(page.data.primaryActions?.map((item) => item.code)).toEqual([
      "APPROVE",
      "REJECT",
    ]);
    expect(page.data.primaryActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "START_PAYMENT" }),
        expect.objectContaining({ code: "RECORD_PAYMENT" }),
        expect.objectContaining({ code: "MARK_UNCERTAIN" }),
      ]),
    );
    expect(mockRefundApi.detail).not.toHaveBeenCalled();
  });

  it("reuses the same payload and key after a version conflict", async () => {
    await openCorrection();
    page.onAction({ currentTarget: { dataset: { action: "APPROVE" } } });
    page.setData({ reason: "原始与替代记录已经核对" });
    mockCorrectionApi.act
      .mockRejectedValueOnce(new Error("状态或记录版本已变化，请刷新详情核对"))
      .mockResolvedValueOnce({
        ...correction,
        status: "APPROVED",
        version: 2,
      });

    await page.onSubmit();
    expect(page.data).toMatchObject({
      formMode: "action",
      formError: "状态或记录版本已变化，请刷新详情核对",
      detail: expect.objectContaining({ id: correction.id, version: 1 }),
    });
    const firstCall = mockCorrectionApi.act.mock.calls[0];

    await page.onSubmit();
    expect(mockCorrectionApi.act.mock.calls[1]).toEqual(firstCall);
    expect(firstCall[1]).toEqual({
      action: "APPROVE",
      expectedVersion: 1,
      reason: "原始与替代记录已经核对",
    });
    expect(firstCall[2]).toEqual(expect.any(String));
  });

  it("keeps correction detail and the review draft after a forbidden response", async () => {
    await openCorrection();
    page.onAction({ currentTarget: { dataset: { action: "REJECT" } } });
    page.setData({ reason: "申请人与审核身份冲突" });
    mockCorrectionApi.act.mockRejectedValueOnce(
      new Error("当前账号不能审核这笔纠错申请"),
    );

    await page.onSubmit();
    expect(page.data).toMatchObject({
      formMode: "action",
      formError: "当前账号不能审核这笔纠错申请",
      reason: "申请人与审核身份冲突",
      detail: expect.objectContaining({ id: correction.id, version: 1 }),
    });
  });
});
