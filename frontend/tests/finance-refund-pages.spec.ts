import * as fs from 'fs';
import * as path from 'path';

const read = (name: string) => fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8');
describe('refund page entry and shared visual contract', () => {
  it('keeps history collapsed and secondary commands in a native action menu', () => {
    const template = read('templates/finance-refunds.wxml');
    expect(template).toContain('wx:for="{{primaryActions}}"');
    expect(template).toContain('bindtap="onMoreActions"');
    expect(template).toContain('wx:if="{{showHistory}}"');
    expect(read('services/finance-refunds.page.ts')).toContain('wx.showActionSheet');
  });
  it('registers distinct finance and review page factories', () => {
    expect(read('pages/finance/refunds/index.ts')).toContain("registerRefundPage('FINANCE')");
    expect(read('pages/super-admin/finance-review/index.ts')).toContain("registerRefundPage('SUPER_ADMIN')");
  });
  it('reuses one template and existing workspace styles without cross-subpackage imports', () => {
    for (const page of ['finance/refunds', 'super-admin/finance-review']) {
      expect(read(`pages/${page}/index.wxml`)).toContain('../../../templates/finance-refunds.wxml');
      expect(read(`pages/${page}/index.wxss`)).toContain('../../../styles/finance-refunds.wxss');
    }
    expect(read('styles/finance-refunds.wxss')).toContain('super-admin-workspace.wxss');
  });
  it('provides receipt-scoped submission and an independent review entry', () => {
    expect(read('pages/finance/receipts/index.wxml')).toContain('bindtap="onRefund"');
    expect(read('pages/finance/receipts/index.ts')).toContain('refunds/index?receiptId=');
    expect(read('pages/super-admin/profile/index.wxml')).toContain('/pages/super-admin/finance-review/index');
    const template = read('templates/finance-refunds.wxml');
    expect(template).toContain('bindtap="onQuote"');
    expect(template).toContain('data-field="paidTime"');
    expect(template).toContain('bindtap="onChooseProof"');
    expect(template).toContain('disabled="{{submitting');
  });
});
