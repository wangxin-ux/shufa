import * as fs from "fs";
import * as path from "path";

const root = path.resolve(__dirname, "..");
const read = (relative: string) =>
  fs.readFileSync(path.join(root, relative), "utf8");

describe("finance information architecture", () => {
  it("keeps the finance home focused on four daily modules", () => {
    const page = read("pages/finance/home/index.ts");
    const markup = read("pages/finance/home/index.wxml");

    expect(page).toContain("key: 'packages'");
    expect(page).toContain("label: '课包'");
    expect(page).toContain("key: 'receipts'");
    expect(page).toContain("label: '收款'");
    expect(page).toContain("key: 'hours'");
    expect(page).toContain("label: '课时'");
    expect(page).toContain("key: 'refunds'");
    expect(page).toContain("label: '退课'");
    expect(page).not.toContain("key: 'corrections'");
    expect(page).not.toContain("key: 'reports'");
    expect(markup).toContain('data-key="more"');
  });

  it("keeps receipt actions inside the receipt module", () => {
    const markup = read("pages/finance/receipts/index.wxml");
    const topToolbar = markup.match(
      /<view wx:if="\{\{apiEnabled\}\}" class="toolbar">([\s\S]*?)<\/view>/,
    )?.[1] ?? "";

    expect(markup).toContain("收款总览");
    expect(markup).toContain("登记收款");
    expect(markup).toContain("查看收款凭证");
    expect(topToolbar).not.toContain("退课退费");
    expect(topToolbar).not.toContain("财务报表");
    expect(topToolbar).not.toContain("退出登录");
    expect(topToolbar).not.toContain("导出 Excel");
    expect(markup).not.toContain('bindtap="onIssue"');
    expect(markup).not.toContain('data-action="issue"');
    expect(markup).not.toMatch(/<button[^>]*>[^<]*录入课包/);
    expect(markup).toContain('class="toolbar finance__primary-toolbar"');
    expect(markup).toContain('class="button finance__create-button"');
    const styles = read("pages/finance/receipts/index.wxss");
    expect(styles).toMatch(
      /\.finance__create-button\s*\{[^}]*width:\s*100%[^}]*min-height:\s*88rpx/s,
    );
  });

  it("uses one divided receipt detail panel with stable actions", () => {
    const markup = read("pages/finance/receipts/index.wxml");
    const styles = read("pages/finance/receipts/index.wxss");
    const packagesMarkup = read("pages/finance/packages/index.wxml");

    expect(markup).toContain('class="finance__detail-panel"');
    expect(markup).toContain('class="finance__detail-row"');
    expect(markup).toContain('class="finance__detail-actions"');
    expect(styles).toMatch(
      /\.finance__detail-panel\s*\{[^}]*overflow:\s*hidden[^}]*border-radius:/s,
    );
    expect(styles).toMatch(
      /\.finance__detail-row\s*\{[^}]*border-bottom:/s,
    );
    expect(styles).toMatch(
      /\.finance__detail-actions\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(markup).toContain("课包名称（家长课时流水可见）");
    expect(packagesMarkup).toContain("课包名称（家长课时流水可见）");
  });

  it("registers separate daily modules and five oversight modules", () => {
    const app = JSON.parse(read("app.json")) as {
      subPackages: Array<{ root: string; pages: string[] }>;
    };
    const finance = app.subPackages.find(
      (item) => item.root === "pages/finance",
    );

    expect(finance?.pages).toEqual(
      expect.arrayContaining([
        "packages/index",
        "hours/index",
        "more/index",
        "orders/index",
        "earnings/index",
        "payouts/index",
        "cash-flow/index",
        "profitability/index",
      ]),
    );
  });

  it("exposes all daily and oversight entries from one finance directory", () => {
    const page = read("pages/finance/more/index.ts");
    const markup = read("pages/finance/more/index.wxml");
    const source = `${page}\n${markup}`;

    for (const label of [
      "日常办理",
      "课包录入",
      "收款总览",
      "课时一览",
      "退课明细",
      "财务核对",
      "订单与凭证",
      "经营收益",
      "提现记录",
      "资金流水",
      "成本收益",
    ]) {
      expect(source).toContain(label);
    }
    expect(source).toContain("/pages/finance/packages/index");
    expect(source).toContain("/pages/finance/receipts/index");
    expect(source).toContain("/pages/finance/hours/index");
    expect(source).toContain("/pages/finance/refunds/index");
    expect(source).toContain("/pages/finance/orders/index");
    expect(source).toContain("/pages/finance/earnings/index");
    expect(source).toContain("/pages/finance/payouts/index");
    expect(source).toContain("/pages/finance/cash-flow/index");
    expect(source).toContain("/pages/finance/profitability/index");
    expect(markup).toContain("dailyEntries");
    expect(markup).toContain("oversightEntries");
  });

  it("uses the existing super-admin workspace styling for every new page", () => {
    for (const name of [
      "packages",
      "hours",
      "more",
      "orders",
      "earnings",
      "payouts",
      "cash-flow",
      "profitability",
    ]) {
      expect(read(`pages/finance/${name}/index.wxss`)).toContain(
        '@import "../../../styles/super-admin-workspace.wxss"',
      );
    }
  });
});
