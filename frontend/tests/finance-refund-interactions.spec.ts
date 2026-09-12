const mockApi = { list: jest.fn(), detail: jest.fn(), quote: jest.fn(), submit: jest.fn(), act: jest.fn(), upload: jest.fn() };
const mockSession = { load: jest.fn() };
jest.mock('../services/session.service', () => ({ createSessionService: () => mockSession }));
jest.mock('../services/finance-refunds.service', () => ({
  ...jest.requireActual('../services/finance-refunds.service'), createRefundApi: () => mockApi,
}));
interface TestPage {
  data: Record<string, unknown>;
  setData(patch: Record<string, unknown>): void;
  onLoad(query: Record<string, string>): Promise<void>;
  load(append?: boolean): Promise<void>;
  onCreate(): void;
  onQuote(): Promise<void>;
  onFormBack(): void;
  onInput(event: { currentTarget: { dataset: { field: string } }; detail: { value: string } }): void;
  onSubmit(): Promise<void>;
  onDetail(event: { currentTarget: { dataset: { id: string } } }): Promise<void>;
  onMoreActions(): void;
  onHistory(): void;
}
const result = {
  id: 'refund-1', status: 'SUBMITTED', amountFen: 10000, referenceAmountFen: 10000,
  mainUnits: 100, giftUnits: 0, createdAt: '2026-09-07T01:00:00Z', events: [], payment: null,
};
const quote = { mainUnits: 100, giftUnits: 0, referenceAmountFen: 10000, suggestedAmountFen: 10000, maxAmountFen: 120000 };
describe('refund page mutations and async boundaries', () => {
  let page: TestPage;
  const oldPage = Object.getOwnPropertyDescriptor(globalThis, 'Page');
  const oldWx = Object.getOwnPropertyDescriptor(globalThis, 'wx');
  beforeEach(() => {
    jest.resetAllMocks();
    Object.defineProperty(globalThis, 'wx', { configurable: true, value: {
      getWindowInfo: () => ({ windowWidth: 430 }), getMenuButtonBoundingClientRect: () => ({ top: 20, left: 300 }),
      showActionSheet: jest.fn(),
    } });
    Object.defineProperty(globalThis, 'Page', { configurable: true, value: (definition: TestPage) => {
      page = definition; page.setData = (patch) => Object.assign(page.data, patch);
    } });
    jest.isolateModules(() => require('../services/finance-refunds.page').registerRefundPage('FINANCE'));
    mockSession.load.mockResolvedValue({ roles: [{ code: 'FINANCE', campusId: null }] });
    mockApi.list.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
  });
  afterEach(() => {
    if (oldPage) Object.defineProperty(globalThis, 'Page', oldPage); else Reflect.deleteProperty(globalThis, 'Page');
    if (oldWx) Object.defineProperty(globalThis, 'wx', oldWx); else Reflect.deleteProperty(globalThis, 'wx');
  });
  it('does not bypass a rejected identity through a list retry', async () => {
    mockSession.load.mockResolvedValue({ roles: [{ code: 'HR', campusId: null }] });
    await page.onLoad({});
    await page.load();
    expect(mockApi.list).not.toHaveBeenCalled();
  });
  it('opens exception confirmation from the menu without performing a write', async () => {
    await page.onLoad({});
    mockApi.detail.mockResolvedValue({ ...result, status: 'PAYING', version: 3 });
    await page.onDetail({ currentTarget: { dataset: { id: result.id } } });
    expect(page.data.showHistory).toBe(false);
    page.onHistory();
    expect(page.data.showHistory).toBe(true);
    page.onMoreActions();
    const menu = (wx.showActionSheet as jest.Mock).mock.calls[0][0];
    expect(menu.itemList).toEqual(['标记待核实']);
    menu.success({ tapIndex: 0 });
    expect(page.data.actionCode).toBe('MARK_UNCERTAIN');
    expect(mockApi.act).not.toHaveBeenCalled();
    page.setData({ formMode: '', detail: null });
    menu.success({ tapIndex: 0 });
    expect(page.data.formMode).toBe('');
  });
  it('discards a quote returned after closing and reopening the draft', async () => {
    await page.onLoad({});
    page.setData({ receiptId: 'receipt-1' });
    page.onCreate();
    page.setData({ mainLessons: '1' });
    let finish!: (value: unknown) => void;
    mockApi.quote.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = page.onQuote();
    page.onFormBack();
    page.onCreate();
    finish(quote);
    await pending;
    expect(page.data.quote).toBeNull();
    expect(page.data.quoting).toBe(false);
  });
  it('keeps the same payload and key after an uncertain network result', async () => {
    await page.onLoad({});
    page.setData({ receiptId: 'receipt-1' });
    page.onCreate();
    page.setData({ mainLessons: '1', quote, amount: '100.00', reason: '部分退课' });
    mockApi.submit.mockRejectedValueOnce(new Error('网络中断')).mockResolvedValueOnce(result);
    await page.onSubmit();
    expect(page.data.formMode).toBe('create');
    const call = mockApi.submit.mock.calls[0];
    await page.onSubmit();
    expect(mockApi.submit.mock.calls[1]).toEqual(call);
    expect(page.data.formMode).toBe('');
  });
  it('releases quote loading when lesson quantities invalidate a pending quote', async () => {
    await page.onLoad({});
    page.setData({ receiptId: 'receipt-1' });
    page.onCreate();
    page.setData({ mainLessons: '1' });
    let finish!: (value: unknown) => void;
    mockApi.quote.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = page.onQuote();
    page.onInput({ currentTarget: { dataset: { field: 'mainLessons' } }, detail: { value: '2' } });
    finish(quote);
    await pending;
    expect(page.data.quote).toBeNull();
    expect(page.data.quoting).toBe(false);
  });
});
