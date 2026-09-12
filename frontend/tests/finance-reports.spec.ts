import * as fs from "fs";
import * as path from "path";
import { FinanceReportsService } from "../services/finance-reports.service";

const listResult = {
  items: [
    {
      id: "ledger-1",
      entryType: "CONSUME",
      campusId: "campus-1",
      campusName: "东城校区",
      studentName: "测试学员",
      packageName: "美术课包",
      courseName: "创意美术",
      lessonCompletedAt: "2026-09-08T02:00:00.000Z",
      bucket: "MAIN",
      units: 100,
      amountFen: 3333,
      amountStatus: "KNOWN",
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  summary: {
    mainUnits: 100,
    giftUnits: 0,
    knownAmountFen: 3333,
    pendingCheckCount: 0,
  },
};

describe("finance reports client", () => {
  it("sends filters to the frozen report endpoints and decodes the envelope", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const service = new FinanceReportsService(
      "https://example.test",
      () => "token",
      (options) => {
        calls.push(options as unknown as Record<string, unknown>);
        options.success({ statusCode: 200, data: { data: listResult } });
      },
    );
    await expect(
      service.lessonConsumption({
        campusId: "campus-1",
        from: "2026-09-01",
        to: "2026-09-08",
        page: 2,
        pageSize: 20,
      }),
    ).resolves.toEqual(listResult);
    expect(calls[0]).toMatchObject({
      url: "https://example.test/finance/reports/lesson-consumption",
      method: "GET",
      header: { Authorization: "Bearer token" },
      data: {
        campusId: "campus-1",
        from: "2026-09-01",
        to: "2026-09-08",
        page: 2,
        pageSize: 20,
      },
    });
  });

  it("downloads only one export and opens it as xlsx", async () => {
    const download = jest.fn((options) =>
      options.success({ statusCode: 200, tempFilePath: "/tmp/report.xlsx" }),
    );
    const open = jest.fn((options) => options.success());
    const service = new FinanceReportsService(
      "https://example.test/",
      () => "token",
      undefined,
      download,
      open,
    );
    await service.export("refunds", {
      campusId: "campus-1",
      from: "2026-09-01",
      to: "2026-09-08",
    });
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.test/finance/reports/refunds/export?campusId=campus-1&from=2026-09-01&to=2026-09-08",
        header: { Authorization: "Bearer token" },
      }),
    );
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "/tmp/report.xlsx",
        fileType: "xlsx",
        showMenu: true,
      }),
    );
  });
});

describe("finance reports page", () => {
  const reportService = {
    lessonConsumption: jest.fn(),
    refunds: jest.fn(),
    export: jest.fn(),
  };
  const financeService = { campuses: jest.fn() };
  const session = { load: jest.fn() };
  let page: any;
  const oldPage = Object.getOwnPropertyDescriptor(globalThis, "Page");
  const oldWx = Object.getOwnPropertyDescriptor(globalThis, "wx");

  beforeEach(() => {
    jest.resetAllMocks();
    reportService.lessonConsumption.mockResolvedValue(listResult);
    financeService.campuses.mockResolvedValue({
      items: [{ id: "campus-1", name: "东城校区" }],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    session.load.mockResolvedValue({
      roles: [{ code: "FINANCE", campusId: null }],
    });
    Object.defineProperty(globalThis, "wx", {
      configurable: true,
      value: { showToast: jest.fn() },
    });
    Object.defineProperty(globalThis, "Page", {
      configurable: true,
      value: (definition: any) => {
        page = definition;
        page.setData = (patch: Record<string, unknown>) =>
          Object.assign(page.data, patch);
      },
    });
    jest.isolateModules(() => {
      jest.doMock("../services/finance-reports.service", () => ({
        createFinanceReportsService: () => reportService,
      }));
      jest.doMock("../services/finance.service", () => ({
        createFinanceService: () => financeService,
        financeMoney: (fen: number) => (fen / 100).toFixed(2),
        financeToday: () => "2026-09-08",
      }));
      jest.doMock("../services/session.service", () => ({
        createSessionService: () => session,
      }));
      require("../pages/finance/reports/index");
    });
  });

  afterEach(() => {
    jest.dontMock("../services/finance-reports.service");
    jest.dontMock("../services/finance.service");
    jest.dontMock("../services/session.service");
    if (oldPage) Object.defineProperty(globalThis, "Page", oldPage);
    else Reflect.deleteProperty(globalThis, "Page");
    if (oldWx) Object.defineProperty(globalThis, "wx", oldWx);
    else Reflect.deleteProperty(globalThis, "wx");
  });

  it("loads a headquarters finance report with server-calculated values and current filters", async () => {
    await page.initialize();
    expect(reportService.lessonConsumption).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "2026-09-01",
        to: "2026-09-08",
        page: 1,
      }),
    );
    expect(reportService.lessonConsumption.mock.calls[0][0]).not.toHaveProperty(
      "campusId",
    );
    expect(page.data).toMatchObject({
      viewState: "ready",
      total: 1,
      hasMore: false,
    });
    expect(page.data.rows[0]).toMatchObject({
      studentName: "测试学员",
      unitsLabel: "1.00 节",
      amountLabel: "33.33 元",
    });
  });

  it("clears the previous summary while reloading and keeps it cleared after failure", async () => {
    await page.initialize();
    expect(page.data.amountLabel).toBe("33.33");

    let reject!: (error: Error) => void;
    reportService.refunds.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const pending = page.onTab({
      currentTarget: { dataset: { kind: "refunds" } },
    });

    expect(page.data).toMatchObject({
      viewState: "loading",
      total: 0,
      mainUnitsLabel: "0.00",
      giftUnitsLabel: "0.00",
      amountLabel: "0.00",
      pendingCheckCount: 0,
    });

    reject(new Error("报表查询失败"));
    await pending;
    expect(page.data).toMatchObject({
      viewState: "error",
      total: 0,
      mainUnitsLabel: "0.00",
      giftUnitsLabel: "0.00",
      amountLabel: "0.00",
      pendingCheckCount: 0,
    });
  });

  it("loads and combines every campus page before requesting the report", async () => {
    financeService.campuses.mockImplementation(async (campusPage = 1) => ({
      items:
        campusPage === 1
          ? Array.from({ length: 50 }, (_, index) => ({
              id: `campus-${index + 1}`,
              name: `校区${index + 1}`,
            }))
          : [{ id: "campus-51", name: "校区51" }],
      total: 51,
      page: campusPage,
      pageSize: 50,
    }));

    await page.initialize();

    expect(financeService.campuses).toHaveBeenNthCalledWith(1, 1);
    expect(financeService.campuses).toHaveBeenNthCalledWith(2, 2);
    expect(page.data.campuses).toHaveLength(52);
    expect(page.data.campuses[51]).toEqual({
      id: "campus-51",
      name: "校区51",
    });
  });

  it("switches reports, pages, keeps failed exports out of list state and blocks duplicate exports", async () => {
    reportService.refunds.mockResolvedValue({
      items: [
        {
          id: "refund-1",
          campusId: "campus-1",
          campusName: "东城校区",
          studentName: "测试学员",
          packageName: "美术课包",
          paidAt: "2026-09-08T03:00:00Z",
          amountFen: 12000,
          mainUnits: 100,
          giftUnits: 20,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      summary: { actualRefundFen: 12000, mainUnits: 100, giftUnits: 20 },
    });
    await page.initialize();
    await page.onTab({ currentTarget: { dataset: { kind: "refunds" } } });
    expect(page.data.rows[0]).toMatchObject({
      amountLabel: "120.00 元",
      unitsLabel: "购买 1.00 · 赠送 0.20 节",
    });
    let reject!: (error: Error) => void;
    reportService.export.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const pending = page.onExport();
    await page.onExport();
    expect(reportService.export).toHaveBeenCalledTimes(1);
    reject(new Error("报表下载失败"));
    await pending;
    expect(page.data).toMatchObject({
      exporting: false,
      exportError: "报表下载失败",
      viewState: "ready",
    });
  });

  it("fails closed for a mixed role and ignores stale list responses", async () => {
    session.load.mockResolvedValueOnce({
      roles: [
        { code: "FINANCE", campusId: null },
        { code: "HR", campusId: null },
      ],
    });
    await page.initialize();
    expect(page.data.viewState).toBe("forbidden");
    expect(reportService.lessonConsumption).not.toHaveBeenCalled();
  });

  it("reuses the existing workspace shell while reports remain separate from receipts", () => {
    const read = (relative: string) =>
      fs.readFileSync(path.resolve(__dirname, "..", relative), "utf8");
    expect(read("pages/finance/reports/index.wxss")).toContain(
      '@import "../../../styles/super-admin-workspace.wxss"',
    );
    const markup = read("pages/finance/reports/index.wxml");
    for (const name of [
      "workspace",
      "toolbar",
      "roster-tabs",
      "metric",
      "row__main",
      "state",
    ])
      expect(markup).toContain(name);
    expect(markup).toContain(
      'wx:if="{{viewState === \'ready\' || viewState === \'empty\'}}"',
    );
    expect(read("pages/finance/receipts/index.wxml")).not.toContain(
      'bindtap="onReports"',
    );
    expect(read("pages/finance/more/index.ts")).toContain(
      "/pages/finance/earnings/index",
    );
  });
});
