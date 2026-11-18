import { PARTNER_OPERATIONS_SUMMARY_FIXTURE } from "../mock/fixtures/partner.fixture";

const loadSummary = jest.fn();
const logout = jest.fn();
jest.mock("../services/partner-runtime", () => ({
  partnerService: { loadOperationsSummary: (query: object) => loadSummary(query) },
  createPartnerService: () => ({ loadOperationsSummary: (query: object) => loadSummary(query) }),
}));
jest.mock("../services/session.service", () => ({
  sessionService: { logout: () => logout() },
  createSessionService: () => ({ logout: () => logout() }),
}));
jest.mock("../pages/partner/runtime/partner-campaign-draft.service", () => ({
  getPartnerCampaignDraftService: () => ({ getSessionKey: () => "synthetic-operations-owner" }),
}));

const success = (data = PARTNER_OPERATIONS_SUMMARY_FIXTURE) => ({
  status: "success", data,
});
const failure = (statusCode = 500) => ({
  status: "error", statusCode, message: "加载失败",
});
const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => { resolve = done; });
  return { resolve, promise };
};

describe("partner operations page lifecycle", () => {
  let page: any;
  let definition: any;
  const instantiate = () => {
    const instance = { ...definition, data: { ...definition.data } };
    instance.setData = jest.fn((values: object) => Object.assign(instance.data, values));
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
  beforeEach(() => {
    loadSummary.mockReset().mockResolvedValue(success());
    logout.mockReset();
    (global as any).wx = { stopPullDownRefresh: jest.fn(), reLaunch: jest.fn() };
    (global as any).Page = (config: any) => { definition = config; };
    jest.isolateModules(() => require("../pages/partner/operations/index"));
    page = instantiate();
  });
  afterEach(() => {
    page.onUnload?.();
    delete (global as any).Page;
    delete (global as any).wx;
  });

  it("deduplicates initial load/show and simultaneous refreshes", async () => {
    const pending = deferred();
    loadSummary.mockReturnValueOnce(pending.promise);
    await open();
    page.onPullDownRefresh();
    page.onPullDownRefresh();
    await flush();
    expect(loadSummary).toHaveBeenCalledTimes(1);
    pending.resolve(success());
    await flush();
    expect(page.data.viewState).toBe("ready");
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });

  it("preserves same-filter statistics on refresh failure and retries", async () => {
    await open();
    const summary = page.data.summary;
    loadSummary.mockResolvedValueOnce(failure());
    page.onPullDownRefresh();
    await flush();
    expect(page.data).toMatchObject({ summary, viewState: "ready", refreshError: "加载失败" });
    page.onRetry();
    await flush();
    expect(page.data.refreshError).toBe("");
  });

  it.each(["onHide", "onUnload"])("preserves period/date when queued filters arrive after %s", async (method) => {
    await open();
    const previous = { periodIndex: page.data.periodIndex, anchorDate: page.data.anchorDate };
    page[method]();
    const writes = page.setData.mock.calls.length;
    page.onPeriodTap({ currentTarget: { dataset: { period: "DAY" } } });
    page.onAnchorDateChange({ detail: { value: "2026-01-01" } });
    await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(page.data).toMatchObject(previous);
    expect(loadSummary).toHaveBeenCalledTimes(1);
  });

  it("discards an old period response after switching period", async () => {
    const pending = deferred();
    loadSummary.mockReturnValueOnce(pending.promise);
    await open();
    page.onPeriodTap({ currentTarget: { dataset: { period: "DAY" } } });
    await flush();
    const current = page.data.summary;
    pending.resolve({ status: "empty", data: { ...PARTNER_OPERATIONS_SUMMARY_FIXTURE, consumedLessonUnits: 0 } });
    await flush();
    expect(page.data.summary).toEqual(current);
    expect(page.data.viewState).toBe("ready");
    expect(loadSummary.mock.calls[1][0].period).toBe("DAY");
  });

  it("clears old statistics when a different date fails", async () => {
    await open();
    loadSummary.mockResolvedValueOnce(failure());
    page.onAnchorDateChange({ detail: { value: "2026-01-01" } });
    await flush();
    expect(page.data).toMatchObject({ summary: null, viewState: "error" });
  });

  it.each([401, 403])("clears cached statistics on HTTP %s", async (code) => {
    await open();
    loadSummary.mockResolvedValueOnce(failure(code));
    page.onPullDownRefresh();
    await flush();
    expect(page.data).toMatchObject({
      summary: null, viewState: "forbidden", refreshError: "",
    });
    expect(page.data.errorMessage).toContain(code === 401 ? "登录" : "无权");
  });

  it.each(["onHide", "onUnload"])("does not write a late response after %s", async (method) => {
    const pending = deferred();
    loadSummary.mockReturnValueOnce(pending.promise);
    await open();
    page[method]?.();
    const writes = page.setData.mock.calls.length;
    pending.resolve(success());
    await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    if (method === "onHide") {
      page.onShow?.();
      await flush();
      expect(loadSummary).toHaveBeenCalledTimes(2);
      expect(page.data.viewState).toBe("ready");
    }
  });

  it("isolates concurrent page instances", async () => {
    const pending = deferred();
    loadSummary.mockReturnValueOnce(pending.promise);
    await open();
    const first = page;
    page = instantiate();
    await open();
    pending.resolve(success());
    await flush();
    expect(first.data.viewState).toBe("ready");
    expect(page.data.viewState).toBe("ready");
    first.onUnload?.();
  });

  it("offers explicit return to login", () => {
    page.onLogin?.();
    expect(logout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/bootstrap/index" });
  });

  it("handles rejected requests and recovers on retry", async () => {
    loadSummary.mockRejectedValueOnce(new Error("offline"));
    await open();
    expect(page.data.viewState).toBe("error");
    expect(page.data.errorMessage).not.toContain("offline");
    page.onRetry();
    await flush();
    expect(page.data.viewState).toBe("ready");
  });

  it("retains an empty response when refresh fails", async () => {
    loadSummary.mockResolvedValueOnce({ status: "empty", data: PARTNER_OPERATIONS_SUMMARY_FIXTURE });
    await open();
    const summary = page.data.summary;
    loadSummary.mockResolvedValueOnce(failure());
    page.onPullDownRefresh();
    await flush();
    expect(page.data).toMatchObject({ summary, viewState: "empty", refreshError: "加载失败" });
  });
});
