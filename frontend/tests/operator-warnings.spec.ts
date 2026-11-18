import * as fs from "fs";
import * as path from "path";
import {
  ApiOperatorDataSource,
  OperatorHttpRequest,
} from "../pages/operator/runtime/data/api-operator-data-source";
import { MockOperatorDataSource } from "../pages/operator/runtime/data/mock-operator-data-source";
import {
  buildOperatorWarningItems,
  buildOperatorWarningQuery,
} from "../pages/operator/runtime/services/operator-warnings.presenter";
import { OperatorWarning } from "../pages/operator/runtime/types/operator";

const warning: OperatorWarning = {
  studentId: "40000000-0000-4000-8000-000000000001",
  studentName: "陈晨",
  classNames: ["创意基础A班"],
  mainBalanceUnits: 300,
  giftBalanceUnits: 200,
  totalBalanceUnits: 900,
  thresholdUnits: 500,
};

describe("campus manager warnings", () => {
  it("formats server-returned balances without recomputing the conclusion", () => {
    expect(buildOperatorWarningItems([warning])).toEqual([
      {
        studentId: warning.studentId,
        studentName: "陈晨",
        classLabel: "创意基础A班",
        mainBalanceLabel: "3",
        giftBalanceLabel: "2",
        totalBalanceLabel: "9",
        thresholdLabel: "5",
        urgencyLabel: "需关注",
      },
    ]);
    expect(buildOperatorWarningQuery("  陈  ", 2, 10)).toEqual({
      page: 2,
      pageSize: 10,
      query: "陈",
    });
  });

  it("sends paging and search to the warnings API", async () => {
    const requests: Parameters<OperatorHttpRequest>[0][] = [];
    const request: OperatorHttpRequest = (options) => {
      requests.push(options);
      options.success({
        statusCode: 200,
        data: {
          data: [warning],
          meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
          requestId: "warnings-1",
        },
      });
    };
    const source = new ApiOperatorDataSource({
      baseUrl: "https://example.test/",
      accessToken: "manager-token",
      request,
    });

    await expect(
      source.listWarnings({ page: 1, pageSize: 20, query: "陈" }),
    ).resolves.toEqual({
      data: [warning],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    expect(requests[0]).toMatchObject({
      method: "GET",
      url: "https://example.test/operators/me/warnings?page=1&pageSize=20&query=%E9%99%88",
      header: { Authorization: "Bearer manager-token" },
    });
  });

  it("provides deterministic Mock search, paging, empty, and error states", async () => {
    const source = new MockOperatorDataSource();
    const page = await source.listWarnings({
      page: 1,
      pageSize: 1,
      query: "陈",
    });
    expect(page.meta).toEqual({
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
    });
    expect(page.data[0]).toMatchObject({ studentName: "陈晨" });
    await expect(
      new MockOperatorDataSource({ scenario: "empty" }).listWarnings({
        page: 1,
        pageSize: 20,
      }),
    ).resolves.toMatchObject({ data: [], meta: { total: 0 } });
    await expect(
      new MockOperatorDataSource({ scenario: "error" }).listWarnings({
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toThrow("运营端数据加载失败，请稍后重试");
  });

  it("registers a responsive themed warning page with honest states", () => {
    const root = path.resolve(__dirname, "..");
    const pageDir = path.join(root, "pages/operator/warnings");
    const markup = fs.readFileSync(path.join(pageDir, "index.wxml"), "utf8");
    const logic = fs.readFileSync(path.join(pageDir, "index.ts"), "utf8");
    const styles = fs.readFileSync(path.join(pageDir, "index.wxss"), "utf8");
    const app = JSON.parse(
      fs.readFileSync(path.join(root, "app.json"), "utf8"),
    ) as { subPackages: Array<{ root: string; pages: string[] }> };
    const pages =
      app.subPackages.find((item) => item.root === "pages/operator")
        ?.pages ?? [];
    const source = `${markup}\n${logic}`;

    expect(markup).toContain("预警名单");
    expect(markup).toContain("主课时");
    expect(markup).toContain("赠送课时");
    expect(markup).toContain("预警阈值");
    expect(source).toMatch(/loading|ready|empty|error|forbidden/);
    expect(source).toMatch(/onSearchInput|onRetry|onLoadMore/);
    expect(styles).toContain("var(--operator-orange)");
    expect(styles).toMatch(/max-width:\s*100%/);
    expect(pages).toContain("warnings/index");
  });
});
