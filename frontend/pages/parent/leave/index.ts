import { loadParentPdfDisplayFont } from '../runtime/parent-pdf-font';
import { buildParentLeavePageModel, formatLeaveContactWarning } from '../../../services/parent-leave.presenter';
import { ParentLeaveWorkflow } from '../../../services/parent-leave.workflow';
import { parentService } from '../../../services/parent-runtime';
import { sessionService } from '../../../services/session.service';
import { LeaveDraft, LeavePageView, LeaveWeekWarning } from '../../../types/parent';

const EMPTY_DRAFT: LeaveDraft = { studentId: '', lessonId: '', reason: '' };

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    students: [] as ReturnType<typeof buildParentLeavePageModel>['students'],
    lessons: [] as ReturnType<typeof buildParentLeavePageModel>['lessons'],
    records: [] as ReturnType<typeof buildParentLeavePageModel>['records'],
    cutoffText: '',
    recordsEmpty: true,
    studentIndex: -1,
    lessonIndex: -1,
    draft: { ...EMPTY_DRAFT },
    submitStatus: 'idle',
    submitMessage: '',
    refreshError: '',
    contactWarning: null as LeaveWeekWarning | null,
    contactWarningText: '',
  },
  currentLeavePage: null as LeavePageView | null,
  workflow: null as ParentLeaveWorkflow | null,
  activeStudentId: '',
  disposed: false,
  requestVersion: 0,
  refreshTimer: null as ReturnType<typeof setInterval> | null,

  onLoad() {
    void loadParentPdfDisplayFont();
    this.workflow = new ParentLeaveWorkflow(parentService);
    void this.loadLeavePage();
  },
  onShow() {
    this.stopRefresh();
    if (this.currentLeavePage) void this.loadLeavePage(true);
    this.refreshTimer = setInterval(() => { void this.loadLeavePage(true); }, 30000);
  },
  onHide() { this.stopRefresh(); this.requestVersion += 1; },
  onUnload() { this.disposed = true; this.onHide(); },
  stopRefresh() {
    if (this.refreshTimer !== null) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  },

  onPullDownRefresh() {
    void this.loadLeavePage(Boolean(this.currentLeavePage)).finally(() => wx.stopPullDownRefresh());
  },

  handleAuthError(state: { statusCode?: number; code?: string }): boolean {
    if (state.statusCode !== 401 && state.code !== 'UNAUTHORIZED') return false;
    this.disposed = true;
    this.stopRefresh();
    sessionService.logout();
    wx.reLaunch({ url: '/pages/bootstrap/index' });
    return true;
  },

  async loadLeavePage(silent = false) {
    if (this.disposed || this.data.submitStatus === 'submitting') return;
    const version = ++this.requestVersion;
    if (!silent) this.setData({ viewState: 'loading', errorMessage: '' });
    const snapshot = await parentService.loadLeavePage(this.data.draft.studentId || this.activeStudentId || undefined);
    if (this.disposed || version !== this.requestVersion) return;
    if (snapshot.status === 'success' || snapshot.status === 'empty') {
      const firstLoad = this.currentLeavePage === null;
      this.currentLeavePage = snapshot.data;
      const model = buildParentLeavePageModel(snapshot.data);
      const selectedId = this.data.draft.studentId || this.activeStudentId;
      const studentIndex = selectedId ? model.students.findIndex((student) => student.id === selectedId) :
        model.students.length ? 0 : -1;
      const lessonIndex = this.data.draft.lessonId ? model.lessons.findIndex((lesson) => lesson.id === this.data.draft.lessonId) :
        firstLoad && model.lessons.length ? 0 : -1;
      this.activeStudentId = studentIndex >= 0 ? model.students[studentIndex].id : '';
      this.setData({
        ...model, viewState: 'ready', errorMessage: '', refreshError: '', studentIndex, lessonIndex,
        draft: {
          studentId: this.activeStudentId,
          lessonId: lessonIndex >= 0 ? model.lessons[lessonIndex].id : '',
          reason: this.data.draft.reason,
        },
      });
      return;
    }

    if (snapshot.status === 'error') {
      if (this.handleAuthError(snapshot)) return;
      this.setData(silent && this.currentLeavePage ? { refreshError: snapshot.message } :
        { viewState: 'error', errorMessage: snapshot.message });
    }
  },

  onRetry() {
    void this.loadLeavePage(Boolean(this.currentLeavePage));
  },

  onStudentChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const studentIndex = Number(e.detail.value);
    const student = this.data.students[studentIndex];
    if (!student || this.data.submitStatus === 'submitting') {
      return;
    }
    this.activeStudentId = student.id;
    this.setData({
      studentIndex, lessonIndex: -1,
      draft: { ...this.data.draft, studentId: student.id, lessonId: '' },
      submitMessage: '',
    });
    void this.loadLeavePage();
  },

  onLessonChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const lessonIndex = Number(e.detail.value);
    const lesson = this.data.lessons[lessonIndex];
    if (!lesson || this.data.submitStatus === 'submitting') {
      return;
    }
    this.setData({
      lessonIndex,
      draft: { ...this.data.draft, lessonId: lesson.id },
      submitMessage: '',
    });
  },

  onReasonInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({
      draft: { ...this.data.draft, reason: e.detail.value },
      submitMessage: '',
    });
  },

  async onSubmitTap() {
    if (!this.currentLeavePage || this.data.submitStatus === 'submitting') {
      return;
    }

    this.requestVersion += 1;
    this.setData({ submitStatus: 'submitting', submitMessage: '' });
    this.workflow ??= new ParentLeaveWorkflow(parentService);
    const outcome = await this.workflow.submit(this.data.draft, this.currentLeavePage);
    if (this.disposed) return;

    if (outcome.status === 'error') {
      if (this.handleAuthError(outcome)) return;
      this.setData({ submitStatus: 'error', submitMessage: outcome.message });
      wx.showToast({ title: outcome.message, icon: 'none' });
      return;
    }

    if (outcome.refreshedPage.status === 'success' || outcome.refreshedPage.status === 'empty') {
      this.currentLeavePage = outcome.refreshedPage.data;
    } else if (outcome.refreshedPage.status === 'error' && this.handleAuthError(outcome.refreshedPage)) {
      return;
    }
    if (!this.currentLeavePage.records.some((record) => record.id === outcome.record.id)) {
      this.currentLeavePage = { ...this.currentLeavePage, records: [outcome.record, ...this.currentLeavePage.records] };
    }

    const model = buildParentLeavePageModel(this.currentLeavePage);
    const contactWarning = outcome.record.contactWarning === undefined ?
      model.contactWarning : outcome.record.contactWarning;
    this.setData({
      ...model, contactWarning, contactWarningText: formatLeaveContactWarning(contactWarning),
      studentIndex: -1,
      lessonIndex: -1,
      draft: outcome.nextDraft,
      submitStatus: 'success',
      submitMessage: '',
    });
    wx.showToast({ title: '请假申请已提交', icon: 'success' });
    if (contactWarning) this.showContactWarning(contactWarning);
  },

  showContactWarning(warning: LeaveWeekWarning) {
    const phone = warning.contactPhone;
    wx.showModal({
      title: '须电话沟通联系校区',
      content: `${formatLeaveContactWarning(warning)}\n${warning.campusName}\n${phone ? `联系电话：${phone}` : '校区电话暂未登记，请联系校区工作人员'}`,
      confirmText: phone ? '拨打电话' : '知道了',
      showCancel: Boolean(phone),
      success: (result) => { if (result.confirm && phone && !this.disposed) this.callCampus(phone); },
    });
  },
  callCampus(phone: string) {
    wx.makePhoneCall({ phoneNumber: phone,
      fail: () => wx.showToast({ title: '暂无法拨打，请稍后联系校区', icon: 'none' }),
    });
  },
  onContactCampusTap() {
    if (this.data.contactWarning?.contactPhone) this.callCampus(this.data.contactWarning.contactPhone);
    else wx.showToast({ title: '校区电话暂未登记，请联系工作人员', icon: 'none' });
  },
});
