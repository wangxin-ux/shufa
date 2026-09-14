import { superAdminService } from '../../../services/super-admin-runtime';
import {
  SuperAdminCampus,
  SuperAdminCreateEarningRuleInput,
  SuperAdminEarningRule,
} from '../../../types/super-admin';
import {
  createMutationKey,
  formatMoneyFen,
} from '../../../utils/super-admin-format';

type TeacherEarningBasisType = SuperAdminCreateEarningRuleInput['basisType'];

interface BasisOption {
  value: TeacherEarningBasisType;
  label: string;
  amountLabel: string;
  unitLabel: string;
}

interface EarningRuleView extends SuperAdminEarningRule {
  amountLabel: string;
  basisLabel: string;
  statusLabel: string;
  unitLabel: string;
}

const BASIS_OPTIONS: BasisOption[] = [
  {
    value: 'PER_COMPLETED_SESSION',
    label: '按完成课次',
    amountLabel: '每完成课次金额（元）',
    unitLabel: '完成课次',
  },
  {
    value: 'PER_LESSON_UNIT',
    label: '按课时',
    amountLabel: '每课时金额（元）',
    unitLabel: '课时',
  },
  {
    value: 'PER_PRESENT_ATTENDEE',
    label: '按实际到课人数',
    amountLabel: '每有效到课人次金额（元）',
    unitLabel: '有效到课人次',
  },
];

const STATUS_LABELS: Record<SuperAdminEarningRule['status'], string> = {
  DRAFT: '草稿',
  ACTIVE: '生效中',
  RETIRED: '已退役',
};

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    campuses: [] as SuperAdminCampus[],
    campusIndex: 0,
    basisOptions: BASIS_OPTIONS,
    basisIndex: 2,
    unitYuan: '3',
    rules: [] as EarningRuleView[],
    submitting: false,
  },

  onLoad() {
    void this.load();
  },

  onCampusChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ campusIndex: Number(event.detail.value) });
  },

  onBasisChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ basisIndex: Number(event.detail.value) });
  },

  onAmountInput(event: WechatMiniprogram.Input) {
    this.setData({ unitYuan: event.detail.value });
  },

  async load() {
    const [rules, campuses] = await Promise.all([
      superAdminService.loadEarningRules({ page: 1, pageSize: 100 }),
      superAdminService.loadCampuses({ page: 1, pageSize: 100 }),
    ]);
    const rulesReady = rules.status === 'success' || rules.status === 'empty';
    const campusesReady =
      campuses.status === 'success' || campuses.status === 'empty';
    if (rulesReady && campusesReady) {
      this.setData({
        viewState: rules.status,
        campuses: campuses.data.data,
        rules: rules.data.data.map(toRuleView),
      });
      return;
    }
    this.setData({
      viewState: 'error',
      errorMessage: '课时费规则加载失败，请稍后重试',
    });
  },

  async onCreate() {
    const campus = this.data.campuses[this.data.campusIndex];
    const basis = this.data.basisOptions[this.data.basisIndex];
    const amount = Math.round(Number(this.data.unitYuan) * 100);
    if (!campus || !basis || !Number.isInteger(amount) || amount <= 0) {
      wx.showToast({
        title: '请选择校区、计费方式并填写有效金额',
        icon: 'none',
      });
      return;
    }

    this.setData({ submitting: true });
    const state = await superAdminService.createEarningRule(
      {
        campusId: campus.id,
        teacherId: null,
        basisType: basis.value as TeacherEarningBasisType,
        unitAmountFen: amount,
        eligibleLessonKinds: ['REGULAR', 'MAKEUP'],
        countedAttendanceStatuses: ['PRESENT'],
        settlementDelayDays: 0,
        effectiveFrom: new Date().toISOString(),
      },
      createMutationKey('earning-rule-create'),
    );
    this.setData({ submitting: false });
    if (state.status === 'success') {
      wx.showToast({ title: '草稿已创建', icon: 'success' });
      void this.load();
    } else if (state.status === 'error') {
      wx.showToast({ title: state.message, icon: 'none' });
    }
  },

  async onTransition(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    const action = String(event.currentTarget.dataset.action ?? '') as
      | 'activate'
      | 'retire';
    const version = Number(event.currentTarget.dataset.version);
    const state = await superAdminService.transitionEarningRule(
      id,
      action,
      version,
      createMutationKey(`earning-rule-${action}`),
    );
    if (state.status === 'success') {
      void this.load();
    } else if (state.status === 'error') {
      wx.showToast({ title: state.message, icon: 'none' });
    }
  },

  onRetry() {
    void this.load();
  },
});

function toRuleView(rule: SuperAdminEarningRule): EarningRuleView {
  const basis = BASIS_OPTIONS.find(({ value }) => value === rule.basisType);
  return {
    ...rule,
    amountLabel: formatMoneyFen(rule.unitAmountFen),
    basisLabel: basis?.label ?? '未知计费方式',
    statusLabel: STATUS_LABELS[rule.status],
    unitLabel: basis?.unitLabel ?? '计费单位',
  };
}
