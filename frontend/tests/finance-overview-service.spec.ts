import { FinanceOverviewService } from "../services/finance-overview.service";

describe("finance overview client", () => {
  it("uses finance-only read endpoints for every overview", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const request = jest.fn((options) => {
      calls.push(options);
      options.success({ statusCode: 200, data: { data: { items: [] } } });
    });
    const service = new FinanceOverviewService(
      "https://example.test/",
      () => "finance-token",
      request,
    );

    await service.hours({ from: "2026-09-01", to: "2026-09-10" });
    await service.orders({ page: 1, pageSize: 20 });
    await service.earnings({ from: "2026-09-01" });
    await service.payouts({ category: "TEACHER_WITHDRAWAL" });
    await service.cashFlow({ to: "2026-09-10" });
    await service.profitability({ region: "长沙" });

    expect(calls.map((call) => call.url)).toEqual([
      "https://example.test/finance/hours",
      "https://example.test/finance/oversight/orders",
      "https://example.test/finance/oversight/earnings",
      "https://example.test/finance/oversight/payouts",
      "https://example.test/finance/oversight/cash-flow",
      "https://example.test/finance/oversight/profitability",
    ]);
    expect(calls.every((call) =>
      (call.header as Record<string, string>).Authorization ===
      "Bearer finance-token",
    )).toBe(true);
  });

  it("downloads audited finance exports without exposing management routes", async () => {
    const download = jest.fn((options) =>
      options.success({ statusCode: 200, tempFilePath: "/tmp/finance.xlsx" }),
    );
    const open = jest.fn((options) => options.success());
    const service = new FinanceOverviewService(
      "https://example.test",
      () => "finance-token",
      undefined,
      download,
      open,
    );

    await service.export("cash-flow", {
      from: "2026-09-01",
      to: "2026-09-10",
    });

    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.test/finance/oversight/cash-flow/export?from=2026-09-01&to=2026-09-10",
        header: { Authorization: "Bearer finance-token" },
      }),
    );
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "/tmp/finance.xlsx",
        fileType: "xlsx",
        showMenu: true,
      }),
    );
  });
});
