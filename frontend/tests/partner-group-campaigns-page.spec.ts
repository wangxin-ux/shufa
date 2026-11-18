import * as fs from "fs";
import * as path from "path";
import { GROUP_PROMOTION_CAMPAIGN_FIXTURE } from "../mock/fixtures/group-promotion.fixture";

const loadCampaigns = jest.fn();
const logout = jest.fn();
const loadDrafts = jest.fn();
const loadPublished = jest.fn();
let draftOwner = "synthetic-owner";
jest.mock("../pages/partner/runtime/free-campaign.service", () => ({
  ...jest.requireActual("../pages/partner/runtime/free-campaign.service"),
  getPartnerFreeCampaignService: () => ({
    published: (page: number, phase: string) => loadPublished(page, phase),
    getSessionKey: () => draftOwner,
  }),
}));
jest.mock("../pages/partner/runtime/partner-campaign-draft.service", () => ({
  ...jest.requireActual("../pages/partner/runtime/partner-campaign-draft.service"),
  getPartnerCampaignDraftService: () => ({
    list: (...args: unknown[]) => loadDrafts(...args), getSessionKey: () => draftOwner,
  }),
}));
jest.mock("../services/partner-runtime", () => ({
  createPartnerService: () => ({ loadGroupPromotionCampaigns: (query: unknown) => loadCampaigns(query) }),
}));
jest.mock("../pages/partner/runtime/campaign-session-runtime", () => ({
  logoutPartnerCampaignSession: () => logout(),
}));

const response = (ids = ["campaign-1"], page = 1, totalPages = 2) => ({
  status: ids.length ? "success" : "empty",
  data: {
    data: ids.map((id) => ({ ...GROUP_PROMOTION_CAMPAIGN_FIXTURE, id, canPromote: true })),
    meta: { page, pageSize: 20, total: totalPages * 20, totalPages },
  },
});
const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => { resolve = done; });
  return { resolve, promise };
};

describe("partner activity list request lifecycle", () => {
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
    loadCampaigns.mockReset().mockResolvedValue(response());
    logout.mockReset();
    draftOwner = "synthetic-owner";
    loadPublished.mockReset().mockResolvedValue({
      data: [{
        campaignId: "free-1", versionId: "approved-1", draftId: "draft-free-1", sequence: 1,
        title: "批准免费体验", startsAt: "2026-10-13T00:00:00.000Z", endsAt: "2099-10-14T00:00:00.000Z",
        timezone: "Asia/Shanghai", availability: "AVAILABLE", registeredCount: 1,
        maxRegistrations: 2, remainingRegistrations: 1,
      }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    loadDrafts.mockReset().mockResolvedValue({
      data: [{
        draftId: "00000000-0000-4000-8000-000000000001", title: null, campaignType: null,
        status: "DRAFT", version: 1, createdAt: "2026-10-13T00:00:00.000Z", updatedAt: "2026-10-13T00:00:00.000Z",
        latestSubmission: null, lifecycle: null,
      }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    (global as any).wx = {
      navigateTo: jest.fn(), reLaunch: jest.fn(), stopPullDownRefresh: jest.fn(),
    };
    (global as any).Page = (config: any) => { definition = config; };
    jest.isolateModules(() => require("../pages/partner/group-campaigns/index"));
    page = instantiate();
  });
  afterEach(() => {
    page.onUnload?.();
    delete (global as any).Page;
    delete (global as any).wx;
  });

  it("deduplicates load/show and simultaneous refresh requests", async () => {
    const pending = deferred();
    loadCampaigns.mockReturnValueOnce(pending.promise);
    await open();
    page.onPullDownRefresh();
    page.onPullDownRefresh();
    await flush();
    expect(loadCampaigns).toHaveBeenCalledTimes(1);
    pending.resolve(response());
    await flush();
    expect(page.data.viewState).toBe("ready");
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });

  it.each(["onHide", "onUnload"])("does not start queued work after %s", async (method) => {
    page.onLoad();
    page[method]?.();
    await flush();
    expect(loadCampaigns).not.toHaveBeenCalled();
  });

  it.each(["onHide", "onUnload"])("discards late responses after %s", async (method) => {
    const pending = deferred();
    loadCampaigns.mockReturnValueOnce(pending.promise);
    await open();
    page[method]?.();
    const writes = page.setData.mock.calls.length;
    pending.resolve(response());
    await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    if (method === "onHide") {
      page.onShow?.();
      await flush();
      expect(loadCampaigns).toHaveBeenCalledTimes(2);
      expect(page.data.viewState).toBe("ready");
    }
  });

  it("isolates concurrent page instances", async () => {
    const pending = deferred();
    loadCampaigns.mockReturnValueOnce(pending.promise);
    await open();
    const first = page;
    page = instantiate();
    await open();
    pending.resolve(response(["first-instance"]));
    await flush();
    expect(first.data.campaigns[0].id).toBe("first-instance");
    expect(page.data.campaigns[0].id).toBe("campaign-1");
    first.onUnload?.();
  });

  it("preserves a ready list on refresh failure and blocks pagination until retry", async () => {
    await open();
    const previous = page.data.campaigns;
    loadCampaigns.mockResolvedValueOnce({ status: "error", message: "刷新失败", statusCode: 500 });
    await page.load(true);
    expect(page.data).toMatchObject({
      viewState: "ready", campaigns: previous, page: 1, refreshError: "刷新失败",
    });
    await page.load(false);
    expect(loadCampaigns).toHaveBeenCalledTimes(2);
    page.onRetry();
    await flush();
    expect(page.data.refreshError).toBe("");
  });

  it("preserves an empty result on refresh failure", async () => {
    loadCampaigns.mockResolvedValueOnce(response([], 1, 0));
    await open();
    loadCampaigns.mockResolvedValueOnce({ status: "error", message: "刷新失败", statusCode: 500 });
    await page.load(true);
    expect(page.data).toMatchObject({ viewState: "empty", campaigns: [], refreshError: "刷新失败" });
  });

  it("retries the failed next page without losing records or duplicating IDs", async () => {
    await open();
    loadCampaigns.mockResolvedValueOnce({ status: "error", message: "下一页失败", statusCode: 500 });
    await page.load(false);
    expect(page.data).toMatchObject({ viewState: "ready", page: 1, paginationError: "下一页失败" });
    expect(page.data.campaigns).toHaveLength(1);
    loadCampaigns.mockResolvedValueOnce(response(["campaign-1", "campaign-2", "campaign-2"], 2, 2));
    page.onRetryMore?.();
    await flush();
    expect(loadCampaigns).toHaveBeenLastCalledWith({ page: 2, pageSize: 20, phase: "ONGOING" });
    expect(page.data.campaigns.map((item: any) => item.id)).toEqual(["campaign-1", "campaign-2"]);
    expect(page.data).toMatchObject({ page: 2, paginationError: "", hasMore: false });
  });

  it("lets a refresh supersede a pending next page", async () => {
    await open();
    const pending = deferred();
    loadCampaigns.mockReturnValueOnce(pending.promise);
    void page.load(false);
    await flush();
    loadCampaigns.mockResolvedValueOnce(response(["fresh"]));
    await page.load(true);
    pending.resolve(response(["stale"], 2, 2));
    await flush();
    expect(page.data.campaigns.map((item: any) => item.id)).toEqual(["fresh"]);
    expect(page.data.page).toBe(1);
  });

  it.each([401, 403])("clears cached campaigns and returns to login on HTTP %s", async (statusCode) => {
    await open();
    loadCampaigns.mockResolvedValueOnce({ status: "error", message: "拒绝访问", statusCode });
    await page.load(false);
    expect(page.data).toMatchObject({
      viewState: "forbidden", campaigns: [], page: 0, hasMore: false,
      loadingMore: false, refreshError: "", paginationError: "",
    });
    page.onLogin?.();
    expect(logout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: "/pages/bootstrap/index" }));
  });

  it("catches rejected requests and allows an explicit retry", async () => {
    loadCampaigns.mockRejectedValueOnce(new Error("internal details"));
    await expect(page.load(true)).resolves.toBeUndefined();
    expect(page.data.viewState).toBe("error");
    expect(page.data.errorMessage).not.toContain("internal details");
    page.onRetry();
    await flush();
    expect(page.data.viewState).toBe("ready");
  });

  it("clears the previous list when a refresh returns empty", async () => {
    await open();
    loadCampaigns.mockResolvedValueOnce(response([], 1, 0));
    await page.load(true);
    expect(page.data).toMatchObject({ viewState: "empty", campaigns: [], hasMore: false });
  });

  it("only navigates a visible ready campaign that belongs to the loaded list", async () => {
    const tap = (id: string) => page.onOpen({ currentTarget: { dataset: { id } } });
    tap("campaign-1");
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
    await open();
    tap("unknown");
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
    tap("campaign-1");
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: "/pages/partner/group-detail/index?id=campaign-1",
    }));
    page.onHide?.();
    tap("campaign-1");
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(1);
  });

  describe("first legacy list session and navigation protection", () => {
    const tap = () => page.onOpen({ currentTarget: { dataset: { id: "campaign-1" } } });
    it("clears the initial legacy rows before returning under a replaced account", async () => {
      await open();
      page.onHide();
      draftOwner = "different-owner";
      page.onShow();
      expect(page.data).toMatchObject({ viewState: "forbidden", campaigns: [], drafts: [], freeCampaigns: [],
        page: 0, hasMore: false, loadingMore: false });
      await flush();
      expect(loadCampaigns).toHaveBeenCalledTimes(1);
    });
    it("does not send the queued first legacy read using a replacement account", async () => {
      page.onLoad();
      draftOwner = "different-owner";
      await flush();
      expect(loadCampaigns).not.toHaveBeenCalled();
      expect(page.data).toMatchObject({ viewState: "forbidden", campaigns: [], page: 0 });
    });
    it("rejects a successful legacy response from the replaced request owner", async () => {
      const pending = deferred();
      loadCampaigns.mockReturnValueOnce(pending.promise);
      await open();
      draftOwner = "different-owner";
      pending.resolve(response(["previous-campus"]));
      await flush();
      expect(page.data).toMatchObject({ viewState: "forbidden", campaigns: [], page: 0, hasMore: false });
    });
    it.each(["open", "create", "phase", "kind", "refresh", "more"])("clears the first legacy list before a changed-owner %s command", async (command) => {
      await open();
      draftOwner = "different-owner";
      if (command === "open") tap();
      else if (command === "create") page.onCreate();
      else if (command === "phase") page.onPhaseTap({ currentTarget: { dataset: { phase: "ENDED" } } });
      else if (command === "kind") page.onCampaignKindChange({ detail: { value: "4" } });
      else await page.load(command === "refresh");
      await flush();
      expect(page.data).toMatchObject({ viewState: "forbidden", campaigns: [], drafts: [], freeCampaigns: [],
        phase: "ONGOING", page: 0, hasMore: false });
      expect(loadCampaigns).toHaveBeenCalledTimes(1);
      expect(loadDrafts).not.toHaveBeenCalled();
      expect(loadPublished).not.toHaveBeenCalled();
      expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
    });
    it("deduplicates legacy detail and create commands, then allows retry after a navigation failure", async () => {
      await open();
      tap(); tap(); page.onCreate();
      const navigate = (global as any).wx.navigateTo;
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate.mock.calls[0][0].url).toBe("/pages/partner/group-detail/index?id=campaign-1");
      navigate.mock.calls[0][0].fail({});
      expect(page.data.refreshError).toBe("活动详情打开失败，请重试");
      tap();
      expect(navigate).toHaveBeenCalledTimes(2);
    });
    it("recovers from a synchronous legacy navigation exception", async () => {
      await open();
      const navigate = (global as any).wx.navigateTo;
      navigate.mockImplementationOnce(() => { throw Error("synthetic navigation failure"); });
      expect(tap).not.toThrow();
      expect(page.data.refreshError).toBe("活动详情打开失败，请重试");
      tap();
      expect(navigate).toHaveBeenCalledTimes(2);
    });
    it("ignores a previous navigation failure after returning and preserves the new navigation lock", async () => {
      await open();
      const navigate = (global as any).wx.navigateTo;
      tap();
      const previous = navigate.mock.calls[0][0];
      page.onHide(); page.onShow(); await flush();
      tap();
      const current = navigate.mock.calls[1][0], writes = page.setData.mock.calls.length;
      previous.fail({});
      expect(page.setData).toHaveBeenCalledTimes(writes);
      tap(); page.onCreate();
      expect(navigate).toHaveBeenCalledTimes(2);
      current.fail({});
      tap();
      expect(navigate).toHaveBeenCalledTimes(3);
    });
    it.each(["onHide", "onUnload"])("ignores a late legacy navigation failure after %s", async (method) => {
      await open();
      tap();
      const previous = (global as any).wx.navigateTo.mock.calls[0][0];
      page[method]();
      const writes = page.setData.mock.calls.length;
      previous.fail({});
      expect(page.setData).toHaveBeenCalledTimes(writes);
    });
    it.each([false, true])("clears a replaced owner's navigation failure after prior validation=%s", async (validated) => {
      await open();
      tap();
      const previous = (global as any).wx.navigateTo.mock.calls[0][0];
      draftOwner = "different-owner";
      if (validated) page.onCreate();
      const writes = page.setData.mock.calls.length;
      previous.fail({});
      expect(page.data).toMatchObject({ viewState: "forbidden", campaigns: [], drafts: [], freeCampaigns: [],
        refreshError: "", page: 0, hasMore: false });
      expect(page.draftNavigationPending).toBe(false);
      if (validated) expect(page.setData).toHaveBeenCalledTimes(writes);
      expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps refresh, next-page retry and login controls separate", () => {
    const markup = fs.readFileSync(path.resolve(__dirname, "../pages/partner/group-campaigns/index.wxml"), "utf8");
    expect(markup).toContain('wx:if="{{refreshError}}"');
    expect(markup).toContain('wx:if="{{paginationError}}"');
    expect(markup).toContain('bindtap="onRetryMore"');
    expect(markup).toContain('bindtap="onLogin"');
  });

  it("switches phase with fresh pagination and ignores the previous phase response", async () => {
    const previous = deferred();
    loadCampaigns.mockReturnValueOnce(previous.promise);
    await open();
    expect(typeof page.onPhaseTap).toBe("function");
    page.onPhaseTap({ currentTarget: { dataset: { phase: "ENDED" } } });
    await flush();
    expect(loadCampaigns).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, phase: "ENDED" });
    expect(page.data).toMatchObject({ phase: "ENDED", page: 1 });
    previous.resolve(response(["stale-ongoing"]));
    await flush();
    expect(page.data.campaigns.map((item: any) => item.id)).not.toContain("stale-ongoing");
    await page.load(false);
    expect(loadCampaigns).toHaveBeenLastCalledWith({ page: 2, pageSize: 20, phase: "ENDED" });
  });

  it("does not change phase for unknown, repeated or hidden commands", async () => {
    await open();
    expect(typeof page.onPhaseTap).toBe("function");
    page.onPhaseTap({ currentTarget: { dataset: { phase: "UNKNOWN" } } });
    page.onPhaseTap({ currentTarget: { dataset: { phase: "ONGOING" } } });
    page.onHide();
    page.onPhaseTap({ currentTarget: { dataset: { phase: "ENDED" } } });
    await flush();
    expect(loadCampaigns).toHaveBeenCalledTimes(1);
    expect(page.data.phase).toBe("ONGOING");
  });

  it("keeps ended history visible on refresh failure and retries its original phase", async () => {
    await open();
    expect(typeof page.onPhaseTap).toBe("function");
    page.onPhaseTap({ currentTarget: { dataset: { phase: "ENDED" } } });
    await flush();
    const previous = page.data.campaigns;
    loadCampaigns.mockResolvedValueOnce({ status: "error", statusCode: 500, message: "网络失败" });
    await page.load(true);
    expect(page.data.campaigns).toBe(previous);
    expect(page.data.refreshError).toBe("网络失败");
    page.onRetry();
    await flush();
    expect(loadCampaigns).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, phase: "ENDED" });
  });

  it.each(["success", "unauthorized"])("rejects the old second-page %s response after changing phase", async (status) => {
    await open();
    const previous = deferred();
    loadCampaigns.mockReturnValueOnce(previous.promise);
    void page.load(false);
    await flush();
    const ended = response(["ended"], 1, 1);
    ended.data.data[0].canPromote = false;
    loadCampaigns.mockResolvedValueOnce(ended);
    page.onPhaseTap({ currentTarget: { dataset: { phase: "ENDED" } } });
    await flush();
    previous.resolve(status === "success" ? response(["old-second-page"], 2)
      : { status: "error", statusCode: 401, message: "旧会话失效" });
    await flush();
    expect(page.data).toMatchObject({
      phase: "ENDED", viewState: "ready", page: 1, hasMore: false,
      loadingMore: false, errorMessage: "", paginationError: "",
    });
    expect(page.data.campaigns.map((item: any) => item.id)).toEqual(["ended"]);
    expect(page.data.campaigns[0].canPromote).toBe(false);
    expect(page.pendingRequest).toBeUndefined();
  });

  it.each([401, 403])("clears ended history after its current request returns %i", async (statusCode) => {
    await open();
    page.onPhaseTap({ currentTarget: { dataset: { phase: "ENDED" } } });
    await flush();
    loadCampaigns.mockResolvedValueOnce({ status: "error", statusCode, message: "无权限" });
    await page.load(true);
    expect(page.data).toMatchObject({
      phase: "ENDED", viewState: "forbidden", campaigns: [],
      page: 0, hasMore: false, loadingMore: false,
    });
  });

  it("loads private drafts separately and opens only their editor", async () => {
    await open();
    page.onPhaseTap({ currentTarget: { dataset: { phase: "DRAFT" } } });
    await flush();
    expect(loadDrafts).toHaveBeenCalledWith(1);
    expect(loadCampaigns).toHaveBeenCalledTimes(1);
    expect(page.data.campaigns).toEqual([]);
    expect(page.data.drafts[0]).toMatchObject({ titleLabel: "未命名活动", typeLabel: "未选类型" });
    page.onOpen({ currentTarget: { dataset: { id: page.data.drafts[0].draftId } } });
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: "/pages/partner/campaign-editor/index?id=00000000-0000-4000-8000-000000000001",
    }));
  });
  it("provides a deduplicated create entry and recovers failed navigation", async () => {
    await open();
    page.onCreate();
    page.onCreate();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(1);
    (global as any).wx.navigateTo.mock.calls[0][0].fail({});
    page.onCreate();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(2);
  });
  const activityTypes = [
    ["REGULAR_GROUP", "常规拼团"],
    ["MULTI_SPEC_GROUP", "多规格拼团"],
    ["FLASH_SALE", "限时秒杀"],
    ["MULTI_SPEC_REGISTRATION_FEE", "多规格报名费"],
    ["FREE_REGISTRATION", "免费报名"],
  ];
  it.each(activityTypes)("creates %s through the same editor with its selected type", async (type, label) => {
    await open();
    const index = activityTypes.findIndex(([value]) => value === type);
    expect(page.data.campaignKinds).toEqual(activityTypes.map(([, name]) => name));
    page.onCampaignKindChange({ detail: { value: String(index) } });
    await flush();
    page.onCreate();
    expect(page.data.campaignKinds[page.data.campaignKindIndex]).toBe(label);
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: `/pages/partner/campaign-editor/index?type=${type}`,
    }));
  });
  it.each(["1", "2", "3"])("keeps unpublished type %s private without querying another type's activities", async (index) => {
    await open();
    page.onCampaignKindChange({ detail: { value: index } });
    await flush();
    expect(page.data).toMatchObject({
      viewState: "draftOnly", campaigns: [], drafts: [], freeCampaigns: [], hasMore: false,
    });
    page.onPhaseTap({ currentTarget: { dataset: { phase: "ENDED" } } });
    page.onHide();
    page.onShow();
    await flush();
    expect(loadCampaigns).toHaveBeenCalledTimes(1);
    expect(loadPublished).not.toHaveBeenCalled();
    page.onPhaseTap({ currentTarget: { dataset: { phase: "DRAFT" } } });
    await flush();
    expect(loadDrafts).toHaveBeenCalledWith(1);
    expect(page.data.drafts[0].draftId).toBeTruthy();
    page.onCreate();
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: `/pages/partner/campaign-editor/index?type=${activityTypes[Number(index)][0]}`,
    }));
  });
  it.each(activityTypes)("filters %s drafts and creates in the same category", async (type) => {
    await open();
    page.onPhaseTap({ currentTarget: { dataset: { phase: "DRAFT" } } });
    await flush();
    page.onCampaignKindChange({ detail: { value: String(activityTypes.findIndex(([value]) => value === type) + 1) } });
    await flush();
    expect(loadDrafts).toHaveBeenLastCalledWith(1, type);
    expect(page.data.draftKinds).toEqual(["全部", ...activityTypes.map(([, label]) => label)]);
    page.onCreate();
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: `/pages/partner/campaign-editor/index?type=${type}`,
    }));
  });
  it("keeps a draft category during pagination, retry and phase return, then restores all drafts", async () => {
    await open();
    page.onPhaseTap({ currentTarget: { dataset: { phase: "DRAFT" } } });
    await flush();
    page.onCampaignKindChange({ detail: { value: "3" } });
    await flush();
    page.setData({ hasMore: true });
    loadDrafts.mockRejectedValueOnce({ statusCode: 503 });
    await page.load(false);
    expect(loadDrafts).toHaveBeenLastCalledWith(2, "FLASH_SALE");
    expect(page.data).toMatchObject({ page: 1, viewState: "ready" });
    page.onRetryMore();
    await flush();
    expect(loadDrafts).toHaveBeenLastCalledWith(2, "FLASH_SALE");
    page.onPhaseTap({ currentTarget: { dataset: { phase: "ENDED" } } });
    await flush();
    expect(loadCampaigns).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, phase: "ENDED" });
    page.onPhaseTap({ currentTarget: { dataset: { phase: "DRAFT" } } });
    await flush();
    expect(loadDrafts).toHaveBeenLastCalledWith(1, "FLASH_SALE");
    page.onCampaignKindChange({ detail: { value: "0" } });
    await flush();
    expect(loadDrafts).toHaveBeenLastCalledWith(1);
  });
  it.each([200, 403])("ignores a previous draft category's late %s response", async (statusCode) => {
    await open();
    page.onPhaseTap({ currentTarget: { dataset: { phase: "DRAFT" } } });
    await flush();
    const old = deferred();
    loadDrafts.mockReturnValueOnce(old.promise);
    void page.load(true);
    await flush();
    page.onCampaignKindChange({ detail: { value: "5" } });
    expect(page.data.drafts).toEqual([]);
    await flush();
    const current = page.data.drafts;
    old.resolve(statusCode === 200
      ? { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }
      : Promise.reject({ statusCode }));
    await flush();
    expect(page.data).toMatchObject({ draftKindIndex: 5, viewState: "ready", drafts: current });
    expect(loadDrafts).toHaveBeenLastCalledWith(1, "FREE_REGISTRATION");
  });
  it.each(["-1", "5", "1.5", "", " 1", "01"])("ignores invalid category %s", async (value) => {
    await open();
    page.onCampaignKindChange({ detail: { value } });
    await flush();
    expect(page.data.campaignKindIndex).toBe(0);
    expect(loadCampaigns).toHaveBeenCalledTimes(1);
  });
  it.each([
    [null, 1, null, "未送审", ""],
    ["SUBMITTED", 2, "OPEN", "第1版 · 待审核", ""],
    ["APPROVED", 2, "OPEN", "第1版 · 已批准", ""],
    ["APPROVED", 3, "OPEN", "第1版 · 已批准", "草稿有后续修改，尚未送审"],
    ["REJECTED", 3, "OPEN", "第1版 · 已驳回", "草稿有后续修改，尚未送审"],
    ["SUBMITTED", 3, "OPEN", "第1版 · 待审核", "草稿有后续修改，尚未送审"],
    ["APPROVED", 2, "CLOSED", "第1版 · 已批准", ""],
  ])("shows latest %s independently of draft version %s and lifecycle %s", async (status, version, lifecycle, reviewLabel, revisionLabel) => {
    const row = {
      draftId: "00000000-0000-4000-8000-000000000001", title: "活动草稿", campaignType: "FREE_REGISTRATION",
      status: "DRAFT", createdAt: "2026-10-13T00:00:00.000Z", updatedAt: "2026-10-13T00:00:00.000Z",
    };
    loadDrafts.mockResolvedValueOnce({
      data: [{ ...row, version, lifecycle, latestSubmission: status ? {
        sequence: 1, sourceDraftVersion: 2, status, reviewReason: status === "REJECTED" ? "请补充说明" : null,
      } : null }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    await open();
    page.onPhaseTap({ currentTarget: { dataset: { phase: "DRAFT" } } });
    await flush();
    expect(page.data.drafts[0]).toMatchObject({
      reviewLabel, revisionLabel, closed: lifecycle === "CLOSED",
      reviewReason: status === "REJECTED" ? "请补充说明" : "",
    });
    expect(loadDrafts).toHaveBeenCalledTimes(1);
    const template = fs.readFileSync(path.join(__dirname, "../pages/partner/group-campaigns/index.wxml"), "utf8");
    expect(template).toContain("{{item.reviewLabel}}");
    expect(template).toContain("{{item.revisionLabel}}");
    expect(template).toContain("{{item.reviewReason}}");
    expect(template).toContain("{{item.closed}}");
  });
  it("clears private drafts before showing a changed owner and ignores its old response", async () => {
    await open();
    page.onPhaseTap({ currentTarget: { dataset: { phase: "DRAFT" } } });
    await flush();
    const pending = deferred();
    loadDrafts.mockReturnValueOnce(pending.promise);
    page.load(true);
    await flush();
    page.onHide();
    draftOwner = "different-owner";
    page.onShow();
    await flush();
    expect(page.data.drafts).toEqual([]);
    pending.resolve({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    await flush();
    expect(page.data.drafts).toEqual([]);
  });
  it.each([true, false])("clears another owner's private rows before a direct reset=%s load", async (reset) => {
    await open();
    page.onPhaseTap({ currentTarget: { dataset: { phase: "DRAFT" } } });
    await flush();
    page.setData({ hasMore: true });
    draftOwner = "different-owner";
    const pending = deferred();
    loadDrafts.mockReturnValueOnce(pending.promise);
    page.load(reset);
    expect(page.data.drafts).toEqual([]);
    expect(page.data).toMatchObject({ page: 0, hasMore: false });
    pending.resolve({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    await flush();
    expect(page.data.drafts).toEqual([]);
  });
  it("releases a failed editor navigation independently of list refresh and phase changes", async () => {
    await open();
    page.onCreate();
    const previous = (global as any).wx.navigateTo.mock.calls[0][0];
    await page.load(true);
    page.onPhaseTap({ currentTarget: { dataset: { phase: "ENDED" } } });
    await flush();
    previous.fail({});
    page.onCreate();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(2);
  });
  const selectFree = (page: any) => {
    expect(typeof page.onCampaignKindChange).toBe("function");
    page.onCampaignKindChange({ detail: { value: "4" } });
  };
  it("loads frozen free activities separately and opens only their authenticated management draft", async () => {
    await open();
    selectFree(page);
    await flush();
    expect(loadPublished).toHaveBeenCalledWith(1, "ONGOING");
    expect(page.data.campaigns).toEqual([]);
    expect(page.data.freeCampaigns[0]).toMatchObject({
      title: "批准免费体验", statusLabel: "可报名", sequenceLabel: "第1版 · 已批准",
    });
    page.onOpen({ currentTarget: { dataset: { id: "unknown" } } });
    page.onOpen({ currentTarget: { dataset: { id: "free-1" } } });
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: "/pages/partner/campaign-editor/index?id=draft-free-1",
    }));
  });
  it("keeps the type across phase, private draft, hide/show and GET retry", async () => {
    await open();
    selectFree(page);
    await flush();
    page.onPhaseTap({ currentTarget: { dataset: { phase: "ENDED" } } });
    await flush();
    expect(loadPublished).toHaveBeenLastCalledWith(1, "ENDED");
    loadPublished.mockRejectedValueOnce({ statusCode: 500 });
    await page.load(true);
    expect(page.data).toMatchObject({ viewState: "ready", page: 1 });
    expect(page.data.refreshError).not.toBe("");
    page.onRetry();
    await flush();
    page.onPhaseTap({ currentTarget: { dataset: { phase: "DRAFT" } } });
    await flush();
    page.onPhaseTap({ currentTarget: { dataset: { phase: "ONGOING" } } });
    await flush();
    page.onHide();
    page.onShow();
    await flush();
    expect(loadPublished).toHaveBeenLastCalledWith(1, "ONGOING");
    expect(loadCampaigns).toHaveBeenCalledTimes(1);
  });
  it("clears old rows and ignores late free success or forbidden replies after switching type", async () => {
    await open();
    selectFree(page);
    await flush();
    for (const statusCode of [200, 403]) {
      const pending = deferred();
      loadPublished.mockReturnValueOnce(pending.promise);
      void page.load(true);
      await flush();
      page.onCampaignKindChange({ detail: { value: "0" } });
      expect(page.data.freeCampaigns).toEqual([]);
      await flush();
      pending.resolve(statusCode === 200 ? { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } :
        Promise.reject({ statusCode }));
      await flush();
      expect(page.data.viewState).toBe("ready");
      expect(page.data.campaigns).toHaveLength(1);
      selectFree(page);
      await flush();
    }
  });
  it.each([401, 403])("clears owned published rows on current %s", async (statusCode) => {
    await open();
    selectFree(page);
    await flush();
    loadPublished.mockRejectedValueOnce({ statusCode });
    await page.load(true);
    expect(page.data).toMatchObject({
      viewState: "forbidden", freeCampaigns: [], campaigns: [], drafts: [], page: 0, hasMore: false,
    });
  });
  it("clears free data after identity replacement even when the user switches to legacy", async () => {
    await open();
    selectFree(page);
    await flush();
    draftOwner = "different-owner";
    page.onCampaignKindChange({ detail: { value: "0" } });
    await flush();
    expect(page.data).toMatchObject({ viewState: "forbidden", freeCampaigns: [], campaigns: [], drafts: [] });
    expect(loadCampaigns).toHaveBeenCalledTimes(1);
  });
  it("paginates free results, retries the failed page and deduplicates campaign IDs", async () => {
    await open();
    const initial = await loadPublished(1, "ONGOING");
    loadPublished.mockResolvedValueOnce({
      ...initial, meta: { page: 1, pageSize: 20, total: 21, totalPages: 2 },
    });
    selectFree(page);
    await flush();
    loadPublished.mockRejectedValueOnce({ statusCode: 500 });
    await page.load(false);
    expect(page.data).toMatchObject({ page: 1, hasMore: true });
    expect(page.data.paginationError).not.toBe("");
    const first = page.data.freeCampaigns[0];
    loadPublished.mockResolvedValueOnce({
      data: [first, { ...first, campaignId: "free-2" }],
      meta: { page: 2, pageSize: 20, total: 21, totalPages: 2 },
    });
    page.onRetryMore();
    await flush();
    expect(loadPublished).toHaveBeenLastCalledWith(2, "ONGOING");
    expect(page.data.freeCampaigns.map((item: any) => item.campaignId)).toEqual(["free-1", "free-2"]);
    expect(page.data.hasMore).toBe(false);
  });
  it("uses a native type selector and frozen version rows without a parent registration action", () => {
    const markup = fs.readFileSync(path.resolve(__dirname, "../pages/partner/group-campaigns/index.wxml"), "utf8");
    expect(markup).toContain('id="campaign-kind"');
    expect(markup).toContain('bindchange="onCampaignKindChange"');
    expect(markup).toContain('wx:for="{{freeCampaigns}}"');
    expect(markup).toContain("{{item.sequenceLabel}}");
    expect(markup).not.toContain('bindtap="onRegister"');
  });
});
