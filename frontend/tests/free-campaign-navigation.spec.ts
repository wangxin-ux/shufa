import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8');
const measure = () => {
  const filename = '../pages/super-admin/runtime/free-campaign-navigation';
  expect(existsSync(join(__dirname, `${filename}.ts`))).toBe(true);
  return require(filename).freeCampaignHeaderTopPx() as number;
};

describe('free campaign navigation safety', () => {
  afterEach(() => { delete (global as any).wx; delete (global as any).Component; });

  it.each([
    [375, 44, 51],
    [390, 47, 55],
    [430, 54, 62],
  ])('matches the shared shell capsule position at %spx', (width, status, top) => {
    (global as any).wx = {
      getWindowInfo: () => ({ windowWidth: width, statusBarHeight: status }),
      getMenuButtonBoundingClientRect: () => ({ top, height: 32 }),
    };
    expect(measure()).toBe(top);
  });

  it('uses the status bar when the capsule has not been measured', () => {
    (global as any).wx = {
      getWindowInfo: () => ({ statusBarHeight: 47 }),
      getMenuButtonBoundingClientRect: () => ({ top: 0, height: 0 }),
    };
    expect(measure()).toBe(55);
  });

  it('retains the status bar estimate when the capsule API throws', () => {
    (global as any).wx = {
      getWindowInfo: () => ({ statusBarHeight: 54 }),
      getMenuButtonBoundingClientRect: () => { throw Error('unavailable capsule'); },
    };
    expect(measure()).toBe(62);
  });

  it('keeps direct-open pages usable without measurement APIs', () => {
    (global as any).wx = {};
    expect(measure()).toBe(28);
  });

  it('makes fixed navigation an explicit opt-in on the shared shell', () => {
    let component: any;
    (global as any).Component = (definition: any) => { component = definition; };
    jest.isolateModules(() => require('../components/super-admin-page-shell/super-admin-page-shell'));
    expect(component.externalClasses ?? []).toContain('header');
    expect(read('components/super-admin-page-shell/super-admin-page-shell.wxml'))
      .toContain('class="shell__header header"');
    expect(read('components/super-admin-page-shell/super-admin-page-shell.wxss'))
      .not.toMatch(/position:\s*fixed/);
  });

  it.each(['campaign-reviews', 'campaign-review-detail'])('keeps the %s header space outside the business content', (page) => {
    const markup = read(`pages/super-admin/${page}/index.wxml`);
    expect(markup).toMatch(/<super-admin-page-shell\b[^>]*\bheader="free-campaign-header"/);
    expect(markup).toContain('height: calc({{headerTopPx}}px + 150rpx);');
    expect(markup.indexOf('free-campaign-header-space')).toBeLessThan(markup.indexOf('class="workspace '));
    const style = read(`pages/super-admin/${page}/index.wxss`);
    expect(style).toContain('@import "../runtime/free-campaign-navigation.wxss";');
  });

  it('reserves the full partner header height while its controls stay fixed', () => {
    const markup = read('pages/partner/campaign-editor/index.wxml');
    expect(markup).toContain('height: calc({{headerTopPx}}px + 106rpx);');
    const style = read('pages/partner/campaign-editor/index.wxss');
    const header = style.match(/\.editor__header\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(header).toMatch(/position:\s*fixed/);
    expect(header).toMatch(/background:\s*#fff/);
    expect(header).toMatch(/top:\s*0/);
  });
});
