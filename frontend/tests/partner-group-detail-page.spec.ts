import * as fs from "fs";
import * as path from "path";
import { GROUP_PROMOTION_CAMPAIGN_FIXTURE } from "../mock/fixtures/group-promotion.fixture";

const loadDetail = jest.fn();
const logout = jest.fn();
let detailOwner = "synthetic-owner";
jest.mock("../pages/partner/runtime/partner-campaign-draft.service", () => ({
  getPartnerCampaignDraftService: () => ({ getSessionKey: () => detailOwner }),
}));
jest.mock("../services/partner-runtime", () => ({
  createPartnerService: () => ({
    loadGroupPromotionCampaign: (id: string) => loadDetail(id),
  }),
}));
jest.mock("../pages/partner/runtime/campaign-session-runtime", () => ({
  logoutPartnerCampaignSession: () => logout(),
}));
const response = () => ({
  status: "success",
  data: { ...GROUP_PROMOTION_CAMPAIGN_FIXTURE, canPromote: true },
});
const posterResponse = () => ({
  ...response(),
  data: {
    ...response().data,
    posterImages: [
      {
        id: "current-poster",
        accessUrl: "https://example.test/current-poster.png",
        width: 750,
        height: 1125,
        mimeType: "image/png",
        sortOrder: 0,
      },
    ],
  },
});
const posterTap = () => ({
  currentTarget: {
    dataset: { url: posterResponse().data.posterImages[0].accessUrl },
  },
});
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { resolve, promise };
};

describe("partner activity detail lifecycle and poster callbacks", () => {
  let page: any;
  let definition: any;
  let canvas: any;
  const flush = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };
  const instantiate = () => {
    const instance = { ...definition, data: { ...definition.data } };
    instance.setData = jest.fn((values: object) =>
      Object.assign(instance.data, values),
    );
    return instance;
  };
  const open = async () => {
    page.onLoad({ id: GROUP_PROMOTION_CAMPAIGN_FIXTURE.id });
    page.onShow?.();
    await flush();
  };
  const generate = async () => {
    page.onOpenPoster();
    jest.advanceTimersByTime(50);
    await flush();
  };
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-09-15T00:00:00.000Z") });
    loadDetail.mockReset().mockResolvedValue(response());
    logout.mockReset();
    detailOwner = "synthetic-owner";
    canvas = Object.fromEntries(
      [
        "setFillStyle",
        "fillRect",
        "setFontSize",
        "fillText",
        "setStrokeStyle",
        "setLineWidth",
        "strokeRect",
        "drawImage",
      ].map((key) => [key, jest.fn()]),
    );
    canvas.measureText = () => ({ width: 100 });
    canvas.draw = jest.fn();
    (global as any).wx = {
      stopPullDownRefresh: jest.fn(),
      reLaunch: jest.fn(),
      showToast: jest.fn(),
      previewImage: jest.fn(),
      setClipboardData: jest.fn(),
      getImageInfo: jest.fn(),
      createCanvasContext: jest.fn(() => canvas),
      canvasToTempFilePath: jest.fn(),
      saveImageToPhotosAlbum: jest.fn(),
      hideShareMenu: jest.fn(),
      showShareMenu: jest.fn(),
    };
    (global as any).Page = (config: any) => {
      definition = config;
    };
    jest.isolateModules(() => require("../pages/partner/group-detail/index"));
    page = instantiate();
  });
  afterEach(() => {
    page.onUnload?.();
    jest.useRealTimers();
    delete (global as any).Page;
    delete (global as any).wx;
  });

  describe("detail owner protection", () => {
    const cleared = () => expect(page.data).toMatchObject({
      viewState: "forbidden", campaign: null, shareCopy: "", posterPath: "",
      showPoster: false, posterGenerating: false, posterSaving: false,
      errorMessage: "登录已更新，请重新登录", refreshError: "", posterError: "",
    });
    it("clears a replaced owner's content immediately on return without reading again", async () => {
      await open();
      page.setData({ posterPath: "synthetic-poster", showPoster: true });
      page.onHide();
      detailOwner = "replacement-owner";
      page.onShow();
      cleared();
      await flush();
      expect(loadDetail).toHaveBeenCalledTimes(1);
      expect(page.promotionTimer).toBeUndefined();
    });
    it("does not start the first queued read after identity replacement", async () => {
      page.onLoad({ id: GROUP_PROMOTION_CAMPAIGN_FIXTURE.id });
      detailOwner = "replacement-owner";
      await flush();
      cleared();
      expect(loadDetail).not.toHaveBeenCalled();
    });
    it("rejects a successful response from the previous owner", async () => {
      const pending = deferred();
      loadDetail.mockReturnValueOnce(pending.promise);
      await open();
      detailOwner = "replacement-owner";
      pending.resolve(response());
      await flush();
      cleared();
      expect(page.promotionTimer).toBeUndefined();
    });
    it.each(["retry", "preview", "copy", "poster", "save", "share", "close"])("clears content before a changed-owner %s action", async (action) => {
      loadDetail.mockResolvedValueOnce(posterResponse());
      await open();
      page.setData({ posterPath: "synthetic-poster", showPoster: true });
      detailOwner = "replacement-owner";
      if (action === "retry") page.onRetry();
      else if (action === "preview") page.onPreviewPoster(posterTap());
      else if (action === "copy") page.onCopyText();
      else if (action === "poster") page.onOpenPoster();
      else if (action === "save") page.onSavePoster();
      else if (action === "close") page.onClosePoster();
      else expect(page.onShareAppMessage().path).toBe("/pages/bootstrap/index");
      await flush();
      cleared();
      expect(loadDetail).toHaveBeenCalledTimes(1);
      for (const method of ["previewImage", "setClipboardData", "saveImageToPhotosAlbum", "createCanvasContext"]) {
        expect((global as any).wx[method]).not.toHaveBeenCalled();
      }
    });
    it.each(["previewImage", "setClipboardData"].flatMap((method) =>
      ["success", "fail", "complete"].map((callback) => ({ method, callback }))))
    ("clears old content on a late $method $callback without a failure notice", async ({ method, callback }) => {
      loadDetail.mockResolvedValueOnce(posterResponse());
      await open();
      if (method === "previewImage") page.onPreviewPoster(posterTap());
      else page.onCopyText();
      const options = (global as any).wx[method].mock.calls[0][0];
      detailOwner = "replacement-owner";
      options[callback]({});
      cleared();
      expect((global as any).wx.showToast).not.toHaveBeenCalled();
    });
    it.each(["image", "draw", "export"])("rejects a changed-owner poster %s callback", async (stage) => {
      if (stage === "image") loadDetail.mockResolvedValueOnce(posterResponse());
      await open();
      await generate();
      if (stage === "export") canvas.draw.mock.calls[0][1]();
      detailOwner = "replacement-owner";
      if (stage === "image") {
        (global as any).wx.getImageInfo.mock.calls[0][0].success({ path: "synthetic-image", width: 360, height: 360 });
      } else if (stage === "draw") canvas.draw.mock.calls[0][1]();
      else (global as any).wx.canvasToTempFilePath.mock.calls[0][0].success({ tempFilePath: "old-owner-poster" });
      await flush();
      cleared();
      if (stage === "image") expect((global as any).wx.createCanvasContext).not.toHaveBeenCalled();
      if (stage === "draw") expect((global as any).wx.canvasToTempFilePath).not.toHaveBeenCalled();
    });
    it.each(["success", "fail"])("settles an existing native save %s after identity replacement without old data or feedback", async (callback) => {
      await open();
      page.setData({ showPoster: true, posterPath: "synthetic-poster" });
      page.onSavePoster();
      const options = (global as any).wx.saveImageToPhotosAlbum.mock.calls[0][0];
      detailOwner = "replacement-owner";
      options[callback]({});
      cleared();
      expect(page.saveInFlight).toBe(false);
      expect((global as any).wx.showToast).not.toHaveBeenCalled();
    });
    it.each(["success", "fail"])("preserves an unsettled native save lock through explicit session invalidation until %s", async (callback) => {
      await open();
      page.setData({ showPoster: true, posterPath: "synthetic-poster" });
      page.onSavePoster();
      const native = (global as any).wx.saveImageToPhotosAlbum;
      const options = native.mock.calls[0][0];
      detailOwner = "replacement-owner";
      page.onCopyText();
      cleared();
      expect(page.saveInFlight).toBe(true);
      page.onSavePoster();
      expect(native).toHaveBeenCalledTimes(1);
      options[callback]({});
      expect(page.saveInFlight).toBe(false);
      cleared();
      expect((global as any).wx.showToast).not.toHaveBeenCalled();
    });
  });

  it("deduplicates initial load/show and concurrent refresh", async () => {
    const pending = deferred();
    loadDetail.mockReturnValueOnce(pending.promise);
    await open();
    page.onPullDownRefresh();
    page.onPullDownRefresh();
    await flush();
    expect(loadDetail).toHaveBeenCalledTimes(1);
    pending.resolve(response());
    await flush();
    expect(page.data.viewState).toBe("ready");
  });

  it.each(["onHide", "onUnload"])(
    "discards queued and late work after %s",
    async (method) => {
      page.onLoad({ id: "queued" });
      page[method]?.();
      await flush();
      expect(loadDetail).not.toHaveBeenCalled();
      page = instantiate();
      const pending = deferred();
      loadDetail.mockReturnValueOnce(pending.promise);
      await open();
      page[method]?.();
      const writes = page.setData.mock.calls.length;
      pending.resolve(response());
      await flush();
      expect(page.setData).toHaveBeenCalledTimes(writes);
    },
  );

  it("refreshes when returning and isolates instances", async () => {
    await open();
    const first = page;
    first.onHide?.();
    page = instantiate();
    await open();
    first.onShow?.();
    await flush();
    expect(loadDetail).toHaveBeenCalledTimes(3);
    first.onUnload?.();
  });

  it("preserves ready content on ordinary refresh failure and retries", async () => {
    await open();
    const campaign = page.data.campaign;
    loadDetail.mockResolvedValueOnce({
      status: "error",
      statusCode: 500,
      message: "刷新失败",
    });
    await page.load();
    expect(page.data).toMatchObject({
      viewState: "ready",
      campaign,
      refreshError: "刷新失败",
    });
    page.onRetry();
    await flush();
    expect(page.data.refreshError).toBe("");
  });

  it.each([401, 403])(
    "clears sensitive and generated data on %s",
    async (statusCode) => {
      await open();
      page.setData({ posterPath: "old-path", showPoster: true });
      loadDetail.mockResolvedValueOnce({
        status: "error",
        statusCode,
        message: "拒绝访问",
      });
      await page.load();
      expect(page.data).toMatchObject({
        viewState: "forbidden",
        campaign: null,
        shareCopy: "",
        posterPath: "",
        showPoster: false,
      });
      expect(page.onShareAppMessage()).toEqual({
        title: "线下课程拼团",
        path: "/pages/bootstrap/index",
      });
      page.onLogin?.();
      expect(logout).toHaveBeenCalledTimes(1);
    },
  );

  it("catches a rejected request without leaking details", async () => {
    loadDetail.mockRejectedValueOnce(new Error("private diagnostic"));
    page.setData({ campaignId: GROUP_PROMOTION_CAMPAIGN_FIXTURE.id });
    await expect(page.load()).resolves.toBeUndefined();
    expect(loadDetail).toHaveBeenCalledTimes(1);
    expect(page.data.viewState).toBe("error");
    expect(page.data.errorMessage).not.toContain("private diagnostic");
  });

  it("rejects an empty activity id before calling the API", async () => {
    page.onLoad({ id: "" });
    await flush();
    expect(loadDetail).not.toHaveBeenCalled();
    expect(page.data.errorMessage).toBe("活动参数无效");
  });

  it("cancels the scheduled draw when the modal closes", async () => {
    await open();
    page.onOpenPoster();
    page.onClosePoster();
    jest.advanceTimersByTime(50);
    await flush();
    expect((global as any).wx.createCanvasContext).not.toHaveBeenCalled();
    expect(page.data.posterGenerating).toBe(false);
  });

  it.each(["onClosePoster", "onHide", "onUnload"])(
    "ignores image completion after %s",
    async (method) => {
      loadDetail.mockResolvedValueOnce({
        status: "success",
        data: {
          ...GROUP_PROMOTION_CAMPAIGN_FIXTURE,
          canPromote: true,
          posterImages: [
            { id: "image", accessUrl: "https://example.test/poster.png" },
          ],
        },
      });
      await open();
      await generate();
      const image = (global as any).wx.getImageInfo.mock.calls[0][0];
      page[method]?.();
      image.success({ path: "image-path", width: 360, height: 360 });
      await flush();
      expect((global as any).wx.createCanvasContext).not.toHaveBeenCalled();
    },
  );

  it("does not export a stale draw or accept a stale export", async () => {
    await open();
    await generate();
    const oldDraw = canvas.draw.mock.calls[0][1];
    page.onClosePoster();
    await generate();
    oldDraw();
    expect((global as any).wx.canvasToTempFilePath).not.toHaveBeenCalled();
    canvas.draw.mock.calls[1][1]();
    const exported = (global as any).wx.canvasToTempFilePath.mock.calls[0][0];
    page.onClosePoster();
    exported.success({ tempFilePath: "stale" });
    expect(page.data.posterPath).toBe("");
  });

  it.each(["createCanvasContext", "canvasToTempFilePath"])(
    "recovers from synchronous %s errors",
    async (method) => {
      await open();
      (global as any).wx[method].mockImplementationOnce(() => {
        throw new Error("canvas unavailable");
      });
      page.onOpenPoster();
      jest.clearAllTimers();
      await expect(page.drawPoster()).resolves.toBeUndefined();
      if (method === "canvasToTempFilePath") {
        expect(() => canvas.draw.mock.calls[0][1]()).not.toThrow();
      }
      expect(page.data.posterGenerating).toBe(false);
      expect(page.data.posterError).toBeTruthy();
      page.onOpenPoster();
      expect(page.data.posterGenerating).toBe(true);
    },
  );

  it("deduplicates saves and ignores callbacks after close", async () => {
    await open();
    await generate();
    canvas.draw.mock.calls[0][1]();
    (global as any).wx.canvasToTempFilePath.mock.calls[0][0].success({
      tempFilePath: "fresh",
    });
    page.onSavePoster();
    page.onSavePoster();
    expect((global as any).wx.saveImageToPhotosAlbum).toHaveBeenCalledTimes(1);
    page.onClosePoster();
    (global as any).wx.saveImageToPhotosAlbum.mock.calls[0][0].success();
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });

  it("keeps the native save lock across close and regeneration", async () => {
    await open();
    await generate();
    canvas.draw.mock.calls[0][1]();
    (global as any).wx.canvasToTempFilePath.mock.calls[0][0].success({
      tempFilePath: "first",
    });
    page.onSavePoster();
    const save = (global as any).wx.saveImageToPhotosAlbum;
    const firstSave = save.mock.calls[0][0];
    page.onClosePoster();
    await generate();
    canvas.draw.mock.calls[1][1]();
    (global as any).wx.canvasToTempFilePath.mock.calls[1][0].success({
      tempFilePath: "second",
    });
    page.onSavePoster();
    expect(save).toHaveBeenCalledTimes(1);
    expect(page.data.posterSaving).toBe(true);
    firstSave.success();
    expect(page.data.posterSaving).toBe(false);
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
    page.onSavePoster();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].filePath).toBe("second");
    firstSave.fail();
    expect(page.data.posterSaving).toBe(true);
  });

  it.each(["onHide", "onUnload"])("releases save bookkeeping without UI writes after %s", async (method) => {
    await open();
    await generate();
    canvas.draw.mock.calls[0][1]();
    (global as any).wx.canvasToTempFilePath.mock.calls[0][0].success({
      tempFilePath: "fresh",
    });
    page.onSavePoster();
    page[method]();
    const writes = page.setData.mock.calls.length;
    (global as any).wx.saveImageToPhotosAlbum.mock.calls[0][0].success();
    expect(page.saveInFlight).toBe(false);
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });

  it("invalidates an export when refreshing and does not reopen it", async () => {
    await open();
    await generate();
    canvas.draw.mock.calls[0][1]();
    const exported = (global as any).wx.canvasToTempFilePath.mock.calls[0][0];
    const pending = deferred();
    loadDetail.mockReturnValueOnce(pending.promise);
    const refresh = page.load();
    page.onOpenPoster();
    expect(page.data.showPoster).toBe(false);
    exported.success({ tempFilePath: "obsolete" });
    pending.resolve(response());
    await refresh;
    expect(page.data.posterPath).toBe("");
  });

  it("shows export errors and regenerates successfully on retry", async () => {
    await open();
    await generate();
    canvas.draw.mock.calls[0][1]();
    (global as any).wx.canvasToTempFilePath.mock.calls[0][0].fail();
    expect(page.data).toMatchObject({ posterGenerating: false, posterPath: "" });
    expect(page.data.posterError).toBeTruthy();
    await generate();
    canvas.draw.mock.calls[1][1]();
    (global as any).wx.canvasToTempFilePath.mock.calls[1][0].success({
      tempFilePath: "retried",
    });
    expect(page.data).toMatchObject({
      posterPath: "retried", posterGenerating: false, posterError: "",
    });
  });

  it.each(["fail", "throw"])("allows another save after %s", async (failure) => {
    await open();
    await generate();
    canvas.draw.mock.calls[0][1]();
    (global as any).wx.canvasToTempFilePath.mock.calls[0][0].success({
      tempFilePath: "fresh",
    });
    const save = (global as any).wx.saveImageToPhotosAlbum;
    if (failure === "throw") {
      save.mockImplementationOnce(() => { throw new Error("save unavailable"); });
    }
    page.onSavePoster();
    if (failure === "fail") save.mock.calls[0][0].fail();
    expect(page.data.posterSaving).toBe(false);
    page.onSavePoster();
    expect(save).toHaveBeenCalledTimes(2);
    expect((global as any).wx.showToast).toHaveBeenCalledWith({
      title: "未能保存，请检查相册权限", icon: "none",
    });
  });

  it("keeps ready sharing on the existing parent recipient route", async () => {
    await open();
    expect(page.onShareAppMessage()).toMatchObject({
      title: GROUP_PROMOTION_CAMPAIGN_FIXTURE.title,
      path: `/pages/parent/group-detail/index?id=${GROUP_PROMOTION_CAMPAIGN_FIXTURE.id}`,
    });
  });

  it("exposes refresh, login and poster retry independently", () => {
    const markup = fs.readFileSync(
      path.resolve(__dirname, "../pages/partner/group-detail/index.wxml"), "utf8",
    );
    expect(markup).toContain('wx:if="{{refreshError}}"');
    expect(markup).toContain('bindtap="onLogin"');
    expect(markup).toContain('wx:if="{{posterError}}"');
    expect(markup).toContain('disabled="{{!posterPath || posterSaving}}"');
  });

  it("only previews current images and blocks hidden copy/save/share", async () => {
    await open();
    page.onPreviewPoster({ currentTarget: { dataset: { url: "unknown" } } });
    expect((global as any).wx.previewImage).not.toHaveBeenCalled();
    page.onHide?.();
    page.onCopyText();
    page.onSavePoster();
    expect((global as any).wx.setClipboardData).not.toHaveBeenCalled();
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
    expect(page.onShareAppMessage().path).toBe("/pages/bootstrap/index");
  });

  it.each(["ACTIVE", "CLOSED"])("keeps ended %s details read-only and blocks invitation actions", async (status) => {
    loadDetail.mockResolvedValueOnce({
      status: "success",
      data: { ...GROUP_PROMOTION_CAMPAIGN_FIXTURE, status, canPromote: false },
    });
    await open();
    expect(page.data.viewState).toBe("ready");
    expect(page.data.campaign.canPromote).toBe(false);
    expect(page.data.shareCopy).toBe("");
    page.onCopyText();
    page.onOpenPoster();
    jest.advanceTimersByTime(100);
    await flush();
    expect((global as any).wx.setClipboardData).not.toHaveBeenCalled();
    expect((global as any).wx.createCanvasContext).not.toHaveBeenCalled();
    expect(page.data.showPoster).toBe(false);
    expect(page.onShareAppMessage().path).toBe("/pages/bootstrap/index");
  });

  it("denies promotion when the partner response omits its required flag", async () => {
    loadDetail.mockResolvedValueOnce({ status: "success", data: GROUP_PROMOTION_CAMPAIGN_FIXTURE });
    await open();
    page.onCopyText();
    page.onOpenPoster();
    expect(page.data.campaign.canPromote).toBe(false);
    expect(page.data.shareCopy).toBe("");
    expect((global as any).wx.setClipboardData).not.toHaveBeenCalled();
    expect(page.onShareAppMessage().path).toBe("/pages/bootstrap/index");
  });

  it("keeps cached text but revokes promotion after a 404 refresh", async () => {
    await open();
    loadDetail.mockResolvedValueOnce({ status: "error", statusCode: 404, message: "活动已失效" });
    await page.load();
    expect(page.data).toMatchObject({
      viewState: "ready", refreshError: "活动已失效", shareCopy: "",
      campaign: { canPromote: false },
    });
    page.onCopyText();
    page.onOpenPoster();
    expect((global as any).wx.setClipboardData).not.toHaveBeenCalled();
    expect(page.onShareAppMessage().path).toBe("/pages/bootstrap/index");
  });

  it("expires visible actions at the deadline and rejects a late poster export", async () => {
    loadDetail.mockResolvedValueOnce({
      ...response(), data: { ...response().data, endsAt: new Date(Date.now() + 100).toISOString() },
    });
    await open();
    await generate();
    canvas.draw.mock.calls[0][1]();
    const exported = (global as any).wx.canvasToTempFilePath.mock.calls[0][0];
    jest.advanceTimersByTime(50);
    expect(page.data).toMatchObject({
      shareCopy: "", showPoster: false, posterPath: "", campaign: { canPromote: false },
    });
    exported.success({ tempFilePath: "expired-poster" });
    page.onCopyText();
    page.onSavePoster();
    expect((global as any).wx.setClipboardData).not.toHaveBeenCalled();
    expect((global as any).wx.saveImageToPhotosAlbum).not.toHaveBeenCalled();
    expect(page.data.posterPath).toBe("");
    expect(page.onShareAppMessage().path).toBe("/pages/bootstrap/index");
    expect((global as any).wx.hideShareMenu).toHaveBeenCalled();
  });

  it("replaces ongoing promotion with read-only history on refresh", async () => {
    await open();
    loadDetail.mockResolvedValueOnce({
      ...response(), data: { ...response().data, status: "CLOSED", canPromote: false },
    });
    await page.load();
    expect(page.data).toMatchObject({ campaign: { statusLabel: "已结束", canPromote: false }, shareCopy: "" });
    page.onOpenPoster();
    expect(page.data.showPoster).toBe(false);
    expect((global as any).wx.hideShareMenu).toHaveBeenCalled();
  });

  it("clears expiry work when hidden and revalidates on return", async () => {
    loadDetail.mockResolvedValueOnce({
      ...response(), data: { ...response().data, endsAt: new Date(Date.now() + 100).toISOString() },
    });
    await open();
    expect(page.promotionTimer).toBeDefined();
    page.onHide();
    const writes = page.setData.mock.calls.length;
    jest.advanceTimersByTime(200);
    expect(page.promotionTimer).toBeUndefined();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    loadDetail.mockResolvedValueOnce({ ...response(), data: { ...response().data, canPromote: false } });
    page.onShow();
    await flush();
    expect(page.data.campaign.canPromote).toBe(false);
  });

  it("rejects expired actions when the clock jumps before the timer runs", async () => {
    await open();
    await generate();
    canvas.draw.mock.calls[0][1]();
    const exported = (global as any).wx.canvasToTempFilePath.mock.calls[0][0];
    jest.setSystemTime(Date.parse(response().data.endsAt) + 1);
    page.onCopyText();
    page.onSavePoster();
    exported.success({ tempFilePath: "clock-jump-poster" });
    expect((global as any).wx.setClipboardData).not.toHaveBeenCalled();
    expect((global as any).wx.saveImageToPhotosAlbum).not.toHaveBeenCalled();
    expect(page.onShareAppMessage().path).toBe("/pages/bootstrap/index");
    expect(page.data).toMatchObject({
      shareCopy: "", posterPath: "", showPoster: false, campaign: { canPromote: false },
    });
  });

  it.each(["fail", "throw"])(
    "recovers from native image preview %s without losing detail",
    async (failure) => {
      loadDetail.mockResolvedValueOnce(posterResponse());
      await open();
      const campaign = page.data.campaign;
      const preview = (global as any).wx.previewImage;
      if (failure === "throw") {
        preview.mockImplementationOnce(() => {
          throw new Error("private native diagnostic");
        });
      }
      expect(() => page.onPreviewPoster(posterTap())).not.toThrow();
      if (failure === "fail") {
        expect(preview.mock.calls[0][0].fail).toEqual(expect.any(Function));
        preview.mock.calls[0][0].fail({ errMsg: "private native diagnostic" });
      }
      expect(page.data).toMatchObject({
        viewState: "ready",
        campaign,
        refreshError: "图片预览失败，请重试",
      });
      page.onPreviewPoster(posterTap());
      expect(preview).toHaveBeenCalledTimes(2);
    },
  );

  it("deduplicates previews and releases the lock after native completion", async () => {
    loadDetail.mockResolvedValueOnce(posterResponse());
    await open();
    const preview = (global as any).wx.previewImage;
    page.onPreviewPoster(posterTap());
    page.onPreviewPoster(posterTap());
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview.mock.calls[0][0]).toMatchObject({
      current: posterResponse().data.posterImages[0].accessUrl,
      urls: [posterResponse().data.posterImages[0].accessUrl],
      complete: expect.any(Function),
    });
    preview.mock.calls[0][0].complete({});
    page.onPreviewPoster(posterTap());
    expect(preview).toHaveBeenCalledTimes(2);
  });

  it("keeps image preview available on ended activities", async () => {
    loadDetail.mockResolvedValueOnce({
      ...posterResponse(),
      data: { ...posterResponse().data, status: "CLOSED", canPromote: false },
    });
    await open();
    page.onPreviewPoster(posterTap());
    const preview = (global as any).wx.previewImage;
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview.mock.calls[0][0].fail).toEqual(expect.any(Function));
    preview.mock.calls[0][0].fail({});
    expect(page.data.refreshError).toBe("图片预览失败，请重试");
    expect(page.data.campaign.canPromote).toBe(false);
    expect(page.onShareAppMessage().path).toBe("/pages/bootstrap/index");
  });

  it("blocks cached preview during refresh and ignores old preview failure", async () => {
    loadDetail.mockResolvedValueOnce(posterResponse());
    await open();
    page.onPreviewPoster(posterTap());
    const preview = (global as any).wx.previewImage;
    const old = preview.mock.calls[0][0];
    const pending = deferred();
    loadDetail.mockReturnValueOnce(pending.promise);
    const refresh = page.load();
    page.onPreviewPoster(posterTap());
    expect(preview).toHaveBeenCalledTimes(1);
    pending.resolve(posterResponse());
    await refresh;
    page.onPreviewPoster(posterTap());
    const writes = page.setData.mock.calls.length;
    expect(old.fail).toEqual(expect.any(Function));
    old.fail({});
    old.complete({});
    expect(page.setData).toHaveBeenCalledTimes(writes);
    page.onPreviewPoster(posterTap());
    expect(preview).toHaveBeenCalledTimes(2);
    preview.mock.calls[1][0].fail({});
    expect(page.data.refreshError).toBe("图片预览失败，请重试");
  });

  it.each(["onHide", "onUnload"])(
    "ignores late native preview failure after %s",
    async (method) => {
      loadDetail.mockResolvedValueOnce(posterResponse());
      await open();
      page.onPreviewPoster(posterTap());
      const preview = (global as any).wx.previewImage.mock.calls[0][0];
      page[method]();
      const writes = page.setData.mock.calls.length;
      expect(preview.fail).toEqual(expect.any(Function));
      preview.fail({});
      expect(page.setData).toHaveBeenCalledTimes(writes);
    },
  );

  it("unlocks native preview on hide and ignores its callback after return", async () => {
    loadDetail.mockResolvedValue(posterResponse());
    await open();
    page.onPreviewPoster(posterTap());
    const preview = (global as any).wx.previewImage;
    const old = preview.mock.calls[0][0];
    page.onHide();
    page.onShow();
    await flush();
    page.onPreviewPoster(posterTap());
    expect(preview).toHaveBeenCalledTimes(2);
    expect(old.fail).toEqual(expect.any(Function));
    old.fail({});
    page.onPreviewPoster(posterTap());
    expect(preview).toHaveBeenCalledTimes(2);
  });

  it.each(["fail", "throw"])(
    "recovers from native clipboard %s with a generic Chinese error",
    async (failure) => {
      await open();
      const clipboard = (global as any).wx.setClipboardData;
      if (failure === "throw") {
        clipboard.mockImplementationOnce(() => {
          throw new Error("private clipboard diagnostic");
        });
      }
      expect(() => page.onCopyText()).not.toThrow();
      if (failure === "fail") {
        expect(clipboard.mock.calls[0][0].fail).toEqual(expect.any(Function));
        clipboard.mock.calls[0][0].fail({ errMsg: "private clipboard diagnostic" });
      }
      expect((global as any).wx.showToast).toHaveBeenCalledWith({
        title: "文案复制失败，请重试",
        icon: "none",
      });
      page.onCopyText();
      expect(clipboard).toHaveBeenCalledTimes(2);
      expect(clipboard.mock.calls[1][0].data).toBe(page.data.shareCopy);
    },
  );

  it("deduplicates copying and releases the lock after native completion", async () => {
    await open();
    const clipboard = (global as any).wx.setClipboardData;
    page.onCopyText();
    page.onCopyText();
    expect(clipboard).toHaveBeenCalledTimes(1);
    expect(clipboard.mock.calls[0][0].complete).toEqual(expect.any(Function));
    clipboard.mock.calls[0][0].complete({});
    page.onCopyText();
    expect(clipboard).toHaveBeenCalledTimes(2);
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });

  it.each(["onHide", "onUnload"])(
    "suppresses clipboard failure after %s",
    async (method) => {
      await open();
      page.onCopyText();
      const clipboard = (global as any).wx.setClipboardData.mock.calls[0][0];
      page[method]();
      expect(clipboard.fail).toEqual(expect.any(Function));
      clipboard.fail({});
      expect((global as any).wx.showToast).not.toHaveBeenCalled();
    },
  );

  it("does not let an old clipboard completion release a newer copy", async () => {
    await open();
    const clipboard = (global as any).wx.setClipboardData;
    page.onCopyText();
    const old = clipboard.mock.calls[0][0];
    page.onHide();
    page.onShow();
    await flush();
    page.onCopyText();
    expect(clipboard).toHaveBeenCalledTimes(2);
    expect(old.fail).toEqual(expect.any(Function));
    old.fail({});
    old.complete({});
    page.onCopyText();
    expect(clipboard).toHaveBeenCalledTimes(2);
    clipboard.mock.calls[1][0].fail({});
    expect((global as any).wx.showToast).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404])(
    "suppresses clipboard errors after a %s refresh",
    async (statusCode) => {
      await open();
      page.onCopyText();
      const old = (global as any).wx.setClipboardData.mock.calls[0][0];
      loadDetail.mockResolvedValueOnce({
        status: "error",
        statusCode,
        message: "活动不可用",
      });
      await page.load();
      expect(old.fail).toEqual(expect.any(Function));
      old.fail({});
      expect((global as any).wx.showToast).not.toHaveBeenCalled();
      page.onCopyText();
      expect((global as any).wx.setClipboardData).toHaveBeenCalledTimes(1);
    },
  );

  it("suppresses clipboard errors when the deadline passes before its callback", async () => {
    await open();
    page.onCopyText();
    const clipboard = (global as any).wx.setClipboardData.mock.calls[0][0];
    jest.setSystemTime(Date.parse(response().data.endsAt) + 1);
    expect(clipboard.fail).toEqual(expect.any(Function));
    clipboard.fail({});
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
    expect(page.data.campaign.canPromote).toBe(false);
    expect(page.data.shareCopy).toBe("");
  });

  it.each(["previewImage", "setClipboardData"])(
    "settles synchronous %s success once even if native code later fails or throws",
    async (method) => {
      loadDetail.mockResolvedValueOnce(posterResponse());
      await open();
      const native = (global as any).wx[method];
      const trigger = () => method === "previewImage"
        ? page.onPreviewPoster(posterTap())
        : page.onCopyText();
      native.mockImplementationOnce((options: any) => {
        options.success({});
        options.fail({ errMsg: "late private diagnostic" });
        options.complete({});
        throw new Error("private diagnostic after success");
      });
      expect(trigger).not.toThrow();
      expect(page.data.refreshError).toBe("");
      expect((global as any).wx.showToast).not.toHaveBeenCalled();
      trigger();
      expect(native).toHaveBeenCalledTimes(2);
      const writes = page.setData.mock.calls.length;
      native.mock.calls[0][0].fail({});
      native.mock.calls[0][0].complete({});
      trigger();
      expect(native).toHaveBeenCalledTimes(2);
      expect(page.setData).toHaveBeenCalledTimes(writes);
      expect((global as any).wx.showToast).not.toHaveBeenCalled();
      native.mock.calls[1][0].success({});
      trigger();
      expect(native).toHaveBeenCalledTimes(3);
    },
  );

  it.each(["previewImage", "setClipboardData"])(
    "settles synchronous %s failure once even if native code later completes or throws",
    async (method) => {
      loadDetail.mockResolvedValueOnce(posterResponse());
      await open();
      const native = (global as any).wx[method];
      const trigger = () => method === "previewImage"
        ? page.onPreviewPoster(posterTap())
        : page.onCopyText();
      native.mockImplementationOnce((options: any) => {
        options.fail({ errMsg: "private native diagnostic" });
        options.complete({});
        throw new Error("private diagnostic after failure");
      });
      expect(trigger).not.toThrow();
      if (method === "previewImage") {
        expect(page.setData.mock.calls.filter(
          ([values]: any[]) => values.refreshError === "图片预览失败，请重试",
        )).toHaveLength(1);
      } else {
        expect((global as any).wx.showToast).toHaveBeenCalledTimes(1);
        expect((global as any).wx.showToast).toHaveBeenCalledWith({
          title: "文案复制失败，请重试",
          icon: "none",
        });
      }
      trigger();
      expect(native).toHaveBeenCalledTimes(2);
      if (method === "previewImage") expect(page.data.refreshError).toBe("");
      native.mock.calls[0][0].fail({});
      native.mock.calls[0][0].complete({});
      trigger();
      expect(native).toHaveBeenCalledTimes(2);
      native.mock.calls[1][0].success({});
      trigger();
      expect(native).toHaveBeenCalledTimes(3);
    },
  );
});
