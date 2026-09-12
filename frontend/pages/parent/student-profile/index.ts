import {
  buildParentProfilePageModel,
  normalizeParentProfileDraft,
} from '../../../services/parent-profile.presenter';
import { ParentPageLoader } from '../../../services/parent-page-loader';
import { parentService } from '../../../services/parent-runtime';

const studentProfileLoader = new ParentPageLoader(() =>
  parentService.loadProfile(),
);

let profileUpdateSequence = 0;

function createProfileUpdateKey(): string {
  profileUpdateSequence += 1;
  return `parent-profile-${Date.now()}-${profileUpdateSequence}`;
}

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    isEmpty: true,
    studentName: '',
    studentAgeLabel: '',
    studentAgeInput: '',
    homeAddress: '',
    homeAddressLabel: '',
    profileVersion: 0,
    savedAgeInput: '',
    savedHomeAddress: '',
    isEditing: false,
    submitting: false,
    emptyMessage: '',
  },

  onLoad() {
    void this.loadStudentProfile();
  },

  onPullDownRefresh() {
    void this.loadStudentProfile().finally(() => wx.stopPullDownRefresh());
  },

  async loadStudentProfile() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const snapshot = await studentProfileLoader.load();

    if (snapshot.status === 'ready' || snapshot.status === 'empty') {
      const model = buildParentProfilePageModel(snapshot.data);
      this.setData({
        ...model,
        savedAgeInput: model.studentAgeInput,
        savedHomeAddress: model.homeAddress,
        isEditing: false,
        submitting: false,
        viewState: 'ready',
        errorMessage: '',
      });
      return;
    }

    if (snapshot.status === 'error') {
      this.setData({ viewState: 'error', errorMessage: snapshot.message });
    }
  },

  onRetry() {
    void this.loadStudentProfile();
  },

  onEdit() {
    this.setData({ isEditing: true, errorMessage: '' });
  },

  onCancel() {
    this.setData({
      studentAgeInput: this.data.savedAgeInput,
      homeAddress: this.data.savedHomeAddress,
      isEditing: false,
      errorMessage: '',
    });
  },

  onAgeInput(event: WechatMiniprogram.Input) {
    this.setData({ studentAgeInput: event.detail.value });
  },

  onAddressInput(event: WechatMiniprogram.TextareaInput) {
    this.setData({ homeAddress: event.detail.value });
  },

  async onSave() {
    if (this.data.submitting) return;

    let draft: { age: number; homeAddress: string };
    try {
      draft = normalizeParentProfileDraft({
        ageInput: this.data.studentAgeInput,
        homeAddressInput: this.data.homeAddress,
      });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '请检查资料内容',
        icon: 'none',
      });
      return;
    }

    this.setData({ submitting: true, errorMessage: '' });
    const result = await parentService.updateProfile(
      { ...draft, expectedVersion: this.data.profileVersion },
      createProfileUpdateKey(),
    );
    if (result.status === 'success') {
      const model = buildParentProfilePageModel(result.data);
      this.setData({
        ...model,
        savedAgeInput: model.studentAgeInput,
        savedHomeAddress: model.homeAddress,
        isEditing: false,
        submitting: false,
      });
      wx.showToast({ title: '资料已保存', icon: 'success' });
      return;
    }

    this.setData({ submitting: false });
    if (result.status === 'error') {
      wx.showToast({ title: result.message, icon: 'none' });
      if (result.code === 'STUDENT_PROFILE_VERSION_CONFLICT') {
        await this.loadStudentProfile();
      }
    }
  },
});
