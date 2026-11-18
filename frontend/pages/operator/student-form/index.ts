import { OperatorPageContext } from '../runtime/operator-page-context';
import { createSessionService } from '../../../services/session.service';
import { OperatorStudentWorkflow } from '../runtime/services/operator-student.workflow';
import { OperatorSchedulingOption } from '../runtime/types/operator';

interface ClassOptionModel {
  classGroupId: string;
  label: string;
}
type SubmitOutcome = Awaited<ReturnType<OperatorStudentWorkflow['submit']>>;

function today(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildClassOptions(
  classes: readonly OperatorSchedulingOption[],
): ClassOptionModel[] {
  return [
    { classGroupId: '', label: '暂不分班' },
    ...classes.map((item) => ({
      classGroupId: item.classGroupId,
      label: `${item.className} · ${item.teacherName}`,
    })),
  ];
}

Page({
  context: undefined as OperatorPageContext | undefined,
  workflow: undefined as OperatorStudentWorkflow | undefined,
  initialShowPending: true,
  deferredOutcome: undefined as SubmitOutcome | undefined,
  data: {
    optionsState: 'loading',
    optionsError: '',
    classOptions: buildClassOptions([]),
    classIndex: 0,
    selectedClassLabel: '暂不分班',
    displayName: '',
    birthDate: '',
    maxBirthDate: today(),
    formError: '',
    submitting: false,
  },

  onLoad() {
    this.context = new OperatorPageContext((optionsError) => this.setData({
      optionsState: 'forbidden', optionsError, classOptions: buildClassOptions([]),
      classIndex: 0, selectedClassLabel: '暂不分班', displayName: '', birthDate: '',
      submitting: false, formError: '',
    }));
    this.workflow = new OperatorStudentWorkflow(this.context.service);
    void this.loadOptions();
  },

  onShow() {
    if (!this.context?.show()) return;
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    if (this.deferredOutcome) {
      const outcome = this.deferredOutcome;
      this.deferredOutcome = undefined;
      this.finishSubmit(outcome);
      if (outcome.status === 'success') return;
    }
    void this.loadOptions();
  },
  onHide() { this.context?.hide(); this.initialShowPending = false; },
  onUnload() { this.context?.dispose(); this.deferredOutcome = undefined; },

  async loadOptions() {
    const context = this.context;
    if (!context?.isActive()) return;
    const sequence = context.nextRead();
    const selectedId = this.data.classOptions[this.data.classIndex]?.classGroupId;
    this.setData({ optionsState: 'loading', optionsError: '' });
    const state = await context.service.loadSchedulingOptions();
    if (!context.accepts(sequence)) return;
    if (state.status === 'success' || state.status === 'empty') {
      const classOptions = buildClassOptions(state.data.classes);
      const classIndex = Math.max(0, classOptions.findIndex((item) => item.classGroupId === selectedId));
      this.setData({
        optionsState: state.status === 'empty' ? 'empty' : 'ready',
        optionsError: '',
        classOptions,
        classIndex,
        selectedClassLabel: classOptions[classIndex].label,
      });
      return;
    }
    if (state.status === 'error') {
      this.setData({
        optionsState: state.statusCode === 403 ? 'forbidden' : 'error',
        optionsError:
          state.statusCode === 403
            ? '当前账号无权新增本校区学员'
            : state.message,
      });
    }
  },

  onNameInput(event: WechatMiniprogram.Input) {
    this.setData({ displayName: event.detail.value, formError: '' });
  },

  onBirthDateChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ birthDate: String(event.detail.value), formError: '' });
  },

  onClearBirthDate() {
    this.setData({ birthDate: '', formError: '' });
  },

  onClassChange(event: WechatMiniprogram.PickerChange) {
    const classIndex = Number(event.detail.value);
    const option = this.data.classOptions[classIndex];
    if (!option) {
      return;
    }
    this.setData({
      classIndex,
      selectedClassLabel: option.label,
      formError: '',
    });
  },

  onRetryOptions() {
    void this.loadOptions();
  },

  async onSubmit() {
    const context = this.context;
    if (!context?.isActive() || !this.workflow || this.data.submitting ||
        !['ready', 'empty'].includes(this.data.optionsState)) {
      return;
    }
    const selectedClass = this.data.classOptions[this.data.classIndex];
    const draft = {
      displayName: this.data.displayName,
      birthDate: this.data.birthDate,
      classGroupId: selectedClass?.classGroupId ?? '',
    };
    this.setData({ submitting: true, formError: '' });
    const outcome = await this.workflow.submit(draft);
    if (!context.isCurrent()) return;
    if (!context.isActive()) { this.deferredOutcome = outcome; return; }
    this.finishSubmit(outcome);
  },

  finishSubmit(outcome: SubmitOutcome) {
    if (!this.context?.isActive()) return;
    if (outcome.status === 'success') {
      this.setData({ submitting: false });
      wx.showToast({ title: '学员新增成功', icon: 'success' });
      wx.redirectTo({ url: '/pages/operator/students/index' });
      return;
    }
    this.setData({
      submitting: false,
      formError: outcome.message,
      ...(outcome.status === 'forbidden'
        ? { optionsState: 'forbidden' }
        : {}),
    });
  },

  onLogin() {
    if (this.context?.ownsRuntime()) createSessionService().logout();
    this.context?.invalidate('请重新登录');
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },
});
