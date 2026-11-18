import * as path from 'path';
import { PartnerWithdrawalClient, parseWithdrawalYuan } from '../pages/partner/runtime/partner-withdrawal.service';
import type { SessionHttpRequestOptions } from '../services/session.service';

const id = '00000000-0000-4000-8000-000000000001';
const profile = { version: 1, payerName: '模拟付款方', beneficiaryName: '模拟收款方', accountLabel: '模拟对公 ****1234', minimumAmountFen: 10000, dailyRequestLimit: 1 };
const summary = { simulated: true, enabled: true, campusId: id, profile, settledEntitlementFen: 100000, reservedFen: 0, paidFen: 0, availableFen: 100000, unresolvedFen: 0, requestsToday: 0, canApply: true, blockReason: '' };
const row = { id, campusId: id, campusName: '模拟校区', requestNo: 'SIM-PW-test', amountFen: 80000, status: 'SUBMITTED', version: 1, simulated: true, profile, requestedAt: '2026-10-16T00:00:00.000Z', reviewedAt: null, payingAt: null, paidAt: null, reason: null, payoutReference: null, proofFileId: null, proofOutcome: null, unresolvedFen: 0 };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

describe('partner withdrawal amount and private transport', () => {
  let sent: SessionHttpRequestOptions, token: string, service: PartnerWithdrawalClient;
  beforeEach(() => {
    token = 'synthetic-token';
    service = new PartnerWithdrawalClient({ dataDriver: 'api', apiBaseUrl: 'http://127.0.0.1:3001',
      accessToken: () => token, request: o => { sent = o; } });
  });
  it.each([['100', 10000], ['100.01', 10001], ['0.10', 10], ['21474836.47', 2147483647]])('parses %s exactly', (text, expected) => {
    expect(parseWithdrawalYuan(text)).toBe(expected);
  });
  it.each(['', '-1', '1e2', '1.001', '21474836.48', '0', 'NaN', '1,000'])('rejects %s', text => {
    expect(parseWithdrawalYuan(text)).toBeNull();
  });
  it('passes only amount and frozen profile version with the explicit original key', async () => {
    const pending = service.create({ amountFen: 80000, expectedProfileVersion: 1 }, 'synthetic-key-001');
    expect(sent).toMatchObject({ method: 'POST', data: { amountFen: 80000, expectedProfileVersion: 1 },
      header: { Authorization: 'Bearer synthetic-token', 'Idempotency-Key': 'synthetic-key-001' } });
    sent.success({ statusCode: 200, data: { data: row, requestId: 'synthetic-request' } });
    expect((await pending).amountFen).toBe(80000);
  });
  it('rejects mismatched creation receipts as unknown instead of accepting another amount', async () => {
    const pending = service.create({ amountFen: 80000, expectedProfileVersion: 1 }, 'synthetic-key-001');
    sent.success({ statusCode: 200, data: { data: { ...row, amountFen: 1 }, requestId: 'synthetic-request' } });
    await expect(pending).rejects.toMatchObject({ statusCode: 502 });
  });
  it('discards an old session reply', async () => {
    const pending = service.summary();
    token = 'new-token';
    sent.success({ statusCode: 200, data: { data: summary, requestId: 'synthetic-request' } });
    await expect(pending).rejects.toMatchObject({ statusCode: 401 });
  });
  it('does not invent cash entitlements in the ordinary Mock environment', async () => {
    const mock = new PartnerWithdrawalClient({ dataDriver: 'mock', accessToken: () => '' });
    expect(await mock.summary()).toMatchObject({ enabled: false, canApply: false, availableFen: 0 });
    await expect(mock.create({ amountFen: 80000, expectedProfileVersion: 1 }, 'synthetic-key-001')).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('partner withdrawal native Page request ownership', () => {
  let page: any, owner: string, create: jest.Mock, list: jest.Mock, runtime: any;
  beforeEach(() => {
    owner = 'owner-a'; create = jest.fn(); list = jest.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    runtime = { getSessionKey: () => owner, summary: jest.fn().mockResolvedValue(summary), list, create,
      cancel: jest.fn(), proof: jest.fn() };
    jest.doMock('../pages/partner/runtime/partner-withdrawal.service', () => ({
      ...jest.requireActual('../pages/partner/runtime/partner-withdrawal.service'), createPartnerWithdrawalClient: () => runtime,
    }));
    jest.doMock('../pages/partner/runtime/partner-pdf-font', () => ({ loadPartnerPdfDisplayFont: jest.fn().mockResolvedValue(true) }));
    (global as any).wx = { showToast: jest.fn(), reLaunch: jest.fn(), stopPullDownRefresh: jest.fn(), getStorageSync: jest.fn() };
    (global as any).Page = (definition: any) => {
      page = { ...definition, data: structuredClone(definition.data), setData: (patch: object) => Object.assign(page.data, patch) };
    };
    jest.isolateModules(() => require(path.resolve(__dirname, '../pages/partner/withdrawals/index.ts')));
  });
  afterEach(() => { page?.onUnload(); jest.dontMock('../pages/partner/runtime/partner-withdrawal.service'); delete (global as any).Page; delete (global as any).wx; });
  const open = async () => { page.onLoad(); page.onShow(); await flush(); };
  const input = (value: string) => page.onAmountInput({ detail: { value } });
  it('loads once and replays exactly the same request after an unknown outcome', async () => {
    await open(); input('800');
    create.mockRejectedValueOnce({ statusCode: 0 }).mockResolvedValueOnce(row);
    await page.onSubmit();
    const first = structuredClone(create.mock.calls[0]);
    expect(page.data.unknown).toBe(true);
    input('900');
    expect(page.data.amount).toBe('800');
    await page.onRetryAction();
    expect(create.mock.calls[1]).toEqual(first);
    expect(page.data.unknown).toBe(false);
    expect(runtime.summary).toHaveBeenCalledTimes(2);
  });
  it('shows records without an empty-state label', async () => {
    list.mockResolvedValue({ data: [row], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    await open();
    expect(page.data.rows).toHaveLength(1);
    expect(page.data.recordsEmpty).toBe(false);
  });
  it('shows a closed API without requesting a disabled financial list and can recover after enabling', async () => {
    runtime.summary.mockResolvedValueOnce({ ...summary, enabled: false, canApply: false,
      profile: null, blockReason: 'SIMULATION_DISABLED', availableFen: 0 });
    list.mockRejectedValueOnce({ statusCode: 409 });
    await open();
    expect(page.data.viewState).toBe('ready');
    expect(page.data.summary.enabled).toBe(false);
    expect(page.data.errorMessage).toBe('');
    expect(list).not.toHaveBeenCalled();
    list.mockReset().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    await page.load(true);
    expect(page.data.summary.enabled).toBe(true);
    expect(list).toHaveBeenCalledTimes(1);
  });
  it('keeps a hidden success available for original-request reconciliation on return', async () => {
    await open(); input('800');
    let complete!: (value: unknown) => void;
    create.mockReturnValueOnce(new Promise(resolve => { complete = resolve; })).mockResolvedValueOnce(row);
    const applying = page.onSubmit(); await flush(); page.onHide(); complete(row); await applying;
    expect(page.data.rows).toEqual([]);
    page.onShow(); await flush();
    expect(page.data.unknown).toBe(true);
    await page.onRetryAction();
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
  });
  it('clears private amounts and unknown actions on a changed owner', async () => {
    await open(); input('800'); create.mockRejectedValue({ statusCode: 0 }); await page.onSubmit();
    owner = 'owner-b'; page.onShow(); await flush();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.summary).toBeNull();
    expect(page.data.amount).toBe('');
    expect(page.intent).toBeUndefined();
    await page.onRetryAction();
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('clears all private state on a real read rejection', async () => {
    await open();
    list.mockRejectedValueOnce({ statusCode: 403 });
    await page.load(true);
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.rows).toEqual([]);
    expect(page.data.summary).toBeNull();
  });
});
