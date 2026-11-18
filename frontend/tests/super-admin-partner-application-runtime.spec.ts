import type { SessionHttpRequestOptions } from '../services/session.service';
import { partnerApplicationAcceptanceFixture } from './fixtures/partner-application-acceptance.fixture';

const api = 'https://review.example.test';
const replacements = [
  { accessToken: 'synthetic-replacement-reviewer' },
  { accessToken: '' },
  { apiBaseUrl: 'https://replacement.example.test' },
  { dataDriver: 'mock' },
];
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

describe('headquarters review with actual page, runtime and private transport', () => {
  let page: any;
  let stored: Record<string, unknown>;
  let requests: SessionHttpRequestOptions[];
  let downloads: WechatMiniprogram.DownloadFileOption[];
  const fixture = partnerApplicationAcceptanceFixture('SUBMITTED');
  const prefix = `${api}/management/partner-applications`;
  const detailPath = `${prefix}/${fixture.detail.applicationId}/submissions/${fixture.detail.submissionId}`;
  const previewEvent = { currentTarget: { dataset: { id: fixture.detail.materials[0].storedFileId } } };

  beforeEach(() => {
    stored = { dataDriver: 'api', apiBaseUrl: api, accessToken: 'synthetic-original-reviewer' };
    requests = []; downloads = [];
    (global as any).wx = {
      getStorageSync: () => stored,
      request: (input: SessionHttpRequestOptions) => {
        requests.push(input);
        const body = input.url.startsWith(`${prefix}?`) ? {
          data: [fixture.summary], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 }, requestId: 'synthetic',
        } : {
          data: input.url === detailPath ? fixture.detail : {
            applicationId: fixture.detail.applicationId, submissionId: fixture.detail.submissionId,
            bankInformation: fixture.bank.bankInformation,
          }, requestId: 'synthetic',
        };
        input.success({ statusCode: 200, data: body });
      },
      downloadFile: (input: WechatMiniprogram.DownloadFileOption) => {
        downloads.push(input);
        input.success?.({ statusCode: 200, tempFilePath: '/synthetic-review.png' } as WechatMiniprogram.DownloadFileSuccessCallbackResult);
      },
      previewImage: jest.fn(),
      showModal: jest.fn(),
    };
    (global as any).Page = (definition: any) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
      page.setData = (patch: object) => Object.assign(page.data, patch);
    };
    jest.isolateModules(() => { require('../pages/super-admin/partner-applications/index'); });
  });
  afterEach(() => {
    page.onUnload();
    delete (global as any).wx;
    delete (global as any).Page;
  });
  const openDetail = async () => {
    page.onLoad(); page.onShow(); await flush();
    await page.onOpen({ currentTarget: { dataset: {
      aid: fixture.detail.applicationId, sid: fixture.detail.submissionId,
    } } });
    expect(page.data.detail).toEqual(fixture.detail);
    expect(requests).toHaveLength(2);
  };

  it('reads bank and previews frozen material on demand with the displayed reviewer credential', async () => {
    await openDetail();
    expect(downloads).toHaveLength(0);
    await page.onBank();
    expect(requests[2]).toMatchObject({
      method: 'GET', url: `${detailPath}/bank-information`,
      header: { Authorization: 'Bearer synthetic-original-reviewer' },
    });
    expect(page.data.bankInformation).toEqual(fixture.bank.bankInformation);
    await page.onPreview(previewEvent);
    expect(downloads[0]).toMatchObject({
      url: `${detailPath}/materials/${fixture.detail.materials[0].storedFileId}/content`,
      header: { Authorization: 'Bearer synthetic-original-reviewer' },
    });
    expect((global as any).wx.previewImage).toHaveBeenCalledWith(expect.objectContaining({
      urls: ['/synthetic-review.png'], current: '/synthetic-review.png',
    }));
  });
  describe.each(['bank', 'preview'])('%s request entry', (action) => {
    it.each(replacements)('stops old-detail requests and clears private content after %j', async (replacement) => {
      await openDetail(); stored = { ...stored, ...replacement };
      if (action === 'bank') await page.onBank(); else await page.onPreview(previewEvent);
      expect(requests).toHaveLength(2); expect(downloads).toHaveLength(0);
      expect((global as any).wx.previewImage).not.toHaveBeenCalled();
      expect(page.data.detail).toBeNull(); expect(page.data.detailMaterials).toEqual([]);
      expect(page.data.bankInformation).toBeNull(); expect(page.data.viewState).toBe('forbidden');
      expect(page.data.privateLoading).toBe(false);
    });
  });
  it.each(replacements)('clears expanded private content on collapse after %j', async (replacement) => {
    await openDetail(); await page.onBank(); stored = { ...stored, ...replacement };
    await page.onBank();
    expect(requests).toHaveLength(3); expect(page.data.bankInformation).toBeNull();
    expect(page.data.detail).toBeNull(); expect(page.data.detailMaterials).toEqual([]);
    expect(page.data.viewState).toBe('forbidden');
  });
  it.each(['APPROVED', 'REJECTED'] as const)('settles an already sent %s receipt while hidden and restores its terminal detail', async (action) => {
    await openDetail();
    (global as any).wx.request = (input: SessionHttpRequestOptions) => { requests.push(input); };
    const reason = action === 'REJECTED' ? '合成补交原因' : '';
    if (action === 'REJECTED') {
      page.onReasonInput({ detail: { value: reason } }); page.onReject();
    } else page.onApprove();
    (global as any).wx.showModal.mock.calls[0][0].success({ confirm: true });
    await flush();
    expect(requests).toHaveLength(3);
    const write = requests[2]; const intent = page.intent;
    expect(write).toMatchObject({
      method: 'POST', url: `${detailPath}/${action === 'APPROVED' ? 'approve' : 'reject'}`,
      data: { expectedVersion: fixture.detail.version, ...(action === 'REJECTED' ? { reason } : {}) },
      header: { Authorization: 'Bearer synthetic-original-reviewer', 'Idempotency-Key': intent.key },
    });
    page.onHide();
    expect(page.intent).toBe(intent); expect(page.data.detail).toBeNull();
    const reviewedAt = '2026-10-15T00:00:00.000Z';
    write.success({ statusCode: 200, data: { data: {
      applicationId: fixture.detail.applicationId, submissionId: fixture.detail.submissionId,
      reviewId: fixture.detail.applicationId, status: action, version: fixture.detail.version + 1, reviewedAt,
      ...(action === 'APPROVED' ? { userId: fixture.identity.applicantId, campusId: fixture.account.campusId } : {}),
    }, requestId: 'synthetic' } });
    await flush();
    expect(page.intent).toBeUndefined(); expect(page.working).toBeUndefined();
    expect(page.data.detail).toBeNull(); expect(page.data.bankInformation).toBeNull();
    page.onShow(); await flush();
    expect(requests).toHaveLength(4);
    expect(requests[3]).toMatchObject({ method: 'GET', url: detailPath });
    requests[3].success({ statusCode: 200, data: { data: {
      ...fixture.detail, status: action, version: fixture.detail.version + 1,
      review: { reviewId: fixture.detail.applicationId, decision: action, reason, reviewedAt },
    }, requestId: 'synthetic' } });
    await flush();
    expect(page.data.detail.status).toBe(action); expect(page.data.detail.version).toBe(fixture.detail.version + 1);
    expect(page.data.viewState).toBe('ready'); expect(page.data.canReject).toBe(false);
    expect(page.data.submitting).toBe(false); expect(page.data.uncertain).toBe(false);
    expect(requests.filter((input) => input.method === 'POST')).toHaveLength(1);
  });
});
