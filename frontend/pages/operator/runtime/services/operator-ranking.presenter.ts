import type { OperatorRankingPage, OperatorRankingRow } from '../types/operator-ranking';
import { formatDateTimeLabel } from '../../../../utils/format';

export function presentOperatorRankingRow(row: OperatorRankingRow, index = 0) {
  return {
    ...row, rowKey: `ranking-${index}`,
    deltaLabel: row.rankDelta === null ? '无上月可比数据' : row.rankDelta > 0 ?
      `上升${row.rankDelta}名` : row.rankDelta < 0 ? `下降${Math.abs(row.rankDelta)}名` : '持平',
    deltaDirection: row.rankDelta === null ? 'unknown' : row.rankDelta > 0 ? 'up' : row.rankDelta < 0 ? 'down' : 'same',
  };
}
export function emptyOperatorRankings() {
  return {
    rows: [] as Array<ReturnType<typeof presentOperatorRankingRow>>,
    ownCampus: null as ReturnType<typeof presentOperatorRankingRow> | null,
    revisionId: null as string | null, availability: null as OperatorRankingPage['availability'] | null,
    availabilityLabel: '', unavailableMessage: '', asOfLabel: '', page: 0, total: 0, hasMore: false,
    errorMessage: '', refreshError: '', pageError: '', loadingMore: false, refreshing: false, revisionMissing: false,
  };
}
export function presentOperatorRankingPage(page: OperatorRankingPage) {
  const available = page.availability !== 'UNAVAILABLE';
  return {
    ownCampus: page.ownCampus ? presentOperatorRankingRow(page.ownCampus) : null,
    revisionId: page.revisionId, availability: page.availability,
    availabilityLabel: page.availability === 'LIVE' ? '本月榜单' : page.availability === 'SNAPSHOT' ? '历史月榜' : '榜单不可用',
    unavailableMessage: !available ? page.unavailableReason === 'HISTORY_UNAVAILABLE' ?
      '该月历史数据不足，暂无法排名' : '该月数据待核对，暂无法排名' : '',
    asOfLabel: formatDateTimeLabel(page.asOf, page.timezone),
    page: page.meta.page, total: page.meta.total, hasMore: available && page.meta.page < page.meta.totalPages,
    errorMessage: '', refreshError: '', pageError: '', loadingMore: false, refreshing: false, revisionMissing: false,
  };
}

export function operatorRankingSnapshotKey(page: OperatorRankingPage): string {
  return JSON.stringify([page.revisionId, page.asOf, page.calculationVersion, page.availability,
    page.meta.total, page.meta.totalPages, page.ownCampus]);
}
