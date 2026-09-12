import { superAdminService } from '../../../services/super-admin-runtime';
import { SuperAdminAuditLog } from '../../../types/super-admin';
import { auditActionLabel, formatLocalDateTime } from '../../../utils/super-admin-format';

Page({
  data: { viewState: 'loading', errorMessage: '', keyword: '', logs: [] as Array<SuperAdminAuditLog & { actionLabel: string; timeLabel: string; outcomeLabel: string }> },
  onLoad() { void this.load(); },
  onKeywordInput(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }); },
  onSearch() { void this.load(); },
  async load() { const state = await superAdminService.loadAuditLogs({ page: 1, pageSize: 100, action: this.data.keyword.trim() || undefined }); if (state.status === 'success' || state.status === 'empty') this.setData({ viewState: state.status, logs: state.data.data.map((item) => ({ ...item, actionLabel: auditActionLabel(item.action), timeLabel: formatLocalDateTime(item.createdAt), outcomeLabel: { SUCCESS: '成功', DENIED: '已拒绝', FAILURE: '失败' }[item.outcome] })) }); else if (state.status === 'error') this.setData({ viewState: state.statusCode === 403 ? 'forbidden' : 'error', errorMessage: state.message }); },
  onRetry() { void this.load(); },
});
