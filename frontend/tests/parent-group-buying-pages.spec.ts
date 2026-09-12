import * as fs from 'fs';
import * as path from 'path';
import {
  buildGroupShareCopy,
  presentParentGroupCampaign,
} from '../services/parent-group-buying.presenter';
import { GroupCampaignView } from '../types/group-buying';

const ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('parent group buying pages', () => {
  it('registers three pages in the parent ordinary subpackage', () => {
    const app = JSON.parse(read('app.json')) as {
      subPackages: Array<{ root: string; pages: string[] }>;
    };
    expect(app.subPackages.find(({ root }) => root === 'pages/parent')?.pages)
      .toEqual(expect.arrayContaining([
        'group-campaigns/index',
        'group-detail/index',
        'group-orders/index',
      ]));
  });

  it('keeps selection, team actions, customer service and payment on the detail page', () => {
    const page = read('pages/parent/group-detail/index.wxml');
    expect(page).toContain('选择学员');
    expect(page).toContain('发起拼团');
    expect(page).toContain('加入该团');
    expect(page).toContain('联系校区');
    expect(page).toContain('邀请海报');
    expect(page).toContain('支付确认中');
    expect(page).toContain('发送给好友');
    expect(page).toContain('复制发圈配文');
    expect(page).toContain('保存海报');
  });

  it('uses a native-style fixed action bar with customer service and poster shortcuts', () => {
    const page = read('pages/parent/group-detail/index.wxml');
    const styles = read('pages/parent/group-detail/index.wxss');

    expect(page).toMatch(
      /class="bottom-bar__tools"[\s\S]*bindtap="onOpenService"[\s\S]*>客服<[\s\S]*bindtap="onOpenPoster"[\s\S]*>海报</,
    );
    expect(page).toContain('src="/pages/parent/assets/group-action-service.png"');
    expect(page).toContain('src="/pages/parent/assets/group-action-poster.png"');
    expect(fs.existsSync(path.join(ROOT, 'pages/parent/assets/group-action-service.png'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'pages/parent/assets/group-action-poster.png'))).toBe(true);
    expect(page).not.toContain('class="tools"');
    expect(page).not.toContain('bottom-tool__share-node');
    expect(styles).toMatch(/button\.bottom-tool\s*\{[^}]*min-width:\s*88rpx[^}]*min-height:\s*88rpx/s);
    expect(styles).toMatch(/\.bottom-tool__icon\s*\{[^}]*width:\s*44rpx[^}]*height:\s*40rpx/s);
    expect(styles).toMatch(/button\.pay-button\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
    expect(styles).toMatch(/button\.pay-button\s*\{[^}]*flex:\s*1[^}]*height:\s*88rpx[^}]*border-radius:\s*44rpx/s);
    expect(styles).toMatch(/button\.pay-button\s*\{[^}]*linear-gradient\([^}]*box-shadow:/s);
    expect(styles).toMatch(/button\.pay-button\[disabled\]\s*\{[^}]*background:\s*#aaa/s);
  });

  it('renders ordered campaign posters as a gapless long page with a fallback hero', () => {
    const page = read('pages/parent/group-detail/index.wxml');
    const styles = read('pages/parent/group-detail/index.wxss');
    expect(page).toContain('class="poster-stream"');
    expect(page).toContain('wx:if="{{campaign.posterImages.length}}"');
    expect(page).toContain('wx:for="{{campaign.posterImages}}"');
    expect(page).toContain('mode="widthFix"');
    expect(page).toContain('wx:else class="hero"');
    expect(styles).toMatch(/\.poster-stream__image\s*\{[^}]*display:\s*block[^}]*width:\s*100%/s);
    expect(styles).toMatch(/\.poster-stream\s*\{[^}]*font-size:\s*0/s);
    expect(page).toContain('class="bottom-bar"');
  });

  it('presents the campaign list as poster-led activity entries', () => {
    const page = read('pages/parent/group-campaigns/index.wxml');
    const styles = read('pages/parent/group-campaigns/index.wxss');

    expect(page).toContain('class="campaign-card__visual"');
    expect(page).toContain('src="{{item.posterImages[0].accessUrl}}"');
    expect(page).toContain('class="campaign-card__status"');
    expect(page).toContain('class="campaign-card__body"');
    expect(page).toContain('class="campaign-card__action"');
    expect(styles).toMatch(/\.campaign-card__visual\s*\{[^}]*height:\s*420rpx[^}]*overflow:\s*hidden/s);
    expect(styles).toMatch(/\.campaign-card__cover\s*\{[^}]*width:\s*100%/s);
    expect(styles).toMatch(/\.campaign-card__action\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
  });

  it('uses focused bottom sheets for customer service and poster actions', () => {
    const page = read('pages/parent/group-detail/index.wxml');
    const styles = read('pages/parent/group-detail/index.wxss');

    expect(page).toContain('class="modal modal--service modal--sheet"');
    expect(page).toContain('class="service-hero"');
    expect(page).toContain('class="service-info"');
    expect(page).toContain('class="service-qr"');
    expect(page).toContain('class="service-qr__image"');
    expect(page).toContain('class="service-qr__placeholder"');
    expect(page).toContain('bindtap="onPreviewQr"');
    expect(page).toContain('class="service-action service-action--primary"');
    expect(page).toContain('class="modal modal--poster modal--sheet"');
    expect(page).toContain('class="poster-stage"');
    expect(page).toContain('class="share-copy"');
    expect(page).toContain('{{shareCopy}}');
    expect(page).toContain('class="poster-action poster-action--share"');
    expect(page).toContain('class="poster-secondary-actions"');
    expect(styles).toMatch(/\.overlay--sheet\s*\{[^}]*align-items:\s*flex-end/s);
    expect(styles).toMatch(/\.modal--sheet\s*\{[^}]*border-radius:\s*36rpx\s+36rpx\s+0\s+0/s);
    expect(styles).toMatch(/button\.service-action\s*\{[^}]*min-height:\s*88rpx/s);
    expect(styles).toMatch(/\.service-qr\s*\{[^}]*width:\s*260rpx[^}]*height:\s*260rpx/s);
    expect(styles).toMatch(/button\.poster-action\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
    expect(styles).toMatch(/\.poster-secondary-actions\s+button:first-child\s*\{[^}]*grid-column:\s*auto/s);
  });

  it('builds a dedicated invitation poster instead of shrinking the full campaign page', () => {
    const source = read('pages/parent/group-detail/index.ts');
    const styles = read('pages/parent/group-detail/index.wxss');

    expect(source).toContain("campaign.posterImages[0]?.accessUrl");
    expect(source).toContain('wx.getImageInfo');
    expect(source).toContain('const cropSize = Math.min(background.width, background.height)');
    expect(source).toContain('context.drawImage(background.path, 0, 0, cropSize, cropSize, 0, 0, 360, 360)');
    expect(source).toContain('canvasId: \'groupPoster\', width: 360, height: 540, destWidth: 720, destHeight: 1080');
    expect(styles).toMatch(/\.poster-stage \.poster-preview\s*\{[^}]*width:\s*480rpx[^}]*height:\s*720rpx/s);
  });

  it('places live learner and team controls inside the reserved areas of the five-poster series', () => {
    const page = read('pages/parent/group-detail/index.wxml');
    const styles = read('pages/parent/group-detail/index.wxss');

    expect(page).toContain('class="poster-sheet"');
    expect(page).toContain('posterIndex === 0 && campaign.posterImages.length === 5');
    expect(page).toContain('class="poster-panel poster-panel--student"');
    expect(page).toContain('posterIndex === 4 && campaign.posterImages.length === 5');
    expect(page).toContain('class="poster-panel poster-panel--teams"');
    expect(page).toContain('wx:if="{{campaign.posterImages.length !== 5}}"');
    expect(styles).toMatch(/\.poster-sheet\s*\{[^}]*position:\s*relative[^}]*height:\s*1125rpx/s);
    expect(styles).toMatch(/\.poster-panel\s*\{[^}]*position:\s*absolute[^}]*z-index:\s*2/s);
    expect(styles).toMatch(/\.poster-panel--student\s*\{[^}]*top:\s*675rpx/s);
    expect(styles).toMatch(/\.poster-panel--teams\s*\{[^}]*top:\s*645rpx/s);
  });

  it('removes the shared header wave only for the poster detail page', () => {
    const page = read('pages/parent/group-detail/index.wxml');
    const shellMarkup = read('components/parent-page-shell/parent-page-shell.wxml');
    const shellLogic = read('components/parent-page-shell/parent-page-shell.ts');

    expect(page).toContain('showWave="{{false}}"');
    expect(page).toContain('backgroundColor="#fef07f"');
    expect(shellMarkup).toContain("showWave && bg === 'yellow'");
    expect(shellMarkup).toContain('background: {{backgroundColor}}');
    expect(shellLogic).toMatch(/showWave:\s*\{\s*type:\s*Boolean,\s*value:\s*true\s*\}/);
    expect(shellLogic).toMatch(/backgroundColor:\s*\{\s*type:\s*String,\s*value:\s*''\s*\}/);
  });

  it('uses light poster-matched surfaces for the live controls', () => {
    const styles = read('pages/parent/group-detail/index.wxss');

    expect(styles).toMatch(/\.poster-panel\s*\{[^}]*border:[^}]*background:\s*rgba\(255,\s*253,\s*241,\s*\.88\)[^}]*box-shadow:/s);
    expect(styles).toMatch(/\.poster-picker\s*\{[^}]*align-items:\s*center[^}]*justify-content:\s*space-between[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*\.72\)/s);
    expect(styles).toMatch(/\.poster-panel--student\s*\{[^}]*left:\s*145rpx[^}]*width:\s*420rpx[^}]*height:\s*230rpx/s);
    expect(styles).toMatch(/\.poster-panel--teams\s*\{[^}]*left:\s*135rpx[^}]*width:\s*480rpx[^}]*height:\s*280rpx/s);
    expect(styles).not.toMatch(/\.poster-picker\s*\{[^}]*background:\s*rgba\(255,\s*215,\s*94,\s*\.48\)/s);
  });

  it('uses a centered poster-style failure panel with a real login action', () => {
    const page = read('pages/parent/group-detail/index.wxml');
    const logic = read('pages/parent/group-detail/index.ts');
    const stateMarkup = read('components/view-state/view-state.wxml');
    const stateStyles = read('components/view-state/view-state.wxss');
    const stateLogic = read('components/view-state/view-state.ts');

    expect(page).toContain('variant="panel"');
    expect(page).toContain("retryText=\"{{needsLogin ? '返回登录' : '重新加载'}}\"");
    expect(logic).toContain('needsLogin: false');
    expect(logic).toContain('needsLogin: state.statusCode === 401');
    expect(logic).toContain("wx.reLaunch({ url: '/pages/bootstrap/index' })");
    expect(stateMarkup).toContain('view-state__status-mark');
    expect(stateMarkup).toContain('{{retryText}}');
    expect(stateMarkup).toContain("size=\"{{variant === 'panel' ? 'default' : 'mini'}}\"");
    expect(stateLogic).toMatch(/variant:\s*\{\s*type:\s*String,\s*value:\s*''\s*\}/);
    expect(stateLogic).toMatch(/retryText:\s*\{\s*type:\s*String,\s*value:\s*'重新加载'\s*\}/);
    expect(stateStyles).toMatch(/\.view-state--panel\s*\{[^}]*border:[^}]*background:[^}]*box-shadow:/s);
    expect(stateStyles).toMatch(/\.view-state__retry--panel\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*height:\s*88rpx[^}]*line-height:\s*1/s);
  });

  it('presents active and ended campaign actions honestly', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-02T00:00:00.000Z'));
    const campaign = {
      id: 'campaign-1', code: 'GROUP-1', campusId: 'campus-1', campusName: '东校区',
      courseProductId: 'course-1', courseName: '创意美术', title: '好友拼团',
      description: '线下课程体验', priceFen: 1990, maxPaidMembers: 3,
      startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-09-30T00:00:00.000Z',
      status: 'ACTIVE', version: 1, joinableTeams: [], boundStudents: [],
      posterImages: [],
      customerService: { name: '东校区', phone: '', qrCodeUrl: null },
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    } satisfies GroupCampaignView;

    const presented = presentParentGroupCampaign(campaign);
    expect(presented)
      .toMatchObject({ canParticipate: true, actionLabel: '发起拼团' });
    expect(buildGroupShareCopy(presented, '陈晨')).toContain('陈晨正在参加');
    expect(buildGroupShareCopy(presented, '陈晨')).toContain('邀请你一起拼');
    expect(buildGroupShareCopy(presented, '陈晨')).toContain('1 人得 1 次、2 人得 3 次、3 人得 5 次');
    expect(buildGroupShareCopy(presented, '陈晨')).toContain(presented.endsAtLabel);
    expect(presentParentGroupCampaign({ ...campaign, status: 'CLOSED' }))
      .toMatchObject({ canParticipate: false, actionLabel: '活动已结束' });
    jest.useRealTimers();
  });

  it('shows honest order states without prohibited marketing modules or a standalone dog logo', () => {
    const source = [
      read('pages/parent/group-campaigns/index.wxml'),
      read('pages/parent/group-detail/index.wxml'),
      read('pages/parent/group-orders/index.wxml'),
    ].join('\n');
    expect(source).toContain('待支付');
    expect(source).toContain('已结算');
    expect(source).toContain('已退款');
    expect(source).not.toMatch(/犬首|狗头|自动发朋友圈|助力解锁|分享奖励|抽奖|实物奖品/);
  });
});
