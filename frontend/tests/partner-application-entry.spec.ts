import * as fs from 'fs';
import * as path from 'path';
import { resolvePartnerHomeAction } from '../services/partner-home.presenter';
import { resolvePartnerProfileAction } from '../services/partner-profile.presenter';

const load = jest.fn();
jest.mock('../services/session.service', () => ({
  resolveRoleBootstrap: () => ({ kind: 'login' }),
  sessionService: { canSwitchTestAccount: () => true, load: () => load() },
}));

describe('explicit bootstrap institution application entry', () => {
  let page: any;
  beforeEach(() => {
    load.mockResolvedValue(null);
    (global as any).wx = { navigateTo: jest.fn(), reLaunch: jest.fn() };
    (global as any).Page = (config: any) => {
      page = { ...config, data: { ...config.data } };
      page.setData = (value: object) => Object.assign(page.data, value);
    };
    jest.isolateModules(() => require('../pages/bootstrap/index'));
  });
  afterEach(() => {
    page.onUnload();
    delete (global as any).Page;
    delete (global as any).wx;
  });
  it('opens only the restricted application page from a login state', () => {
    page.data.viewState = 'login';
    page.onOpenApplication();
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/pages/partner/application/index' }),
    );
  });
  it('does not open a second application page while navigation is pending', () => {
    page.data.viewState = 'login';
    page.onOpenApplication();
    page.onOpenApplication();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(1);
  });
  it('releases navigation lock on failure', () => {
    page.data.viewState = 'login';
    page.onOpenApplication();
    (global as any).wx.navigateTo.mock.calls[0][0].fail();
    page.onOpenApplication();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(2);
  });
  it.each(['loading', 'submitting'])('does not open application while %s', (state) => {
    page.data.viewState = state;
    page.onOpenApplication();
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
  });
  it('invalidates old navigation callbacks after hiding', () => {
    page.data.viewState = 'login';
    page.onOpenApplication();
    page.onHide();
    const snapshot = { ...page.data };
    (global as any).wx.navigateTo.mock.calls[0][0].fail();
    page.onOpenApplication();
    expect(page.data).toEqual(snapshot);
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(1);
    page.onShow();
    page.onOpenApplication();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(2);
  });
  it('offers the same applicant page from existing partner entries', () => {
    expect(resolvePartnerHomeAction('application')).toEqual({
      kind: 'navigate', url: '/pages/partner/application/index',
    });
    expect(resolvePartnerProfileAction('application' as never)).toEqual({
      kind: 'navigate', url: '/pages/partner/application/index',
    });
  });
  it('renders a separate application entry without importing applicant runtime into main', () => {
    const root = path.resolve(__dirname, '..');
    const markup = fs.readFileSync(path.join(root, 'pages/bootstrap/index.wxml'), 'utf8');
    expect(markup).toContain('bindtap="onOpenApplication"');
    const source = fs.readFileSync(path.join(root, 'pages/bootstrap/index.ts'), 'utf8');
    expect(source).not.toMatch(/import[\s\S]*from.*partner\/runtime/);
  });
});
