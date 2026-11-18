import {
  buildParentProfilePageModel,
  normalizeParentProfileDraft,
} from '../../../services/parent-profile.presenter';
import { parentService } from '../../../services/parent-runtime';
import { sessionService } from '../../../services/session.service';

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
    profileSetupCompleted: false,
    savedAgeInput: '',
    savedHomeAddress: '',
    isEditing: false,
    submitting: false,
    emptyMessage: '',
  },
  disposed: false,
  requestVersion: 0,
  pendingUpdate: null as { fingerprint: string; key: string } | null,

  onLoad() {
    void this.loadStudentProfile();
  },
  onUnload() { this.disposed = true; this.requestVersion += 1; },
  handleAuthError(state: { statusCode?: number; code?: string }): boolean {
    if (state.statusCode !== 401 && state.code !== 'UNAUTHORIZED') return false;
    this.disposed = true;
    sessionService.logout();
    wx.reLaunch({ url: '/pages/bootstrap/index' });
    return true;
  },

  onPullDownRefresh() {
    void this.loadStudentProfile().finally(() => {
      if (!this.disposed) wx.stopPullDownRefresh();
    });
  },

  async loadStudentProfile() {
    if (this.disposed || this.data.submitting) return;
    const version = ++this.requestVersion;
    const editing = this.data.isEditing;
    if (!editing) this.setData({ viewState: 'loading', errorMessage: '' });
    const snapshot = await parentService.loadProfile();
    if (this.disposed || version !== this.requestVersion || this.data.submitting) return;

    if (snapshot.status === 'success' || snapshot.status === 'empty') {
      const model = buildParentProfilePageModel(snapshot.data);
      const profileSetupCompleted = snapshot.data.student?.profileSetupCompleted === true;
      const preserveDraft = this.data.isEditing && !model.isEmpty;
      this.setData({
        ...model,
        ...(preserveDraft ? {
          studentAgeInput: profileSetupCompleted ? model.studentAgeInput : this.data.studentAgeInput,
          homeAddress: this.data.homeAddress,
        } : {}),
        profileSetupCompleted,
        savedAgeInput: model.studentAgeInput,
        savedHomeAddress: model.homeAddress,
        isEditing: preserveDraft,
        submitting: false,
        viewState: 'ready',
        errorMessage: '',
      });
      return;
    }

    if (snapshot.status === 'error') {
      if (this.handleAuthError(snapshot)) return;
      if (this.data.isEditing) {
        wx.showToast({ title: snapshot.message, icon: 'none' });
        return;
      }
      this.setData({ viewState: 'error', errorMessage: snapshot.message });
    }
  },

  onRetry() {
    void this.loadStudentProfile();
  },

  onEdit() {
    if (this.disposed || this.data.isEmpty || this.data.submitting) return;
    this.setData({ isEditing: true, errorMessage: '' });
  },

  onCancel() {
    if (this.disposed || this.data.submitting) return;
    this.setData({
      studentAgeInput: this.data.savedAgeInput,
      homeAddress: this.data.savedHomeAddress,
      isEditing: false,
      errorMessage: '',
    });
    this.pendingUpdate = null;
  },

  onAgeInput(event: WechatMiniprogram.Input) {
    if (this.disposed || this.data.profileSetupCompleted || this.data.submitting || !this.data.isEditing) return;
    this.setData({ studentAgeInput: event.detail.value });
  },

  onAddressInput(event: WechatMiniprogram.TextareaInput) {
    if (this.disposed || this.data.submitting || !this.data.isEditing) return;
    this.setData({ homeAddress: event.detail.value });
  },

  async onSave() {
    if (this.disposed || this.data.isEmpty || this.data.submitting || !this.data.isEditing) return;

    let draft: { age?: number; homeAddress: string };
    try {
      if (this.data.profileSetupCompleted) {
        const homeAddress = this.data.homeAddress.trim();
        if (homeAddress.length > 300) throw new Error('家庭住址不能超过 300 字');
        draft = { homeAddress };
      } else {
        draft = normalizeParentProfileDraft({
          ageInput: this.data.studentAgeInput,
          homeAddressInput: this.data.homeAddress,
        });
      }
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '请检查资料内容',
        icon: 'none',
      });
      return;
    }

    const input = { ...draft, expectedVersion: this.data.profileVersion };
    const fingerprint = JSON.stringify(input);
    if (!this.pendingUpdate || this.pendingUpdate.fingerprint !== fingerprint) {
      this.pendingUpdate = { fingerprint, key: createProfileUpdateKey() };
    }
    this.requestVersion += 1;
    this.setData({ submitting: true, errorMessage: '' });
    const result = await parentService.updateProfile(
      input,
      this.pendingUpdate.key,
    );
    if (this.disposed) return;
    if (result.status === 'success') {
      this.pendingUpdate = null;
      const model = buildParentProfilePageModel(result.data);
      this.setData({
        ...model,
        profileSetupCompleted: result.data.student?.profileSetupCompleted === true,
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
      if (this.handleAuthError(result)) return;
      wx.showToast({ title: result.message, icon: 'none' });
      if (result.code === 'STUDENT_PROFILE_VERSION_CONFLICT') {
        await this.loadStudentProfile();
      }
    }
  },
});
