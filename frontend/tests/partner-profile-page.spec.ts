import { PARTNER_PROFILE_FIXTURE } from "../mock/fixtures/partner.fixture";
import * as fs from "fs";
import * as path from "path";

const loadProfile = jest.fn();
const logout = jest.fn();
const createRuntime = jest.fn();
let ownerKey = "synthetic-profile-owner";
jest.mock("../services/partner-runtime", () => ({
  partnerService: { loadProfile: () => loadProfile() },
  createPartnerService: () => createRuntime(),
}));
jest.mock("../services/session.service", () => ({
  sessionService: { logout: () => logout() },
  createSessionService: () => ({ logout: () => logout() }),
}));
jest.mock("../pages/partner/runtime/partner-campaign-draft.service", () => ({
  getPartnerCampaignDraftService: () => ({ getSessionKey: () => ownerKey }),
}));
const success = { status: "success", data: PARTNER_PROFILE_FIXTURE };
const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => { resolve = done; });
  return { resolve, promise };
};

describe("partner profile page lifecycle", () => {
  it("keeps refresh controls above the overflowing character artwork", () => {
    const root = path.resolve(__dirname, "../pages/partner/profile");
    const markup = fs.readFileSync(path.join(root, "index.wxml"), "utf8");
    const styles = fs.readFileSync(path.join(root, "index.wxss"), "utf8");
    expect(markup).toContain("profile-hero--refresh-error");
    expect(styles).toMatch(/\.profile-hero--refresh-error\s*\{[^}]*margin-top:\s*120rpx;/);
  });
  it("renders the campus and count with four primary entries and a conditional secondary region", () => {
    const markup = fs.readFileSync(path.resolve(__dirname, "../pages/partner/profile/index.wxml"), "utf8");
    expect(markup).toContain('wx:for="{{primaryActions}}"');
    expect(markup).toContain('wx:for="{{secondaryActions}}"');
    expect(markup).toContain('wx:if="{{moreExpanded}}"');
    expect(markup).toContain('{{activeStudentCountLabel}}');
    expect(markup).toContain('bindtap="onMoreToggle"');
    expect(markup).toContain('<session-logout id="sessionLogout" />');
    expect(markup).toContain('<scroll-view wx:if="{{moreExpanded}}"');
    const styles = fs.readFileSync(path.resolve(__dirname, "../pages/partner/profile/index.wxss"), "utf8");
    expect(styles).toMatch(/\.profile-more-toggle\s*\{[^}]*width:\s*144rpx;/);
    expect(styles).toContain('height: var(--profile-body-height)');
    expect(styles).toMatch(/\.profile-page\s*\{[^}]*overflow:\s*visible;/);
  });
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
    ownerKey = "synthetic-profile-owner";
    createRuntime.mockReset().mockImplementation(() => ({ loadProfile: () => loadProfile() }));
    loadProfile.mockReset().mockResolvedValue(success);
    logout.mockReset();
    (global as any).wx = {
      stopPullDownRefresh: jest.fn(), reLaunch: jest.fn(), navigateTo: jest.fn(), showToast: jest.fn(),
      getWindowInfo: () => ({ windowWidth: 430, windowHeight: 932, statusBarHeight: 54 }),
      getMenuButtonBoundingClientRect: () => ({ top: 58, height: 32 }),
    };
    (global as any).Page = (config: any) => { definition = config; };
    jest.isolateModules(() => require("../pages/partner/profile/index"));
    page = instantiate();
  });
  afterEach(() => {
    page.onUnload?.();
    delete (global as any).Page;
    delete (global as any).wx;
  });

  it("deduplicates initial load/show and concurrent refreshes", async () => {
    const pending = deferred();
    loadProfile.mockReturnValueOnce(pending.promise);
    await open();
    page.onPullDownRefresh();
    page.onPullDownRefresh();
    await flush();
    expect(loadProfile).toHaveBeenCalledTimes(1);
    pending.resolve(success);
    await flush();
    expect(page.data.viewState).toBe("ready");
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });

  it.each([[375, 812], [390, 844], [430, 932]])("sizes the page from the %s by %s viewport and actual capsule", async (width, height) => {
    (global as any).wx.getWindowInfo = () => ({ windowWidth: width, windowHeight: height, statusBarHeight: 54 });
    await open();
    expect(page.data.profileBodyHeightPx).toBe(
      Math.floor(height - 58 - Math.max(48, 88 * width / 750) - 42 * width / 750),
    );
  });

  it("preserves profile and menu on a retryable refresh failure", async () => {
    await open();
    const previous = { displayName: page.data.displayName, addressLabel: page.data.addressLabel,
      activeStudentCountLabel: page.data.activeStudentCountLabel };
    loadProfile.mockResolvedValueOnce({ status: "error", message: "加载失败", statusCode: 500 });
    page.onPullDownRefresh();
    await flush();
    expect(page.data).toMatchObject({ ...previous, viewState: "ready", refreshError: "加载失败" });
    page.onRetry();
    await flush();
    expect(page.data.refreshError).toBe("");
  });

  it.each([401, 403])("clears all profile fields on HTTP %s", async (statusCode) => {
    await open();
    loadProfile.mockResolvedValueOnce({ status: "error", message: "拒绝访问", statusCode });
    page.onPullDownRefresh();
    await flush();
    expect(page.data).toMatchObject({
      viewState: "forbidden", refreshError: "", displayName: "", identityLabel: "",
      campusName: "", campusCodeLabel: "", contactPhoneLabel: "", addressLabel: "",
      warningThresholdLabel: "", activeStudentCountLabel: "", moreExpanded: false,
    });
  });

  it.each(["onHide", "onUnload"])("discards late responses after %s", async (method) => {
    const pending = deferred();
    loadProfile.mockReturnValueOnce(pending.promise);
    await open();
    page[method]?.();
    const writes = page.setData.mock.calls.length;
    pending.resolve(success);
    await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    if (method === "onHide") {
      page.onShow?.();
      await flush();
      expect(loadProfile).toHaveBeenCalledTimes(2);
      expect(page.data.viewState).toBe("ready");
    }
  });

  it("does not request after unloading", async () => {
    await open();
    page.onUnload?.();
    page.onShow?.();
    await page.loadProfile();
    expect(loadProfile).toHaveBeenCalledTimes(1);
  });

  it("isolates concurrent page instances", async () => {
    const pending = deferred();
    loadProfile.mockReturnValueOnce(pending.promise);
    await open();
    const first = page;
    page = instantiate();
    await open();
    pending.resolve(success);
    await flush();
    expect(first.data.viewState).toBe("ready");
    expect(page.data.viewState).toBe("ready");
    first.onUnload?.();
  });

  it("clears previous details on a successful empty response", async () => {
    await open();
    loadProfile.mockResolvedValueOnce({ status: "empty", data: PARTNER_PROFILE_FIXTURE });
    page.onPullDownRefresh();
    await flush();
    expect(page.data).toMatchObject({
      viewState: "empty", displayName: "", campusName: "", contactPhoneLabel: "",
      addressLabel: "", warningThresholdLabel: "", activeStudentCountLabel: "", moreExpanded: false,
    });
  });

  it("handles rejected requests and recovers on retry", async () => {
    loadProfile.mockRejectedValueOnce(new Error("internal details"));
    page.onLoad();
    await expect(page.loadProfile()).resolves.toBeUndefined();
    expect(page.data.viewState).toBe("error");
    expect(page.data.errorMessage).not.toContain("internal details");
    page.onRetry();
    await flush();
    expect(page.data.viewState).toBe("ready");
  });

  it.each([false, true])("contains malformed profile data during refresh=%s and allows retry", async (refresh) => {
    if (refresh) {
      await open();
      page.onMoreToggle();
    }
    loadProfile.mockResolvedValueOnce({
      status: "success", data: { ...PARTNER_PROFILE_FIXTURE, campus: null },
    });
    if (refresh) page.onRetry(); else page.onLoad();
    await expect(page.pendingRequest).resolves.toBeUndefined();
    expect(page.pendingRequest).toBeUndefined();
    expect(page.data).toMatchObject(refresh
      ? { viewState: "ready", campusName: PARTNER_PROFILE_FIXTURE.campus.name,
          moreExpanded: true, refreshError: "合作方资料加载失败，请重试" }
      : { viewState: "error", errorMessage: "合作方资料加载失败，请重试" });
    page.onRetry();
    await page.pendingRequest;
    expect(page.data).toMatchObject({ viewState: "ready", refreshError: "" });
  });

  it("returns explicitly to login", () => {
    page.onLogin?.();
    expect(logout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/bootstrap/index" });
  });

  it("only navigates business entries from a ready profile", async () => {
    const event = { currentTarget: { dataset: { key: "students" } } };
    page.onActionTap(event);
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
    await open();
    page.onActionTap(event);
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: "/pages/partner/students/index" }));
  });

  it("shows four primary entries and expands four preserved secondary entries without requesting", async () => {
    await open();
    expect(page.data.primaryActions.map((item: any) => item.key)).toEqual([
      "students", "lesson-account", "teachers", "group-campaigns",
    ]);
    expect(page.data.secondaryActions.map((item: any) => item.key)).toEqual([
      "operations", "earnings", "warnings", "attendance",
    ]);
    expect(page.data.moreExpanded).toBe(false);
    page.onMoreToggle();
    expect(page.data.moreExpanded).toBe(true);
    page.onMoreToggle();
    expect(page.data.moreExpanded).toBe(false);
    expect(loadProfile).toHaveBeenCalledTimes(1);
  });

  it.each([0, 106, 1234])("keeps a ready profile for %s active students", async (count) => {
    loadProfile.mockResolvedValueOnce({
      status: "success", data: { ...PARTNER_PROFILE_FIXTURE, activeStudentCount: count },
    });
    await open();
    expect(page.data).toMatchObject({ viewState: "ready", activeStudentCountLabel: `${count}人` });
  });

  it.each([28, 80, 200])("fits a %s-character campus name without changing the menu", async (length) => {
    const campusName = "校".repeat(length);
    loadProfile.mockResolvedValueOnce({
      status: "success",
      data: { ...PARTNER_PROFILE_FIXTURE, campus: { ...PARTNER_PROFILE_FIXTURE.campus, name: campusName } },
    });
    await open();
    expect(page.data.campusName).toBe(campusName);
    expect(page.data.campusNameFontSizeRpx).toBeLessThan(54);
    expect(page.data.campusNameFontSizeRpx).toBeGreaterThanOrEqual(28);
    expect(page.data.campusNameHeightRpx).toBeLessThanOrEqual(128);
    const markup = fs.readFileSync(path.resolve(__dirname, "../pages/partner/profile/index.wxml"), "utf8");
    expect(markup).toMatch(/<scroll-view[^>]*class="profile-card__name"[^>]*scroll-y="\{\{true\}\}"/);
    expect(page.data.primaryActions).toHaveLength(4);
  });

  it.each([6, 28, 80, 200])("confines a %s-character name to the portrait-free column", async (length) => {
    loadProfile.mockResolvedValueOnce({
      status: "success",
      data: { ...PARTNER_PROFILE_FIXTURE, campus: { ...PARTNER_PROFILE_FIXTURE.campus, name: "校".repeat(length) } },
    });
    await open();
    expect(page.data.campusNameCompact).toBe(true);
    expect(page.data.campusNameFontSizeRpx).toBeLessThanOrEqual(38);
    expect(page.data.campusNameHeightRpx).toBe(Math.min(
      128,
      Math.ceil(length * page.data.campusNameFontSizeRpx / 210) * page.data.campusNameFontSizeRpx * 1.18,
    ));
    const root = path.resolve(__dirname, "../pages/partner/profile");
    const markup = fs.readFileSync(path.join(root, "index.wxml"), "utf8");
    const styles = fs.readFileSync(path.join(root, "index.wxss"), "utf8");
    expect(markup).toContain("campusNameCompact ? 'profile-card__summary--compact' : ''");
    expect(styles).toMatch(/\.profile-card__summary--compact\s*\{[^}]*width:\s*210rpx;/);
  });

  it("preserves the five-character name layout and clears compact mode on lost access", async () => {
    await open();
    expect(page.data).toMatchObject({
      campusNameCompact: false, campusNameFontSizeRpx: 54, campusNameHeightRpx: 63.72,
    });
    loadProfile.mockResolvedValueOnce({
      status: "success",
      data: { ...PARTNER_PROFILE_FIXTURE, campus: { ...PARTNER_PROFILE_FIXTURE.campus, name: "校".repeat(28) } },
    });
    page.onRetry();
    await flush();
    expect(page.data.campusNameCompact).toBe(true);
    loadProfile.mockResolvedValueOnce({ status: "error", message: "拒绝访问", statusCode: 403 });
    page.onRetry();
    await flush();
    expect(page.data.campusNameCompact).toBe(false);
  });

  it("navigates every approved route and rejects unknown keys", async () => {
    await open();
    for (const key of ["students", "lesson-account", "teachers", "group-campaigns",
      "operations", "earnings", "warnings", "attendance"]) {
      page.onActionTap({ currentTarget: { dataset: { key } } });
      expect((global as any).wx.navigateTo).toHaveBeenLastCalledWith(expect.objectContaining({
        url: `/pages/partner/${key}/index`,
      }));
      page.onHide();
      page.onShow();
      await flush();
    }
    page.onActionTap({ currentTarget: { dataset: { key: "__proto__" } } });
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(8);
    page.onHide();
    page.onMoreToggle();
    expect(page.data.moreExpanded).toBe(false);
  });

  const tapStudents = () => page.onActionTap({ currentTarget: { dataset: { key: "students" } } });

  it("deduplicates navigation and leaves the menu unchanged while opening a page", async () => {
    await open();
    tapStudents();
    tapStudents();
    page.onMoreToggle();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(1);
    expect(page.data.moreExpanded).toBe(false);
  });

  it("allows retry after native navigation failure and synchronous exceptions", async () => {
    await open();
    tapStudents();
    (global as any).wx.navigateTo.mock.calls[0][0].fail({ errMsg: "internal details" });
    expect((global as any).wx.showToast).toHaveBeenCalledWith({
      title: "页面打开失败，请重试", icon: "none",
    });
    (global as any).wx.navigateTo.mockImplementationOnce(() => { throw new Error("internal details"); });
    expect(tapStudents).not.toThrow();
    tapStudents();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(3);
  });

  it("does not release a new navigation lock from an old failure callback", async () => {
    await open();
    tapStudents();
    const oldFailure = (global as any).wx.navigateTo.mock.calls[0][0].fail;
    page.onHide();
    page.onShow();
    await flush();
    tapStudents();
    oldFailure();
    tapStudents();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(2);
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });

  it.each(["onHide", "onUnload"])("ignores late navigation failures and login after %s", async (method) => {
    await open();
    tapStudents();
    const failure = (global as any).wx.navigateTo.mock.calls[0][0].fail;
    page[method]();
    failure();
    page.onLogin();
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
    expect((global as any).wx.reLaunch).not.toHaveBeenCalled();
  });

  it("does not display navigation failure after access is lost", async () => {
    await open();
    tapStudents();
    const failure = (global as any).wx.navigateTo.mock.calls[0][0].fail;
    loadProfile.mockResolvedValueOnce({ status: "error", statusCode: 403, message: "拒绝访问" });
    page.onRetry();
    await flush();
    failure();
    expect(page.data.viewState).toBe("forbidden");
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });

  const expectCleared = () => expect(page.data).toMatchObject({
    viewState: "forbidden", refreshError: "", displayName: "", identityLabel: "",
    campusName: "", campusNameCompact: false, campusNameFontSizeRpx: 54,
    campusNameHeightRpx: 63.72, campusCodeLabel: "", contactPhoneLabel: "",
    addressLabel: "", warningThresholdLabel: "", activeStudentCountLabel: "", moreExpanded: false,
  });

  it("creates the current service separately for every loaded instance", async () => {
    expect(createRuntime).not.toHaveBeenCalled();
    await open();
    const otherLoad = jest.fn().mockResolvedValue(success);
    createRuntime.mockReturnValueOnce({ loadProfile: otherLoad });
    const other = instantiate();
    other.onLoad(); other.onShow();
    await flush();
    expect(createRuntime).toHaveBeenCalledTimes(2);
    expect(otherLoad).toHaveBeenCalledTimes(1);
    expect(loadProfile).toHaveBeenCalledTimes(1);
    other.onUnload();
  });

  it.each(["onShow", "onRetry", "loadProfile", "onMoreToggle", "onActionTap"])(
    "clears private data and blocks the old session at %s", async (entry) => {
      await open();
      page.onMoreToggle();
      const reads = loadProfile.mock.calls.length;
      ownerKey = "synthetic-other-owner";
      await page[entry]({ currentTarget: { dataset: { key: "students" } } });
      await flush();
      expectCleared();
      expect(loadProfile).toHaveBeenCalledTimes(reads);
      expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
      page.onRetry(); page.onShow();
      await flush();
      expectCleared();
      expect(loadProfile).toHaveBeenCalledTimes(reads);
    },
  );

  it("checks ownership before the queued initial read and first show", async () => {
    page.onLoad();
    ownerKey = "synthetic-other-owner";
    page.onShow();
    await flush();
    expectCleared();
    expect(loadProfile).not.toHaveBeenCalled();
    expect(page.pendingRequest).toBeUndefined();
  });

  it("checks ownership when a refresh is queued before sending", async () => {
    await open();
    page.onMoreToggle();
    const reading = page.loadProfile();
    ownerKey = "synthetic-other-owner";
    await reading;
    expectCleared();
    expect(loadProfile).toHaveBeenCalledTimes(1);
  });

  it.each(["success", "empty", "error", "reject"])(
    "discards a late %s reply from another session", async (kind) => {
      await open();
      page.onMoreToggle();
      let resolve!: (value: unknown) => void;
      let reject!: (error: unknown) => void;
      loadProfile.mockReturnValueOnce(new Promise((done, fail) => { resolve = done; reject = fail; }));
      const reading = page.loadProfile();
      await flush();
      ownerKey = "synthetic-other-owner";
      if (kind === "reject") reject({ statusCode: 500 });
      else resolve(kind === "success" ? success : { status: kind, data: PARTNER_PROFILE_FIXTURE, message: "旧回复" });
      await reading;
      expectCleared();
      expect(page.pendingRequest).toBeUndefined();
      expect(page.navigating).toBe(false);
    },
  );

  it.each([401, 403])("invalidates locks for resolved HTTP %s", async (statusCode) => {
    await open();
    page.onMoreToggle();
    tapStudents();
    const requestSequence = page.requestSequence;
    const navigationSequence = page.navigationSequence;
    loadProfile.mockResolvedValueOnce({ status: "error", statusCode, message: "拒绝访问" });
    await page.loadProfile();
    expectCleared();
    expect(page.requestSequence).toBeGreaterThan(requestSequence + 1);
    expect(page.navigationSequence).toBeGreaterThan(navigationSequence);
    expect(page.navigating).toBe(false);
    expect(page.pendingRequest).toBeUndefined();
  });

  it.each([401, 403])("treats sync and rejected HTTP %s as lost access", async (statusCode) => {
    await open();
    for (const sync of [true, false]) {
      page.onRetry();
      await flush();
      expect(page.data.viewState).toBe("ready");
      page.onMoreToggle();
      expect(page.data.moreExpanded).toBe(true);
      tapStudents();
      expect(page.navigating).toBe(true);
      const error = { statusCode, message: "internal details" };
      loadProfile.mockImplementationOnce(() => {
        if (sync) throw error;
        return Promise.reject(error);
      });
      await page.loadProfile();
      expectCleared();
      expect(page.navigating).toBe(false);
      expect(page.pendingRequest).toBeUndefined();
      expect(page.data.errorMessage).not.toContain("internal details");
    }
  });

  it("keeps content and expanded menu on ordinary sync or rejected failure", async () => {
    await open();
    page.onMoreToggle();
    const previous = { ...page.data };
    for (const sync of [true, false]) {
      loadProfile.mockImplementationOnce(() => {
        if (sync) throw new Error("internal details");
        return Promise.reject(new Error("internal details"));
      });
      await page.loadProfile();
      expect(page.data).toMatchObject({ ...previous, refreshError: "合作方资料加载失败，请重试" });
    }
  });

  it("clears an old session on navigation failure without showing a toast", async () => {
    await open();
    page.onMoreToggle();
    tapStudents();
    const fail = (global as any).wx.navigateTo.mock.calls[0][0].fail;
    ownerKey = "synthetic-other-owner";
    fail();
    expectCleared();
    expect(page.navigating).toBe(false);
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });

  it("checks ownership before the navigation lock and on stale callbacks", async () => {
    await open();
    tapStudents();
    const fail = (global as any).wx.navigateTo.mock.calls[0][0].fail;
    page.onHide(); page.onShow();
    await flush();
    tapStudents();
    ownerKey = "synthetic-other-owner";
    fail();
    expectCleared();
    expect(page.navigating).toBe(false);
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });

  it("clears a changed owner even when a second action is blocked by navigation", async () => {
    await open();
    tapStudents();
    ownerKey = "synthetic-other-owner";
    tapStudents();
    expectCleared();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(1);
  });

  it.each(["fail", "throw"])("stops old reads before logout even if login navigation %s", async (failure) => {
    await open();
    page.onMoreToggle();
    const held = deferred();
    loadProfile.mockReturnValueOnce(held.promise);
    const reading = page.loadProfile();
    await flush();
    logout.mockImplementationOnce(() => {
      expectCleared();
      expect(page.runtime).toBeUndefined();
      expect(page.pendingRequest).toBeUndefined();
    });
    (global as any).wx.reLaunch.mockImplementationOnce((options: { fail?: () => void }) => {
      if (failure === "throw") throw new Error("native navigation failed");
      options.fail?.();
    });
    expect(() => page.onLogin()).not.toThrow();
    held.resolve(success);
    await reading;
    page.onShow(); page.onRetry(); page.onMoreToggle(); tapStudents();
    await page.loadProfile();
    expectCleared();
    expect(loadProfile).toHaveBeenCalledTimes(2);
    expect(logout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
  });

  it.each(["onHide", "onUnload"])("does not stop a pull after %s", async (method) => {
    const held = deferred();
    loadProfile.mockReturnValueOnce(held.promise);
    await open();
    page.onPullDownRefresh();
    page[method]();
    held.resolve(success);
    await flush();
    expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
  });

  it("isolates an old pull completion from a new pull after returning", async () => {
    await open();
    const old = deferred(), current = deferred();
    loadProfile.mockReturnValueOnce(old.promise);
    page.onPullDownRefresh();
    await flush();
    page.onHide(); page.onShow();
    loadProfile.mockReturnValueOnce(current.promise);
    page.onPullDownRefresh();
    await flush();
    old.resolve(success);
    await flush();
    expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
    expect(page.pendingRequest).toBeDefined();
    current.resolve(success);
    await flush();
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });

  it("preserves layout updates and ignores resize after unload", async () => {
    await open();
    (global as any).wx.getWindowInfo = () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 54 });
    page.onResize();
    expect(page.data.profileBodyHeightPx).toBe(Math.floor(812 - 58 - 48 - 42 * 375 / 750));
    page.onUnload();
    const writes = page.setData.mock.calls.length;
    page.onResize();
    expect(page.setData).toHaveBeenCalledTimes(writes);
  });
});
