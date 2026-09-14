import { FinanceService, parseDecimalUnits } from "../services/finance.service";
import { resolveRoleBootstrap } from "../services/session.service";

describe("finance transport and input precision", () => {
  it("parses currency and lesson decimals without floating point arithmetic", () => {
    expect(parseDecimalUnits("1200.01")).toBe(120001);
    expect(parseDecimalUnits("12")).toBe(1200);
    expect(parseDecimalUnits("0.25")).toBe(25);
    for (const value of ["-1", "1.001", "1e3", "", "NaN"]) {
      expect(() => parseDecimalUnits(value)).toThrow();
    }
  });

  it("uses the current finance token and caller-stable idempotency key", async () => {
    const calls: Array<{
      url: string;
      header: Record<string, string>;
      data?: unknown;
    }> = [];
    let token = "first-test-token";
    const service = new FinanceService(
      "https://finance.test",
      () => token,
      (options) => {
        calls.push(options);
        options.success({ statusCode: 201, data: { data: { id: "receipt" } } });
      },
    );
    const input = {
      campusId: "c",
      studentId: "s",
      amountFen: 120000,
      receivedOn: "2026-09-01",
      channel: "CASH",
      proofFileId: "p",
      note: "",
    };
    await service.create(input, "stable-key");
    token = "second-test-token";
    await service.create(input, "stable-key");
    expect(calls[0].url).toBe("https://finance.test/finance/receipts");
    expect(calls[0].data).toEqual(input);
    expect(calls[1].header).toMatchObject({
      Authorization: "Bearer second-test-token",
      "Idempotency-Key": "stable-key",
    });
  });

  it("downloads and opens the filtered receipt workbook", async () => {
    const downloadFile = jest.fn(
      (options: {
        url: string;
        success(response: { statusCode: number; tempFilePath: string }): void;
      }) =>
        options.success({
          statusCode: 200,
          tempFilePath: "/tmp/receipts.xlsx",
        }),
    );
    const openDocument = jest.fn((options: { success(): void }) =>
      options.success(),
    );
    const oldWx = Object.getOwnPropertyDescriptor(globalThis, "wx");
    Object.defineProperty(globalThis, "wx", {
      configurable: true,
      value: { downloadFile, openDocument },
    });
    try {
      const service = new FinanceService(
        "https://finance.test/",
        () => "finance-token",
      );
      await service.exportReceipts({
        campusId: "campus-1",
        query: "陈 晨",
        from: "2026-09-01",
        to: "2026-09-08",
        status: "LINKED",
      });
      expect(downloadFile.mock.calls[0][0].url).toBe(
        "https://finance.test/finance/receipts/export?campusId=campus-1&query=%E9%99%88%20%E6%99%A8&from=2026-09-01&to=2026-09-08&status=LINKED",
      );
      expect(openDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: "/tmp/receipts.xlsx",
          fileType: "xlsx",
          showMenu: true,
        }),
      );
    } finally {
      if (oldWx) Object.defineProperty(globalThis, "wx", oldWx);
      else Reflect.deleteProperty(globalThis, "wx");
    }
  });

  it("routes a single headquarters finance identity without granting mixed roles", () => {
    expect(
      resolveRoleBootstrap({
        userId: "f",
        displayName: "财务",
        roles: [{ code: "FINANCE", campusId: null }],
      }),
    ).toEqual({ kind: "navigate", url: "/pages/finance/home/index" });
    for (const roles of [
      [{ code: "FINANCE" as const, campusId: "campus" }],
      [
        { code: "FINANCE" as const, campusId: null },
        { code: "HR" as const, campusId: null },
      ],
    ]) {
      expect(
        resolveRoleBootstrap({ userId: "f", displayName: "财务", roles }),
      ).toEqual({ kind: "forbidden" });
    }
  });
});
