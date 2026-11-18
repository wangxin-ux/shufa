import * as fs from 'node:fs';
import * as path from 'node:path';
import { ApiParentDataSource, ParentHttpRequestOptions } from '../data/api-parent-data-source';
import { MockParentDataSource } from '../data/mock-parent-data-source';
import { presentCourseQuote } from '../services/parent-course-catalog.presenter';
import type { ParentCourseQuote } from '../types/parent';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.existsSync(path.join(root, file))
  ? fs.readFileSync(path.join(root, file), 'utf8') : '';

describe('parent PDF course catalog', () => {
  it.each([488000, 8888888888])('fits the full price %s without splitting digits', (priceFen) => {
    const quote = presentCourseQuote({ priceFen, mainUnits: 99900, giftUnits: 99900 } as ParentCourseQuote);
    expect(quote).toHaveProperty('priceSize');
    const size = (quote as typeof quote & { priceSize: number }).priceSize;
    expect(size * quote.priceLabel.length * 0.69).toBeLessThanOrEqual(128);
    if (priceFen === 488000) expect(size).toBe(36);
    expect(read('pages/parent/courses/index.wxml')).toContain('item.priceSize');
    expect(read('pages/parent/courses/index.wxss')).toMatch(/\.course-row__price\s*\{[^}]*white-space:\s*nowrap/s);
  });
  it('reserves a scroll gutter so expanded quote text is not covered', () => {
    expect(read('pages/parent/courses/index.wxss'))
      .toMatch(/\.quote-type\s*\{[^}]*padding-right:\s*16rpx/s);
  });
  it('routes both home more buttons to the course directory rather than campaign checkout', () => {
    expect(read('pages/parent/home/index.ts')).toContain("url: '/pages/parent/courses/index'");
    const app = JSON.parse(read('app.json'));
    expect(app.subPackages.find((item: { root: string }) => item.root === 'pages/parent').pages)
      .toContain('courses/index');
  });

  it('keeps the course list, expandable quotes, native map and offer link in one page', () => {
    const markup = read('pages/parent/courses/index.wxml');
    expect(markup).toContain('bindtap="onClassTypeTap"');
    expect(markup).toContain('<map');
    expect(markup).toContain('更多优惠活动');
    expect(markup).toContain('priceLabel');
    expect(markup).toContain('unitsLabel');
    const script = read('pages/parent/courses/index.ts');
    expect(script).toContain('wx.openLocation');
    expect(script).toContain('/pages/parent/group-campaigns/index');
    expect(script).not.toContain('createGroupTeam');
  });

  it('uses the intact camera mascot shown in the PDF course-directory page', () => {
    const markup = read('pages/parent/courses/index.wxml');
    expect(markup).toMatch(/class="catalog__mascot"\s+src="\/pages\/parent\/assets\/profile-mascot\.png"/);
    expect(markup).not.toMatch(/class="catalog__mascot"\s+src="\/pages\/parent\/assets\/home-mascot\.png"/);
  });

  it('loads real catalog pagination through authenticated GET without inventing monetary values', async () => {
    let captured: ParentHttpRequestOptions | undefined;
    const response = { data: [], meta: { page: 2, pageSize: 5, total: 0, totalPages: 0 } };
    const source = new ApiParentDataSource({
      baseUrl: 'https://example.test/api', accessToken: 'catalog-token',
      request: (options) => { captured = options; options.success({ statusCode: 200, data: response }); },
    });
    const result = await (source as unknown as {
      listCourseCatalog(query: { page: number; pageSize: number }): Promise<unknown>;
    }).listCourseCatalog({ page: 2, pageSize: 5 });
    expect(result).toEqual(response);
    expect(captured).toMatchObject({
      method: 'GET', url: 'https://example.test/api/parents/me/course-catalog?page=2&pageSize=5',
      header: { Authorization: 'Bearer catalog-token' },
    });
  });

  it('supports normal, empty and error mock scenarios with the same catalog contract', async () => {
    type CatalogSource = { listCourseCatalog(query: { page: number; pageSize: number }): Promise<{
      data: Array<{ courseName: string; primaryQuote: { priceFen: number; mainUnits: number }; classTypes: unknown[] }>;
      meta: { total: number };
    }> };
    const normal = await (new MockParentDataSource() as unknown as CatalogSource)
      .listCourseCatalog({ page: 1, pageSize: 1 });
    expect(normal.data).toHaveLength(1);
    expect(normal.data[0]).toMatchObject({ courseName: '专业美术', primaryQuote: { priceFen: 488000, mainUnits: 4800 } });
    const empty = await (new MockParentDataSource({ scenario: 'empty' }) as unknown as CatalogSource)
      .listCourseCatalog({ page: 1, pageSize: 20 });
    expect(empty.data).toEqual([]);
    await expect((new MockParentDataSource({ scenario: 'error' }) as unknown as CatalogSource)
      .listCourseCatalog({ page: 1, pageSize: 20 })).rejects.toThrow();
  });
});
