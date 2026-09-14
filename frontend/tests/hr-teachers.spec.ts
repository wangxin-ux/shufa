import { resolveRoleBootstrap, SessionService } from '../services/session.service';
import { HrApi } from '../services/hr.service';
import * as fs from 'fs';
import * as path from 'path';

describe('HR teacher workspace boundaries', () => {
  it('routes only a single headquarters HR account to its own workspace', () => {
    const session = { userId: 'hr', displayName: '人力', roles: [{ code: 'HR' as const, campusId: null }] };
    expect(resolveRoleBootstrap(session)).toEqual({ kind: 'navigate', url: '/pages/hr/home/index' });
    expect(resolveRoleBootstrap({ ...session, roles: [{ code: 'HR', campusId: 'campus' }] })).toEqual({ kind: 'forbidden' });
    expect(new SessionService({ dataDriver: 'mock' }).listTestAccounts().some((a) => a.code === 'HR')).toBe(true);
  });
  it('only queries dedicated HR endpoints with the current account token', async () => {
    const requests: Array<{ url: string; method: string; header: Record<string, string>; data?: unknown }> = [];
    const api = new HrApi('https://example.test', () => 'hr-token', (options) => {
      requests.push(options);
      options.success({ statusCode: 200, data: { data: { items: [], total: 0, page: 1, pageSize: 20 } } });
    });
    await api.teachers({ campusId: 'campus-a', query: '林', page: 1, pageSize: 20 });
    expect(requests[0]).toMatchObject({
      url: 'https://example.test/hr/teachers', method: 'GET',
      header: { Authorization: 'Bearer hr-token' },
      data: { campusId: 'campus-a', query: '林' },
    });
  });
  it('uses the existing workspace visuals and has no identity or finance mutation controls', () => {
    const root = path.resolve(__dirname, '../pages/hr/teachers');
    expect(fs.readFileSync(path.join(root, 'index.wxss'), 'utf8')).toContain('finance-refunds.wxss');
    const template = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
    expect(template).toContain('教师名册');
    expect(template).toContain('completedLessonCount');
    expect(template).not.toMatch(/创建账号|审核收益|登记退款|导入教师|评价/);
  });
});
