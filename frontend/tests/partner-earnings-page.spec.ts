import {
  PARTNER_EARNINGS_FIXTURE,
  PARTNER_EARNING_RULE_FIXTURE,
  PARTNER_EARNING_SUMMARY_FIXTURE,
} from "../mock/fixtures/partner.fixture";
import * as fs from "fs";
import * as path from "path";

const loadSummary = jest.fn();
const loadRule = jest.fn();
const loadEntries = jest.fn();
const logout = jest.fn();
let ownerKey = "synthetic-earnings-owner";
jest.mock("../services/partner-runtime", () => ({
  createPartnerService: () => ({
    loadEarningSummary: (query: object) => loadSummary(query),
    loadCurrentEarningRule: () => loadRule(),
    loadEarnings: (query: object) => loadEntries(query),
  }),
  partnerService: {
    loadEarningSummary: (query: object) => loadSummary(query),
    loadCurrentEarningRule: () => loadRule(),
    loadEarnings: (query: object) => loadEntries(query),
  },
}));
jest.mock("../pages/partner/runtime/partner-campaign-draft.service", () => ({
  getPartnerCampaignDraftService: () => ({ getSessionKey: () => ownerKey }),
}));
jest.mock("../services/session.service", () => ({
  sessionService: { logout: () => logout() },
  createSessionService: () => ({ logout: () => logout() }),
}));

const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { resolve, promise };
};
const success = (data: unknown) => ({ status: "success", data });
const rows = (page = 1) =>
  success({
    data: PARTNER_EARNINGS_FIXTURE,
    meta: { page, pageSize: 20, total: 21, totalPages: 2 },
  });
const failure = (statusCode = 500) => ({
  status: "error",
  statusCode,
  message: "加载失败",
});

describe("partner earnings page request lifecycle", () => {
  it("uses a compact refresh alert instead of the full-page error height", () => {
    const root = path.resolve(__dirname, "..");
    const markup = fs.readFileSync(path.join(root, "pages/partner/earnings/index.wxml"), "utf8");
    const styles = fs.readFileSync(path.join(root, "pages/partner/earnings/index.wxss"), "utf8");
    expect(markup).toContain('class="earnings-refresh-error"');
    expect(styles).toMatch(/\.earnings-refresh-error\s*\{[^}]*min-height:\s*0;/);
  });
  let page: any;
  let definition: any;
  const instantiate = () => {
    const instance = { ...definition, data: { ...definition.data } };
    instance.setData = jest.fn((values: object) =>
      Object.assign(instance.data, values),
    );
    return instance;
  };
  const flush = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };
  const open = async () => {
    page.onLoad();
    page.onShow?.();
    await flush();
  };
  const start = () => {
    page.onLoad();
    return page.pendingRequest as Promise<void>;
  };
  beforeEach(() => {
    ownerKey = "synthetic-earnings-owner";
    loadSummary
      .mockReset()
      .mockResolvedValue(success(PARTNER_EARNING_SUMMARY_FIXTURE));
    loadRule
      .mockReset()
      .mockResolvedValue(success(PARTNER_EARNING_RULE_FIXTURE));
    loadEntries.mockReset().mockResolvedValue(rows());
    logout.mockReset();
    (global as any).wx = {
      stopPullDownRefresh: jest.fn(),
      reLaunch: jest.fn(),
    };
    (global as any).Page = (config: any) => {
      definition = config;
    };
    jest.isolateModules(() => require("../pages/partner/earnings/index"));
    page = instantiate();
  });
  afterEach(() => {
    page.onUnload?.();
    delete (global as any).Page;
    delete (global as any).wx;
  });

  it("deduplicates load/show and refreshes for the same filter", async () => {
    const pending = deferred();
    loadEntries.mockReturnValueOnce(pending.promise);
    await open();
    page.onPullDownRefresh();
    page.onPullDownRefresh();
    await flush();
    expect(loadEntries).toHaveBeenCalledTimes(1);
    pending.resolve(rows());
    await flush();
    expect(page.data.viewState).toBe("ready");
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(2);
  });

  it.each(["onHide", "onUnload"])("does not start queued earnings reads after immediate %s", async (method) => {
    const request = start();
    page[method]();
    await request;
    expect(loadSummary).not.toHaveBeenCalled();
    expect(loadRule).not.toHaveBeenCalled();
    expect(loadEntries).not.toHaveBeenCalled();
  });

  it("only starts the latest queued period and not the superseded first load", async () => {
    const initial = start();
    page.onPeriodTap({ currentTarget: { dataset: { period: "DAY" } } });
    await initial;
    await flush();
    expect(loadSummary).toHaveBeenCalledTimes(1);
    expect(loadRule).toHaveBeenCalledTimes(1);
    expect(loadEntries).toHaveBeenCalledTimes(1);
    expect(loadEntries).toHaveBeenLastCalledWith(expect.objectContaining({ period: "DAY" }));
    expect(page.data.viewState).toBe("ready");
  });

  it.each(["onHide", "onUnload"])("does not start readers when %s happens between queued stages", async (method) => {
    const request = start();
    await Promise.resolve();
    page[method]();
    await request;
    expect(loadSummary).not.toHaveBeenCalled();
    expect(loadRule).not.toHaveBeenCalled();
    expect(loadEntries).not.toHaveBeenCalled();
  });

  it("only reads the current request after a queued hide/show cycle", async () => {
    const old = start();
    page.onHide();
    page.onShow();
    await old;
    await flush();
    expect(loadSummary).toHaveBeenCalledTimes(1);
    expect(loadRule).toHaveBeenCalledTimes(1);
    expect(loadEntries).toHaveBeenCalledTimes(1);
    expect(page.data.viewState).toBe("ready");
  });

  it.each(["summary", "rule", "entries"])("converts synchronous %s reader errors into recoverable failures", async (source) => {
    const reader = { summary: loadSummary, rule: loadRule, entries: loadEntries }[source]!;
    reader.mockImplementationOnce(() => { throw new Error("offline"); });
    await expect(start()).resolves.toBeUndefined();
    expect(page.data.viewState).toBe("error");
    expect(page.data.errorMessage).toBe("合作收益加载失败，请重试");
    expect(page.pendingRequest).toBeUndefined();
    await page.load(true);
    expect(page.data.viewState).toBe("ready");
  });

  it.each([
    { source: "summary", code: 401 }, { source: "summary", code: 403 },
    { source: "rule", code: 401 }, { source: "rule", code: 403 },
    { source: "entries", code: 401 }, { source: "entries", code: 403 },
  ])("clears cached earnings for rejected $source HTTP $code even alongside an ordinary failure", async ({ source, code }) => {
    await open();
    const reader = { summary: loadSummary, rule: loadRule, entries: loadEntries }[source]!;
    const other = source === "summary" ? loadRule : loadSummary;
    other.mockResolvedValueOnce(failure());
    reader.mockRejectedValueOnce(Object.assign(new Error("request denied"), { statusCode: code }));
    await page.load(true);
    expect(page.data).toMatchObject({
      viewState: "forbidden", summary: null, rule: null, entries: [],
      page: 0, total: 0, hasMore: false, loadingMore: false,
      refreshError: "", pageError: "",
    });
    expect(page.contentKey).toBe("");
    expect(logout).not.toHaveBeenCalled();
  });

  it.each([401, 403])("also clears cached earnings on synchronous HTTP %s during pagination", async (code) => {
    await open();
    loadEntries.mockImplementationOnce(() => {
      throw Object.assign(new Error("request denied"), { statusCode: code });
    });
    await expect(page.load(false)).resolves.toBeUndefined();
    expect(page.data).toMatchObject({
      viewState: "forbidden", summary: null, rule: null, entries: [],
      loadingMore: false, hasMore: false, page: 0,
    });
  });

  it.each([401, 403])("also clears cached earnings on rejected HTTP %s during pagination", async (code) => {
    await open();
    loadEntries.mockRejectedValueOnce(Object.assign(new Error("request denied"), { statusCode: code }));
    await page.load(false);
    expect(page.data).toMatchObject({
      viewState: "forbidden", summary: null, rule: null, entries: [],
      loadingMore: false, hasMore: false, page: 0,
    });
  });

  it.each([401, 403])("does not let old rejected HTTP %s clear a newer period or its pending lock", async (code) => {
    let reject!: (value: unknown) => void;
    loadEntries.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const old = start();
    await flush();
    const current = deferred();
    loadEntries.mockReturnValueOnce(current.promise);
    page.onPeriodTap({ currentTarget: { dataset: { period: "DAY" } } });
    await flush();
    reject(Object.assign(new Error("old request denied"), { statusCode: code }));
    await old;
    const requests = loadEntries.mock.calls.length;
    page.onRetry();
    await flush();
    expect(loadEntries).toHaveBeenCalledTimes(requests);
    current.resolve(rows());
    await flush();
    expect(page.data.viewState).toBe("ready");
    expect(page.data.periodIndex).toBe(0);
    expect(page.data.entries.length).toBeGreaterThan(0);
    expect(page.pendingRequest).toBeUndefined();
  });

  it.each(["onHide", "onUnload"])("preserves filters when queued events arrive after %s", async (method) => {
    await open();
    const previous = {
      statusIndex: page.data.statusIndex, periodIndex: page.data.periodIndex, anchorDate: page.data.anchorDate,
    };
    page[method]();
    const writes = page.setData.mock.calls.length;
    page.onStatusChange({ detail: { value: "1" } });
    page.onPeriodTap({ currentTarget: { dataset: { period: "DAY" } } });
    page.onAnchorDateChange({ detail: { value: "2026-01-01" } });
    await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(page.data).toMatchObject(previous);
    expect(loadEntries).toHaveBeenCalledTimes(1);
  });

  it.each(["-1", "99", "1.5", "invalid"])("ignores invalid status picker index %s", async (value) => {
    await open();
    const previous = page.data.statusIndex;
    const writes = page.setData.mock.calls.length;
    page.onStatusChange({ detail: { value } });
    await flush();
    expect(page.data.statusIndex).toBe(previous);
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(loadEntries).toHaveBeenCalledTimes(1);
  });

  it("loads a valid foreground status once and ignores reselection", async () => {
    await open();
    page.onStatusChange({ detail: { value: "1" } });
    await flush();
    expect(page.data.statusIndex).toBe(1);
    expect(loadEntries).toHaveBeenLastCalledWith(expect.objectContaining({
      status: page.data.statusOptions[1].value,
    }));
    expect(loadEntries).toHaveBeenCalledTimes(2);
    page.onStatusChange({ detail: { value: "1" } });
    await flush();
    expect(loadEntries).toHaveBeenCalledTimes(2);
  });

  it("keeps rows and summary on refresh failure and retries page one", async () => {
    await open();
    const previous = { entries: page.data.entries, summary: page.data.summary };
    loadSummary.mockResolvedValueOnce(failure());
    page.onPullDownRefresh();
    await flush();
    expect(page.data).toMatchObject({
      ...previous,
      viewState: "ready",
      refreshError: "加载失败",
    });
    page.onRetry();
    await flush();
    expect(
      loadEntries.mock.calls[loadEntries.mock.calls.length - 1][0].page,
    ).toBe(1);
    expect(page.data.refreshError).toBe("");
  });

  it("preserves rows on pagination failure, retries the same page and deduplicates IDs", async () => {
    await open();
    const previous = page.data.entries;
    const pending = deferred();
    loadEntries.mockReturnValueOnce(pending.promise);
    page.onLoadMore();
    page.onLoadMore();
    await flush();
    expect(loadEntries).toHaveBeenCalledTimes(2);
    pending.resolve(failure());
    await flush();
    expect(page.data).toMatchObject({
      entries: previous,
      viewState: "ready",
      pageError: "加载失败",
      page: 1,
    });
    loadEntries.mockResolvedValueOnce(rows(2));
    page.onLoadMore();
    await flush();
    expect(
      loadEntries.mock.calls[loadEntries.mock.calls.length - 1][0].page,
    ).toBe(2);
    expect(page.data.entries).toEqual(previous);
    expect(page.data.pageError).toBe("");
    expect(loadSummary).toHaveBeenCalledTimes(1);
    expect(loadRule).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])(
    "prioritizes HTTP %s over another failure and clears all cached business data",
    async (code) => {
      await open();
      loadSummary.mockResolvedValueOnce(failure());
      loadRule.mockResolvedValueOnce(failure(code));
      page.onPullDownRefresh();
      await flush();
      expect(page.data).toMatchObject({
        viewState: "forbidden",
        summary: null,
        rule: null,
        entries: [],
        page: 0,
        total: 0,
        hasMore: false,
        refreshError: "",
        pageError: "",
      });
    },
  );

  it("ignores responses while hidden and reloads on return", async () => {
    const pending = deferred();
    loadEntries.mockReturnValueOnce(pending.promise);
    await open();
    page.onHide?.();
    const writes = page.setData.mock.calls.length;
    pending.resolve(rows());
    await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    page.onShow?.();
    await flush();
    expect(loadEntries).toHaveBeenCalledTimes(2);
    expect(page.data.viewState).toBe("ready");
  });

  it("isolates simultaneous page instances", async () => {
    const pending = deferred();
    loadEntries.mockReturnValueOnce(pending.promise);
    await open();
    const first = page;
    page = instantiate();
    await open();
    pending.resolve(rows());
    await flush();
    expect(first.data.viewState).toBe("ready");
    expect(page.data.viewState).toBe("ready");
    first.onUnload?.();
  });

  it("discards old period responses when a newer period succeeds", async () => {
    const pending = deferred();
    loadEntries.mockReturnValueOnce(pending.promise);
    await open();
    page.onPeriodTap({ currentTarget: { dataset: { period: "DAY" } } });
    await flush();
    pending.resolve(
      success({
        data: [],
        meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      }),
    );
    await flush();
    expect(page.data.viewState).toBe("ready");
    expect(
      loadEntries.mock.calls[loadEntries.mock.calls.length - 1][0].period,
    ).toBe("DAY");
  });

  it("clears the old period when the new period fails", async () => {
    await open();
    loadEntries.mockResolvedValueOnce(failure());
    page.onPeriodTap({ currentTarget: { dataset: { period: "DAY" } } });
    await flush();
    expect(page.data).toMatchObject({
      viewState: "error",
      summary: null,
      rule: null,
      entries: [],
      hasMore: false,
    });
  });

  it("returns to login explicitly", () => {
    page.onLogin?.();
    expect(logout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({
      url: "/pages/bootstrap/index",
    });
  });

  it("handles rejected requests and recovers on retry", async () => {
    loadSummary.mockRejectedValueOnce(new Error("offline"));
    await open();
    expect(page.data.viewState).toBe("error");
    page.onRetry();
    await flush();
    expect(page.data.viewState).toBe("ready");
  });

  it("invalidates pagination on refresh and ignores its late result", async () => {
    await open();
    const pending = deferred();
    loadEntries.mockReturnValueOnce(pending.promise);
    page.onLoadMore();
    await flush();
    page.onPullDownRefresh();
    await flush();
    pending.resolve(rows(2));
    await flush();
    expect(page.data.page).toBe(1);
    expect(page.data.loadingMore).toBe(false);
    expect(page.data.hasMore).toBe(true);
  });

  it.each(["account", "address", "driver"])("clears private earnings on return after a %s change", async (change) => {
    await open();
    ownerKey = `synthetic-changed-${change}`;
    page.onShow();
    await flush();
    expect(page.data).toMatchObject({
      viewState: "forbidden", errorMessage: "登录已更新，请重新登录",
      summary: null, rule: null, entries: [], page: 0, total: 0,
      hasMore: false, loadingMore: false, refreshError: "", pageError: "",
    });
    expect(page.contentKey).toBe("");
    expect(page.pendingKey).toBe("");
    expect(page.pendingRequest).toBeUndefined();
    expect(loadEntries).toHaveBeenCalledTimes(1);
    const fresh = instantiate();
    fresh.onLoad(); fresh.onShow();
    await flush();
    expect(fresh.data.viewState).toBe("ready");
    fresh.onUnload();
    expect(logout).not.toHaveBeenCalled();
  });

  it.each(["retry", "more", "status", "period", "date"])("checks the current owner before %s without a lifecycle event", async (action) => {
    await open();
    const filters = {
      statusIndex: page.data.statusIndex, periodIndex: page.data.periodIndex, anchorDate: page.data.anchorDate,
    };
    ownerKey = "synthetic-replacement-owner";
    if (action === "retry") page.onRetry();
    if (action === "more") page.onLoadMore();
    if (action === "status") page.onStatusChange({ detail: { value: "1" } });
    if (action === "period") page.onPeriodTap({ currentTarget: { dataset: { period: "DAY" } } });
    if (action === "date") page.onAnchorDateChange({ detail: { value: "2026-01-01" } });
    await flush();
    expect(page.data).toMatchObject({
      ...filters, viewState: "forbidden", summary: null, rule: null, entries: [],
    });
    expect(loadSummary).toHaveBeenCalledTimes(1);
    expect(loadRule).toHaveBeenCalledTimes(1);
    expect(loadEntries).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1])("cancels reads when the owner changes after %i queued stages", async (stage) => {
    const reading = start();
    if (stage === 1) await Promise.resolve();
    ownerKey = "synthetic-replacement-owner";
    await reading;
    expect(loadSummary).not.toHaveBeenCalled();
    expect(loadRule).not.toHaveBeenCalled();
    expect(loadEntries).not.toHaveBeenCalled();
    expect(page.data.viewState).toBe("forbidden");
    expect(page.pendingRequest).toBeUndefined();
  });

  it.each(["summary", "rule", "entries"])("discards a late successful %s reply after identity replacement", async (source) => {
    await open();
    const pending = deferred();
    const reader = { summary: loadSummary, rule: loadRule, entries: loadEntries }[source]!;
    reader.mockReturnValueOnce(pending.promise);
    const reading = page.load(true);
    await flush();
    ownerKey = "synthetic-replacement-owner";
    pending.resolve(source === "summary" ? success(PARTNER_EARNING_SUMMARY_FIXTURE)
      : source === "rule" ? success(PARTNER_EARNING_RULE_FIXTURE) : rows());
    await reading;
    expect(page.data).toMatchObject({
      viewState: "forbidden", summary: null, rule: null, entries: [], page: 0,
    });
    expect(page.pendingRequest).toBeUndefined();
  });

  it.each([
    { source: "summary", code: 401 }, { source: "summary", code: 403 },
    { source: "rule", code: 401 }, { source: "rule", code: 403 },
    { source: "entries", code: 401 }, { source: "entries", code: 403 },
  ])("clears immediately on $source HTTP $code while both siblings remain pending", async ({ source, code }) => {
    await open();
    const held = deferred();
    for (const [name, reader] of Object.entries({ summary: loadSummary, rule: loadRule, entries: loadEntries })) {
      reader.mockReturnValueOnce(name === source ? Promise.resolve(failure(code)) : held.promise);
    }
    const reading = page.load(true);
    await flush();
    expect(page.data).toMatchObject({
      viewState: "forbidden", summary: null, rule: null, entries: [], page: 0, total: 0,
      hasMore: false, loadingMore: false, refreshError: "", pageError: "",
    });
    expect(page.pendingRequest).toBeUndefined();
    expect(page.pendingKey).toBe("");
    const cleared = { ...page.data };
    held.resolve(failure());
    await reading;
    expect(page.data).toEqual(cleared);
  });

  it("keeps a new retry and its lock when siblings from an early denial arrive late", async () => {
    await open();
    const held = deferred();
    loadSummary.mockResolvedValueOnce(failure(403));
    loadRule.mockReturnValueOnce(held.promise);
    loadEntries.mockReturnValueOnce(held.promise);
    const old = page.load(true);
    await flush();
    expect(page.data.viewState).toBe("forbidden");
    const current = deferred();
    loadEntries.mockReturnValueOnce(current.promise);
    const reading = page.load(true);
    await flush();
    held.resolve(failure(401));
    await old;
    expect(page.pendingRequest).toBe(reading);
    expect(page.data.viewState).toBe("loading");
    page.onRetry();
    await flush();
    expect(loadEntries).toHaveBeenCalledTimes(3);
    current.resolve(rows());
    await reading;
    expect(page.data.viewState).toBe("ready");
    expect(page.pendingRequest).toBeUndefined();
  });

  it("clears loaded mock earnings and stops reads if the login navigation fails", async () => {
    await open();
    (global as any).wx.reLaunch.mockImplementationOnce((options: any) => options.fail?.());
    page.onLogin();
    page.onRetry(); page.onLoadMore(); page.onShow();
    await flush();
    expect(page.data).toMatchObject({
      viewState: "forbidden", summary: null, rule: null, entries: [], total: 0,
    });
    expect(page.pendingRequest).toBeUndefined();
    expect(loadEntries).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("does not restore an in-flight reply after explicit logout even if its owner key stays the same", async () => {
    await open();
    const held = deferred();
    loadEntries.mockReturnValueOnce(held.promise);
    const reading = page.load(true);
    await flush();
    page.onLogin();
    const writes = page.setData.mock.calls.length;
    held.resolve(rows());
    await reading;
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(page.data).toMatchObject({ viewState: "forbidden", summary: null, rule: null, entries: [] });
  });
});
