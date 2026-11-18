import {
  buildTeacherFeedbackPageModel,
  mergeTeacherFeedbackItems,
  resolveTeacherFeedbackNavigation,
} from '../../../services/teacher-feedback.presenter';
import { createTeacherRecordPage } from '../runtime/teacher-record-page';

Page({
  ...createTeacherRecordPage(
    buildTeacherFeedbackPageModel, mergeTeacherFeedbackItems,
    (runtime, query) => runtime.loadTeachingRecords(query),
  ),

  loadFeedback(reset: boolean) { return this.loadRecords(reset); },

  onFeedbackTap(event: WechatMiniprogram.TouchEvent) {
    const lessonSessionId = String(event.currentTarget.dataset.id ?? '');
    if (this.hidden || this.disposed || !this.validateOwner() || this.navigating ||
        !this.data.items.some((item) => item.lessonSessionId === lessonSessionId)) return;
    this.navigating = true;
    const sequence = ++this.navigationSequence;
    const fail = () => {
      if (!this.hidden && !this.disposed && sequence === this.navigationSequence &&
          this.validateOwner()) this.navigating = false;
    };
    try { wx.navigateTo({ ...resolveTeacherFeedbackNavigation(lessonSessionId), fail }); }
    catch { fail(); }
  },
});
