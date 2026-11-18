export {};
import { partnerApplicationAcceptanceFixture } from './fixtures/partner-application-acceptance.fixture';
const runtime = jest.fn();
jest.mock('../pages/super-admin/runtime/partner-application-review-runtime', () => ({ getPartnerReviewRuntime: () => runtime() }), { virtual: true });
const id = '55883f08-c9f5-4f26-927c-82ea07cb8a02';
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const snapshot = () => ({ applicationId: id, submissionId: id, version: 9, submissionVersion: 9, status: 'SUBMITTED', latest: true,
  submittedAt: '2026-10-13T00:00:00.000Z', basicInformation: { institutionName: '合成机构', contactPhone: '000-00000000' },
  materials: [{ storedFileId: id, kind: 'BUSINESS_LICENSE' }], review: null });
describe('headquarters frozen application review page', () => {
  let page: any; let service: any; let key: string;
  beforeEach(() => {
    key = 'synthetic-admin';
    service = { getSessionKey: () => key, invalidateReads: jest.fn(),
      list: jest.fn().mockResolvedValue({ data: [{ applicationId: id, submissionId: id, institutionName: '合成机构', status: 'SUBMITTED', submittedAt: '2026-10-13T00:00:00.000Z' }],
        meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }),
      detail: jest.fn().mockResolvedValue(snapshot()), bank: jest.fn().mockResolvedValue({ applicationId: id, submissionId: id,
        bankInformation: { bankName: '合成银行', accountHolder: '合成账户', accountNumber: '0000123456789' } }),
      image: jest.fn().mockResolvedValue('/synthetic-private.png'),
      reject: jest.fn().mockResolvedValue({ ...snapshot(), status: 'REJECTED', version: 10 }),
      approve: jest.fn().mockResolvedValue({ applicationId: id, submissionId: id, reviewId: id,
        userId: id, campusId: id, status: 'APPROVED', version: 10, reviewedAt: '2026-10-13T00:00:00.000Z' }),
    };
    runtime.mockReset().mockReturnValue(service);
    (global as any).wx = { showModal: jest.fn(), previewImage: jest.fn(), getRandomValues: (input: any) => input.success({ randomValues: new Uint8Array(16).buffer }) };
    page = { data: {} };
    (global as any).Page = (config: any) => { page = { ...config, data: JSON.parse(JSON.stringify(config.data)) };
      page.setData = jest.fn((patch: object) => Object.assign(page.data, patch)); };
    jest.isolateModules(() => {
      const fs = require('node:fs');
      if (fs.existsSync(require('node:path').resolve(__dirname, '../pages/super-admin/partner-applications/index.ts')))
        require('../pages/super-admin/partner-applications/index');
    });
  });
  afterEach(() => { page.onUnload?.(); delete (global as any).wx; delete (global as any).Page; });
  const open = async () => { page.onLoad?.(); page.onShow?.(); await flush(); };
  const detail = async () => { await open(); await page.onOpen?.({ currentTarget: { dataset: { aid: id, sid: id } } }); await flush(); };
  it('loads a paginated list then the specified frozen detail without bank prefetch', async () => {
    await detail(); expect(service.list).toHaveBeenCalled(); expect(service.detail).toHaveBeenCalledWith(id, id);
    expect(page.data.detail.basicInformation.institutionName).toBe('合成机构'); expect(service.bank).not.toHaveBeenCalled();
  });
  it('retains complete contract-sized frozen details and all 14 material actions', async () => {
    const fixture = partnerApplicationAcceptanceFixture('SUBMITTED');
    service.list.mockResolvedValueOnce({ data: [fixture.summary], meta: { page: 1, totalPages: 1 } });
    service.detail.mockResolvedValueOnce(fixture.detail);
    service.bank.mockResolvedValueOnce({
      applicationId: fixture.detail.applicationId, submissionId: fixture.detail.submissionId,
      bankInformation: fixture.bank.bankInformation,
    });
    await open();
    expect(page.data.rows[0].institutionName).toHaveLength(200);
    await page.onOpen({ currentTarget: { dataset: {
      aid: fixture.detail.applicationId, sid: fixture.detail.submissionId,
    } } });
    expect(page.data.detail.basicInformation.detailedAddress).toHaveLength(300);
    expect(page.data.detailMaterials).toHaveLength(14);
    expect(page.data.detailMaterials.filter((file: any) => file.kind === 'ENVIRONMENT')).toHaveLength(9);
    expect(page.data.submittedLabel).toBe('2026-10-13 02:00');
    expect(service.bank).not.toHaveBeenCalled();
    await page.onBank();
    expect(page.data.bankInformation).toEqual(fixture.bank.bankInformation);
    page.onHide();
    expect(page.data.detail).toBeNull();
    expect(page.data.detailMaterials).toEqual([]);
    expect(page.data.bankInformation).toBeNull();
  });
  it('accepts a 1000-character rejection without truncation and rejects an over-limit direct input', async () => {
    await detail();
    const reason = partnerApplicationAcceptanceFixture().reason;
    page.onReasonInput({ detail: { value: `${reason}多` } }); page.onReject();
    expect((global as any).wx.showModal).not.toHaveBeenCalled();
    page.onReasonInput({ detail: { value: reason } }); page.onReject();
    (global as any).wx.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
    expect(service.reject).toHaveBeenCalledWith(id, id, 9, reason, expect.any(String));
  });
  it('reads bank on demand and clears it on hide', async () => {
    await detail(); await page.onBank?.(); expect(page.data.bankInformation.accountNumber).toBe('0000123456789');
    page.onHide(); expect(page.data.bankInformation).toBeNull(); expect(page.data.detail).toBeNull();
  });
  it.each(['bank', 'preview'])('rejects an old detail %s action before requesting with a replacement reviewer', async (action) => {
    await detail(); key = 'replacement-reviewer';
    if (action === 'bank') await page.onBank();
    else await page.onPreview({ currentTarget: { dataset: { id } } });
    expect(service.bank).not.toHaveBeenCalled(); expect(service.image).not.toHaveBeenCalled();
    expect((global as any).wx.previewImage).not.toHaveBeenCalled();
    expect(page.data.detail).toBeNull(); expect(page.data.detailMaterials).toEqual([]);
    expect(page.data.viewState).toBe('forbidden'); expect(page.data.privateLoading).toBe(false);
  });
  it('clears the entire old detail when collapsing an expanded bank after reviewer replacement', async () => {
    await detail(); await page.onBank(); key = 'replacement-reviewer';
    await page.onBank();
    expect(service.bank).toHaveBeenCalledTimes(1);
    expect(page.data.bankInformation).toBeNull(); expect(page.data.detail).toBeNull();
    expect(page.data.detailMaterials).toEqual([]); expect(page.data.canReject).toBe(false);
  });
  it.each(['onApprove', 'onReject'])('clears a replaced reviewer detail before opening %s confirmation', async (action) => {
    await detail(); page.onReasonInput({ detail: { value: '请补交资料' } }); key = 'replacement-reviewer';
    page[action]();
    expect((global as any).wx.showModal).not.toHaveBeenCalled();
    expect(service.approve).not.toHaveBeenCalled(); expect(service.reject).not.toHaveBeenCalled();
    expect(page.data.detail).toBeNull(); expect(page.data.reason).toBe('');
  });
  it('ignores a queued list-open event after hide instead of reopening its detail on return', async () => {
    await open(); page.onHide();
    await page.onOpen({ currentTarget: { dataset: { aid: id, sid: id } } });
    expect(page.selected).toBeUndefined();
    page.onShow(); await flush();
    expect(service.detail).not.toHaveBeenCalled(); expect(service.list).toHaveBeenCalledTimes(2);
    expect(page.data.detail).toBeNull();
  });
  it('ignores a queued close event after hide and restores the selected detail on return', async () => {
    await detail(); page.onHide(); page.onClose();
    expect(page.selected).toEqual({ aid: id, sid: id });
    page.onShow(); await flush();
    expect(service.detail).toHaveBeenCalledTimes(2); expect(service.list).toHaveBeenCalledTimes(1);
    expect(page.data.detail.applicationId).toBe(id);
  });
  it.each([
    ['onKeywordInput', 'keyword', '延迟机构名称'],
    ['onStatus', 'statusIndex', '1'],
    ['onReasonInput', 'reason', '延迟审核原因'],
  ])('ignores queued %s edits while hidden', async (action, field, value) => {
    await detail(); page.onHide();
    const before = page.data[field];
    page[action]({ detail: { value } }); await flush();
    expect(page.data[field]).toBe(before);
    expect(service.list).toHaveBeenCalledTimes(1); expect(service.detail).toHaveBeenCalledTimes(1);
  });
  it.each(['onKeywordInput', 'onStatus', 'onReasonInput', 'onOpen', 'onClose'])(
    'clears private content before %s can act under a replacement reviewer', async (action) => {
      await detail(); await page.onBank(); key = 'replacement-reviewer';
      await page[action]({ detail: { value: action === 'onStatus' ? '1' : '旧输入' },
        currentTarget: { dataset: { aid: id, sid: id } } }); await flush();
      expect(page.data.viewState).toBe('forbidden'); expect(page.data.detail).toBeNull();
      expect(page.data.bankInformation).toBeNull(); expect(page.data.reason).toBe('');
      expect(page.selected).toBeUndefined();
      expect(service.list).toHaveBeenCalledTimes(1); expect(service.detail).toHaveBeenCalledTimes(1);
    });
  it('rejects with a stable key and prevents repeated native confirmation', async () => {
    await detail(); page.onReasonInput?.({ detail: { value: '图片不清晰' } });
    page.onReject?.(); await flush(); expect((global as any).wx.showModal).toHaveBeenCalled();
    const callback = (global as any).wx.showModal.mock.calls.at(-1)[0].success;
    callback({ confirm: true }); callback({ confirm: true }); await flush();
    expect(service.reject).toHaveBeenCalledTimes(1);
    expect(service.reject).toHaveBeenCalledWith(id, id, 9, '图片不清晰', expect.any(String));
  });
  it('ignores private bank returned after hide or owner change', async () => {
    await detail(); let resolve!: (v: unknown) => void;
    service.bank.mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }));
    const pending = page.onBank?.(); await flush(); page.onHide?.(); key = 'new-owner';
    resolve({ bankInformation: { accountNumber: 'private' } }); await pending;
    expect(page.data.bankInformation).toBeNull();
  });
  it.each([401, 403])('clears private detail and list after %s', async (statusCode) => {
    await detail(); service.bank.mockRejectedValue(Object.assign(new Error('拒绝'), { statusCode }));
    await page.onBank?.(); expect(page.data.detail).toBeNull(); expect(page.data.rows).toEqual([]);
    expect(page.data.viewState).toBe('forbidden');
  });
  it('previews only authorized temporary files and ignores a hidden download', async () => {
    await detail(); let resolve!: (v: unknown) => void;
    service.image.mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }));
    const pending = page.onPreview?.({ currentTarget: { dataset: { id } } }); await flush(); page.onHide?.();
    resolve('/synthetic-private.png'); await pending;
    expect((global as any).wx.previewImage).not.toHaveBeenCalled();
  });
  it('keeps original rejection key and reason after an uncertain outcome', async () => {
    await detail(); page.onReasonInput({ detail: { value: '原原因' } });
    service.reject.mockRejectedValueOnce(Object.assign(new Error('未知'), { statusCode: 503 }));
    const confirm = async () => { page.onReject(); await flush();
      (global as any).wx.showModal.mock.calls.at(-1)[0].success({ confirm: true }); await flush(); };
    await confirm(); expect(page.data.uncertain).toBe(true);
    const first = service.reject.mock.calls[0]; page.onReasonInput({ detail: { value: '替换原因' } });
    await confirm(); expect(service.reject.mock.calls[1]).toEqual(first);
  });
  it('retains the list and retries the same page after pagination failure', async () => {
    service.list.mockResolvedValueOnce({ data: [{ ...snapshot(), institutionName: '合成机构' }], meta: { page: 1, totalPages: 2 } });
    await open(); service.list.mockRejectedValueOnce(Object.assign(new Error('离线'), { statusCode: 0 }));
    await page.onMore(); expect(page.data.rows).toHaveLength(1); expect(page.data.page).toBe(1);
    service.list.mockResolvedValueOnce({ data: [], meta: { page: 2, totalPages: 2 } });
    await page.onMore(); expect(service.list.mock.calls.slice(-2).map((args: unknown[]) => args[0])).toEqual([2, 2]);
  });
  it('clears an old pending write on account replacement and rejects its late 401', async () => {
    await detail(); page.onReasonInput({ detail: { value: '补交' } });
    let reject!: (v: unknown) => void;
    service.reject.mockImplementationOnce(() => new Promise((_yes, no) => { reject = no; }));
    page.onReject(); (global as any).wx.showModal.mock.calls.at(-1)[0].success({ confirm: true }); await flush();
    page.onHide(); key = 'new-reviewer'; page.onShow(); await flush();
    reject(Object.assign(new Error('拒绝'), { statusCode: 401 })); await flush();
    expect(page.data.viewState).not.toBe('forbidden'); expect(page.data.detail).toBeNull();
    expect(page.data.submitting).toBe(false);
  });
  it('settles an unknown old rejection when its reviewed snapshot is superseded by a new submission', async () => {
    await detail(); page.onReasonInput({ detail: { value: '补交' } });
    service.reject.mockRejectedValueOnce(Object.assign(new Error('未知'), { statusCode: 503 }));
    page.onReject(); (global as any).wx.showModal.mock.calls.at(-1)[0].success({ confirm: true }); await flush();
    expect(page.data.uncertain).toBe(true);
    service.detail.mockResolvedValueOnce({ ...snapshot(), status: 'SUBMITTED', version: 14, latest: false,
      review: { reviewId: id, decision: 'REJECTED', reason: '补交', reviewedAt: '2026-10-13T01:00:00.000Z' } });
    await page.onRetry(); expect(page.data.uncertain).toBe(false); expect(page.data.canReject).toBe(false);
    page.onClose(); await flush(); expect(page.data.detail).toBeNull();
  });
  it('releases the private read lock when refreshed detail supersedes an in-flight bank read', async () => {
    await detail(); service.bank.mockRejectedValueOnce(Object.assign(new Error('离线'), { statusCode: 0 })); await page.onBank();
    let resolve!: (v: unknown) => void;
    service.bank.mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }));
    const pending = page.onBank(); await flush(); await page.onRetry();
    expect(page.data.privateLoading).toBe(false);
    resolve({ bankInformation: { accountNumber: '旧数据' } }); await pending;
    expect(page.data.bankInformation).toBeNull();
    await page.onBank(); expect(page.data.bankInformation.accountNumber).toBe('0000123456789');
  });
  it('uses the successfully loaded keyword for pagination while an unsubmitted edit stays in the input', async () => {
    service.list.mockResolvedValueOnce({ data: [{ ...snapshot(), institutionName: '合成机构' }], meta: { page: 1, totalPages: 2 } });
    await open(); page.onKeywordInput({ detail: { value: '新关键字' } });
    await page.onMore(); expect(service.list.mock.calls[1]).toEqual([2, 'SUBMITTED', '']);
  });
  it('retains old pagination conditions if a new status query fails', async () => {
    service.list.mockResolvedValueOnce({ data: [{ ...snapshot(), institutionName: '合成机构' }], meta: { page: 1, totalPages: 2 } });
    await open(); service.list.mockRejectedValueOnce(Object.assign(new Error('离线'), { statusCode: 0 }));
    page.onStatus({ detail: { value: '1' } }); await flush(); await page.onMore();
    expect(service.list.mock.calls[2]).toEqual([2, 'SUBMITTED', '']);
  });
  it('approves once after confirmation and hides both terminal actions', async () => {
    await detail(); page.onApprove?.();
    expect((global as any).wx.showModal).toHaveBeenCalled();
    const dialog = (global as any).wx.showModal.mock.calls.at(-1)[0];
    dialog.success({ confirm: true }); dialog.success({ confirm: true }); await flush();
    expect(service.approve).toHaveBeenCalledTimes(1);
    expect(service.approve).toHaveBeenCalledWith(id, id, 9, expect.any(String));
    expect(page.data.detail.status).toBe('APPROVED'); expect(page.data.canReject).toBe(false);
    expect(service.reject).not.toHaveBeenCalled();
  });
  it('retains unknown approval key, prevents changing it into rejection, and settles on a fresh terminal read', async () => {
    await detail(); service.approve.mockRejectedValueOnce(Object.assign(new Error('未知'), { statusCode: 503 }));
    const confirm = async () => { page.onApprove?.();
      expect((global as any).wx.showModal).toHaveBeenCalled();
      (global as any).wx.showModal.mock.calls.at(-1)[0].success({ confirm: true }); await flush(); };
    await confirm(); expect(page.data.uncertain).toBe(true);
    const first = service.approve.mock.calls[0]; const dialogs = (global as any).wx.showModal.mock.calls.length;
    page.onReasonInput({ detail: { value: '改为驳回' } }); page.onReject(); await flush();
    expect((global as any).wx.showModal).toHaveBeenCalledTimes(dialogs); expect(service.reject).not.toHaveBeenCalled();
    await confirm(); expect(service.approve.mock.calls[1]).toEqual(first);
    service.detail.mockResolvedValueOnce({ ...snapshot(), status: 'APPROVED', version: 10,
      review: { reviewId: id, decision: 'APPROVED', reason: '', reviewedAt: '2026-10-13T00:00:00.000Z' } });
    await page.onRetry(); expect(page.data.uncertain).toBe(false); expect(page.data.canReject).toBe(false);
  });
  it('ignores approval confirmation after hide and does not allow approval during a rejection intent', async () => {
    await detail(); page.onApprove?.();
    expect((global as any).wx.showModal).toHaveBeenCalled();
    const dialog = (global as any).wx.showModal.mock.calls.at(-1)[0]; page.onHide(); dialog.success({ confirm: true }); await flush();
    expect(service.approve).not.toHaveBeenCalled();
    page.onShow(); await flush(); page.onReasonInput({ detail: { value: '补交' } });
    service.reject.mockRejectedValueOnce(Object.assign(new Error('未知'), { statusCode: 503 }));
    page.onReject(); (global as any).wx.showModal.mock.calls.at(-1)[0].success({ confirm: true }); await flush();
    const dialogs = (global as any).wx.showModal.mock.calls.length; page.onApprove?.(); await flush();
    expect((global as any).wx.showModal).toHaveBeenCalledTimes(dialogs); expect(service.approve).not.toHaveBeenCalled();
  });
  it.each(['success', 'failure'])('clears private details and approval intent on direct %s refresh after reviewer replacement', async (outcome) => {
    await detail(); service.approve.mockRejectedValueOnce(Object.assign(new Error('未知'), { statusCode: 503 }));
    page.onApprove(); (global as any).wx.showModal.mock.calls.at(-1)[0].success({ confirm: true }); await flush();
    const oldKey = service.approve.mock.calls[0][3]; expect(page.data.uncertain).toBe(true);
    key = 'replacement-reviewer';
    if (outcome === 'failure') service.list.mockRejectedValueOnce(Object.assign(new Error('离线'), { statusCode: 503 }));
    await page.onRetry(); await flush();
    expect(page.data.detail).toBeNull(); expect(page.data.reason).toBe(''); expect(page.intent).toBeUndefined();
    expect(page.selected).toBeUndefined(); expect(page.data.uncertain).toBe(false);
    page.onApprove(); await flush(); expect(service.approve).toHaveBeenCalledTimes(1);
    expect(service.approve.mock.calls.filter((args: unknown[]) => args[3] === oldKey)).toHaveLength(1);
  });
});
