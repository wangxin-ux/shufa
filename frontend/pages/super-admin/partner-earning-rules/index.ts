import {
  presentSuperAdminPartnerRule,
} from '../../../services/super-admin-partner-earnings.presenter';
import { superAdminService } from '../../../services/super-admin-runtime';
import {
  SuperAdminCampus,
  SuperAdminCreatePartnerEarningRuleInput,
} from '../../../types/super-admin';
import { createMutationKey } from '../../../utils/super-admin-format';

const LESSON_KIND_OPTIONS = [
  { value: 'REGULAR', label: '常规课', checked: true },
  { value: 'MAKEUP', label: '补课', checked: true },
  { value: 'TRIAL', label: '试听课', checked: false },
];

const ATTENDANCE_OPTIONS = [
  { value: 'PRESENT', label: '实际到课', checked: true },
  { value: 'LEAVE', label: '请假', checked: false },
  { value: 'ABSENT', label: '缺勤', checked: false },
];

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    campuses: [] as SuperAdminCampus[],
    campusIndex: 0,
    unitPriceYuan: '10',
    sharePercent: '40',
    settlementDelayDays: '0',
    effectiveDate: localDatePart(new Date()),
    effectiveTime: localTimePart(new Date()),
    lessonKindOptions: LESSON_KIND_OPTIONS,
    attendanceOptions: ATTENDANCE_OPTIONS,
    rules: [] as Array<ReturnType<typeof presentSuperAdminPartnerRule>>,
    submittingId: '',
  },

  onLoad() {
    void this.load();
  },

  async load() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const [ruleState, campusState] = await Promise.all([
      superAdminService.loadPartnerEarningRules({ page: 1, pageSize: 100 }),
      superAdminService.loadCampuses({ page: 1, pageSize: 100 }),
    ]);
    const failure = [ruleState, campusState].find(
      (state) => state.status === 'error',
    );
    if (failure?.status === 'error') {
      this.setData({
        viewState: failure.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage: failure.message,
      });
      return;
    }
    if (
      (ruleState.status === 'success' || ruleState.status === 'empty') &&
      (campusState.status === 'success' || campusState.status === 'empty')
    ) {
      this.setData({
        viewState: ruleState.data.data.length > 0 ? 'ready' : 'empty',
        campuses: campusState.data.data,
        rules: ruleState.data.data.map(presentSuperAdminPartnerRule),
      });
    }
  },

  onCampusChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ campusIndex: Number(event.detail.value) });
  },

  onUnitPriceInput(event: WechatMiniprogram.Input) {
    this.setData({ unitPriceYuan: event.detail.value });
  },

  onShareInput(event: WechatMiniprogram.Input) {
    this.setData({ sharePercent: event.detail.value });
  },

  onDelayInput(event: WechatMiniprogram.Input) {
    this.setData({ settlementDelayDays: event.detail.value });
  },

  onEffectiveDateChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ effectiveDate: String(event.detail.value) });
  },

  onEffectiveTimeChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ effectiveTime: String(event.detail.value) });
  },

  onLessonKindsChange(event: WechatMiniprogram.CheckboxGroupChange) {
    const selected = new Set(event.detail.value);
    this.setData({
      lessonKindOptions: this.data.lessonKindOptions.map((item) => ({
        ...item,
        checked: selected.has(item.value),
      })),
    });
  },

  onAttendanceChange(event: WechatMiniprogram.CheckboxGroupChange) {
    const selected = new Set(event.detail.value);
    this.setData({
      attendanceOptions: this.data.attendanceOptions.map((item) => ({
        ...item,
        checked: selected.has(item.value),
      })),
    });
  },

  async onCreate() {
    if (this.data.submittingId) return;
    const campus = this.data.campuses[this.data.campusIndex];
    const unitPriceFen = Math.round(Number(this.data.unitPriceYuan) * 100);
    const shareBasisPoints = Math.round(Number(this.data.sharePercent) * 100);
    const settlementDelayDays = Number(this.data.settlementDelayDays);
    const eligibleLessonKinds = this.data.lessonKindOptions
      .filter(({ checked }) => checked)
      .map(({ value }) => value) as SuperAdminCreatePartnerEarningRuleInput['eligibleLessonKinds'];
    const countedAttendanceStatuses = this.data.attendanceOptions
      .filter(({ checked }) => checked)
      .map(({ value }) => value) as SuperAdminCreatePartnerEarningRuleInput['countedAttendanceStatuses'];
    if (
      !campus ||
      !Number.isInteger(unitPriceFen) ||
      unitPriceFen <= 0 ||
      !Number.isInteger(shareBasisPoints) ||
      shareBasisPoints <= 0 ||
      shareBasisPoints > 10000 ||
      !Number.isInteger(settlementDelayDays) ||
      settlementDelayDays < 0 ||
      eligibleLessonKinds.length === 0 ||
      countedAttendanceStatuses.length === 0
    ) {
      wx.showToast({ title: '请完整填写有效的规则配置', icon: 'none' });
      return;
    }
    const effectiveFrom = new Date(
      `${this.data.effectiveDate}T${this.data.effectiveTime}:00+08:00`,
    ).toISOString();
    this.setData({ submittingId: 'create' });
    const state = await superAdminService.createPartnerEarningRule(
      {
        campusId: campus.id,
        unitPriceFen,
        shareBasisPoints,
        eligibleLessonKinds,
        countedAttendanceStatuses,
        settlementDelayDays,
        effectiveFrom,
      },
      createMutationKey('partner-rule-create'),
    );
    this.setData({ submittingId: '' });
    if (state.status === 'success') {
      wx.showToast({ title: '规则草稿已创建', icon: 'success' });
      void this.load();
    } else if (state.status === 'error') {
      wx.showToast({ title: state.message, icon: 'none' });
    }
  },

  onTransition(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    const action = String(event.currentTarget.dataset.action ?? '') as
      | 'activate'
      | 'retire';
    const version = Number(event.currentTarget.dataset.version);
    wx.showModal({
      title: action === 'activate' ? '启用规则' : '退役规则',
      content:
        action === 'activate'
          ? '启用后将成为该校区当前合作收益规则。'
          : '退役后不会影响历史收益快照。',
      confirmText: action === 'activate' ? '确认启用' : '确认退役',
      success: ({ confirm }) => {
        if (confirm) void this.performTransition(id, action, version);
      },
    });
  },

  async performTransition(
    id: string,
    action: 'activate' | 'retire',
    version: number,
  ) {
    if (this.data.submittingId) return;
    this.setData({ submittingId: id });
    const state = await superAdminService.transitionPartnerEarningRule(
      id,
      action,
      version,
      createMutationKey(`partner-rule-${action}`),
    );
    this.setData({ submittingId: '' });
    if (state.status === 'success') {
      wx.showToast({ title: action === 'activate' ? '规则已启用' : '规则已退役', icon: 'success' });
      void this.load();
    } else if (state.status === 'error') {
      wx.showToast({ title: state.message, icon: 'none' });
      void this.load();
    }
  },

  onRetry() {
    void this.load();
  },
});

function localDatePart(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localTimePart(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
