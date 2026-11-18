import * as path from 'path';
const id = '00000000-0000-4000-8000-000000000001';
const profile = { version: 1, payerName: '模拟付款方', beneficiaryName: '模拟收款方', accountLabel: '模拟对公 ****1234', minimumAmountFen: 10000, dailyRequestLimit: 1 };
const summary = { simulated: true, enabled: true, campusId: id, profile, availableFen: 100000, reservedFen: 0, paidFen: 0, unresolvedFen: 0, requestsToday: 0, canApply: true, blockReason: '' };
const row = { id, campusId: id, campusName: '模拟校区', requestNo: 'SIM-PW-test', amountFen: 80000, status: 'PAYING', version: 3, simulated: true, profile, requestedAt: '2026-10-16T00:00:00.000Z', reviewedAt: '2026-10-16T00:00:01.000Z', payingAt: '2026-10-16T00:00:02.000Z', paidAt: null, reason: null, payoutReference: null, proofFileId: id, proofOutcome: 'PAID', unresolvedFen: 0 };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
describe('headquarters partner withdrawal Page', () => {
  let page: any, owner: string, client: any, action: jest.Mock, sources: jest.Mock;
  beforeEach(() => {
    owner = 'owner-a'; action = jest.fn().mockResolvedValue({ ...row, status: 'PAID', version: 4 });
    sources = jest.fn().mockResolvedValue({ data: [], meta: { page: 1, total: 0, totalPages: 0, pageSize: 20 } });
    client = { getSessionKey: () => owner, isMock: false,
      campuses: jest.fn().mockResolvedValue({ data: [{ id, name: '模拟校区' }], meta: { page: 1, totalPages: 1 } }),
      summary: jest.fn().mockResolvedValue(summary), sources, list: jest.fn().mockResolvedValue({ data: [row], meta: { page: 1, total: 1, totalPages: 1 } }),
      configure: jest.fn(), confirm: jest.fn(), action };
    jest.doMock('../pages/super-admin/runtime/partner-withdrawal.service', () => ({
      createManagedPartnerWithdrawalClient: () => client,
    }));
    (global as any).wx = { showToast: jest.fn(), reLaunch: jest.fn(), getStorageSync: jest.fn(), stopPullDownRefresh: jest.fn() };
    (global as any).Page = (definition: any) => {
      page = { ...definition, data: structuredClone(definition.data), setData: (patch: object) => Object.assign(page.data, patch) };
    };
    jest.isolateModules(() => require(path.resolve(__dirname, '../pages/super-admin/partner-withdrawals/index.ts')));
  });
  afterEach(() => { page?.onUnload(); jest.dontMock('../pages/super-admin/runtime/partner-withdrawal.service'); delete (global as any).wx; delete (global as any).Page; });
  const open = async () => { page.onLoad(); page.onShow(); await flush(); };
  const event = (action: string) => ({ currentTarget: { dataset: { id, action } } });
  it('selects an actual campus and opens both source and withdrawal lists', async () => {
    await open();
    expect(page.data.campusId).toBe(id);
    expect(client.summary).toHaveBeenCalledWith(id);
    expect(client.list).toHaveBeenCalledWith(id, 1);
    expect(sources).toHaveBeenCalledWith(id, 1);
    expect(page.data.minimumAmount).toBe('100.00');
    expect(page.data.recordsEmpty).toBe(false);
    expect(page.data.sourcesEmpty).toBe(true);
  });
  it('keeps unknown paid confirmation stable including timestamp and evidence', async () => {
    await open(); page.onSelect({ currentTarget: { dataset: { id } } });
    page.onField({ currentTarget: { dataset: { field: 'payoutReference' } }, detail: { value: 'SIM-local-reference' } });
    action.mockRejectedValueOnce({ statusCode: 0 });
    await page.onAction(event('mark-paid'));
    expect(page.data.unknown).toBe(true);
    await page.onRetryAction();
    expect(action.mock.calls[1]).toEqual(action.mock.calls[0]);
    expect(action.mock.calls[0][2]).toMatchObject({ expectedVersion: 3, amountFen: 80000, accountVersion: 1, proofFileId: id, payoutReference: 'SIM-local-reference', paidAt: expect.any(String) });
  });
  it('requires explicit nonpayment confirmation before releasing unknown funds', async () => {
    await open(); page.onSelect({ currentTarget: { dataset: { id } } });
    await page.onAction(event('mark-failed'));
    expect(action).not.toHaveBeenCalled();
    expect(page.data.actionMessage).toContain('未付款');
  });
  it('cannot create paid evidence before payment starts', async () => {
    client.list.mockResolvedValue({ data: [{ ...row, status: 'APPROVED', proofFileId: null, proofOutcome: null }],
      meta: { page: 1, total: 1, totalPages: 1 } });
    await open(); page.onSelect({ currentTarget: { dataset: { id } } });
    page.onField({ currentTarget: { dataset: { field: 'reason' } }, detail: { value: '模拟核对原因' } });
    await page.onAction({ currentTarget: { dataset: { action: 'mock-proof', outcome: 'PAID' } } });
    expect(action).not.toHaveBeenCalled();
    expect(page.data.actionMessage).toContain('开始');
  });
  it('does not start payment after nonpayment evidence is bound', async () => {
    client.list.mockResolvedValue({ data: [{ ...row, status: 'APPROVED', proofOutcome: 'UNPAID' }],
      meta: { page: 1, total: 1, totalPages: 1 } });
    await open(); page.onSelect({ currentTarget: { dataset: { id } } });
    await page.onAction(event('mark-paying'));
    expect(action).not.toHaveBeenCalled();
    expect(page.data.actionMessage).toContain('未付');
  });
  it('labels historical unspecified evidence as needing verification', async () => {
    client.list.mockResolvedValue({ data: [{ ...row, proofOutcome: null }],
      meta: { page: 1, total: 1, totalPages: 1 } });
    await open(); page.onSelect({ currentTarget: { dataset: { id } } });
    expect(page.data.selected.proofLabel).toBe('旧凭证待核对');
  });
  it('clears beneficiary, sources and unknown writes on owner replacement', async () => {
    await open(); page.onSelect({ currentTarget: { dataset: { id } } }); owner = 'owner-b';
    page.onShow(); await flush();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.summary).toBeNull();
    expect(page.data.rows).toEqual([]);
    expect(page.data.sources).toEqual([]);
    expect(page.data.selected).toBeNull();
  });
  it('handles a late forbidden source reply even when another read already failed', async () => {
    await open();
    let deny!: (error: unknown) => void;
    client.summary.mockRejectedValueOnce({ statusCode: 503 });
    sources.mockReturnValueOnce(new Promise((_yes, reject) => { deny = reject; }));
    await page.load(true); deny({ statusCode: 403 }); await flush();
    expect(page.data.viewState).toBe('forbidden');
  });
});
