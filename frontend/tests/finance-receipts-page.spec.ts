interface PreviewPage {
  data: {
    previewEnabled: boolean;
    viewState: string;
    rows: Array<{ id: string }>;
    detail: { studentName: string } | null;
    keyword: string;
    total: number;
    startDate: string;
    endDate: string;
    errorMessage: string;
  };
  setData(patch: Record<string, unknown>): void;
  onLoad(query: Record<string, string>): void;
  onKeywordInput(event: { detail: { value: string } }): void;
  onReceiptTap(event: { currentTarget: { dataset: { id: string } } }): void;
  onCloseDetail(): void;
  onLoadMore(): void;
  onReset(): void;
  reload(): void;
}

describe('finance preview page lifecycle', () => {
  const originalPage = Object.getOwnPropertyDescriptor(globalThis, 'Page');
  const originalWx = Object.getOwnPropertyDescriptor(globalThis, 'wx');
  let page: PreviewPage;
  const request = jest.fn();
  const setStorageSync = jest.fn();

  function mount(version = 'develop', query = { preview: '1' }) {
    Object.defineProperty(globalThis, 'Page', {
      configurable: true,
      value: (definition: PreviewPage) => {
        page = definition;
        page.setData = (patch) => Object.assign(page.data, patch);
      },
    });
    Object.defineProperty(globalThis, 'wx', {
      configurable: true,
      value: {
        getAccountInfoSync: () => ({ miniProgram: { envVersion: version } }),
        getWindowInfo: () => ({ statusBarHeight: 54, windowWidth: 430 }),
        getMenuButtonBoundingClientRect: () => ({ height: 32, top: 58, left: 330 }),
        request,
        setStorageSync,
      },
    });
    jest.isolateModules(() => require('../pages/finance/receipts/index'));
    page.onLoad(query);
    return page;
  }

  afterEach(() => {
    expect(request).not.toHaveBeenCalled();
    expect(setStorageSync).not.toHaveBeenCalled();
    if (originalPage) Object.defineProperty(globalThis, 'Page', originalPage);
    else Reflect.deleteProperty(globalThis, 'Page');
    if (originalWx) Object.defineProperty(globalThis, 'wx', originalWx);
    else Reflect.deleteProperty(globalThis, 'wx');
  });

  it('does not load fixtures in release or without explicit preview', () => {
    for (const current of [mount('release'), mount('develop', { preview: '' })]) {
      expect(current.data.viewState).toBe('forbidden');
      expect(current.data.rows).toEqual([]);
      current.onReceiptTap({ currentTarget: { dataset: { id: 'preview-receipt-1' } } });
      expect(current.data.detail).toBeNull();
    }
  });

  it('runs search, empty state and reset through real page handlers', () => {
    const current = mount();
    expect(current.data.viewState).toBe('ready');
    expect(current.data.total).toBe(5);
    current.onKeywordInput({ detail: { value: '不存在的学员' } });
    expect(current.data.viewState).toBe('empty');
    current.onReset();
    expect(current.data.total).toBe(5);
    current.onKeywordInput({ detail: { value: '陈晨' } });
    expect(current.data.total).toBe(1);
  });

  it('appends pages, opens and closes read-only detail without any persistence', () => {
    const current = mount();
    current.onLoadMore();
    expect(current.data.rows).toHaveLength(5);
    current.onReceiptTap({ currentTarget: { dataset: { id: 'preview-receipt-1' } } });
    expect(current.data.detail?.studentName).toBe('陈晨');
    current.onCloseDetail();
    expect(current.data.detail).toBeNull();
  });

  it('clears stale financial results when the date range is invalid', () => {
    const current = mount();
    current.setData({ startDate: '2026-09-07' });
    current.reload();
    expect(current.data.viewState).toBe('error');
    expect(current.data.rows).toEqual([]);
    expect(current.data.total).toBe(0);
    expect(current.data.errorMessage).toBe('开始日期不能晚于结束日期');
  });
});
