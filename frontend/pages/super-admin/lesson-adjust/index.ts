import { superAdminService } from '../../../services/super-admin-runtime';
import { decodeSuperAdminRouteParam } from '../../../services/super-admin-students.presenter';
import { createMutationKey, formatLessonUnits } from '../../../utils/super-admin-format';

Page({
  data: { viewState: 'ready', errorMessage: '', packageId: '', studentName: '', bucket: 'MAIN' as 'MAIN' | 'GIFT', deltaLessons: '', reason: '', submitting: false, resultLabel: '' },
  onLoad(options: Record<string, string | undefined>) { this.setData({ packageId: decodeSuperAdminRouteParam(options.packageId), studentName: decodeSuperAdminRouteParam(options.studentName), bucket: options.bucket === 'GIFT' ? 'GIFT' : 'MAIN' }); },
  onBucketChange(event: WechatMiniprogram.PickerChange) { this.setData({ bucket: Number(event.detail.value) === 1 ? 'GIFT' : 'MAIN' }); },
  onDeltaInput(event: WechatMiniprogram.Input) { this.setData({ deltaLessons: event.detail.value }); },
  onReasonInput(event: WechatMiniprogram.Input) { this.setData({ reason: event.detail.value }); },
  async onSubmit() {
    const value = Number(this.data.deltaLessons); const reason = this.data.reason.trim();
    if (!this.data.packageId || !Number.isFinite(value) || value === 0 || !reason) { wx.showToast({ title: '请填写非零课时和调整原因', icon: 'none' }); return; }
    const deltaUnits = Math.round(value * 100);
    if (deltaUnits === 0) { wx.showToast({ title: '调整精度至少为0.01课时', icon: 'none' }); return; }
    this.setData({ submitting: true, errorMessage: '' });
    const state = await superAdminService.adjustLessonLedger({ coursePackageId: this.data.packageId, bucket: this.data.bucket, deltaUnits, reason }, createMutationKey('lesson-adjust'));
    if (state.status === 'success') this.setData({ submitting: false, viewState: 'success', resultLabel: `调整成功，当前余额${formatLessonUnits(state.data.balanceAfterUnits)}节` });
    else if (state.status === 'error') this.setData({ submitting: false, viewState: 'error', errorMessage: state.message });
  },
  onBackToLedger() { wx.navigateBack({ delta: 1 }); },
});
