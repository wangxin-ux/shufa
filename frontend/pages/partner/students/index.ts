import { loadPartnerPdfDisplayFont } from '../runtime/partner-pdf-font';
import {
  buildPartnerStudentItems,
  buildPartnerStudentQuery,
  mergePartnerStudentItems,
  PartnerStudentItemModel,
  PartnerStudentSearchDebouncer,
  PARTNER_STUDENT_BALANCE_OPTIONS,
  normalizePartnerStudentSearch,
  resolvePartnerStudentDetailRoute,
  buildPartnerStudentExpansion,
} from '../../../services/partner-students.presenter';
import { createPartnerStudentsService } from '../runtime/partner-students-runtime';
import { getPartnerCampaignDraftService } from '../runtime/partner-campaign-draft.service';
import { PartnerBalanceBand } from '../../../types/partner';
import { createSessionService } from '../../../services/session.service';
import { presentPartnerEnrollment } from '../runtime/partner-enrollment.presenter';

const PAGE_SIZE = 20;
type SubjectOption = { value: string; label: string; unavailable?: boolean };
const baseSubjects = (): SubjectOption[] => [
  { value: '', label: '全部科目' }, { value: 'UNCLASSIFIED', label: '未归类' },
];
type Expansion = ReturnType<typeof buildPartnerStudentExpansion> & {
  enrollment: ReturnType<typeof presentPartnerEnrollment>;
};

async function readStudentState<T>(read: () => Promise<T>, message: string) {
  try {
    return await read();
  } catch (error: unknown) {
    return {
      status: 'error' as const,
      statusCode: typeof error === 'object' && error !== null &&
        'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode : undefined,
      message,
    };
  }
}

Page({
  requestSequence: 0,
  searchDebouncer: null as PartnerStudentSearchDebouncer | null,
  disposed: false,
  hidden: false,
  initialShowPending: false,
  navigating: false,
  navigationSequence: 0,
  pullSequence: 0,
  pendingResetKey: '',
  pendingResetRequest: undefined as Promise<void> | undefined,
  expansionSequence: 0,
  expansionCache: null as Map<string, { value: Expansion; expiresAt: number }> | null,
  expansionRequests: null as Map<string, Promise<void>> | null,
  photoSequence: 0,
  photoRequest: undefined as Promise<void> | undefined,
  runtime: undefined as ReturnType<typeof createPartnerStudentsService> | undefined,
  studentsOwnerKey: '',
  subjectSequence: 0,
  subjectPending: undefined as Promise<void> | undefined,
  data: {
    viewState: 'loading',
    errorMessage: '',
    searchValue: '',
    activeQuery: '',
    items: [] as PartnerStudentItemModel[],
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
    paginationError: '',
    balanceBand: 'ALL' as PartnerBalanceBand,
    balanceIndex: 0,
    balanceOptions: PARTNER_STUDENT_BALANCE_OPTIONS,
    subjectId: '',
    subjectIndex: 0,
    subjectOptions: baseSubjects(),
    subjectError: '',
    subjectUnavailable: false,
    subjectsLoading: false,
    expandedId: '',
    expandedState: 'idle',
    expandedError: '',
    expandedDetail: null as Expansion | null,
    expandedPhotoError: '',
    expandedPhotoRetrying: false,
  },

  onLoad() {
    void loadPartnerPdfDisplayFont();
    this.runtime = createPartnerStudentsService();
    this.studentsOwnerKey = getPartnerCampaignDraftService().getSessionKey();
    this.expansionCache = new Map();
    this.expansionRequests = new Map();
    this.initialShowPending = true;
    this.searchDebouncer = new PartnerStudentSearchDebouncer((activeQuery) => {
      if (this.disposed || this.hidden || !this.validateOwner()) return;
      this.setData({ activeQuery });
      void this.loadStudents(true, true);
    });
    void this.loadStudents(true);
    void this.loadSubjects();
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.validateOwner()) return;
    this.navigating = false;
    this.navigationSequence += 1;
    if (this.initialShowPending) {
      this.initialShowPending = false;
      return;
    }
    this.setData({ activeQuery: normalizePartnerStudentSearch(this.data.searchValue) });
    void this.loadStudents(true);
    void this.loadSubjects();
  },

  onHide() {
    this.hidden = true;
    this.pullSequence += 1;
    this.navigating = false;
    this.navigationSequence += 1;
    this.initialShowPending = false;
    this.requestSequence += 1;
    this.pendingResetRequest = undefined;
    this.pendingResetKey = '';
    this.subjectSequence += 1;
    this.subjectPending = undefined;
    this.searchDebouncer?.cancel();
    this.expansionSequence += 1;
    this.expansionRequests?.clear();
    this.expansionCache?.clear();
    this.invalidatePhotoRequest();
  },

  onUnload() {
    this.disposed = true;
    this.onHide();
    this.searchDebouncer = null;
  },

  onPullDownRefresh() {
    const sequence = ++this.pullSequence;
    void this.loadStudents(true).finally(() => {
      if (!this.hidden && !this.disposed && sequence === this.pullSequence) wx.stopPullDownRefresh();
    });
  },

  loadStudents(reset: boolean, preserveExpansion = false): Promise<void> {
    if (this.disposed || this.hidden || !this.validateOwner()) return Promise.resolve();
    const key = JSON.stringify([
      this.data.activeQuery, this.data.balanceBand, this.data.subjectId, preserveExpansion,
    ]);
    if (reset && this.pendingResetRequest && key === this.pendingResetKey) {
      return this.pendingResetRequest;
    }
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) return Promise.resolve();
    const page = reset ? 1 : this.data.page + 1;
    const sequence = ++this.requestSequence;
    const expandedId = reset && preserveExpansion ? this.data.expandedId : '';
    const request = this.requestStudents(reset, page, sequence, expandedId).finally(() => {
      if (reset && sequence === this.requestSequence) {
        this.pendingResetRequest = undefined;
        this.pendingResetKey = '';
      }
    });
    if (reset) {
      this.pendingResetRequest = request;
      this.pendingResetKey = key;
    }
    return request;
  },

  async requestStudents(reset: boolean, page: number, sequence: number, retainedId = '') {
    if (this.disposed || this.hidden || sequence !== this.requestSequence ||
      !this.validateOwner() || !this.runtime) return;
    const runtime = this.runtime;
    if (reset) this.resetExpansion(retainedId);
    this.setData(
      reset
        ? {
            viewState: 'loading',
            errorMessage: '',
            items: [],
            loadingMore: false,
            paginationError: '',
            hasMore: false,
            total: 0,
            page: 0,
          }
        : { loadingMore: true, paginationError: '' },
    );
    const state = await readStudentState(() => runtime.loadStudents(
      {
        ...buildPartnerStudentQuery(this.data.activeQuery, page, PAGE_SIZE, this.data.balanceBand),
        ...(this.data.subjectId ? { subjectId: this.data.subjectId } : {}),
      },
    ), '学员档案加载失败，请稍后重试');
    if (this.disposed || this.hidden || sequence !== this.requestSequence || !this.validateOwner()) return;
    if (state.status === 'success' || state.status === 'empty') {
      const items = mergePartnerStudentItems(
        this.data.items,
        buildPartnerStudentItems(state.data.data),
        page,
      );
      const expandedId = reset && items.some((item) => item.id === retainedId) ? retainedId : '';
      this.setData({
        items,
        page: state.data.meta.page,
        total: state.data.meta.total,
        hasMore: state.data.meta.page < state.data.meta.totalPages,
        loadingMore: false,
        viewState: items.length > 0 ? 'ready' : 'empty',
        errorMessage: '',
        paginationError: '',
        ...(reset ? { expandedId } : {}),
      });
      if (expandedId) void this.loadExpanded(expandedId);
      return;
    }
    if (state.status === 'error') {
      const forbidden = state.statusCode === 401 || state.statusCode === 403;
      if (forbidden) {
        this.clearStudentAccess(state.statusCode!);
        return;
      }
      if (!reset) {
        this.setData({ loadingMore: false, paginationError: state.message });
        return;
      }
      this.resetExpansion();
      this.setData({
        items: [],
        total: 0,
        page: 0,
        hasMore: false,
        paginationError: '',
        loadingMore: false,
        viewState: 'error',
        errorMessage: state.message,
      });
    }
  },

  onSearchInput(event: WechatMiniprogram.Input) {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    const searchValue = event.detail.value;
    this.setData({ searchValue });
    this.searchDebouncer?.schedule(searchValue);
  },

  onBalanceChange(event: WechatMiniprogram.PickerChange) {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    const index = Number(event.detail.value);
    const option = Number.isInteger(index) ? PARTNER_STUDENT_BALANCE_OPTIONS[index] : undefined;
    if (!option || option.value === this.data.balanceBand) return;
    this.searchDebouncer?.cancel();
    this.setData({
      balanceBand: option.value,
      balanceIndex: index,
      activeQuery: normalizePartnerStudentSearch(this.data.searchValue),
    });
    void this.loadStudents(true, true);
  },

  onRetry() {
    void this.loadStudents(true);
  },

  loadSubjects(): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner() || !this.runtime) return Promise.resolve();
    if (this.subjectPending) return this.subjectPending;
    const runtime = this.runtime;
    const sequence = ++this.subjectSequence;
    const current = () => !this.hidden && !this.disposed &&
      sequence === this.subjectSequence && this.validateOwner();
    this.setData({ subjectsLoading: true, subjectError: '' });
    const pending = Promise.resolve().then(async () => {
      if (!current()) return;
      const state = await readStudentState(
        () => runtime.loadSubjects(current), '科目加载失败，请重试',
      );
      if (!current()) return;
      if (state.status === 'error') {
        if (state.statusCode === 401 || state.statusCode === 403) {
          this.clearStudentAccess(state.statusCode);
        } else {
          this.setData({ subjectError: '科目加载失败，请重试' });
        }
        return;
      }
      if (state.status !== 'success' && state.status !== 'empty') return;
      const options: SubjectOption[] = [
        ...baseSubjects(),
        ...state.data.map((row) => ({
          value: row.id, label: `${row.name}${row.isActive ? '' : '（已归档）'}`,
        })),
      ];
      let selected = options.findIndex((option) => option.value === this.data.subjectId);
      const unavailable = selected < 0;
      if (unavailable) {
        const previous = this.data.subjectOptions.find((option) => option.value === this.data.subjectId);
        selected = options.length;
        options.push({
          value: this.data.subjectId, label: previous?.label ?? '所选科目（目录中不可用）', unavailable: true,
        });
      }
      this.setData({
        subjectOptions: options, subjectIndex: selected, subjectUnavailable: unavailable,
        subjectError: unavailable ? '所选科目已不在目录中，请重新选择或重试' : '',
      });
    }).finally(() => {
      if (sequence !== this.subjectSequence) return;
      this.subjectPending = undefined;
      if (!this.hidden && !this.disposed) this.setData({ subjectsLoading: false });
    });
    this.subjectPending = pending;
    return pending;
  },

  onSubjectsRetry() {
    void this.loadSubjects();
  },

  onSubjectChange(event: WechatMiniprogram.PickerChange) {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    const index = Number(event.detail.value);
    const option = Number.isInteger(index) ? this.data.subjectOptions[index] : undefined;
    if (!option || option.unavailable || option.value === this.data.subjectId) return;
    this.searchDebouncer?.cancel();
    this.setData({
      subjectId: option.value,
      subjectIndex: index,
      activeQuery: normalizePartnerStudentSearch(this.data.searchValue),
      subjectUnavailable: false,
      ...(this.data.subjectUnavailable &&
        this.data.subjectError === '所选科目已不在目录中，请重新选择或重试' ? { subjectError: '' } : {}),
    });
    void this.loadStudents(true, true);
  },

  onStudentMore(event: WechatMiniprogram.TouchEvent) {
    if (this.hidden || this.disposed || !this.validateOwner() || this.navigating ||
      this.data.viewState !== 'ready' || this.data.expandedState !== 'ready') return;
    const studentId = String(event.currentTarget.dataset.id ?? '');
    if (this.data.expandedId !== studentId || !this.data.expandedDetail ||
      !this.data.items.some((item) => item.id === studentId)) return;
    this.navigating = true;
    const sequence = ++this.navigationSequence;
    const fail = () => {
      if (this.hidden || this.disposed || sequence !== this.navigationSequence || !this.validateOwner()) return;
      this.navigating = false;
      if (this.hidden || this.disposed || this.data.viewState !== 'ready' ||
        this.data.expandedId !== studentId || this.data.expandedState !== 'ready') return;
      wx.showToast({ title: '页面打开失败，请重试', icon: 'none' });
    };
    try {
      wx.navigateTo({ url: resolvePartnerStudentDetailRoute(studentId), fail });
    } catch {
      fail();
    }
  },

  resetExpansion(expandedId = '') {
    this.invalidatePhotoRequest();
    this.expansionSequence += 1;
    this.expansionCache?.clear();
    this.expansionRequests?.clear();
    this.setData({
      expandedId, expandedState: 'idle', expandedError: '', expandedDetail: null,
      expandedPhotoError: '', expandedPhotoRetrying: false,
    });
  },

  onStudentToggle(event: WechatMiniprogram.TouchEvent) {
    if (this.hidden || this.disposed || !this.validateOwner() || this.data.viewState !== 'ready') return;
    const id = String(event.currentTarget.dataset.id ?? '');
    if (!this.data.items.some((item) => item.id === id)) return;
    this.invalidatePhotoRequest();
    if (this.data.expandedId === id) {
      this.setData({
        expandedId: '', expandedState: 'idle', expandedError: '', expandedDetail: null,
        expandedPhotoError: '', expandedPhotoRetrying: false,
      });
      return;
    }
    this.setData({
      expandedId: id, expandedDetail: null, expandedError: '',
      expandedPhotoError: '', expandedPhotoRetrying: false,
    });
    void this.loadExpanded(id);
  },

  loadExpanded(id: string): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner() ||
      !this.runtime || this.data.viewState !== 'ready') return Promise.resolve();
    const runtime = this.runtime;
    const cached = this.expansionCache?.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      this.setData({ expandedDetail: cached.value, expandedState: 'ready', expandedError: '' });
      return Promise.resolve();
    }
    this.setData({ expandedState: 'loading', expandedError: '' });
    const pending = this.expansionRequests?.get(id);
    if (pending) return pending;
    const sequence = this.expansionSequence;
    const request = (async () => {
      const state = await readStudentState(
        () => runtime.loadStudent(id), '学员信息加载失败，请重试',
      );
      if (this.hidden || this.disposed || sequence !== this.expansionSequence || !this.validateOwner()) return;
      if (state.status === 'success') {
        const value = {
          ...buildPartnerStudentExpansion(state.data),
          enrollment: presentPartnerEnrollment(state.data),
        };
        this.expansionCache?.set(id, { value, expiresAt: Date.now() + 10 * 60_000 });
        if (this.data.expandedId === id) this.setData({ expandedDetail: value, expandedState: 'ready', expandedError: '' });
      } else if (state.status === 'error' && (state.statusCode === 401 || state.statusCode === 403)) {
        this.clearStudentAccess(state.statusCode);
      } else if (this.data.expandedId === id) {
        this.setData({
          expandedState: state.status === 'empty' || (state.status === 'error' && state.statusCode === 404) ? 'empty' : 'error',
          expandedDetail: null,
          expandedError: state.status === 'error' ? state.message : '学员信息已不可用',
        });
      }
    })().finally(() => {
      if (sequence === this.expansionSequence) this.expansionRequests?.delete(id);
    });
    this.expansionRequests?.set(id, request);
    return request;
  },

  onRetryExpanded() {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    if (this.data.expandedId) void this.loadExpanded(this.data.expandedId);
  },

  invalidatePhotoRequest() {
    this.photoSequence += 1;
    this.photoRequest = undefined;
  },

  invalidateStudents(message: string) {
    this.runtime = undefined;
    this.requestSequence += 1;
    this.pendingResetRequest = undefined;
    this.pendingResetKey = '';
    this.subjectSequence += 1;
    this.subjectPending = undefined;
    this.searchDebouncer?.cancel();
    this.navigating = false;
    this.navigationSequence += 1;
    this.resetExpansion();
    this.setData({
      viewState: 'forbidden', items: [], total: 0, page: 0, hasMore: false,
      loadingMore: false, paginationError: '',
      searchValue: '', activeQuery: '', errorMessage: message,
      subjectId: '', subjectIndex: 0, subjectOptions: [], subjectError: '',
      subjectUnavailable: false, subjectsLoading: false,
    });
  },

  validateOwner() {
    if (!this.runtime) return false;
    if (getPartnerCampaignDraftService().getSessionKey() === this.studentsOwnerKey) return true;
    this.invalidateStudents('登录已更新，请重新登录');
    return false;
  },

  clearStudentAccess(statusCode: number) {
    this.invalidateStudents(statusCode === 401
      ? '登录已失效，请重新登录' : '当前账号无权查看本校区学员档案');
  },

  onExpandedPhotoError(event: WechatMiniprogram.BaseEvent) {
    if (this.hidden || this.disposed || !this.validateOwner() || this.data.viewState !== 'ready' ||
      this.data.expandedState !== 'ready') return;
    const { id, photoId, url } = event.currentTarget.dataset;
    const photo = this.data.expandedDetail?.photo;
    if (!photo || id !== this.data.expandedId || photoId !== photo.id || url !== photo.accessUrl) return;
    this.setData({ expandedPhotoError: '照片加载失败，请重试' });
  },

  onRetryExpandedPhoto(): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner() ||
      !this.runtime || this.data.viewState !== 'ready' ||
      this.data.expandedState !== 'ready' || !this.data.expandedPhotoError ||
      !this.data.expandedDetail?.photo) return Promise.resolve();
    if (this.photoRequest) return this.photoRequest;
    const runtime = this.runtime;
    const id = this.data.expandedId;
    const photo = this.data.expandedDetail.photo;
    const sequence = ++this.photoSequence;
    const current = () => !this.hidden && !this.disposed && sequence === this.photoSequence &&
      this.validateOwner() &&
      this.data.viewState === 'ready' && this.data.expandedState === 'ready' &&
      this.data.expandedId === id && this.data.expandedDetail?.photo?.id === photo.id &&
      this.data.expandedDetail.photo.accessUrl === photo.accessUrl;
    this.setData({ expandedPhotoRetrying: true });
    const request = Promise.resolve()
      .then(() => current()
        ? readStudentState(() => runtime.loadStudent(id), '照片加载失败，请重试')
        : undefined)
      .then((state) => {
        if (!state || !current()) return;
        if (state.status === 'success' && this.data.expandedDetail) {
          if (state.data.id !== id) {
            this.setData({ expandedPhotoError: '照片加载失败，请重试' });
            return;
          }
          const value = { ...this.data.expandedDetail, photo: state.data.photo };
          const expiresAt = this.expansionCache?.get(id)?.expiresAt ?? Date.now();
          this.expansionCache?.set(id, { value, expiresAt });
          this.setData({ expandedDetail: value, expandedPhotoError: '' });
        } else if (state.status === 'error' && (state.statusCode === 401 || state.statusCode === 403)) {
          this.clearStudentAccess(state.statusCode);
        } else if (state.status === 'empty' || (state.status === 'error' && state.statusCode === 404)) {
          this.expansionCache?.delete(id);
          this.setData({
            expandedDetail: null, expandedState: 'empty', expandedPhotoError: '',
          });
        } else {
          this.setData({ expandedPhotoError: '照片加载失败，请重试' });
        }
      })
      .catch(() => {
        if (current()) this.setData({ expandedPhotoError: '照片加载失败，请重试' });
      })
      .finally(() => {
        if (sequence !== this.photoSequence) return;
        this.photoRequest = undefined;
        if (!this.hidden && !this.disposed) this.setData({ expandedPhotoRetrying: false });
      });
    this.photoRequest = request;
    return request;
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    this.invalidateStudents('登录已失效，请重新登录');
    this.runtime = undefined;
    createSessionService().logout();
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },

  onLoadMore() {
    void this.loadStudents(false);
  },

  onRetryMore() {
    void this.loadStudents(false);
  },
});
