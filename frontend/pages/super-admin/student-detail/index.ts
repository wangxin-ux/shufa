import {
  buildSuperAdminStudentAdjustmentUrl,
  buildSuperAdminStudentDetail,
  SuperAdminStudentDetailModel,
} from '../../../services/super-admin-students.presenter';
import { superAdminService } from '../../../services/super-admin-runtime';
import { createMutationKey } from '../../../utils/super-admin-format';

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    studentId: '',
    detail: null as SuperAdminStudentDetailModel | null,
    validityEditingPackageId: '',
    validityStartDate: '',
    validityEndDate: '',
    validityLongTerm: false,
    validityReason: '',
    validityError: '',
    validitySubmitting: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ studentId: options.id ?? '' });
    void this.load();
  },

  onShow() {
    if (this.data.studentId && this.data.detail) void this.load();
  },

  onPullDownRefresh() {
    void this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    if (!this.data.studentId) {
      this.setData({ viewState: 'error', errorMessage: '缺少学员标识' });
      return;
    }
    this.setData({ viewState: 'loading', errorMessage: '' });
    const state = await superAdminService.loadStudent(this.data.studentId);
    if (state.status === 'success') {
      this.setData({
        viewState: 'ready',
        detail: buildSuperAdminStudentDetail(state.data),
      });
      return;
    }
    if (state.status === 'error') {
      this.setData({
        viewState: state.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage: state.message,
        detail: null,
      });
    }
  },

  onAdjustTap(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.detail) return;
    const packageId = String(event.currentTarget.dataset.packageId ?? '');
    const bucket =
      event.currentTarget.dataset.bucket === 'GIFT' ? 'GIFT' : 'MAIN';
    if (!packageId) return;
    wx.navigateTo({
      url: buildSuperAdminStudentAdjustmentUrl(
        packageId,
        this.data.detail.displayName,
        bucket,
      ),
    });
  },

  onValidityTap(event: WechatMiniprogram.TouchEvent) {
    const packageId = String(event.currentTarget.dataset.packageId ?? '');
    const coursePackage = this.data.detail?.packages.find(
      (item) => item.id === packageId,
    );
    if (!coursePackage) return;
    this.setData({
      validityEditingPackageId: packageId,
      validityStartDate: coursePackage.validFromInput,
      validityEndDate:
        coursePackage.expiresAtInput || coursePackage.validFromInput,
      validityLongTerm: !coursePackage.expiresAtInput,
      validityReason: '',
      validityError: '',
    });
  },

  onValidityStartChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ validityStartDate: String(event.detail.value) });
  },

  onValidityEndChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ validityEndDate: String(event.detail.value) });
  },

  onValidityLongTermChange(event: WechatMiniprogram.SwitchChange) {
    this.setData({ validityLongTerm: event.detail.value });
  },

  onValidityReasonInput(event: WechatMiniprogram.Input) {
    this.setData({ validityReason: event.detail.value });
  },

  onValidityCancel() {
    this.setData({
      validityEditingPackageId: '',
      validityReason: '',
      validityError: '',
    });
  },

  async onValiditySubmit() {
    const coursePackage = this.data.detail?.packages.find(
      (item) => item.id === this.data.validityEditingPackageId,
    );
    const reason = this.data.validityReason.trim();
    if (!coursePackage || !this.data.validityStartDate || !reason) {
      wx.showToast({ title: '请填写有效期和调整原因', icon: 'none' });
      return;
    }
    if (
      !this.data.validityLongTerm &&
      (!this.data.validityEndDate ||
        this.data.validityEndDate < this.data.validityStartDate)
    ) {
      wx.showToast({ title: '结束日期不能早于开始日期', icon: 'none' });
      return;
    }
    this.setData({ validitySubmitting: true, validityError: '' });
    const state = await superAdminService.updateCoursePackageValidity(
      coursePackage.id,
      {
        validFrom: `${this.data.validityStartDate}T00:00:00+08:00`,
        expiresAt: this.data.validityLongTerm
          ? null
          : `${this.data.validityEndDate}T23:59:59.999+08:00`,
        expectedVersion: coursePackage.version,
        reason,
      },
      createMutationKey('course-package-validity'),
    );
    if (state.status === 'success') {
      this.setData({
        validitySubmitting: false,
        validityEditingPackageId: '',
        validityReason: '',
      });
      wx.showToast({ title: '有效期已更新', icon: 'success' });
      await this.load();
      return;
    }
    if (state.status === 'error') {
      this.setData({
        validitySubmitting: false,
        validityError: state.message,
      });
    }
  },

  onRetry() {
    void this.load();
  },
});
