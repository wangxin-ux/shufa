import * as fs from "fs";
import * as path from "path";

const financeService = { campuses: jest.fn() };
const overviewService = { hours: jest.fn() };
const sessionService = { load: jest.fn() };

jest.mock("../services/finance.service", () => ({
  ...jest.requireActual("../services/finance.service"),
  createFinanceService: () => financeService,
}));
jest.mock("../services/finance-overview.service", () => ({
  createFinanceOverviewService: () => overviewService,
}));
jest.mock("../services/session.service", () => ({
  createSessionService: () => sessionService,
}));

interface TestPage {
  data: Record<string, any>;
  setData(patch: Record<string, unknown>): void;
  reload(append?: boolean): Promise<void>;
}

describe("finance hours page", () => {
  const originalPage = Object.getOwnPropertyDescriptor(globalThis, "Page");
  let page: TestPage;

  beforeEach(() => {
    jest.resetAllMocks();
    Object.defineProperty(globalThis, "Page", {
      configurable: true,
      value: (definition: TestPage) => {
        page = definition;
        page.setData = (patch) => Object.assign(page.data, patch);
      },
    });
    jest.isolateModules(() => require("../pages/finance/hours/index"));
    page.setData({
      campuses: [{ id: "", name: "全部校区" }],
      campusIndex: 0,
      startDate: "2026-09-01",
      endDate: "2026-09-11",
    });
  });

  afterAll(() => {
    if (originalPage) Object.defineProperty(globalThis, "Page", originalPage);
    else Reflect.deleteProperty(globalThis, "Page");
  });

  it("separates the reporting cutoff from each package validity period", async () => {
    overviewService.hours.mockResolvedValue({
      items: [
        packageRow({ expiresAt: "2027-08-23T15:59:59.999Z" }),
        packageRow({ id: "package-2", expiresAt: null }),
      ],
      total: 2,
      page: 1,
      pageSize: 20,
      asOf: "2026-09-11T15:59:59.999Z",
      summary: {
        studentCount: 1,
        consumedMainUnits: 0,
        consumedGiftUnits: 0,
        remainingUnits: 2200,
      },
    });

    await page.reload();

    expect(page.data.asOfLabel).toBe("2026-09-11");
    expect(page.data.rows.map((row: Record<string, unknown>) => row.validityLabel)).toEqual([
      "有效期 2026-08-23 至 2027-08-23",
      "有效期 2026-08-23 起 · 长期有效",
    ]);
  });

  it("labels the shared date as a reporting cutoff, not a package expiry", () => {
    const markup = fs.readFileSync(
      path.resolve(__dirname, "../pages/finance/hours/index.wxml"),
      "utf8",
    );

    expect(markup).toContain("查询期末剩余");
    expect(markup).toContain("统计截至");
    expect(markup).toContain("{{item.validityLabel}}");
    expect(markup).not.toContain("余额截止日");
    expect(markup).not.toContain("截止日剩余");
  });
});

function packageRow(overrides: Record<string, unknown>) {
  return {
    id: "package-1",
    campusName: "启明东校区",
    studentName: "陈晨",
    packageName: "创意美术基础课包",
    validFrom: "2026-08-22T16:00:00.000Z",
    expiresAt: null,
    consumedMainUnits: 0,
    consumedGiftUnits: 0,
    unitPriceFen: 10000,
    priceStatus: "KNOWN",
    mainRemainingUnits: 900,
    giftRemainingUnits: 200,
    totalRemainingUnits: 1100,
    mainReservedUnits: 0,
    giftReservedUnits: 0,
    ...overrides,
  };
}
