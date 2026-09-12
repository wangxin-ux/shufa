import * as fs from 'fs';
import * as path from 'path';

interface FinanceHomePage {
  data: Record<string, any>;
  setData(patch: Record<string, unknown>): void;
  initialize(): Promise<void>;
  onActionTap(event: { currentTarget: { dataset: { key?: string } } }): void;
  onLogoutTap(): void;
}

const sessionService = {
  load: jest.fn(),
  logout: jest.fn(),
  logoutDestination: '/pages/bootstrap/index',
};
const financeService = { list: jest.fn() };
const refundApi = { list: jest.fn() };
const reportService = { lessonConsumption: jest.fn() };

jest.mock('../services/session.service', () => ({ sessionService }));
jest.mock('../services/finance.service', () => ({
  createFinanceService: () => financeService,
  financeToday: () => '2026-09-09',
}));
jest.mock('../services/finance-refunds.service', () => ({
  createRefundApi: () => refundApi,
}));
jest.mock('../services/finance-reports.service', () => ({
  createFinanceReportsService: () => reportService,
}));

describe('finance home', () => {
  const originalPage = Object.getOwnPropertyDescriptor(globalThis, 'Page');
  const originalWx = Object.getOwnPropertyDescriptor(globalThis, 'wx');
  let page: FinanceHomePage;
  const navigateTo = jest.fn();
  const reLaunch = jest.fn();
  const showToast = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    financeService.list.mockResolvedValue({
      items: [],
      total: 36,
      page: 1,
      pageSize: 1,
      summary: {
        amountFen: 0,
        correctionEffectFen: 0,
        netAmountFen: 0,
        unlinkedCount: 0,
      },
    });
    refundApi.list.mockResolvedValue({ items: [], total: 7, page: 1, pageSize: 1 });
    reportService.lessonConsumption.mockResolvedValue({
      items: [],
      total: 12,
      page: 1,
      pageSize: 1,
      summary: {
        mainUnits: 0,
        giftUnits: 0,
        knownAmountFen: 0,
        pendingCheckCount: 3,
      },
    });
    Object.defineProperty(globalThis, 'wx', {
      configurable: true,
      value: {
        getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 430 }),
        getMenuButtonBoundingClientRect: () => ({ top: 24, left: 332, height: 32 }),
        navigateTo,
        reLaunch,
        showToast,
        stopPullDownRefresh: jest.fn(),
      },
    });
    Object.defineProperty(globalThis, 'Page', {
      configurable: true,
      value: (definition: FinanceHomePage) => {
        page = definition;
        page.setData = (patch) => Object.assign(page.data, patch);
      },
    });
    jest.isolateModules(() => require('../pages/finance/home/index'));
  });

  afterAll(() => {
    if (originalPage) Object.defineProperty(globalThis, 'Page', originalPage);
    else Reflect.deleteProperty(globalThis, 'Page');
    if (originalWx) Object.defineProperty(globalThis, 'wx', originalWx);
    else Reflect.deleteProperty(globalThis, 'wx');
  });

  it('accepts only a single headquarters FINANCE session', async () => {
    sessionService.load.mockResolvedValue({
      userId: 'finance-1',
      displayName: '总部财务',
      roles: [{ code: 'FINANCE', campusId: null }],
    });

    await page.initialize();

    expect(page.data).toMatchObject({
      viewState: 'ready',
      displayName: '总部财务',
      identityLabel: '总部财务',
      workItems: [
        { key: 'receipts', label: '收款记录', value: '36', unit: '笔' },
        { key: 'refunds', label: '退费申请', value: '7', unit: '笔' },
        { key: 'hours', label: '待核对课耗', value: '3', unit: '笔' },
      ],
    });
    expect(financeService.list).toHaveBeenCalledWith({ page: 1, pageSize: 1 });
    expect(refundApi.list).toHaveBeenCalledWith({ page: 1, pageSize: 1 });
    expect(reportService.lessonConsumption).toHaveBeenCalledWith({
      from: '2026-09-01',
      to: '2026-09-09',
      page: 1,
      pageSize: 1,
    });

    sessionService.load.mockResolvedValue({
      userId: 'admin-1',
      displayName: '系统管理员',
      roles: [{ code: 'SUPER_ADMIN', campusId: null }],
    });
    await page.initialize();
    expect(page.data).toMatchObject({
      viewState: 'forbidden',
      errorMessage: '当前账号无财务端访问权限',
    });
  });

  it('does not present zeroes as real metrics when a dashboard request fails', async () => {
    sessionService.load.mockResolvedValue({
      userId: 'finance-1',
      displayName: '总部财务',
      roles: [{ code: 'FINANCE', campusId: null }],
    });
    refundApi.list.mockRejectedValue(new Error('退费统计加载失败'));

    await page.initialize();

    expect(page.data).toMatchObject({
      viewState: 'error',
      errorMessage: '退费统计加载失败',
      workItems: [
        expect.objectContaining({ value: '0' }),
        expect.objectContaining({ value: '0' }),
        expect.objectContaining({ value: '0' }),
      ],
    });
  });

  it.each([
    ['packages', '/pages/finance/packages/index'],
    ['receipts', '/pages/finance/receipts/index'],
    ['hours', '/pages/finance/hours/index'],
    ['refunds', '/pages/finance/refunds/index'],
    ['profile', '/pages/finance/profile/index'],
    ['more', '/pages/finance/more/index'],
  ])('routes %s to an existing finance page', (key, url) => {
    page.onActionTap({ currentTarget: { dataset: { key } } });
    expect(navigateTo).toHaveBeenCalledWith({
      url,
      fail: expect.any(Function),
    });
  });

  it('opens profile from the name and keeps it out of bottom navigation', () => {
    expect(
      page.data.actions.map(({ key, label }: { key: string; label: string }) => ({ key, label })),
    ).toEqual([
      { key: 'receipts', label: '收款' },
      { key: 'hours', label: '课时' },
      { key: 'refunds', label: '退课' },
      { key: 'packages', label: '课包' },
    ]);
    const markup = fs.readFileSync(
      path.resolve(__dirname, '../pages/finance/home/index.wxml'),
      'utf8',
    );
    expect(markup).toMatch(
      /<button\s+class="home__identity"\s+data-key="profile"\s+bindtap="onActionTap"/s,
    );

    page.onActionTap({ currentTarget: { dataset: { key: 'unknown' } } });
    expect(showToast).toHaveBeenCalledWith({ title: '入口暂不可用', icon: 'none' });
  });

  it('uses logout as the only account-exit flow', () => {
    page.onLogoutTap();
    expect(sessionService.logout).toHaveBeenCalledTimes(1);
    expect(reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  });

  it('keeps the established role-home composition with finance-owned artwork', () => {
    const pageDir = path.resolve(__dirname, '../pages/finance/home');
    const wxml = fs.readFileSync(path.join(pageDir, 'index.wxml'), 'utf8');
    const wxss = fs.readFileSync(path.join(pageDir, 'index.wxss'), 'utf8');
    const json = fs.readFileSync(path.join(pageDir, 'index.json'), 'utf8');
    const ts = fs.readFileSync(path.join(pageDir, 'index.ts'), 'utf8');
    const source = [wxml, wxss, json, ts].join('\n');
    const config = JSON.parse(json) as {
      usingComponents?: Record<string, string>;
    };

    for (const state of ['loading', 'ready', 'error', 'forbidden']) {
      expect(source).toContain(state);
    }
    for (const key of ['packages', 'receipts', 'hours', 'refunds']) {
      expect(ts).toContain(`key: '${key}'`);
    }
    expect(ts).not.toContain("key: 'home'");
    expect(config.usingComponents?.['super-admin-page-shell']).toBe(
      '/components/super-admin-page-shell/super-admin-page-shell',
    );
    expect(wxml).toContain('<super-admin-page-shell');
    expect(wxml).toContain('data-key="more"');
    expect(source).not.toContain('/assets/super-admin/home-stat-glass.png');
    expect(wxml).toContain('class="home__work-glass"');
    expect(wxml).toContain('/pages/finance/assets/home-stat-glass.png');
    expect(wxml).toContain('{{item.value}}');
    expect(wxml).toContain('{{item.unit}}');
    expect(wxml).toContain('日常财务');
    expect(wxml).toContain('课包录入');
    expect(wxml).toContain('/pages/finance/assets/home-character.png');
    expect(wxml).toContain('/pages/finance/assets/home-mark-glyph.png');
    for (const asset of [
      'icon-receipts.png',
      'icon-corrections.png',
      'icon-reports.png',
      'icon-refunds.png',
    ]) {
      expect(source).toContain(`/pages/finance/assets/${asset}`);
    }
    expect(wxml).toContain('class="home__work-strip"');
    expect(wxml).toContain('class="quick-actions"');
    expect(wxml).not.toContain('quick-actions--active-first');
    expect(wxml).toContain('class="home__footer-more"');
    expect(wxml).not.toContain('class="home__logout"');
    expect(wxml).not.toContain('class="home__identity-row"');
    expect(wxml).toContain("item.key === 'packages' ? 'quick-action--active' : ''");
    expect(source).not.toMatch(/pages\/(?:teacher|partner|campus-manager|super-admin)\/assets\/home-character\.png/);
    expect(source).not.toMatch(/凯曼|教育赋能|Kaiman|Empowering Education/i);
    expect(source).not.toContain('全校区职责范围');
    expect(source).not.toMatch(/home__work-command">(?:登记|办理|查看)</);
    expect(wxss).toMatch(/\.home__stage\s*\{[^}]*height:\s*800rpx[^}]*margin:\s*-74rpx -32rpx 0/s);
    expect(wxss).toMatch(/\.home__stage\s*\{[^}]*overflow:\s*visible/s);
    expect(wxss).toMatch(/\.home__character\s*\{[^}]*top:\s*-10rpx[^}]*left:\s*95rpx[^}]*width:\s*655rpx[^}]*pointer-events:\s*none/s);
    expect(wxss).toMatch(
      /\.home__identity\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*218rpx/s,
    );
    expect(wxss).toMatch(/\.home__work-strip\s*\{[^}]*right:\s*var\(--role-home-glass-right\)[^}]*bottom:\s*68rpx[^}]*left:\s*var\(--role-home-glass-left\)[^}]*background:\s*transparent/s);
    expect(wxss).toMatch(/\.quick-actions\s*\{[^}]*width:\s*var\(--role-home-nav-width\)/s);
    expect(wxss).toMatch(/\.quick-actions::before\s*\{[^}]*width:\s*var\(--role-home-nav-capsule-width\)[^}]*height:\s*var\(--role-home-nav-capsule-height\)/s);
    expect(wxss).not.toContain('.quick-actions--active-first::before');
    expect(wxss).toMatch(/\.home__footer-more\s*\{[^}]*align-self:\s*flex-start[^}]*\}/s);
    expect(wxss).not.toMatch(
      /\.home__footer-more\s*\{[^}]*(?:background:\s*var\(--role-home-nav-background\)|box-shadow:\s*var\(--role-home-nav-shadow\))/s,
    );
    expect(wxss).toMatch(/\.home__footer\s*\{[^}]*z-index:\s*3[^}]*justify-content:\s*space-between[^}]*min-height:\s*166rpx[^}]*margin-top:\s*-32rpx[^}]*padding:\s*0 16rpx/s);
    expect(source).not.toContain('home__wave');
    const character = fs.readFileSync(
      path.resolve(__dirname, '../pages/finance/assets/home-character.png'),
    );
    expect(character.readUInt32BE(20) / character.readUInt32BE(16)).toBeGreaterThan(1.5);
  });
});
