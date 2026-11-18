import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../pages/partner/lesson-account');
const markup = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'index.wxss'), 'utf8');

describe('partner lesson ledger internal scrolling', () => {
  it('bounds the ledger in a vertical scroll-view with guarded next-page events', () => {
    expect(markup).toMatch(/<scroll-view[^>]*wx:else[^>]*class="account-ledger"[^>]*scroll-y="\{\{true\}\}"[^>]*bindscrolltolower="onLedgerReachBottom"/);
    expect(markup).toContain('lower-threshold="80"');
    expect(markup).toContain('show-scrollbar="{{true}}"');
    expect(styles).toMatch(/\.account-ledger\s*\{[^}]*flex:\s*1;[^}]*height:\s*0;/s);
    expect(styles).toMatch(/\.account-page\s*\{[^}]*height:\s*var\(--partner-body-height\)/s);
  });

  it('keeps the explicit retry and full existing row fields inside the scrollable region', () => {
    const ledger = markup.match(/<scroll-view[^>]*class="account-ledger"[^>]*>([\s\S]*?)<\/scroll-view>/)?.[1] ?? '';
    expect(ledger).toContain('wx:for="{{items}}"');
    expect(ledger).toContain('{{item.teachingLabel}}');
    expect(ledger).toContain('{{item.balanceAfterLabel}}');
    expect(ledger).toContain('wx:if="{{pageError}}"');
    expect(ledger).toContain('bindtap="onLoadMore"');
    expect(ledger).toContain("pageError ? '重试加载'");
  });

  it('remounts the ledger after category loading while preserving filters and empty/error states outside it', () => {
    expect(markup).toContain('bindchange="onEntryTypeChange"');
    expect(markup).toContain('wx:if="{{ledgerLoading}}"');
    expect(markup).toContain('wx:elif="{{viewState === \'empty\'}}"');
    expect(markup).toContain('wx:if="{{refreshError}}"');
    expect(markup).toContain('/pages/partner/assets/lesson-account-top-character.png');
    expect(markup).toContain('/pages/partner/assets/lesson-account-lower-character.png');
  });

  it('keeps a reachable ledger when long subject names and refresh feedback need extra space', () => {
    expect(styles).toMatch(/\.account-filter__value text:first-child\s*\{[^}]*-webkit-line-clamp:\s*2/s);
    expect(styles).toMatch(/\.account-ledger\s*\{[^}]*min-height:\s*120rpx/s);
    expect(styles).toMatch(/\.account-page--feedback\s*\{[^}]*height:\s*auto/s);
    expect(markup).toContain("subjectError || refreshError || earningAccountError || earningPreviewError");
  });
});
