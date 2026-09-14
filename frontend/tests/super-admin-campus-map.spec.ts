import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..');

describe('super admin campus map editor', () => {
  it('keeps the minimal location editor inside campus detail', () => {
    const markup = fs.readFileSync(
      path.join(root, 'pages/super-admin/campus-detail/index.wxml'),
      'utf8',
    );
    const script = fs.readFileSync(
      path.join(root, 'pages/super-admin/campus-detail/index.ts'),
      'utf8',
    );
    expect(markup).toContain('选择地图位置');
    expect(markup).toContain('在家长地图展示');
    expect(markup).toContain('保存地图配置');
    expect(markup).toContain('bindtap="onChooseLocation"');
    expect(markup).toContain('bindchange="onMapVisibleChange"');
    expect(markup).toContain('bindtap="onSaveMapLocation"');
    expect(script).toContain('wx.chooseLocation');
    expect(script).toContain('updateCampusMapLocation');
    expect(`${markup}\n${script}`).not.toMatch(
      /API\s*Key|腾讯地图 SDK|高德地图|路线规划|纬度输入|经度输入/i,
    );
  });

  it('keeps a fixed customer-service QR editor inside campus detail', () => {
    const markup = fs.readFileSync(
      path.join(root, 'pages/super-admin/campus-detail/index.wxml'),
      'utf8',
    );
    const script = fs.readFileSync(
      path.join(root, 'pages/super-admin/campus-detail/index.ts'),
      'utf8',
    );
    const styles = fs.readFileSync(
      path.join(root, 'pages/super-admin/campus-detail/index.wxss'),
      'utf8',
    );

    expect(markup).toContain('客服二维码');
    expect(markup).toContain('class="qr-editor__preview"');
    expect(markup).toContain('bindtap="onChooseCustomerServiceQr"');
    expect(script).toContain('wx.chooseMedia');
    expect(script).toContain('uploadCampusCustomerServiceQr');
    expect(styles).toMatch(
      /\.qr-editor__preview\s*\{[^}]*width:\s*240rpx[^}]*height:\s*240rpx/s,
    );
  });
});
