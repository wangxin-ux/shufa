import { PARTNER_ATTENDANCE_FIXTURE, PARTNER_PROFILE_FIXTURE } from "../mock/fixtures/partner.fixture";

const loadProfile = jest.fn();
const loadAttendance = jest.fn();
const logout = jest.fn();
const createPartnerService = jest.fn();
const createSessionService = jest.fn();
let ownerKey = "synthetic-attendance-owner";
jest.mock("../services/partner-runtime", () => ({
  createPartnerService: () => createPartnerService(),
  partnerService: {
    loadProfile: () => loadProfile(),
    loadAttendance: (query: unknown) => loadAttendance(query),
  },
}));
jest.mock("../services/session.service", () => ({
  createSessionService: () => createSessionService(),
  sessionService: { logout: () => logout() },
}));
jest.mock("../pages/partner/runtime/partner-campaign-draft.service", () => ({
  getPartnerCampaignDraftService: () => ({ getSessionKey: () => ownerKey }),
}));
const profile = (timezone = "Asia/Shanghai") => ({
  status: "success",
  data: { ...PARTNER_PROFILE_FIXTURE, campus: { ...PARTNER_PROFILE_FIXTURE.campus, timezone } },
});
const rows = (page = 1, ids = ["one"]) => ({
  status: ids.length ? "success" : "empty",
  data: {
    ...PARTNER_ATTENDANCE_FIXTURE,
    items: ids.map((id) => ({ ...PARTNER_ATTENDANCE_FIXTURE.items[0], id, startsAt: "2026-10-08T02:00:00Z" })),
    meta: { page, pageSize: 20, total: ids.length ? 21 : 0, totalPages: ids.length ? 2 : 0 },
  },
});
const failure = (statusCode = 500) => ({ status: "error", statusCode, message: "加载失败" });
const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { resolve, reject, promise };
};
const cleared = {
  viewState: "forbidden", items: [], page: 0, total: 0, hasMore: false,
  refreshError: "", pageError: "", loadingMore: false,
  summary: {
    attendanceRateLabel: "暂无数据", recordedCountLabel: "0",
    presentCountLabel: "0", absentCountLabel: "0", leaveCountLabel: "0",
  },
};

describe("partner attendance page lifecycle and campus timezone", () => {
  let page: any;
  let definition: any;
  let instances: any[];
  const instantiate = () => {
    const instance = { ...definition, data: { ...definition.data, items: [] } };
    instance.setData = jest.fn((values: object) => Object.assign(instance.data, values));
    instances.push(instance);
    return instance;
  };
  const flush = async () => {
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
  };
  const open = async () => {
    page.onLoad();
    page.onShow?.();
    await flush();
  };
  beforeEach(() => {
    instances = [];
    loadProfile.mockReset().mockResolvedValue(profile());
    loadAttendance.mockReset().mockResolvedValue(rows());
    logout.mockReset();
    ownerKey = "synthetic-attendance-owner";
    createPartnerService.mockReset().mockImplementation(() => ({
      loadProfile: () => loadProfile(),
      loadAttendance: (query: unknown) => loadAttendance(query),
    }));
    createSessionService.mockReset().mockReturnValue({ logout: () => logout() });
    (global as any).wx = { stopPullDownRefresh: jest.fn(), reLaunch: jest.fn() };
    (global as any).Page = (config: any) => { definition = config; };
    jest.isolateModules(() => require("../pages/partner/attendance/index"));
    page = instantiate();
  });
  afterEach(() => {
    instances.forEach((instance) => instance.onUnload?.());
    delete (global as any).Page;
    delete (global as any).wx;
  });

  it("deduplicates initialization, show and refresh while profile is pending", async () => {
    const pending = deferred();
    loadProfile.mockReturnValueOnce(pending.promise);
    await open();
    page.onPullDownRefresh();
    page.onPullDownRefresh();
    await flush();
    expect(loadProfile).toHaveBeenCalledTimes(1);
    expect(loadAttendance).not.toHaveBeenCalled();
    pending.resolve(profile());
    await flush();
    expect(loadAttendance).toHaveBeenCalledTimes(1);
    expect(page.data.viewState).toBe("ready");
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 500])("does not fetch attendance with an unavailable profile HTTP %s", async (code) => {
    loadProfile.mockResolvedValueOnce(failure(code));
    await open();
    expect(loadAttendance).not.toHaveBeenCalled();
    expect(page.data.viewState).toBe(code === 500 ? "error" : "forbidden");
    page.onRetry();
    await flush();
    expect(page.data.viewState).toBe("ready");
  });

  it("isolates page instances and their timezone through subsequent pagination", async () => {
    loadProfile.mockResolvedValueOnce(profile("Asia/Shanghai"));
    await open();
    const first = page;
    page = instantiate();
    loadProfile.mockResolvedValueOnce(profile("America/New_York"));
    await open();
    expect(first.data.items[0].lessonLabel).toContain("10月8日 10:00");
    expect(page.data.items[0].lessonLabel).toContain("10月7日 22:00");
    loadAttendance.mockResolvedValueOnce(rows(2, ["two"]));
    first.onLoadMore();
    await flush();
    expect(first.data.items[1].lessonLabel).toContain("10月8日 10:00");
    expect(loadProfile).toHaveBeenCalledTimes(2);
  });

  it.each(["profile", "attendance"])("does not continue or write after hide during %s", async (stage) => {
    const pending = deferred();
    if (stage === "profile") loadProfile.mockReturnValueOnce(pending.promise);
    else loadAttendance.mockReturnValueOnce(pending.promise);
    await open();
    page.onHide?.();
    const calls = loadAttendance.mock.calls.length;
    const writes = page.setData.mock.calls.length;
    pending.resolve(stage === "profile" ? profile() : rows());
    await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(loadAttendance).toHaveBeenCalledTimes(calls);
    page.onShow?.();
    await flush();
    expect(page.data.viewState).toBe("ready");
  });

  it("ignores late responses and never starts requests after unload", async () => {
    const pending = deferred();
    loadAttendance.mockReturnValueOnce(pending.promise);
    await open();
    page.onUnload?.();
    const writes = page.setData.mock.calls.length;
    pending.resolve(rows());
    await flush();
    page.onShow?.();
    await page.loadAttendance(true);
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(loadAttendance).toHaveBeenCalledTimes(1);
  });

  it.each(["profile", "attendance"])("preserves summary and rows when refresh %s fails", async (stage) => {
    await open();
    const previous = { summary: page.data.summary, items: page.data.items, page: page.data.page };
    if (stage === "profile") loadProfile.mockResolvedValueOnce(failure());
    else loadAttendance.mockResolvedValueOnce(failure());
    page.onPullDownRefresh();
    await flush();
    expect(page.data).toMatchObject({ ...previous, viewState: "ready", refreshError: "加载失败" });
    const calls = loadAttendance.mock.calls.length;
    page.onLoadMore();
    await flush();
    expect(loadAttendance).toHaveBeenCalledTimes(calls);
    page.onRetry();
    await flush();
    expect(page.data.refreshError).toBe("");
  });

  it("keeps rows and retries the failed page without refetching profile or duplicating IDs", async () => {
    await open();
    const previous = page.data.items;
    loadAttendance.mockResolvedValueOnce(failure());
    page.onLoadMore();
    page.onLoadMore();
    await flush();
    expect(loadAttendance).toHaveBeenCalledTimes(2);
    expect(page.data).toMatchObject({ items: previous, page: 1, viewState: "ready", pageError: "加载失败" });
    loadAttendance.mockResolvedValueOnce(rows(2, ["one", "two", "two"]));
    page.onLoadMore();
    await flush();
    expect(loadAttendance).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 });
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(["one", "two"]);
    expect(loadProfile).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])("clears summary, counts and rows on HTTP %s during pagination", async (statusCode) => {
    await open();
    loadAttendance.mockResolvedValueOnce(failure(statusCode));
    page.onLoadMore();
    await flush();
    expect(page.data).toMatchObject({
      viewState: "forbidden", items: [], page: 0, total: 0, hasMore: false,
      refreshError: "", pageError: "", loadingMore: false,
      summary: { attendanceRateLabel: "暂无数据", recordedCountLabel: "0", presentCountLabel: "0" },
    });
  });

  it("invalidates old pagination when refreshing and ignores its late result", async () => {
    await open();
    const pending = deferred();
    loadAttendance.mockReturnValueOnce(pending.promise);
    page.onLoadMore();
    await flush();
    page.onPullDownRefresh();
    await flush();
    pending.resolve(rows(2, ["stale"]));
    await flush();
    expect(page.data.page).toBe(1);
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(["one"]);
  });

  it.each(["profile", "attendance"])("catches a rejected %s request and retries", async (stage) => {
    if (stage === "profile") loadProfile.mockRejectedValueOnce(new Error("offline"));
    else loadAttendance.mockRejectedValueOnce(new Error("offline"));
    await expect(page.initialize()).resolves.toBeUndefined();
    expect(page.data.viewState).toBe("error");
    page.onRetry();
    await flush();
    expect(page.data.viewState).toBe("ready");
  });

  it.each(["initial", "refresh"])("contains a malformed profile during %s and recovers", async (phase) => {
    if (phase === "refresh") await open();
    const previous = {
      summary: page.data.summary, items: page.data.items,
      page: page.data.page, total: page.data.total, hasMore: page.data.hasMore,
    };
    const timeZone = page.campusTimeZone;
    const attendanceCalls = loadAttendance.mock.calls.length;
    loadProfile.mockResolvedValueOnce({
      status: "success", data: { ...PARTNER_PROFILE_FIXTURE, campus: null },
    });
    await expect(page.loadAttendance(true)).resolves.toBeUndefined();
    expect(loadAttendance).toHaveBeenCalledTimes(attendanceCalls);
    expect(page.data).toMatchObject({
      ...previous, loadingMore: false,
      ...(phase === "refresh"
        ? { viewState: "ready", refreshError: "出勤统计加载失败，请重试" }
        : { viewState: "error", errorMessage: "出勤统计加载失败，请重试" }),
    });
    expect(page.campusTimeZone).toBe(timeZone);
    expect(page.pendingRequest).toBeUndefined();
    expect(page.pendingPage).toBe(0);
    page.onRetry();
    await flush();
    expect(page.data).toMatchObject({
      viewState: "ready", errorMessage: "", refreshError: "", pageError: "",
    });
    expect(page.campusTimeZone).toBe("Asia/Shanghai");
  });

  it.each(["initial", "refresh", "pagination"])("contains a malformed attendance model during %s and retries the same page", async (phase) => {
    if (phase !== "initial") await open();
    const previous = {
      summary: page.data.summary, items: page.data.items,
      page: page.data.page, total: page.data.total, hasMore: page.data.hasMore,
    };
    const timeZone = page.campusTimeZone;
    const nextPage = phase === "pagination" ? 2 : 1;
    if (phase === "refresh") loadProfile.mockResolvedValueOnce(profile("America/New_York"));
    loadAttendance.mockResolvedValueOnce({
      status: "success", data: { ...rows(nextPage).data, items: null },
    });
    await expect(page.loadAttendance(phase !== "pagination")).resolves.toBeUndefined();
    expect(page.data).toMatchObject({
      ...previous, loadingMore: false,
      ...(phase === "initial"
        ? { viewState: "error", errorMessage: "出勤统计加载失败，请重试" }
        : {
            viewState: "ready",
            [phase === "refresh" ? "refreshError" : "pageError"]: "出勤统计加载失败，请重试",
          }),
    });
    expect(page.campusTimeZone).toBe(timeZone);
    expect(page.pendingRequest).toBeUndefined();
    expect(page.pendingPage).toBe(0);
    loadAttendance.mockResolvedValueOnce(rows(nextPage, nextPage === 2 ? ["one", "two"] : ["one"]));
    if (phase === "pagination") page.onLoadMore(); else page.onRetry();
    await flush();
    expect(loadAttendance).toHaveBeenLastCalledWith({ page: nextPage, pageSize: 20 });
    expect(page.data).toMatchObject({
      viewState: "ready", page: nextPage, errorMessage: "", refreshError: "", pageError: "",
    });
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(
      nextPage === 2 ? ["one", "two"] : ["one"],
    );
    expect(page.campusTimeZone).toBe("Asia/Shanghai");
  });

  it("deduplicates the initial page and returns explicitly to login", async () => {
    loadAttendance.mockResolvedValueOnce(rows(1, ["one", "one"]));
    await open();
    expect(page.data.items).toHaveLength(1);
    page.onLogin?.();
    expect(logout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/bootstrap/index" });
  });

  it.each(["initialize", "loadAttendance"])("binds current services before legacy direct %s entry", async (entry) => {
    await (entry === "initialize" ? page.initialize() : page.loadAttendance(true));
    expect(createPartnerService).toHaveBeenCalledTimes(1);
    expect(page.data.viewState).toBe("ready");
    ownerKey = "synthetic-other-owner";
    await page.loadAttendance(true);
    expect(page.data).toMatchObject(cleared);
    expect(loadProfile).toHaveBeenCalledTimes(1);
  });

  it.each(["show", "initialize", "refresh", "retry", "pagination"])("clears loaded private data on owner change at %s", async (entry) => {
    await open();
    ownerKey = "synthetic-other-owner";
    if (entry === "show") page.onShow();
    if (entry === "initialize") await page.initialize();
    if (entry === "refresh") page.onPullDownRefresh();
    if (entry === "retry") page.onRetry();
    if (entry === "pagination") page.onLoadMore();
    await flush();
    expect(page.data).toMatchObject(cleared);
    expect(page.campusTimeZone).toBeUndefined();
    expect(page.pendingPage).toBe(0);
    expect(page.pendingRequest).toBeUndefined();
    page.onShow(); page.onRetry(); page.onLoadMore();
    await flush();
    expect(loadProfile).toHaveBeenCalledTimes(1);
    expect(loadAttendance).toHaveBeenCalledTimes(1);
    const fresh = instantiate();
    fresh.onLoad(); fresh.onShow();
    await flush();
    expect(fresh.data.viewState).toBe("ready");
    expect(createPartnerService).toHaveBeenCalledTimes(2);
  });

  it.each(["initial-profile", "refresh-profile", "pagination"])("checks ownership before queued %s reads execute", async (stage) => {
    if (stage !== "initial-profile") await open();
    const profileCalls = loadProfile.mock.calls.length;
    const attendanceCalls = loadAttendance.mock.calls.length;
    const reading = page.loadAttendance(stage !== "pagination");
    ownerKey = "synthetic-other-owner";
    await reading;
    expect(loadProfile).toHaveBeenCalledTimes(profileCalls);
    expect(loadAttendance).toHaveBeenCalledTimes(attendanceCalls);
    expect(page.data).toMatchObject(cleared);
    expect(page.campusTimeZone).toBeUndefined();
    expect(page.pendingPage).toBe(0);
  });

  it.each(["initial-profile", "refresh-profile", "attendance", "pagination"])("discards a held %s response after ownership changes", async (stage) => {
    if (stage !== "initial-profile") await open();
    const pending = deferred();
    const isProfile = stage.endsWith("profile");
    (isProfile ? loadProfile : loadAttendance).mockReturnValueOnce(pending.promise);
    const reading = page.loadAttendance(stage !== "pagination");
    await flush();
    const calls = loadAttendance.mock.calls.length;
    ownerKey = "synthetic-other-owner";
    pending.resolve(isProfile ? profile("America/New_York") : rows(2, ["stale"]));
    await reading;
    expect(page.data).toMatchObject(cleared);
    expect(page.campusTimeZone).toBeUndefined();
    expect(page.pendingPage).toBe(0);
    expect(loadAttendance).toHaveBeenCalledTimes(calls);
  });

  it.each(["profile", "attendance", "pagination"])("invalidates request ownership for %s returned or thrown auth failures", async (stage) => {
    await open();
    const runtime = stage === "profile" ? loadProfile : loadAttendance;
    runtime.mockRejectedValueOnce({ statusCode: 403 });
    const sequence = page.requestSequence;
    await page.loadAttendance(stage !== "pagination");
    expect(page.data).toMatchObject(cleared);
    expect(page.requestSequence).toBeGreaterThan(sequence + 1);
    expect(page.campusTimeZone).toBeUndefined();
    expect(page.pendingPage).toBe(0);
    page.onRetry();
    await flush();
    expect(page.data.viewState).toBe("ready");
  });

  it.each([401, 403])("unifies HTTP %s returned, rejected and synchronous failures in both stages and pagination", async (statusCode) => {
    for (const stage of ["profile", "attendance", "pagination"]) {
      for (const form of ["returned", "rejected", "thrown"]) {
        await page.loadAttendance(true);
        const runtime = stage === "profile" ? loadProfile : loadAttendance;
        if (form === "returned") runtime.mockResolvedValueOnce(failure(statusCode));
        if (form === "rejected") runtime.mockRejectedValueOnce({ statusCode });
        if (form === "thrown") runtime.mockImplementationOnce(() => { throw { statusCode }; });
        const sequence = page.requestSequence;
        await expect(page.loadAttendance(stage !== "pagination")).resolves.toBeUndefined();
        expect(page.data).toMatchObject(cleared);
        expect(page.requestSequence).toBeGreaterThan(sequence + 1);
        expect(page.campusTimeZone).toBeUndefined();
        expect(page.pendingPage).toBe(0);
        expect(page.pendingRequest).toBeUndefined();
      }
    }
  });

  it.each(["fail", "throw"])("clears and stops before current logout when reLaunch %s", async (navigation) => {
    await open();
    const pending = deferred();
    loadAttendance.mockReturnValueOnce(pending.promise);
    const reading = page.loadAttendance(false);
    await flush();
    logout.mockImplementationOnce(() => {
      expect(page.data).toMatchObject(cleared);
      expect(page.runtime).toBeUndefined();
      expect(page.pendingPage).toBe(0);
    });
    (global as any).wx.reLaunch.mockImplementationOnce((options: { fail?: () => void }) => {
      if (navigation === "throw") throw new Error("synthetic navigation failure");
      options.fail?.();
    });
    expect(() => page.onLogin()).not.toThrow();
    expect(createSessionService).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledTimes(1);
    const writes = page.setData.mock.calls.length;
    pending.resolve(rows(2, ["stale"]));
    await reading;
    page.onShow(); page.onRetry(); page.onLoadMore(); page.onPullDownRefresh();
    await page.initialize();
    await flush();
    expect(page.data).toMatchObject(cleared);
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(loadProfile).toHaveBeenCalledTimes(1);
    expect(loadAttendance).toHaveBeenCalledTimes(2);
    expect(createPartnerService).toHaveBeenCalledTimes(1);
  });

  it("cancels a queued read immediately on logout", async () => {
    await open();
    const reading = page.loadAttendance(true);
    page.onLogin();
    await reading;
    expect(loadProfile).toHaveBeenCalledTimes(1);
    expect(loadAttendance).toHaveBeenCalledTimes(1);
    expect(page.data).toMatchObject(cleared);
  });

  it.each(["hide", "unload", "return"])("does not let an old pull callback stop the spinner after %s", async (boundary) => {
    await open();
    const old = deferred();
    loadProfile.mockReturnValueOnce(old.promise);
    page.onPullDownRefresh();
    await flush();
    if (boundary === "unload") page.onUnload();
    else page.onHide();
    const current = deferred();
    if (boundary === "return") {
      loadProfile.mockReturnValueOnce(current.promise);
      page.onShow();
      page.onPullDownRefresh();
      await flush();
    }
    old.resolve(profile());
    await flush();
    expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
    if (boundary === "return") {
      current.resolve(profile());
      await flush();
      expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
      expect(page.data.viewState).toBe("ready");
    }
  });

  it("isolates a new pull from a superseded pagination and preserves its pending lock", async () => {
    await open();
    const old = deferred();
    loadAttendance.mockReturnValueOnce(old.promise);
    page.onLoadMore();
    await flush();
    const current = deferred();
    loadProfile.mockReturnValueOnce(current.promise);
    page.onPullDownRefresh();
    await flush();
    const reading = page.pendingRequest;
    old.reject({ statusCode: 401 });
    await flush();
    expect(page.pendingRequest).toBe(reading);
    expect(page.pendingPage).toBe(1);
    expect(page.data.viewState).toBe("ready");
    current.resolve(profile());
    await reading;
    await flush();
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(["one"]);
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });
});
