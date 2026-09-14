import { campusManagerService } from '../../../services/campus-manager-runtime';
import { CampusManagerStudentWorkflow } from '../../../services/campus-manager-student.workflow';
import { CampusManagerSchedulingOption } from '../../../types/campus-manager';

interface ClassOptionModel {
  classGroupId: string;
  label: string;
}

const workflow = new CampusManagerStudentWorkflow(campusManagerService);

function today(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildClassOptions(
  classes: readonly CampusManagerSchedulingOption[],
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
    void this.loadOptions();
  },

  async loadOptions() {
    this.setData({ optionsState: 'loading', optionsError: '' });
    const state = await campusManagerService.loadSchedulingOptions();
    if (state.status === 'success' || state.status === 'empty') {
      const classOptions = buildClassOptions(state.data.classes);
      this.setData({
        optionsState: state.status === 'empty' ? 'empty' : 'ready',
        optionsError: '',
        classOptions,
        classIndex: 0,
        selectedClassLabel: classOptions[0].label,
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
    if (this.data.submitting || this.data.optionsState === 'forbidden') {
      return;
    }
    const selectedClass = this.data.classOptions[this.data.classIndex];
    const draft = {
      displayName: this.data.displayName,
      birthDate: this.data.birthDate,
      classGroupId: selectedClass?.classGroupId ?? '',
    };
    this.setData({ submitting: true, formError: '' });
    const outcome = await workflow.submit(draft);
    if (outcome.status === 'success') {
      this.setData({ submitting: false });
      wx.showToast({ title: '学员新增成功', icon: 'success' });
      wx.redirectTo({ url: '/pages/campus-manager/students/index' });
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
});
