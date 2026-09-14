import * as fs from 'fs';
import * as path from 'path';
import {
  canPreviewFinance,
  loadReceiptPreview,
  previewReceiptDetail,
} from '../pages/finance/receipts/receipt-preview';

describe('finance standard-page preview', () => {
  it('uses the existing workspace classes for cards, filters, tabs and states', () => {
    const styles = fs.readFileSync(path.resolve(__dirname, '../pages/finance/receipts/index.wxss'), 'utf8');
    const markup = fs.readFileSync(path.resolve(__dirname, '../pages/finance/receipts/index.wxml'), 'utf8');
    const script = fs.readFileSync(path.resolve(__dirname, '../pages/finance/receipts/index.ts'), 'utf8');
    const preview = fs.readFileSync(path.resolve(__dirname, '../pages/finance/receipts/receipt-preview.ts'), 'utf8');
    expect(styles).toContain('@import "../../../styles/super-admin-workspace.wxss"');
    for (const name of ['workspace__head', 'workspace__title', 'toolbar', 'select', 'field', 'roster-tabs', 'roster-tab', 'metric', 'row__main', 'row__title', 'row__meta', 'row__value', 'status--success', 'state__title']) {
      expect(markup).toContain(name);
    }
    expect(markup).toContain('class="row receipt"');
    expect(markup).toContain('尚未录入课包');
    expect([markup, script, preview].join('\n')).not.toMatch(/已关联|尚未关联课包/);
    expect(styles).not.toMatch(/\.receipt\s*\{[^}]*(?:background|box-shadow|border-radius)/);
    expect(styles).not.toContain('.finance__tab--active');
  });
  it('directly reuses the existing super-admin background instead of a custom palette', () => {
    const styles = fs.readFileSync(path.resolve(__dirname, '../pages/finance/receipts/index.wxss'), 'utf8');
    expect(styles).toMatch(/\.finance\s*\{[^}]*background:\s*var\(--super-admin-gradient\)/);
    expect(styles).not.toContain('linear-gradient(');
    const reference = fs.readFileSync(path.resolve(__dirname, '../components/super-admin-page-shell/super-admin-page-shell.wxss'), 'utf8');
    const declarations = (source: string, selector: string) =>
      source.match(new RegExp(`${selector}\\{([^}]+)\\}`))?.[1]
        .split(';').map((part) => part.replace(/\s/g, '')).filter(Boolean).sort();
    expect(declarations(styles, '\\.finance__wave\\s*')?.filter((part) => part !== 'pointer-events:none'))
      .toEqual(declarations(reference, '\\.shell__wave'));
  });
  it('requires an explicit development preview and fails closed elsewhere', () => {
    expect(canPreviewFinance('develop', '1')).toBe(true);
    for (const version of ['release', 'trial', '', undefined]) {
      expect(canPreviewFinance(version, '1')).toBe(false);
    }
    expect(canPreviewFinance('develop', undefined)).toBe(false);
    expect(canPreviewFinance('develop', 'true')).toBe(false);
  });

  it('returns deterministic Chinese receipt rows and original package facts', () => {
    const result = loadReceiptPreview({});
    expect(result.total).toBe(6);
    expect(result.rows).toHaveLength(3);
    expect(result.hasMore).toBe(true);
    expect(result.rows[0]).toMatchObject({
      studentName: '陈晨', amountLabel: '1,200.00', statusLabel: '已录包',
      packageLabel: '购买 12 节 · 赠送 3 节',
    });
    expect(previewReceiptDetail('preview-receipt-1')).toMatchObject({
      unitPriceLabel: '100.00 元/节',
    });
  });

  it('combines campus, inclusive actual receipt date and name filters', () => {
    const result = loadReceiptPreview({
      campusId: 'east', startDate: '2026-09-01', endDate: '2026-09-06',
      keyword: ' 陈晨 ',
    });
    expect(result.rows.map((row) => row.studentName)).toEqual(['陈晨']);
    expect(result.summary.receiptsLabel).toBe('1,200.00');
  });

  it('filters unlinked receipts without fabricating lesson counts or unit prices', () => {
    const result = loadReceiptPreview({ status: 'UNLINKED' });
    expect(result.total).toBe(2);
    expect(result.rows.every((row) => row.statusLabel === '待录包')).toBe(true);
    expect(result.rows[0].packageLabel).toBe('尚未录入课包');
    expect(previewReceiptDetail(result.rows[0].id)?.unitPriceLabel).toBe('待录包');
  });

  it('returns empty state, supports pagination and rejects invalid periods', () => {
    expect(loadReceiptPreview({ keyword: '无此学员' }).total).toBe(0);
    const first = loadReceiptPreview({});
    const second = loadReceiptPreview({ page: 2 });
    expect(second.hasMore).toBe(false);
    expect(second.summary).toEqual(first.summary);
    expect(second.rows.some((row) => first.rows.some((item) => item.id === row.id))).toBe(false);
    expect(() => loadReceiptPreview({ startDate: '2026-09-07', endDate: '2026-09-01' }))
      .toThrow('开始日期不能晚于结束日期');
    expect(previewReceiptDetail('unknown')).toBeNull();
  });
});
