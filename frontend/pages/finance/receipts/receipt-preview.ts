// Development-only visual fixture. This is not the finance API or a cash ledger.
export function canPreviewFinance(version: string | undefined, preview: string | undefined): boolean {
  return version === 'develop' && preview === '1';
}

export interface ReceiptPreviewQuery {
  campusId?: string;
  keyword?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  page?: number;
}

const receipts = [
  { id: 'preview-receipt-1', studentName: '陈晨', campusId: 'east', campusName: '东城校区', date: '2026-09-06', amountFen: 120000, linked: true, main: 12, gift: 3, price: '100.00', channel: '微信收款', course: '创意美术 · 秋季课包' },
  { id: 'preview-receipt-2', studentName: '林小满', campusId: 'west', campusName: '西城校区', date: '2026-09-06', amountFen: 240000, linked: false, main: 0, gift: 0, price: '', channel: '银行转账', course: '' },
  { id: 'preview-receipt-3', studentName: '欧阳慕容思远', campusId: 'east', campusName: '东城校区', date: '2026-09-05', amountFen: 168000, linked: true, main: 16, gift: 2, price: '105.00', channel: '微信收款', course: '综合创作 · 进阶课包' },
  { id: 'preview-receipt-4', studentName: '周予安', campusId: 'west', campusName: '西城校区', date: '2026-09-04', amountFen: 360000, linked: true, main: 36, gift: 6, price: '100.00', channel: '现金', course: '创意美术 · 年度课包' },
  { id: 'preview-receipt-5', studentName: '许知夏', campusId: 'east', campusName: '东城校区', date: '2026-09-02', amountFen: 98000, linked: false, main: 0, gift: 0, price: '', channel: '微信收款', course: '' },
  { id: 'preview-receipt-6', studentName: '沈星河', campusId: 'west', campusName: '西城校区', date: '2026-08-31', amountFen: 123456789, linked: true, main: 120, gift: 0, price: '10,288.07', channel: '银行转账', course: '大金额排版样例' },
] as const;

function money(fen: number): string {
  return (fen / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function toRow(receipt: typeof receipts[number]) {
  return {
    ...receipt,
    amountLabel: money(receipt.amountFen),
    statusLabel: receipt.linked ? '已录包' : '待录包',
    packageLabel: receipt.linked ? `购买 ${receipt.main} 节 · 赠送 ${receipt.gift} 节` : '尚未录入课包',
    unitPriceLabel: receipt.linked ? `${receipt.price} 元/节` : '待录包',
  };
}

export interface ReceiptPreviewRow {
  id: string;
  studentName: string;
  campusId: string;
  campusName: string;
  date: string;
  amountFen: number;
  linked: boolean;
  main: number;
  gift: number;
  price: string;
  channel: string;
  course: string;
  amountLabel: string;
  statusLabel: string;
  packageLabel: string;
  unitPriceLabel: string;
  validityLabel?: string;
  createdLabel?: string;
  note?: string;
}

export function loadReceiptPreview(query: ReceiptPreviewQuery) {
  if (query.startDate && query.endDate && query.startDate > query.endDate) {
    throw new Error('开始日期不能晚于结束日期');
  }
  const filtered = receipts.filter((receipt) =>
    (!query.campusId || receipt.campusId === query.campusId) &&
    (!query.keyword?.trim() || receipt.studentName.includes(query.keyword.trim())) &&
    (!query.startDate || receipt.date >= query.startDate) &&
    (!query.endDate || receipt.date <= query.endDate) &&
    (!query.status || (query.status === 'LINKED' ? receipt.linked : !receipt.linked)),
  );
  const page = Math.max(1, Math.trunc(query.page || 1));
  const end = page * 3;
  return {
    rows: filtered.slice(end - 3, end).map(toRow),
    total: filtered.length,
    hasMore: filtered.length > end,
    summary: {
      receiptsLabel: money(filtered.reduce((sum, receipt) => sum + receipt.amountFen, 0)),
      linkedCount: filtered.filter((receipt) => receipt.linked).length,
      unlinkedCount: filtered.filter((receipt) => !receipt.linked).length,
    },
  };
}

export function previewReceiptDetail(id: string): ReceiptPreviewRow | null {
  const receipt = receipts.find((item) => item.id === id);
  return receipt ? toRow(receipt) : null;
}
