export {};

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

const loadCatalog = jest.fn();
const loadCampuses = jest.fn();
const logout = jest.fn();
jest.mock('../services/parent-runtime', () => ({
  parentService: { loadCourseCatalog: (query: unknown) => loadCatalog(query), loadCampuses: (query: unknown) => loadCampuses(query) },
}));
jest.mock('../services/session.service', () => ({ sessionService: { logout: () => logout() } }));

interface CatalogPage {
  data: Record<string, any>;
  setData(values: Record<string, unknown>): void;
  load(): Promise<void>;
  onClassTypeTap(event: unknown): void;
  onCloseQuotes(): void;
  onNavigateTap(event: unknown): void;
  onMarkerTap(event: unknown): void;
  onOffersTap(): void;
  onUnload(): void;
}

describe('course directory page interactions', () => {
  let page: CatalogPage;
  const campus = { id: 'east', name: '公开东校区', address: '测试路', contactPhone: null,
    latitude: 28.2, longitude: 112.9, distanceMeters: null };
  const quote = { productId: 'product', productName: '书法课包', classType: '学习班',
    priceFen: 388001, mainUnits: 4800, giftUnits: 1200, validityDays: 365, campus };
  const course = { courseName: '硬笔书法', primaryQuote: quote, classTypes: [{ name: '学习班', quotes: [quote] }] };
  const meta = { page: 1, pageSize: 100, total: 1, totalPages: 1 };

  beforeEach(() => {
    loadCatalog.mockReset().mockResolvedValue({ status: 'success', data: { data: [course], meta } });
    loadCampuses.mockReset().mockResolvedValue({ status: 'success', data: { data: [campus], meta } });
    logout.mockReset();
    (global as any).wx = { openLocation: jest.fn(), showToast: jest.fn(), navigateTo: jest.fn(), reLaunch: jest.fn() };
    (global as any).Page = (config: CatalogPage) => {
      page = { ...config, data: { ...config.data } };
      page.setData = (values) => Object.assign(page.data, values);
    };
    jest.isolateModules(() => require('../pages/parent/courses/index'));
  });
  afterEach(() => {
    delete (global as any).Page;
    delete (global as any).wx;
  });

  it('shows quote amounts with their units and navigates only the selected public campus', async () => {
    await page.load();
    expect(page.data.courses[0]).toMatchObject({ priceLabel: '3880.01¥', unitsLabel: '48节 + 赠12节' });
    page.onClassTypeTap({ currentTarget: { dataset: { name: course.courseName } } });
    expect(page.data.activeCourse.courseName).toBe(course.courseName);
    page.onNavigateTap({ currentTarget: { dataset: { id: campus.id } } });
    expect((global as any).wx.openLocation).toHaveBeenCalledWith(expect.objectContaining({
      name: campus.name, address: campus.address, latitude: campus.latitude, longitude: campus.longitude,
    }));
    page.onNavigateTap({ currentTarget: { dataset: { id: 'unpublished-campus' } } });
    expect((global as any).wx.openLocation).toHaveBeenCalledTimes(1);
    page.onOffersTap();
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/parent/group-campaigns/index' });
  });

  it('fits raw price cases using the shipped WOFF advances rather than the sizing formula', async () => {
    const root = path.resolve(__dirname, '../..');
    const [input] = JSON.parse(fs.readFileSync(path.join(root,
      'docs/verification/fixtures/parent-courses-price-input.json'), 'utf8'));
    const metrics = JSON.parse(fs.readFileSync(path.join(root,
      'docs/verification/parent-course-price-2026-10-11/font-metrics-free-campaign-2026-10-13-v2.json'), 'utf8')).font;
    const font = fs.readFileSync(path.join(root, metrics.source));
    expect(createHash('sha256').update(font).digest('hex')).toBe(metrics.sha256);
    const cases = input.pricesFen.map((priceFen: number, index: number) => {
      const rawQuote = { ...quote, campus: input.campus, priceFen, mainUnits: input.mainUnits,
        giftUnits: input.giftUnits, productId: `synthetic-price-${index}`,
        productName: input.productName, classType: input.classType, validityDays: input.validityDays };
      return { courseName: `${input.courseName}${index + 1}`, primaryQuote: rawQuote,
        classTypes: [{ name: input.classType, quotes: [rawQuote] }] };
    });
    const original = JSON.stringify(cases);
    loadCatalog.mockResolvedValue({ status: 'success', data: { data: cases, meta: { ...meta, total: cases.length } } });
    await page.load();
    expect(page.data.courses.map((item: { priceLabel: string }) => item.priceLabel))
      .toEqual(['0¥', '0.01¥', '4880¥', '3880.01¥', '14444444¥', '21474836.47¥']);
    for (const item of page.data.courses) {
      const advanceEm = [...item.priceLabel as string].reduce((total, character) =>
        total + metrics.glyphs[character].advance / metrics.unitsPerEm, 0);
      expect(advanceEm * item.priceSize).toBeLessThanOrEqual(128);
      expect(item.priceSize).toBeGreaterThanOrEqual(15);
      expect(item.quotePanelHeight).toBe(108);
      page.onClassTypeTap({ currentTarget: { dataset: { name: item.courseName } } });
      expect(page.data.activeCourse).toBe(item);
      expect(page.data.activeCourse.classTypes[0].quotes[0])
        .toMatchObject({ priceFen: item.primaryQuote.priceFen, priceLabel: item.priceLabel,
          priceSize: item.priceSize, unitsLabel: '999节 + 赠999节' });
      page.onClassTypeTap({ currentTarget: { dataset: { name: item.courseName } } });
      expect(page.data.activeCourse).toBeNull();
    }
    expect(JSON.stringify(cases)).toBe(original);
    expect((global as any).wx.openLocation).not.toHaveBeenCalled();
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
  });

  it('keeps all quotes in a capped scroll panel and closes without map or offer side effects', async () => {
    const quotes = Array.from({ length: 8 }, (_, index) => ({
      ...quote, productId: `synthetic-many-${index}`, priceFen: 488000 + index,
    }));
    loadCatalog.mockResolvedValue({ status: 'success',
      data: { data: [{ ...course, classTypes: [{ name: '学习班', quotes }] }], meta } });
    await page.load();
    page.onClassTypeTap({ currentTarget: { dataset: { name: course.courseName } } });
    expect(page.data.activeCourse.quotePanelHeight).toBe(390);
    expect(page.data.activeCourse.classTypes[0].quotes.map((item: { productId: string }) => item.productId))
      .toEqual(quotes.map((item) => item.productId));
    page.onCloseQuotes();
    expect(page.data.activeCourse).toBeNull();
    page.onClassTypeTap({ currentTarget: { dataset: { name: '未上架课程' } } });
    expect(page.data.activeCourse).toBeNull();
    expect((global as any).wx.openLocation).not.toHaveBeenCalled();
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
  });

  it('loads every catalog page and preserves the map when courses fail', async () => {
    loadCatalog.mockResolvedValueOnce({ status: 'success', data: { data: [course], meta: { ...meta, total: 2, totalPages: 2 } } })
      .mockResolvedValueOnce({ status: 'success', data: { data: [{ ...course, courseName: '美术' }], meta: { ...meta, page: 2, total: 2, totalPages: 2 } } });
    await page.load();
    expect(page.data.courses).toHaveLength(2);
    expect(loadCatalog).toHaveBeenNthCalledWith(2, { page: 2, pageSize: 100 });
    loadCatalog.mockResolvedValue({ status: 'error', message: '课程加载失败' });
    await page.load();
    expect(page.data.viewState).toBe('error');
    expect(page.data.mapState).toBe('ready');
  });

  it('keeps empty course/map states independent and clears an expired session', async () => {
    await page.load();
    loadCatalog.mockResolvedValue({ status: 'empty', data: { data: [], meta: { ...meta, total: 0, totalPages: 0 } } });
    loadCampuses.mockResolvedValue({ status: 'empty', data: { data: [], meta: { ...meta, total: 0, totalPages: 0 } } });
    await page.load();
    expect(page.data.viewState).toBe('empty');
    expect(page.data.mapState).toBe('empty');
    expect(page.data.selectedCampus).toBeNull();
    expect(page.data.markers).toEqual([]);
    loadCatalog.mockResolvedValue({ status: 'error', message: '登录已失效', statusCode: 401 });
    await page.load();
    expect(logout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  });

  it('ignores a pending response after leaving the page', async () => {
    let complete!: (value: unknown) => void;
    loadCatalog.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const loading = page.load();
    page.onUnload();
    complete({ status: 'success', data: { data: [course], meta } });
    await loading;
    expect(page.data.viewState).toBe('loading');
    expect(page.data.courses).toEqual([]);
  });
});
