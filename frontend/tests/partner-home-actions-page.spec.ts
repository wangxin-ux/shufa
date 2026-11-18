import * as fs from "fs";
import * as path from "path";

const loadDashboard = jest.fn();
const logout = jest.fn();
jest.mock("../services/partner-runtime", () => ({
  partnerService: { loadDashboard: () => loadDashboard() },
  createPartnerService: () => ({ loadDashboard: () => loadDashboard() }),
}));
jest.mock("../services/session.service", () => ({
  sessionService: { logout: () => logout() },
  createSessionService: () => ({ logout: () => logout() }),
}));
jest.mock("../pages/partner/runtime/partner-campaign-draft.service", () => ({
  getPartnerCampaignDraftService: () => ({ getSessionKey: () => "synthetic-home-owner" }),
}));

describe("partner home action visibility", () => {
  let page: any;
  const tap = (key = "students") =>
    page.onActionTap({ currentTarget: { dataset: { key } } });
  beforeEach(async () => {
    loadDashboard.mockReset().mockResolvedValue({ status: "error", message: "刷新失败" });
    logout.mockReset();
    (global as any).wx = {
      navigateTo: jest.fn(), showToast: jest.fn(), reLaunch: jest.fn(),
    };
    (global as any).Page = (definition: any) => {
      page = { ...definition, data: { ...definition.data } };
      page.setData = jest.fn((values: object) => Object.assign(page.data, values));
    };
    jest.isolateModules(() => require("../pages/partner/home/index"));
    page.onLoad();
    for (let index = 0; index < 20; index++) await Promise.resolve();
  });
  afterEach(() => {
    page.onUnload();
    delete (global as any).wx;
    delete (global as any).Page;
  });

  it.each(["loading", "error", "forbidden"])("blocks navigation in %s", (state) => {
    page.setData({ viewState: state });
    tap();
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
  });

  it.each(["onHide", "onUnload"])("blocks actions and login after %s", (method) => {
    page.setData({ viewState: "ready" });
    page[method]();
    tap();
    tap("application");
    page.onLogin();
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  it.each(["ready", "empty"])("allows one navigation at a time in %s", (state) => {
    page.setData({ viewState: state });
    tap();
    tap();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(1);
  });

  it("allows retry after a visible navigation failure", () => {
    page.setData({ viewState: "ready" });
    tap();
    (global as any).wx.navigateTo.mock.calls[0][0].fail();
    expect((global as any).wx.showToast).toHaveBeenCalledWith({
      title: "页面打开失败，请重试", icon: "none",
    });
    tap();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(2);
  });

  it("does not toast for a failure delivered after leaving", () => {
    page.setData({ viewState: "ready" });
    tap();
    page.onHide();
    (global as any).wx.navigateTo.mock.calls[0][0].fail();
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });

  it("ignores an old failure after returning without releasing a new navigation", () => {
    page.setData({ viewState: "ready" });
    tap();
    const oldFailure = (global as any).wx.navigateTo.mock.calls[0][0].fail;
    page.onHide();
    page.onShow();
    tap("teachers");
    oldFailure();
    tap();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(2);
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });

  it("recovers when navigation throws synchronously", () => {
    page.setData({ viewState: "ready" });
    (global as any).wx.navigateTo.mockImplementationOnce(() => {
      throw new Error("runtime failure");
    });
    expect(() => tap()).not.toThrow();
    tap();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(2);
  });
  it.each(["ready", "empty"])("toggles a full menu even when dashboard is %s", (state) => {
    page.setData({ viewState: state });
    page.onMenuToggle?.();
    expect(page.data.menuExpanded).toBe(true);
    expect(page.data.primaryMenuActions.map((item: any) => item.key)).toEqual([
      "students", "lesson-account", "teachers", "group-campaigns",
    ]);
    expect(page.data.secondaryMenuActions.map((item: any) => item.key)).toEqual([
      "operations", "earnings", "warnings", "attendance",
    ]);
    page.onMenuToggle?.();
    expect(page.data.menuExpanded).toBe(false);
  });

  it.each(["loading", "error", "forbidden"])("does not open the full menu in %s", (state) => {
    page.setData({ viewState: state });
    page.onMenuToggle?.();
    expect(page.data.menuExpanded).toBe(false);
  });

  it("closes the menu when returning and does not write after hiding", () => {
    page.setData({ viewState: "ready" });
    page.onMenuToggle?.();
    page.onHide();
    const writes = page.setData.mock.calls.length;
    page.onMenuToggle?.();
    page.onCloseMenu?.();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    page.onShow();
    expect(page.data.menuExpanded).toBe(false);
  });

  it.each(["students", "lesson-account", "teachers", "group-campaigns", "operations", "earnings", "warnings", "attendance", "profile"])(
    "routes the menu entry %s to its existing partner page",
    (key) => {
      page.setData({ viewState: "ready", menuExpanded: true });
      tap(key);
      expect((global as any).wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
        url: `/pages/partner/${key}/index`,
      }));
      expect(page.data.menuExpanded).toBe(false);
    },
  );

  it("uses a scrollable menu and sends the visible more link to students", () => {
    const markup = fs.readFileSync(path.resolve(__dirname, "../pages/partner/home/index.wxml"), "utf8");
    expect(markup).toContain('bindtap="onMenuToggle"');
    expect(markup).toContain('bindtap="onCloseMenu"');
    expect(markup).toMatch(/<scroll-view[^>]+class="home-menu__body"[^>]+scroll-y/);
    expect(markup).toMatch(/class="home__more"[\s\S]*?data-key="students"/);
  });

  it.each([401, 403])("closes the menu on HTTP %s without keeping account data", async (statusCode) => {
    page.setData({ viewState: "ready", menuExpanded: true, campusName: "旧校区" });
    loadDashboard.mockResolvedValueOnce({ status: "error", statusCode, message: "无权限" });
    await page.loadHome(true);
    expect(page.data).toMatchObject({ viewState: "forbidden", menuExpanded: false, campusName: "" });
  });

  it("opens the restricted basic draft page from the application entry", () => {
    page.setData({ viewState: "ready", menuExpanded: true });
    tap("application");
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: "/pages/partner/application/index",
    }));
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
    expect(page.data.menuExpanded).toBe(false);
  });
});
