import { loadParentPdfDisplayFont } from '../runtime/parent-pdf-font';
import { parentService } from '../../../services/parent-runtime';
import { sessionService } from '../../../services/session.service';
import type { ParentProfileSetupView } from '../../../types/parent';

let setupSequence = 0;
const mutationKey = () => `parent-profile-setup-${Date.now()}-${++setupSequence}`;
const todayInShanghai = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

function birthDateError(value: string): string {
  if (!value) return '请选择出生日期';
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value) return '请选择有效的出生日期';
  const today = todayInShanghai();
  if (value > today) return '出生日期不能晚于今天';
  const age = Number(today.slice(0, 4)) - Number(value.slice(0, 4)) -
    (today.slice(5) < value.slice(5) ? 1 : 0);
  return age > 120 ? '年龄不能超过 120 岁' : '';
}

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    emptyMessage: '暂未绑定学员，请联系校区',
    message: '',
    student: null as ParentProfileSetupView['student'],
    name: '',
    birthDate: '',
    dateEnd: todayInShanghai(),
    fileId: '',
    photoUrl: '',
    photoBusy: false,
    submitting: false,
    loadingSetup: false,
  },
  disposed: false,
  unloaded: false,
  readSequence: 0,
  needsVersionRefresh: false,
  pendingUpdate: null as { fingerprint: string; key: string } | null,

  onLoad() {
    void loadParentPdfDisplayFont();
    void this.loadSetup();
  },

  onUnload() {
    this.unloaded = true;
    this.disposed = true;
    this.readSequence += 1;
  },

  onPullDownRefresh() {
    void this.loadSetup().finally(() => {
      if (!this.disposed) wx.stopPullDownRefresh();
    });
  },

  async loadSetup() {
    if (this.disposed || this.data.photoBusy || this.data.submitting) return;
    const request = ++this.readSequence;
    this.setData({
      loadingSetup: true,
      errorMessage: '',
      ...(this.data.viewState === 'ready' ? {} : { viewState: 'loading' }),
    });
    const state = await parentService.loadProfileSetup();
    if (this.disposed || request !== this.readSequence) return;
    this.setData({ loadingSetup: false });
    if (state.status === 'success' || state.status === 'empty') {
      const student = state.data.student;
      if (!student) {
        this.pendingUpdate = null;
        this.setData({
          viewState: 'ready', student: null, name: '', birthDate: '',
          fileId: '', photoUrl: '', message: '',
        });
        return;
      }
      if (!state.data.required) {
        this.returnHome();
        return;
      }
      const preserveDraft = this.data.student?.id === student.id;
      if (!preserveDraft) this.pendingUpdate = null;
      this.needsVersionRefresh = false;
      this.setData({
        viewState: 'ready',
        student,
        name: preserveDraft ? this.data.name : student.name,
        birthDate: preserveDraft ? this.data.birthDate : student.birthDate ?? '',
        fileId: preserveDraft ? this.data.fileId : '',
        photoUrl: preserveDraft && this.data.fileId ? this.data.photoUrl : student.photo?.accessUrl ?? '',
        dateEnd: todayInShanghai(),
        errorMessage: '',
        message: '',
      });
      return;
    }
    if (state.status === 'error' && !this.handleAuthError(state)) {
      if (this.data.viewState === 'ready') this.setData({ message: state.message });
      else this.setData({ viewState: 'error', errorMessage: state.message });
    }
  },

  onRetry() {
    void this.loadSetup();
  },

  onNameInput(event: WechatMiniprogram.Input) {
    if (this.disposed || this.data.photoBusy || this.data.submitting || this.data.loadingSetup) return;
    this.setData({ name: event.detail.value, message: '' });
  },

  onBirthDateChange(event: WechatMiniprogram.PickerChange) {
    if (this.disposed || this.data.photoBusy || this.data.submitting || this.data.loadingSetup) return;
    this.setData({ birthDate: String(event.detail.value), message: '' });
  },

  async onChoosePhoto() {
    const student = this.data.student;
    if (this.disposed || !student || this.data.photoBusy || this.data.submitting ||
      this.data.loadingSetup || this.needsVersionRefresh) return;
    this.setData({ photoBusy: true, message: '' });
    let selected: WechatMiniprogram.MediaFile | undefined;
    try {
      const choice = await new Promise<WechatMiniprogram.ChooseMediaSuccessCallbackResult>((resolve, reject) => {
        wx.chooseMedia({
          count: 1, mediaType: ['image'], sourceType: ['album', 'camera'],
          success: resolve, fail: reject,
        });
      });
      if (this.disposed) return;
      selected = choice.tempFiles[0];
    } catch (error) {
      if (this.disposed) return;
      const canceled = typeof error === 'object' && error !== null && 'errMsg' in error &&
        String(error.errMsg).includes('cancel');
      this.setData({ photoBusy: false, message: canceled ? '' : '选择照片失败，请重试' });
      return;
    }
    if (!selected || !selected.tempFilePath || !Number.isFinite(selected.size) || selected.size <= 0) {
      this.setData({ photoBusy: false, message: '请选择有效的照片' });
      return;
    }
    if (selected.size > 3 * 1024 * 1024) {
      this.setData({ photoBusy: false, message: '照片不能超过 3 MB' });
      return;
    }
    try {
      const image = await new Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult>((resolve, reject) => {
        wx.getImageInfo({ src: selected!.tempFilePath, success: resolve, fail: reject });
      });
      if (this.disposed) return;
      if (!['jpeg', 'jpg', 'png'].includes(image.type.toLowerCase())) {
        this.setData({ photoBusy: false, message: '照片仅支持 JPEG 或 PNG 格式' });
        return;
      }
    } catch {
      if (!this.disposed) this.setData({ photoBusy: false, message: '读取照片失败，请选择 JPEG 或 PNG 照片' });
      return;
    }
    this.readSequence += 1;
    const state = await parentService.uploadStudentPhoto(student.id, selected.tempFilePath);
    if (this.disposed) return;
    this.setData({ photoBusy: false });
    if (state.status === 'success' || state.status === 'empty') {
      this.pendingUpdate = null;
      this.setData({ fileId: state.data.id, photoUrl: selected.tempFilePath, message: '' });
    } else if (state.status === 'error' && !this.handleAuthError(state)) {
      this.setData({ message: state.message });
    }
  },

  onPreviewPhoto() {
    if (this.disposed || !this.data.photoUrl) return;
    wx.previewImage({ current: this.data.photoUrl, urls: [this.data.photoUrl] });
  },

  async onSubmit() {
    const student = this.data.student;
    if (this.disposed || !student || this.data.photoBusy || this.data.submitting || this.data.loadingSetup) return;
    if (this.needsVersionRefresh) {
      await this.loadSetup();
      return;
    }
    const name = this.data.name.trim();
    const birthdayMessage = birthDateError(this.data.birthDate);
    const fileId = this.data.fileId || student.photo?.id || '';
    const message = !name ? '请填写孩子姓名' : Array.from(name).length > 100 ? '孩子姓名不能超过 100 字' :
      birthdayMessage || (!fileId ? '请上传孩子照片' : '');
    if (message) {
      this.setData({ message });
      return;
    }
    const input = { name, birthDate: this.data.birthDate, fileId, expectedVersion: student.profileVersion };
    const fingerprint = JSON.stringify({ studentId: student.id, ...input });
    if (!this.pendingUpdate || this.pendingUpdate.fingerprint !== fingerprint) {
      this.pendingUpdate = { fingerprint, key: mutationKey() };
    }
    this.readSequence += 1;
    this.setData({ submitting: true, message: '' });
    const state = await parentService.completeProfileSetup(student.id, input, this.pendingUpdate.key);
    if (this.disposed) return;
    if (state.status === 'success' || state.status === 'empty') {
      this.pendingUpdate = null;
      this.returnHome();
      return;
    }
    this.setData({ submitting: false });
    if (state.status !== 'error' || this.handleAuthError(state)) return;
    this.setData({ message: state.message });
    if (state.statusCode === 409 || state.code === 'STUDENT_PROFILE_VERSION_CONFLICT' ||
      state.code === 'PARENT_PROFILE_ALREADY_COMPLETED') {
      this.needsVersionRefresh = true;
      this.pendingUpdate = null;
      await this.loadSetup();
    }
  },

  handleAuthError(state: { statusCode?: number; code?: string }): boolean {
    if (state.statusCode !== 401 && state.code !== 'UNAUTHORIZED') return false;
    this.onLogout();
    return true;
  },

  onLogout() {
    if (this.disposed) return;
    this.disposed = true;
    this.readSequence += 1;
    sessionService.logout();
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },

  returnHome() {
    if (this.disposed) return;
    this.disposed = true;
    this.readSequence += 1;
    wx.reLaunch({
      url: '/pages/parent/home/index',
      fail: () => {
        if (this.unloaded) return;
        this.disposed = false;
        this.setData({
          submitting: false,
          photoBusy: false,
          viewState: 'error',
          errorMessage: '孩子资料已完善，返回首页失败，请重试',
        });
      },
    });
  },
});
