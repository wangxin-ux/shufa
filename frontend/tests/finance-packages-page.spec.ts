import * as fs from "fs";
import * as path from "path";
import type { FinanceReceipt } from "../services/finance.service";

const mockService = {
  campuses: jest.fn(),
  list: jest.fn(),
  issue: jest.fn(),
};
const mockSession = { load: jest.fn() };

jest.mock("../services/finance.service", () => ({
  ...jest.requireActual("../services/finance.service"),
  createFinanceService: () => mockService,
}));
jest.mock("../services/session.service", () => ({
  createSessionService: () => mockSession,
}));

interface TestPage {
  data: Record<string, unknown>;
  setData(patch: Record<string, unknown>): void;
  onSelect(event: { currentTarget: { dataset: { id: string } } }): void;
  onSubmit(): Promise<void>;
}

const receipt: FinanceReceipt & {
  amountLabel: string;
  channelLabel: string;
} = {
  id: "receipt-1",
  campusId: "campus-1",
  campusName: "测试校区",
  studentId: "student-1",
  studentName: "测试学员",
  amountFen: 120_000,
  amountLabel: "1200.00",
  receivedOn: "2026-09-01",
  channel: "CASH",
  channelLabel: "现金",
  note: "",
  createdAt: "2026-09-01T01:00:00Z",
  status: "UNLINKED",
  recordKind: "ORIGINAL",
  replacementOfCorrectionId: null,
  correctionEffectFen: 0,
  correction: null,
  issuance: null,
};

describe("finance package entry page", () => {
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
    jest.isolateModules(() => require("../pages/finance/packages/index"));
    mockService.list.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });

  afterEach(() => {
    if (oldPage) Object.defineProperty(globalThis, "Page", oldPage);
    else Reflect.deleteProperty(globalThis, "Page");
    if (oldWx) Object.defineProperty(globalThis, "wx", oldWx);
    else Reflect.deleteProperty(globalThis, "wx");
  });

  it("describes package-entry progress without association jargon", () => {
    const markup = fs.readFileSync(
      path.resolve(__dirname, "../pages/finance/packages/index.wxml"),
      "utf8",
    );

    expect(markup).toContain("选择待录包收款");
    expect(markup).toContain("正在加载待录包收款");
    expect(markup).toContain("尚未录入课包");
    expect(markup).not.toMatch(/未关联|待关联/);
  });

  it("keeps the package name independent when selecting a receipt", () => {
    page.setData({ rows: [receipt], packageName: "上一次填写的课包" });

    page.onSelect({ currentTarget: { dataset: { id: receipt.id } } });

    expect(page.data.selected).toBe(receipt);
    expect(page.data.packageName).toBe("");
  });

  it("requires the expiry date to be later than the effective date", async () => {
    page.setData({
      selected: receipt,
      packageName: "秋季课包",
      mainLessons: "12",
      giftLessons: "3",
      validFrom: "2026-09-01",
      expiresOn: "2026-09-01",
    });

    await page.onSubmit();

    expect(mockService.issue).not.toHaveBeenCalled();
    expect(page.data.formError).toBe("到期日必须晚于生效日");
    expect(page.data.submitting).toBe(false);
  });

  it("submits full Shanghai timestamps and keeps gift lessons separate", async () => {
    mockService.issue.mockResolvedValue(undefined);
    page.setData({
      selected: receipt,
      packageName: "秋季课包",
      mainLessons: "12",
      giftLessons: "3",
      validFrom: "2026-09-01",
      expiresOn: "2026-09-30",
    });

    await page.onSubmit();

    expect(mockService.issue).toHaveBeenCalledWith(
      receipt.id,
      {
        name: "秋季课包",
        mainUnits: 1200,
        giftUnits: 300,
        validFrom: "2026-09-01T00:00:00+08:00",
        expiresAt: "2026-09-30T23:59:59.999+08:00",
      },
      expect.stringMatching(/^finance-package-/),
    );
  });
});
