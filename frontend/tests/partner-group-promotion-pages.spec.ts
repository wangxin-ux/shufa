import * as fs from 'fs';
import * as path from 'path';
import {
  PARTNER_PROFILE_ACTIONS,
  resolvePartnerProfileAction,
} from '../services/partner-profile.presenter';

const root = path.resolve(__dirname, '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('partner group promotion pages', () => {
  it('registers the list and detail pages inside the partner subpackage', () => {
    const app = JSON.parse(read('app.json')) as {
      subPackages: Array<{ root: string; pages: string[] }>;
    };
    const partner = app.subPackages.find(({ root }) => root === 'pages/partner');

    expect(partner?.pages).toEqual(
      expect.arrayContaining(['group-campaigns/index', 'group-detail/index']),
    );
  });

  it('keeps activity-center entries in profile and the home more button', () => {
    expect(PARTNER_PROFILE_ACTIONS).toContainEqual({
      key: 'group-campaigns',
      label: '活动中心',
    });
    expect(resolvePartnerProfileAction('group-campaigns')).toEqual({
      kind: 'navigate',
      url: '/pages/partner/group-campaigns/index',
    });
    expect(read('pages/partner/home/index.wxml')).toMatch(
      /data-key="more"[\s\S]*aria-label="进入活动中心"/,
    );
  });

  it('uses the partner shell and covers list request states', () => {
    const markup = read('pages/partner/group-campaigns/index.wxml');

    expect(markup).toContain('<partner-page-shell');
    for (const state of ['loading', 'forbidden', 'error', 'empty', 'ready']) {
      expect(markup).toContain(state);
    }
    expect(markup).toContain('查看活动');
    expect(markup).not.toContain('切换校区');
  });

  it('renders ordered posters and generates a dedicated promotion poster', () => {
    const markup = read('pages/partner/group-detail/index.wxml');
    const logic = read('pages/partner/group-detail/index.ts');
    const combined = `${markup}\n${logic}`;

    expect(markup).toContain('wx:for="{{campaign.posterImages}}"');
    expect(markup).toContain('open-type="share"');
    expect(markup).toContain('发送给好友');
    expect(markup).toContain('生成邀请海报');
    expect(markup).toMatch(
      /class="action-button action-button--secondary action-button--poster"[\s\S]*bindtap="onOpenPoster"/,
    );
    expect(markup).toContain('复制文案');
    expect(markup).toContain('canvas-id="partnerGroupPoster"');
    expect(markup).toContain('class="poster-preview"');
    expect(logic).toContain('groupPromotionRecipientPath');
    expect(logic).toContain("wx.createCanvasContext('partnerGroupPoster'");
    expect(logic).toContain('wx.canvasToTempFilePath');
    expect(logic).toContain('campaign.posterImages[0]?.accessUrl');
    expect(logic).toContain('小程序码');
    expect(logic).not.toContain('wx.downloadFile');
    expect(logic).toContain('wx.saveImageToPhotosAlbum');
    expect(logic).toContain('wx.setClipboardData');

    for (const forbidden of [
      '切换校区',
      '发起拼团',
      '加入该团',
      '选择学员',
      '立即支付',
      '申请退款',
      '佣金',
      '配置活动',
      'requestPayment',
    ]) {
      expect(combined).not.toContain(forbidden);
    }
  });
});
