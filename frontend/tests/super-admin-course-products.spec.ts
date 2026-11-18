import * as fs from 'node:fs';
import * as path from 'node:path';
import { MockSuperAdminDataSource } from '../data/mock-super-admin-data-source';
import { ApiSuperAdminDataSource, SuperAdminHttpRequest } from '../data/api-super-admin-data-source';

describe('course product management workflow', () => {
  it('has a reachable native management page and guarded actions', () => {
    const root = path.resolve(__dirname, '..');
    const file = path.join(root, 'pages/super-admin/course-products/index.wxml');
    const markup = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    for (const label of ['课程名称', '班型', '课包名称', '价格', '购买课时', '赠送课时', '有效天数', '保存草稿', '上架', '下架']) {
      expect(markup).toContain(label);
    }
    expect(fs.readFileSync(path.join(root, 'pages/super-admin/group-campaigns/index.ts'), 'utf8'))
      .toContain('/pages/super-admin/course-products/index');
  });

  it('implements mock product lifecycle rather than recreating products from campaign snapshots', () => {
    const source = new MockSuperAdminDataSource();
    expect(typeof (source as unknown as Record<string, unknown>).createCourseProduct).toBe('function');
    expect(typeof (source as unknown as Record<string, unknown>).updateCourseProduct).toBe('function');
    expect(typeof (source as unknown as Record<string, unknown>).transitionCourseProduct).toBe('function');
  });

  it('keeps mock product updates, versions, retirement and replay consistent', async () => {
    const source = new MockSuperAdminDataSource();
    const input = { campusId: 'campus', name: '课包', courseName: '书法', classType: '常规班',
      summary: '基础书写', priceFen: 388000, mainUnits: 4800, giftUnits: 0, validityDays: 365 };
    const draft = await source.createCourseProduct(input, 'product-create');
    expect(await source.createCourseProduct(input, 'product-create')).toEqual(draft);
    const updated = await source.updateCourseProduct(draft.id, { ...input, classType: '学习班' }, 1, 'product-update');
    expect(updated.version).toBe(2);
    const active = await source.transitionCourseProduct(draft.id, 'activate', 2, 'product-activate');
    expect(active.status).toBe('ACTIVE');
    await expect(source.updateCourseProduct(draft.id, input, 3, 'product-active-edit')).rejects.toThrow();
    const retired = await source.transitionCourseProduct(draft.id, 'retire', 3, 'product-retire');
    expect(await source.transitionCourseProduct(draft.id, 'retire', 3, 'product-retire')).toEqual(retired);
    expect(retired.version).toBe(4);
    const list = await source.listCourseProducts({ page: 1, pageSize: 100, status: 'RETIRED' });
    expect(list.data).toEqual([retired]);
    await expect(source.createCourseProduct({ ...input, priceFen: 1 }, 'product-create')).rejects.toThrow();
  });

  it('sends metadata and optimistic versions on existing authenticated management routes', async () => {
    const requests: Parameters<SuperAdminHttpRequest>[0][] = [];
    const source = new ApiSuperAdminDataSource({
      baseUrl: 'https://example.test/api', accessToken: 'admin',
      request: (options) => {
        requests.push(options);
        options.success({ statusCode: 200, data: { data: { id: 'product' }, requestId: 'test' } });
      },
    });
    const input = { campusId: 'campus', name: '书法课包', courseName: '书法', classType: '常规班',
      summary: '书写基础', priceFen: 388000, mainUnits: 4800, giftUnits: 0, validityDays: 365 };
    await source.createCourseProduct(input, 'create');
    await source.updateCourseProduct('product', input, 1, 'update');
    await source.transitionCourseProduct('product', 'activate', 2, 'activate');
    expect(requests[0]).toMatchObject({ method: 'POST', data: input, header: { 'Idempotency-Key': 'create' } });
    expect(requests[1]).toMatchObject({ method: 'PATCH', data: { ...input, expectedVersion: 1 } });
    expect(requests[2]).toMatchObject({ url: 'https://example.test/api/management/course-products/product/activate',
      data: { expectedVersion: 2 }, header: { Authorization: 'Bearer admin', 'Idempotency-Key': 'activate' } });
  });
});
