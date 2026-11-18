import {
  createPartnerTeacherPerformanceClient,
  type TeacherEvaluation, type TeacherEvaluationInput, type TeacherEvaluationRevision, type RatingField,
} from '../../runtime/partner-teacher-performance.service';
import { starRatingFills, starRatingLabel } from '../../../../utils/star-rating';

const fields: Array<{ field: RatingField; label: string }> = [
  { field: 'teachingRating', label: '教学' }, { field: 'communicationRating', label: '课后沟通' },
  { field: 'attendanceRating', label: '出勤' }, { field: 'overallRating', label: '整体' },
];
const ratings = (evaluation: TeacherEvaluation | null = null) => fields.map(({ field, label }) => {
  const score = evaluation?.[field] ?? null;
  return { field, label, score, scoreLabel: starRatingLabel(score),
    stars: starRatingFills(score).map((fill, index) => ({ fill, half: index * 2 + 1, full: index * 2 + 2 })) };
});
function timeLabel(value: string, timezone: string) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
const empty = () => ({
  message: '', timezone: '', scheduledLabel: '', completedLabel: '', rateLabel: '',
  ratings: ratings(), guidance: '', guidanceCount: 0, canEdit: false, authorName: '', savedLabel: '',
  dirty: false, saving: false, saveUnknown: false, conflict: false, historyOpen: false,
  historyRows: [] as Array<TeacherEvaluationRevision & {
    teachingLabel: string; communicationLabel: string; attendanceLabel: string; overallLabel: string; savedLabel: string;
  }>,
  historyLoading: false, historyError: '', historyHasMore: false,
});
type State = {
  attached: boolean; hidden: boolean; detached: boolean; stopped: boolean; initialShow: boolean;
  owner: string; sequence: number; historySequence: number; version: number; historyPage: number;
  runtime?: ReturnType<typeof createPartnerTeacherPerformanceClient>;
  pending?: Promise<void>; historyPending?: Promise<void>; savePending?: TeacherEvaluationInput;
  baseline: string; modalSequence: number;
};
const states = new WeakMap<object, State>();
function state(instance: object): State {
  let current = states.get(instance);
  if (!current) {
    current = { attached: false, hidden: true, detached: false, stopped: false, initialShow: false,
      owner: '', sequence: 0, historySequence: 0, version: 0, historyPage: 0, baseline: '', modalSequence: 0 };
    states.set(instance, current);
  }
  return current;
}
const status = (error: unknown) => typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 0;

Component({
  properties: {
    teacherId: { type: String, value: '', observer() {
      const current = state(this);
      if (current.attached && !current.hidden && !current.detached) { this.clearPrivate(); void this.load(); }
    } },
    blocked: { type: Boolean, value: false, observer(value: boolean) {
      if (value) this.clearPrivate();
    } },
  },
  data: { ...empty(), state: 'loading', month: '' },
  lifetimes: {
    attached() {
      const current = state(this);
      current.attached = true; current.hidden = false; current.initialShow = true;
      void this.load();
    },
    detached() {
      this.clearPrivate();
      const current = state(this);
      current.detached = true; current.hidden = true; current.runtime = undefined;
    },
  },
  pageLifetimes: {
    hide() { const current = state(this); current.hidden = true; current.initialShow = false; this.clearPrivate(); },
    show() {
      const current = state(this);
      if (!current.attached || current.detached) return;
      current.hidden = false;
      if (current.initialShow) { current.initialShow = false; return; }
      void this.load();
    },
  },
  methods: {
    clearPrivate() {
      const current = state(this);
      current.sequence++; current.historySequence++; current.modalSequence++;
      current.pending = undefined; current.historyPending = undefined; current.savePending = undefined;
      current.baseline = ''; current.version = 0; current.historyPage = 0;
      if (!current.detached) this.setData({ ...empty(), state: current.stopped ? 'forbidden' : 'loading' });
    },
    forbid() {
      const current = state(this);
      if (current.stopped) return;
      current.stopped = true; this.clearPrivate();
      this.setData({ state: 'forbidden', message: '登录或访问权限已变化，请重新登录' });
      this.triggerEvent('forbidden', { message: '登录或访问权限已变化，请重新登录' });
    },
    active(): boolean {
      const current = state(this);
      if (!current.attached || current.hidden || current.detached || current.stopped || this.data.blocked) return false;
      try {
        const runtime = createPartnerTeacherPerformanceClient(), owner = runtime.getSessionKey();
        if (!owner || current.owner && current.owner !== owner || current.runtime && current.runtime.getSessionKey() !== owner) {
          this.forbid(); return false;
        }
        current.owner = owner; current.runtime ??= runtime;
        return true;
      } catch { this.forbid(); return false; }
    },
    draftKey(): string {
      return JSON.stringify([this.data.ratings.map(r => r.score), this.data.guidance.trim()]);
    },
    applyEvaluation(evaluation: TeacherEvaluation | null) {
      const current = state(this);
      current.version = evaluation?.version ?? 0;
      current.savePending = undefined;
      this.setData({
        ratings: ratings(evaluation), guidance: evaluation?.guidance ?? '',
        guidanceCount: Array.from(evaluation?.guidance ?? '').length, canEdit: evaluation?.canEdit ?? true,
        authorName: evaluation?.authorName ?? '',
        savedLabel: evaluation ? timeLabel(evaluation.updatedAt, this.data.timezone) : '',
        dirty: false, saving: false, saveUnknown: false, conflict: false, message: '',
      });
      current.baseline = this.draftKey();
    },
    load(): Promise<void> {
      if (!this.active() || !this.data.teacherId) return Promise.resolve();
      const current = state(this);
      if (current.pending) return current.pending;
      const sequence = ++current.sequence, teacherId = this.data.teacherId, month = this.data.month;
      this.setData({ state: 'loading', message: '' });
      const promise = Promise.resolve().then(() => {
        if (!this.active() || sequence !== current.sequence) return;
        return current.runtime!.performance(teacherId, month || undefined);
      }).then(result => {
        if (!result || !this.active() || sequence !== current.sequence) return;
        this.setData({
          state: 'ready', month: result.periodMonth, timezone: result.timezone,
          scheduledLabel: String(result.scheduledLessonCount), completedLabel: String(result.completedLessonCount),
          rateLabel: result.completionRateBasisPoints === null ? '无计划' : `${result.completionRateBasisPoints / 100}%`,
        });
        this.applyEvaluation(result.evaluation);
      }).catch(error => {
        if (!this.active() || sequence !== current.sequence) return;
        if ([401, 403].includes(status(error))) { this.forbid(); return; }
        this.setData({ state: 'error', message: '授课与月度评价加载失败，请重试' });
      }).finally(() => { if (sequence === current.sequence) current.pending = undefined; });
      current.pending = promise;
      return promise;
    },
    onRetry() { return this.load(); },
    onReload() {
      if (!this.active() || this.data.saving || this.data.saveUnknown) return Promise.resolve();
      this.clearPrivate();
      return this.load();
    },
    onMonthChange(event: WechatMiniprogram.PickerChange) {
      if (!this.active() || this.data.saving || this.data.saveUnknown) return;
      const month = String(event.detail.value);
      if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month) || month === this.data.month) return;
      const current = state(this), sequence = ++current.modalSequence;
      const change = () => {
        if (!this.active() || sequence !== current.modalSequence || this.data.saving || this.data.saveUnknown) return;
        this.clearPrivate(); this.setData({ month }); void this.load();
      };
      if (!this.data.dirty) { change(); return; }
      wx.showModal({
        title: '切换月份', content: '本月还有未保存的评价，是否放弃修改并切换？',
        confirmText: '放弃修改', success: result => { if (result.confirm) change(); },
      });
    },
    editable(): boolean {
      return this.active() && this.data.state === 'ready' && this.data.canEdit &&
        !this.data.saving && !this.data.saveUnknown && !this.data.conflict;
    },
    onRate(event: WechatMiniprogram.TouchEvent) {
      if (!this.editable()) return;
      const { field, score: raw } = event.currentTarget.dataset, score = Number(raw);
      if (!fields.some(r => r.field === field) || !Number.isInteger(score) || score < 1 || score > 10) return;
      const updated = this.data.ratings.map(r => r.field !== field ? r : {
        ...r, score, scoreLabel: starRatingLabel(score),
        stars: starRatingFills(score).map((fill, index) => ({ fill, half: index * 2 + 1, full: index * 2 + 2 })),
      });
      this.setData({ ratings: updated, message: '' });
      this.setData({ dirty: this.draftKey() !== state(this).baseline });
    },
    onGuidanceInput(event: WechatMiniprogram.Input) {
      if (!this.editable()) return;
      const guidance = event.detail.value;
      this.setData({ guidance, guidanceCount: Array.from(guidance).length, message: '' });
      this.setData({ dirty: this.draftKey() !== state(this).baseline });
    },
    onSave(): Promise<void> {
      if (!this.active() || this.data.state !== 'ready' || !this.data.canEdit || this.data.saving || this.data.conflict)
        return Promise.resolve();
      const current = state(this);
      if (!this.data.saveUnknown) {
        if (!this.data.dirty) return Promise.resolve();
        if (this.data.ratings.some(r => r.score === null) || this.data.guidanceCount > 1000 ||
          /[\u0000\uD800-\uDFFF]/u.test(this.data.guidance)) {
          this.setData({ message: '请填完四项评分，指导意见最多1000字' }); return Promise.resolve();
        }
        const scores = Object.fromEntries(this.data.ratings.map(r => [r.field, r.score])) as Record<RatingField, number>;
        current.savePending = { ...scores, periodMonth: this.data.month, expectedVersion: current.version, guidance: this.data.guidance.trim() };
      }
      const payload = current.savePending;
      if (!payload) return Promise.resolve();
      const sequence = current.sequence, teacherId = this.data.teacherId;
      this.setData({ saving: true, message: '' });
      return Promise.resolve().then(() => {
        if (!this.active() || sequence !== current.sequence) return;
        return current.runtime!.save(teacherId, payload);
      }).then(result => {
        if (!result || !this.active() || sequence !== current.sequence) return;
        this.applyEvaluation(result);
        this.setData({ message: '评价已保存', historyRows: [], historyHasMore: false, historyError: '' });
        current.historySequence++; current.historyPage = 0; current.historyPending = undefined;
        if (this.data.historyOpen) void this.loadHistory();
      }).catch(error => {
        if (!this.active() || sequence !== current.sequence) return;
        const code = status(error);
        if ([401, 403].includes(code)) { this.forbid(); return; }
        if (code === 409) this.setData({ saving: false, conflict: true, saveUnknown: false });
        else if (code === 400 || code === 404) {
          current.savePending = undefined;
          this.setData({ saving: false, saveUnknown: false, message: code === 400 ? '评分或指导意见不符合要求，请核对' : '该教师已不可用，请重新读取' });
        } else this.setData({ saving: false, saveUnknown: true });
      });
    },
    loadHistory(): Promise<void> {
      if (!this.active() || this.data.state !== 'ready' || !this.data.historyOpen) return Promise.resolve();
      const current = state(this);
      if (current.historyPending) return current.historyPending;
      const sequence = ++current.historySequence, page = current.historyPage + 1;
      const teacherId = this.data.teacherId, month = this.data.month;
      this.setData({ historyLoading: true, historyError: '' });
      const promise = Promise.resolve().then(() => {
        if (!this.active() || sequence !== current.historySequence) return;
        return current.runtime!.history(teacherId, month, page);
      }).then(result => {
        if (!result || !this.active() || sequence !== current.historySequence) return;
        const incoming = result.data.map(row => ({
          ...row, teachingLabel: starRatingLabel(row.teachingRating), communicationLabel: starRatingLabel(row.communicationRating),
          attendanceLabel: starRatingLabel(row.attendanceRating), overallLabel: starRatingLabel(row.overallRating),
          savedLabel: timeLabel(row.savedAt, this.data.timezone),
        }));
        const rows = [...new Map([...this.data.historyRows, ...incoming].map(row => [row.version, row])).values()]
          .sort((a, b) => b.version - a.version);
        current.historyPage = result.meta.page;
        this.setData({ historyRows: rows, historyHasMore: result.meta.page < result.meta.totalPages, historyLoading: false });
      }).catch(error => {
        if (!this.active() || sequence !== current.historySequence) return;
        if ([401, 403].includes(status(error))) { this.forbid(); return; }
        this.setData({ historyLoading: false, historyError: '修订历史加载失败，请重试' });
      }).finally(() => { if (sequence === current.historySequence) current.historyPending = undefined; });
      current.historyPending = promise;
      return promise;
    },
    onHistoryToggle() {
      if (!this.active() || this.data.state !== 'ready') return Promise.resolve();
      this.setData({ historyOpen: !this.data.historyOpen });
      if (this.data.historyOpen && state(this).historyPage === 0) return this.loadHistory();
      return Promise.resolve();
    },
    onHistoryMore() { return this.data.historyHasMore ? this.loadHistory() : Promise.resolve(); },
    onHistoryRetry() { return this.loadHistory(); },
  },
});
