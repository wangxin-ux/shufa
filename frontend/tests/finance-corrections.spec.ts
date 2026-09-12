import {
  CorrectionApi,
  correctionActions,
  type CreateCorrectionInput,
} from "../services/finance-corrections.service";

interface RequestOptions {
  url: string;
  method: "GET" | "POST";
  data?: unknown;
  header: Record<string, string>;
  success(response: { statusCode: number; data: unknown }): void;
}

const replacement = {
  campusId: "campus-1",
  studentId: "student-1",
  amountFen: 120000,
  receivedOn: "2026-09-08",
  channel: "CASH",
  proofFileId: "proof-1",
  note: "更正后的收款",
  package: {
    name: "更正课包",
    mainUnits: 1200,
    giftUnits: 300,
    validFrom: "2026-09-08T00:00:00+08:00",
    expiresAt: null,
  },
} as const;

describe("finance correction client boundaries", () => {
  it("keeps finance execution separate from headquarters review", () => {
    expect(correctionActions("FINANCE", "SUBMITTED").map((item: { code: string }) => item.code)).toEqual([
      "WITHDRAW",
    ]);
    expect(correctionActions("FINANCE", "APPROVED").map((item: { code: string }) => item.code)).toEqual([
      "APPLY",
    ]);
    expect(correctionActions("SUPER_ADMIN", "SUBMITTED").map((item: { code: string }) => item.code)).toEqual([
      "APPROVE",
      "REJECT",
    ]);

    for (const status of ["REJECTED", "WITHDRAWN", "APPLIED"] as const) {
      expect(correctionActions("FINANCE", status)).toEqual([]);
      expect(correctionActions("SUPER_ADMIN", status)).toEqual([]);
    }
    expect(correctionActions("SUPER_ADMIN", "APPROVED")).toEqual([]);
  });

  it("uses a discriminated create body for void and replacement corrections", () => {
    const voidInput: CreateCorrectionInput = {
      type: "VOID",
      reason: "收款登记错误，整笔撤销",
    };
    const replaceInput: CreateCorrectionInput = {
      type: "REPLACE",
      reason: "收款学员与课包信息录入错误",
      replacement,
    };

    expect(voidInput).not.toHaveProperty("replacement");
    expect(replaceInput.replacement).toEqual(replacement);

  });

  it("routes finance submission and actions without crossing into management", async () => {
    const calls: RequestOptions[] = [];
    const api = new CorrectionApi(
      "https://finance.test/",
      () => "finance-token",
      "FINANCE",
      (options: RequestOptions) => {
        calls.push(options);
        options.success({
          statusCode: options.url.endsWith("/corrections") ? 201 : 200,
          data: { data: { id: "correction-1", status: "SUBMITTED" } },
        });
      },
    );
    const input: CreateCorrectionInput = {
      type: "REPLACE",
      reason: "更正收款和课包",
      replacement,
    };

    await api.submit("receipt/1", input, "submit-key");
    await api.list({ page: 2, pageSize: 20, receiptId: "receipt/1" });
    await api.detail("correction/1");
    await api.act(
      "correction/1",
      { action: "WITHDRAW", expectedVersion: 1, reason: "撤回后重新核对" },
      "action-key",
    );

    expect(calls).toEqual([
      expect.objectContaining({
        url: "https://finance.test/finance/receipts/receipt%2F1/corrections",
        method: "POST",
        data: input,
        header: {
          Authorization: "Bearer finance-token",
          "Idempotency-Key": "submit-key",
        },
      }),
      expect.objectContaining({
        url: "https://finance.test/finance/corrections",
        method: "GET",
        data: { page: 2, pageSize: 20, receiptId: "receipt/1" },
      }),
      expect.objectContaining({
        url: "https://finance.test/finance/corrections/correction%2F1",
        method: "GET",
      }),
      expect.objectContaining({
        url: "https://finance.test/finance/corrections/correction%2F1/actions",
        method: "POST",
        data: {
          action: "WITHDRAW",
          expectedVersion: 1,
          reason: "撤回后重新核对",
        },
        header: {
          Authorization: "Bearer finance-token",
          "Idempotency-Key": "action-key",
        },
      }),
    ]);
    expect(calls.every((call) => !call.url.includes("/management/"))).toBe(true);
  });

  it("routes headquarters reads and review actions only through management", async () => {
    const calls: RequestOptions[] = [];
    const api = new CorrectionApi(
      "https://finance.test",
      () => "admin-token",
      "SUPER_ADMIN",
      (options: RequestOptions) => {
        calls.push(options);
        options.success({
          statusCode: 200,
          data: { data: { id: "correction-1", status: "APPROVED" } },
        });
      },
    );

    await api.list({ page: 1, pageSize: 20, status: "SUBMITTED" });
    await api.detail("correction-1");
    await api.act(
      "correction-1",
      { action: "APPROVE", expectedVersion: 3, reason: "原始与替代快照核对一致" },
      "review-key",
    );

    expect(calls.map((call) => call.url)).toEqual([
      "https://finance.test/management/finance-corrections",
      "https://finance.test/management/finance-corrections/correction-1",
      "https://finance.test/management/finance-corrections/correction-1/actions",
    ]);
    expect(calls[2]).toMatchObject({
      data: {
        action: "APPROVE",
        expectedVersion: 3,
        reason: "原始与替代快照核对一致",
      },
      header: {
        Authorization: "Bearer admin-token",
        "Idempotency-Key": "review-key",
      },
    });
  });

  it("downloads proposed replacement proof from the current role scope", async () => {
    const downloadFile = jest.fn(
      (options: {
        url: string;
        header: Record<string, string>;
        success(response: { statusCode: number; tempFilePath: string }): void;
      }) =>
        options.success({
          statusCode: 200,
          tempFilePath: "/tmp/replacement-proof.png",
        }),
    );
    const oldWx = Object.getOwnPropertyDescriptor(globalThis, "wx");
    Object.defineProperty(globalThis, "wx", {
      configurable: true,
      value: { downloadFile },
    });
    try {
      const request = (_options: RequestOptions) => undefined;
      const finance = new CorrectionApi(
        "https://finance.test",
        () => "finance-token",
        "FINANCE",
        request,
      );
      const admin = new CorrectionApi(
        "https://finance.test",
        () => "admin-token",
        "SUPER_ADMIN",
        request,
      );

      await expect(finance.originalProof("correction/1")).resolves.toBe(
        "/tmp/replacement-proof.png",
      );
      await expect(finance.replacementProof("correction/1")).resolves.toBe(
        "/tmp/replacement-proof.png",
      );
      await expect(admin.originalProof("correction/1")).resolves.toBe(
        "/tmp/replacement-proof.png",
      );
      await expect(admin.replacementProof("correction/1")).resolves.toBe(
        "/tmp/replacement-proof.png",
      );
      expect(downloadFile.mock.calls.map(([options]) => options.url)).toEqual([
        "https://finance.test/finance/corrections/correction%2F1/original-proof",
        "https://finance.test/finance/corrections/correction%2F1/replacement-proof",
        "https://finance.test/management/finance-corrections/correction%2F1/original-proof",
        "https://finance.test/management/finance-corrections/correction%2F1/replacement-proof",
      ]);
    } finally {
      if (oldWx) Object.defineProperty(globalThis, "wx", oldWx);
      else Reflect.deleteProperty(globalThis, "wx");
    }
  });
});
