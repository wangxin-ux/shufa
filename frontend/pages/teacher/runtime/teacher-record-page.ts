import { loadTeacherDisplayFont } from './teacher-display-font';

import { createSessionService } from '../../../services/session.service';
import { DatePageQuery, Page as DataPage } from '../../../types/teacher';
import { RequestState } from '../../../utils/request-state';
import {
  createTeacherPageService, isCurrentTeacherReadContext, readTeacherReadContext, TeacherReadContext,
} from './teacher-read-context';

// Record views share session and lifecycle handling while keeping their own endpoint.
export function createTeacherRecordPage<TRecord, T extends { id: string; lessonSessionId: string }>(
  present: (records: readonly TRecord[]) => T[],
  merge: (current: readonly T[], incoming: readonly T[], page: number) => T[],
  readPage: (
    runtime: ReturnType<typeof createTeacherPageService>, query: DatePageQuery,
  ) => Promise<RequestState<DataPage<TRecord>>>,
  recordLabel = '授课记录',
) {
  return {
    context: undefined as TeacherReadContext | undefined,
    runtime: undefined as ReturnType<typeof createTeacherPageService> | undefined,
    requestSequence: 0,
    pullSequence: 0,
    navigationSequence: 0,
    navigating: false,
    hidden: false,
    disposed: false,
    blocked: false,
    pendingDenial: false,
    initialShowPending: false,
    pendingRequest: undefined as Promise<void> | undefined,
    pendingReset: true,

    data: {
      viewState: 'loading', errorMessage: '', items: [] as T[], page: 0,
      hasMore: false, loadingMore: false, refreshError: '', loadMoreError: '',
    },

    onLoad() {
      void loadTeacherDisplayFont();
      this.context = readTeacherReadContext();
      this.initialShowPending = true;
      if (!this.validateOwner()) return;
      try { this.runtime = createTeacherPageService(this.context!); }
      catch {
        this.setData({ viewState: 'error', errorMessage: '教师端配置不可用，请重新登录' });
        return;
      }
      void this.loadRecords(true);
    },

    onShow() {
      if (this.disposed) return;
      this.hidden = false;
      this.navigating = false;
      this.navigationSequence += 1;
      if (!this.validateOwner()) return;
      if (this.pendingDenial) {
        this.invalidateOwner(`登录已失效或无权查看${recordLabel}，请重新登录`);
        return;
      }
      if (this.initialShowPending) { this.initialShowPending = false; return; }
      void this.loadRecords(true);
    },

    onHide() {
      this.hidden = true;
      this.initialShowPending = false;
      this.requestSequence += 1;
      this.pullSequence += 1;
      this.navigationSequence += 1;
      this.navigating = false;
      this.pendingRequest = undefined;
    },

    onUnload() { this.disposed = true; this.onHide(); },

    invalidateOwner(message: string) {
      this.blocked = true;
      this.pendingDenial = false;
      this.requestSequence += 1;
      this.pendingRequest = undefined;
      this.setData({
        viewState: 'forbidden', errorMessage: message, items: [], page: 0,
        hasMore: false, loadingMore: false, refreshError: '', loadMoreError: '',
      });
    },

    validateOwner(): boolean {
      if (this.blocked || !this.context) return false;
      if (isCurrentTeacherReadContext(this.context)) return true;
      this.invalidateOwner('登录已更新，请重新登录');
      return false;
    },

    canReceive(sequence: number): boolean {
      return !this.hidden && !this.disposed && !this.pendingDenial &&
        sequence === this.requestSequence && this.validateOwner();
    },

    onPullDownRefresh() {
      if (this.hidden || this.disposed) return;
      if (!this.validateOwner()) { wx.stopPullDownRefresh(); return; }
      const pull = ++this.pullSequence;
      void this.loadRecords(true).finally(() => {
        if (!this.hidden && !this.disposed && pull === this.pullSequence) wx.stopPullDownRefresh();
      });
    },

    loadRecords(reset: boolean): Promise<void> {
      if (this.hidden || this.disposed || !this.validateOwner() || !this.runtime) return Promise.resolve();
      if (this.pendingRequest && (!reset || this.pendingReset)) return this.pendingRequest;
      if (!reset && (!this.data.hasMore || this.data.loadingMore)) return Promise.resolve();
      const page = reset ? 1 : this.data.page + 1;
      const sequence = ++this.requestSequence;
      this.pendingReset = reset;
      const keepContent = this.data.page > 0;
      this.setData({
        ...(!keepContent ? { viewState: 'loading' } : {}),
        loadingMore: !reset, errorMessage: '', refreshError: '', loadMoreError: '',
      });
      const runtime = this.runtime as ReturnType<typeof createTeacherPageService>;
      const pending = readPage(runtime, { page, pageSize: 20 }).then((state) => {
        // A same-owner denial remains authoritative after hiding or superseding the read.
        if (state.status === 'error' && (state.statusCode === 401 || state.statusCode === 403)) {
          if (!this.disposed && this.validateOwner()) {
            if (this.hidden) {
              this.pendingDenial = true;
              this.requestSequence += 1;
              this.pendingRequest = undefined;
            } else this.applyReadFailure(state.statusCode, reset, keepContent);
          }
          return;
        }
        if (!this.canReceive(sequence)) return;
        if (state.status === 'success' || state.status === 'empty') {
          const items = merge(this.data.items, present(state.data.data), page);
          this.setData({
            items, page: state.data.meta.page, hasMore: state.data.meta.page < state.data.meta.totalPages,
            loadingMore: false, viewState: items.length ? 'ready' : 'empty',
          });
        } else if (state.status === 'error') this.applyReadFailure(state.statusCode, reset, keepContent);
      }).catch(() => {
        if (this.canReceive(sequence)) this.applyReadFailure(undefined, reset, keepContent);
      }).finally(() => {
        if (sequence === this.requestSequence) this.pendingRequest = undefined;
      });
      this.pendingRequest = pending;
      return pending;
    },

    applyReadFailure(code: number | undefined, reset: boolean, keepContent: boolean) {
      if (code === 401 || code === 403) {
        this.invalidateOwner(`登录已失效或无权查看${recordLabel}，请重新登录`);
        return;
      }
      this.setData(keepContent
        ? { loadingMore: false, [reset ? 'refreshError' : 'loadMoreError']:
          reset ? '刷新失败，请重试' : '加载更多失败，请重试' }
        : { loadingMore: false, viewState: 'error', errorMessage: '记录加载失败，请稍后重试' });
    },

    onRetry() { void this.loadRecords(true); },
    onLoadMore() { void this.loadRecords(false); },
    onLogin() {
      if (this.hidden || this.disposed) return;
      createSessionService().logout();
      this.invalidateOwner('请重新登录');
      wx.reLaunch({ url: '/pages/bootstrap/index' });
    },
  } satisfies ThisType<WechatMiniprogram.IAnyObject>;
}
