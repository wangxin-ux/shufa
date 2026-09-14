import * as fs from 'fs';
import * as path from 'path';
import {
  resolveTeacherProfileAction,
  TEACHER_PROFILE_ACTIONS,
} from '../services/teacher-profile.presenter';

const root = path.resolve(__dirname, '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('teacher group promotion pages', () => {
  it('registers the list and detail pages inside the teacher subpackage', () => {
    const app = JSON.parse(read('app.json')) as {
      subPackages: Array<{ root: string; pages: string[] }>;
    };
    const teacher = app.subPackages.find(({ root }) => root === 'pages/teacher');

    expect(teacher?.pages).toEqual(
      expect.arrayContaining(['group-campaigns/index', 'group-detail/index']),
    );
  });

  it('adds an activity-center entry to teacher profile without changing home navigation', () => {
    expect(TEACHER_PROFILE_ACTIONS).toContainEqual({
      key: 'group-campaigns',
      label: '活动中心',
    });
    expect(resolveTeacherProfileAction('group-campaigns')).toEqual({
      kind: 'navigate',
      url: '/pages/teacher/group-campaigns/index',
    });
    expect(read('pages/teacher/home/index.wxml')).not.toContain('活动中心');
  });

  it('uses the teacher shell and covers list request states', () => {
    const markup = read('pages/teacher/group-campaigns/index.wxml');

    expect(markup).toContain('<teacher-page-shell');
    for (const state of ['loading', 'forbidden', 'error', 'empty', 'ready']) {
      expect(markup).toContain(state);
    }
    expect(markup).toContain('查看活动');
  });

  it('shows a complete poster-led activity card with a centered glossy command', () => {
    const markup = read('pages/teacher/group-campaigns/index.wxml');
    const styles = read('pages/teacher/group-campaigns/index.wxss');

    expect(markup).toContain('mode="widthFix"');
    expect(markup).toContain('class="campaign-card__status-dot"');
    expect(markup).toContain('class="campaign-card__time-row"');
    expect(markup).toContain('class="campaign-card__action"');
    expect(styles).toMatch(
      /\.campaign-card__cover\s*\{[^}]*position:\s*absolute[^}]*top:\s*0[^}]*width:\s*100%/s,
    );
    expect(styles).not.toContain('-webkit-line-clamp');
    expect(styles).toMatch(
      /\.campaign-card__action\s*\{[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*height:\s*76rpx[^}]*border-radius:\s*38rpx[^}]*linear-gradient[^}]*inset/s,
    );
  });

  it('renders ordered posters and exposes promotion-only actions', () => {
    const markup = read('pages/teacher/group-detail/index.wxml');
    const logic = read('pages/teacher/group-detail/index.ts');
    const combined = `${markup}\n${logic}`;

    expect(markup).toContain('wx:for="{{campaign.posterImages}}"');
    expect(markup).toContain('open-type="share"');
    expect(markup).toContain('发送给好友');
    expect(markup).toContain('生成邀请海报');
    expect(markup).toContain('复制文案');
    expect(markup).toContain('canvas-id="teacherGroupPoster"');
    expect(markup).toContain('本地演示码');
    expect(logic).toContain('groupPromotionRecipientPath');
    expect(logic).toContain("wx.createCanvasContext('teacherGroupPoster', this)");
    expect(logic).toContain('wx.canvasToTempFilePath');
    expect(logic).toContain('wx.saveImageToPhotosAlbum');
    expect(logic).toContain('wx.setClipboardData');
    expect(logic).not.toContain('wx.downloadFile');

    for (const forbidden of [
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

  it('keeps detail actions centered in rounded teacher-style controls', () => {
    const styles = read('pages/teacher/group-detail/index.wxss');

    expect(styles).toMatch(
      /\.action-button,\s*\.state-button\s*\{[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*min-height:\s*76rpx[^}]*border-radius:\s*38rpx/s,
    );
    expect(styles).toMatch(
      /\.action-button--primary,[^}]*\.state-button\s*\{[^}]*linear-gradient[^}]*box-shadow:\s*inset/s,
    );
    expect(styles).toMatch(
      /\.poster-modal\s*\{[^}]*border-radius:\s*36rpx 36rpx 0 0[^}]*background:\s*#fffdf8/s,
    );
    expect(styles).toMatch(
      /\.poster-action--primary\s*\{[^}]*linear-gradient[^}]*box-shadow:\s*inset/s,
    );
  });
});
