import { loadParentPdfDisplayFont } from '../runtime/parent-pdf-font';
import {
  buildParentHomePageModel,
  resolveParentHomeAction,
} from '../../../services/parent-home.presenter';
import { ParentPageLoader } from '../../../services/parent-page-loader';
import { parentService } from '../../../services/parent-runtime';
import { sessionService } from '../../../services/session.service';
import type { ParentHomeSummary } from '../../../types/parent';

const homeLoader = new ParentPageLoader(() => parentService.loadHomeSummary());

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    refreshError: '',
    menuExpanded: false,
    activeSheet: '',
    teachers: [] as Array<NonNullable<ParentHomeSummary['teachers']>[number] & { specialtyLabel: string }>,
    reminders: [] as NonNullable<ParentHomeSummary['reminders']>,
    hasTeachers: false,
    hasReminders: false,
    hasShortCourseName: false,
    hasLongCourseName: false,
    courseNamePrefix: '',
    courseNameTail: '',
    hasLongCampusName: false,
    campusNamePrefix: '',
    campusNameTail: '',
    studentNameFontSize: 64,
    course: null as ReturnType<typeof buildParentHomePageModel>['course'],
    student: { id: '', name: '', age: 0 },
    metrics: [] as ReturnType<typeof buildParentHomePageModel>['metrics'],
    quickActions: [
      { key: 'leave', icon: '/pages/parent/assets/icon-qa-leave.png', label: '申请请假' },
      { key: 'hours', icon: '/pages/parent/assets/icon-qa-hours.png', label: '课时明细' },
      { key: 'team', icon: '/pages/parent/assets/icon-qa-team.png', label: '教师团队' },
    ],
  },

  refreshTimer: null as ReturnType<typeof setInterval> | null,
  disposed: false,
  unloaded: false,
  visible: false,
  requestVersion: 0,

  onLoad() {
    void loadParentPdfDisplayFont();
  },

  onShow() {
    if (this.disposed) return;
    this.visible = true;
    this.stopRefresh();
    void this.loadHome(this.data.viewState === 'ready');
  },

  onHide() {
    this.visible = false;
    this.requestVersion += 1;
    this.stopRefresh();
    this.setData({ activeSheet: '', menuExpanded: false });
  },

  onUnload() {
    this.disposed = true;
    this.unloaded = true;
    this.visible = false;
    this.requestVersion += 1;
    this.stopRefresh();
  },

  startRefresh() {
    if (this.disposed || !this.visible || this.refreshTimer !== null) return;
    this.refreshTimer = setInterval(() => void this.loadHome(true), 30000);
  },

  stopRefresh() {
    if (this.refreshTimer !== null) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  },

  onPullDownRefresh() {
    void this.loadHome().finally(() => {
      if (!this.disposed) wx.stopPullDownRefresh();
    });
  },

  async loadHome(silent = false) {
    if (this.disposed) return;
    const request = ++this.requestVersion;
    const keepContent = silent && this.data.viewState === 'ready';
    if (!keepContent) this.setData({ viewState: 'loading', errorMessage: '' });
    const snapshot = await homeLoader.load();
    if (this.disposed || request !== this.requestVersion) return;

    if (snapshot.status === 'ready' || snapshot.status === 'empty') {
      if (snapshot.data.profileSetupRequired) {
        this.disposed = true;
        this.stopRefresh();
        wx.redirectTo({
          url: '/pages/parent/profile-setup/index',
          fail: () => {
            if (this.unloaded) return;
            this.disposed = false;
            this.setData({
              viewState: 'error',
              errorMessage: '资料完善页面暂时无法打开，请重试',
              refreshError: '',
              activeSheet: '',
              menuExpanded: false,
            });
          },
        });
        return;
      }
      const model = buildParentHomePageModel(snapshot.data);
      const courseNameCharacters = Array.from(model.course?.name ?? '');
      const hasLongCourseName = courseNameCharacters.length >= 12;
      const protectCourseTail = courseNameCharacters.length >= 6;
      const campusNameCharacters = Array.from(model.course?.campus ?? '');
      const hasLongCampusName = campusNameCharacters.length >= 15;
      this.setData({
        ...model,
        viewState: 'ready',
        errorMessage: '',
        refreshError: '',
        teachers: (snapshot.data.teachers ?? []).map((teacher) => ({
          ...teacher,
          specialtyLabel: teacher.specialties.join('、') || '暂未填写专长',
        })),
        reminders: snapshot.data.reminders ?? [],
        hasTeachers: (snapshot.data.teachers?.length ?? 0) > 0,
        hasReminders: (snapshot.data.reminders?.length ?? 0) > 0,
        hasShortCourseName: courseNameCharacters.length > 0 && courseNameCharacters.length <= 4,
        hasLongCourseName,
        courseNamePrefix: protectCourseTail ? courseNameCharacters.slice(0, -2).join('') : '',
        courseNameTail: protectCourseTail ? courseNameCharacters.slice(-2).join('') : '',
        hasLongCampusName,
        campusNamePrefix: hasLongCampusName ? campusNameCharacters.slice(0, -2).join('') : '',
        campusNameTail: hasLongCampusName ? campusNameCharacters.slice(-2).join('') : '',
        studentNameFontSize: Math.max(24, Math.min(64,
          Math.floor(480 / Math.max(1, Array.from(model.student.name).length)))),
      });
      this.startRefresh();
      return;
    }

    if (snapshot.status === 'error') {
      if (snapshot.statusCode === 401 || snapshot.code === 'UNAUTHORIZED') {
        this.disposed = true;
        this.stopRefresh();
        sessionService.logout();
        wx.reLaunch({ url: '/pages/bootstrap/index' });
        return;
      }
      if (keepContent) {
        this.setData({ refreshError: snapshot.message });
        this.startRefresh();
        return;
      }
      this.setData({ viewState: 'error', errorMessage: snapshot.message });
      this.startRefresh();
    }
  },

  onRetry() {
    void this.loadHome();
  },

  onQuickAction(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    const action = resolveParentHomeAction(key);
    if (action.type === 'navigate') {
      wx.navigateTo({ url: action.url });
      return;
    }
    if (action.type === 'sheet') {
      this.setData({ activeSheet: action.sheet });
      return;
    }
    wx.showToast({ title: action.message, icon: 'none' });
  },

  onRemindTap() {
    if (!this.data.menuExpanded) {
      this.setData({ menuExpanded: true });
      return;
    }
    this.setData({ activeSheet: 'reminders' });
  },

  onCloseSheet() {
    this.setData({ activeSheet: '' });
  },

  onSheetTap() {
    // Keep interactions inside the sheet from closing the backdrop.
  },

  onMoreCourseTap() {
    wx.navigateTo({ url: '/pages/parent/courses/index' });
  },

  onStudentTap() {
    wx.navigateTo({ url: '/pages/parent/profile/index' });
  },
});
