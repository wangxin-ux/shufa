import { buildParentLeavePageModel } from '../../../services/parent-leave.presenter';
import { ParentLeaveWorkflow } from '../../../services/parent-leave.workflow';
import { ParentPageLoader } from '../../../services/parent-page-loader';
import { parentService } from '../../../services/parent-runtime';
import { LeaveDraft, LeavePageView } from '../../../types/parent';

const leaveLoader = new ParentPageLoader(() => parentService.loadLeavePage());
const leaveWorkflow = new ParentLeaveWorkflow(parentService);
let currentLeavePage: LeavePageView | null = null;

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
  },

  onLoad() {
    void this.loadLeavePage();
  },

  onPullDownRefresh() {
    void this.loadLeavePage().finally(() => wx.stopPullDownRefresh());
  },

  async loadLeavePage() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const snapshot = await leaveLoader.load();

    if (snapshot.status === 'ready' || snapshot.status === 'empty') {
      currentLeavePage = snapshot.data;
      const model = buildParentLeavePageModel(snapshot.data);
      const studentIndex = model.students.length > 0 ? 0 : -1;
      const lessonIndex = model.lessons.length > 0 ? 0 : -1;
      this.setData({
        ...model,
        viewState: 'ready',
        errorMessage: '',
        studentIndex,
        lessonIndex,
        draft: {
          studentId: studentIndex >= 0 ? model.students[studentIndex].id : '',
          lessonId: lessonIndex >= 0 ? model.lessons[lessonIndex].id : '',
          reason: '',
        },
        submitStatus: 'idle',
        submitMessage: '',
      });
      return;
    }

    if (snapshot.status === 'error') {
      this.setData({ viewState: 'error', errorMessage: snapshot.message });
    }
  },

  onRetry() {
    void this.loadLeavePage();
  },

  onStudentChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const studentIndex = Number(e.detail.value);
    const student = this.data.students[studentIndex];
    if (!student) {
      return;
    }
    this.setData({
      studentIndex,
      draft: { ...this.data.draft, studentId: student.id },
      submitMessage: '',
    });
  },

  onLessonChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const lessonIndex = Number(e.detail.value);
    const lesson = this.data.lessons[lessonIndex];
    if (!lesson) {
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
    if (!currentLeavePage || this.data.submitStatus === 'submitting') {
      return;
    }

    this.setData({ submitStatus: 'submitting', submitMessage: '' });
    const outcome = await leaveWorkflow.submit(this.data.draft, currentLeavePage);

    if (outcome.status === 'error') {
      this.setData({ submitStatus: 'error', submitMessage: outcome.message });
      wx.showToast({ title: outcome.message, icon: 'none' });
      return;
    }

    if (outcome.refreshedPage.status === 'success' || outcome.refreshedPage.status === 'empty') {
      currentLeavePage = outcome.refreshedPage.data;
    } else {
      currentLeavePage = {
        ...currentLeavePage,
        records: [outcome.record, ...currentLeavePage.records],
      };
    }

    const model = buildParentLeavePageModel(currentLeavePage);
    this.setData({
      ...model,
      studentIndex: -1,
      lessonIndex: -1,
      draft: outcome.nextDraft,
      submitStatus: 'success',
      submitMessage: '',
    });
    wx.showToast({ title: '请假申请已提交', icon: 'success' });
  },
});
