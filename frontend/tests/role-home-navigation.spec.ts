import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

describe("HR and finance home return navigation", () => {
  it("returns finance subpages to the finance home when opened directly", () => {
    expect(read("pages/finance/receipts/index.ts")).toContain(
      'else wx.reLaunch({ url: "/pages/finance/home/index" })',
    );
    expect(read("services/finance-refunds.page.ts")).toContain(
      '? "/pages/finance/home/index"',
    );
    expect(read("pages/finance/reports/index.ts")).toContain(
      'else wx.reLaunch({ url: "/pages/finance/home/index" })',
    );
  });

  it("returns HR subpages to the HR home when opened directly", () => {
    expect(read("pages/hr/teachers/index.wxml")).toContain('bindtap="onBack"');
    expect(read("pages/hr/teachers/index.ts")).toMatch(
      /else wx\.reLaunch\(\{ url: ["']\/pages\/hr\/home\/index["'] \}\)/,
    );
    for (const page of ["teaching", "earnings"]) {
      expect(read(`pages/hr/${page}/index.ts`)).toMatch(
        /else wx\.reLaunch\(\{ url: ["']\/pages\/hr\/home\/index["'] \}\)/,
      );
    }
  });
});
