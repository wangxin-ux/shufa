import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const root = path.resolve(__dirname, '../pages/partner/teachers');
const markup = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'index.wxss'), 'utf8');
const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

describe('partner P7 reference teacher strips', () => {
  it('uses the P7 curve at its original artboard position with a separately rendered shadow', () => {
    expect(markup).toContain('waveImage="/pages/partner/assets/teachers-top-wave.png"');
    expect(markup).not.toContain('waveImage="/pages/partner/assets/top-wave.png"');
    expect(rule('page')).toContain(
      '--partner-shell-wave-filter: drop-shadow(0 4.666667rpx 11.333333rpx rgba(24, 18, 14, 0.28));',
    );
    const curve = fs.readFileSync(path.join(root, '../assets/teachers-top-wave.png'));
    expect([curve.readUInt32BE(16), curve.readUInt32BE(20), curve[25]]).toEqual([750, 240, 6]);
    expect(createHash('sha256').update(curve).digest('hex')).toBe(
      '52c69259d480fd8b979a8481073bdb96405c47ca0ff49a28ed7acc236d325d79',
    );
  });

  it('uses a compact search and count toolbar without a duplicate display heading', () => {
    expect(markup).not.toContain('class="partner-heading"');
    expect(markup).toContain('class="partner-search teachers-search"');
    expect(markup).toContain('class="teachers-search__count">{{total}}人</text>');
    expect(markup).toContain('wx:if="{{query}}" class="teachers-search__clear"');
    expect(markup).toContain('bindtap="onClearSearch"');
    expect(markup).toContain('aria-label="清空教师姓名搜索"');
    expect(rule('.teachers-page .teachers-search')).toContain('margin-top: 0;');
    expect(rule('.teachers-search__clear')).toContain('width: 88rpx;');
    expect(rule('.teachers-search__clear')).toContain('height: 88rpx;');
    expect(rule('.teachers-search__count')).toContain('flex: none;');
  });

  it('uses unframed rows with separate header and detail surfaces instead of nested white cards', () => {
    expect(markup).toContain('wx:for="{{items}}" wx:key="id" class="teacher-row"');
    expect(markup).not.toContain('class="partner-card teacher-card"');
    expect(rule('.teachers-page')).toContain('margin: 0 16rpx;');
    expect(rule('.teachers-page .partner-list')).toContain('gap: 40rpx;');
  });

  it('uses the sampled orange header and established P2 strip dimensions with readable white labels', () => {
    const header = rule('.teacher-card__toggle');
    expect(header).toContain('background: #fe8319;');
    expect(header).toContain('color: #ffffff;');
    expect(header).toContain('min-height: 162rpx;');
    expect(header).toContain('padding: 28rpx 30rpx;');
    expect(header).toContain('box-sizing: border-box;');
    expect(header).toContain('border-radius: 36rpx;');
    expect(markup).toContain('class="teacher-card__name" style="font-size: {{item.nameFontSize}}rpx;"');
    expect(markup).toContain('class="teacher-card__class-caption">所带班级</text>');
    expect(rule('.teacher-card__identity')).toContain('width: 40%;');
  });

  it('allows long names and classes to wrap without resizing the fixed chevron', () => {
    expect(rule('.teacher-card__name')).toContain('min-width: 0;');
    expect(rule('.teacher-card__name')).toContain('overflow-wrap: anywhere;');
    expect(rule('.teacher-card__name')).toContain('word-break: break-all;');
    expect(rule('.teacher-card__classes')).toContain('overflow-wrap: anywhere;');
    expect(rule('.teacher-card__chevron')).toContain('flex: none;');
    expect(rule('.teacher-card__chevron')).toContain('width: 28rpx;');
    expect(styles).not.toMatch(/font-size:\s*[^;]*(?:vw|vmin|vmax)/);
  });

  it('gives expanded existing facts their own sampled orange panel without fake ratings or attendance', () => {
    const details = rule('.teacher-card__details');
    expect(details).toContain('background: #fd8f2e;');
    expect(details).toContain('margin-top: 36rpx;');
    expect(markup).toContain('wx:if="{{expandedId === item.id}}" class="teacher-card__details"');
    expect(markup).toContain('在读学员');
    expect(markup).toContain('本月完成课次');
    expect(markup).not.toMatch(/应出勤|实际出勤|出勤率|工作指导意见|star-rating/);
  });

  it('mounts one identified monthly evaluation component inside the expanded teacher', () => {
    expect(markup).toContain('id="teacher-performance-{{item.id}}"');
    expect(markup).toContain('teacher-id="{{item.id}}"');
    expect(markup).toContain('bind:forbidden="onPerformanceForbidden"');
    const config = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
    expect(config.usingComponents['teacher-performance']).toBe('/pages/partner/components/teacher-performance/index');
  });
});
