import { superAdminService } from '../../../services/super-admin-runtime';
import { SuperAdminLessonLedgerEntry } from '../../../types/super-admin';
import { formatLessonUnits, formatLocalDateTime } from '../../../utils/super-admin-format';

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    campusId: '',
    entryType: '',
    heroLabel: '全部课时流水',
    ledgerCount: 0,
    mainEntryCount: 0,
    giftEntryCount: 0,
    entries: [] as Array<SuperAdminLessonLedgerEntry & {
      deltaLabel: string;
      balanceLabel: string;
      timeLabel: string;
      typeLabel: string;
      bucketLabel: string;
    }>,
  },
  onLoad(options: Record<string, string | undefined>) { this.setData({ campusId: options.campusId ?? '' }); },
  onShow() { void this.load(); },
  async load() {
    const state = await superAdminService.loadLessonLedger({ page: 1, pageSize: 100, campusId: this.data.campusId || undefined, entryType: this.data.entryType || undefined });
    if (state.status === 'success' || state.status === 'empty') {
      const entries = state.data.data.map((item) => ({
        ...item,
        deltaLabel: `${item.deltaUnits > 0 ? '+' : ''}${formatLessonUnits(item.deltaUnits)}节`,
        balanceLabel: `${formatLessonUnits(item.balanceAfterUnits)}节`,
        timeLabel: formatLocalDateTime(item.createdAt),
        typeLabel: {
          CONSUME: '扣课',
          REVERSAL: '撤销',
          ADJUSTMENT: '后台调整',
          REFUND: '退课扣回',
          GRANT: '课时发放',
          CORRECTION: '收款纠错冲正',
        }[item.entryType],
        bucketLabel: item.bucket === 'MAIN' ? '主课时' : '赠送课时',
      }));
      this.setData({
        viewState: state.status,
        heroLabel: this.data.entryType ? '当前筛选流水' : '全部课时流水',
        ledgerCount: state.data.meta.total,
        mainEntryCount: entries.filter((item) => item.bucket === 'MAIN').length,
        giftEntryCount: entries.filter((item) => item.bucket === 'GIFT').length,
        entries,
      });
    }
    else if (state.status === 'error') this.setData({ viewState: state.statusCode === 403 ? 'forbidden' : 'error', errorMessage: state.message });
  },
  onFilterTap(event: WechatMiniprogram.TouchEvent) { this.setData({ entryType: String(event.currentTarget.dataset.type ?? '') }); void this.load(); },
  onAdjustTap(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.packageId ?? ''); const name = String(event.currentTarget.dataset.studentName ?? ''); const bucket = String(event.currentTarget.dataset.bucket ?? 'MAIN');
    wx.navigateTo({ url: `/pages/super-admin/lesson-adjust/index?packageId=${encodeURIComponent(id)}&studentName=${encodeURIComponent(name)}&bucket=${encodeURIComponent(bucket)}` });
  },
  onRetry() { void this.load(); },
});
