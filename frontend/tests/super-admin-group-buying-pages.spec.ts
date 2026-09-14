import * as fs from 'fs';
import * as path from 'path';
import {
  resolveSuperAdminHomeAction,
  SUPER_ADMIN_HOME_ACTIONS,
} from '../services/super-admin-home.presenter';

const ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('super admin group buying pages', () => {
  it('registers campaign and order management in the super admin package and profile menu', () => {
    const app = JSON.parse(read('app.json')) as { subPackages: Array<{ root: string; pages: string[] }> };
    expect(app.subPackages.find(({ root }) => root === 'pages/super-admin')?.pages)
      .toEqual(expect.arrayContaining(['group-campaigns/index', 'group-orders/index']));
    expect(SUPER_ADMIN_HOME_ACTIONS).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'groups' }),
    ]));
    expect(resolveSuperAdminHomeAction('groups')).toEqual({
      kind: 'navigate', url: '/pages/super-admin/group-campaigns/index',
    });
    expect(read('pages/super-admin/profile/index.wxml')).toContain(
      'data-url="/pages/super-admin/group-campaigns/index"',
    );
  });

  it('supports campaign fields and guarded lifecycle actions', () => {
    const page = read('pages/super-admin/group-campaigns/index.wxml');
    const script = read('pages/super-admin/group-campaigns/index.ts');
    for (const label of ['适用校区', '课程产品', '活动标题', '活动说明', '拼团价格', '开始日期', '结束日期']) {
      expect(page).toContain(label);
    }
    for (const action of ['创建草稿', '修改草稿', '启用', '结束活动', '取消活动']) {
      expect(page).toContain(action);
    }
    expect(script).toContain('superAdminService.loadCourseProducts');
    expect(script).not.toContain('uniqueProducts(campaigns.data.data)');
  });

  it('manages up to six ordered poster images without a page builder', () => {
    const page = read('pages/super-admin/group-campaigns/index.wxml');
    const script = read('pages/super-admin/group-campaigns/index.ts');
    for (const label of ['活动长海报', '最多 6 张', '上传图片', '上移', '下移', '移除']) {
      expect(page).toContain(label);
    }
    expect(page).toContain('wx:for="{{item.posterImages}}"');
    expect(page).toContain('mode="aspectFill"');
    expect(script).toContain('wx.chooseMedia');
    expect(script).toContain('uploadGroupCampaignPoster');
    expect(script).toContain('reorderGroupCampaignPosters');
    expect(script).toContain('detachGroupCampaignPoster');
    expect(page).not.toMatch(/页面装修器|素材库|背景音乐/);
  });

  it('shows order payment, settlement, package and refund facts without unrelated money features', () => {
    const page = read('pages/super-admin/group-orders/index.wxml');
    for (const label of ['校区筛选', '状态筛选', '支付状态', '拼团人数', '课包权益', '退款']) {
      expect(page).toContain(label);
    }
    expect(page).not.toMatch(/合作方提现|自动分账|商城设置/);
  });
});
