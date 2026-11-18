import type { TeacherRankingMetric, TeacherRankingPage, TeacherRankingRow } from '../types/teacher-rankings';
import { formatFenAmount } from '../utils/format';

export function teacherRankChange(delta: number | null): string {
  return delta === null ? '无上月对比' : delta === 0 ? '持平' : delta > 0 ? `上升 ${delta}` : `下降 ${-delta}`;
}
export function teacherRankingRow(row: TeacherRankingRow) {
  return { ...row, changeLabel: teacherRankChange(row.rankDelta) };
}
// PSD a3 在标题下显示「2026年10月份」，接口给的是 "2026-10"。
export function teacherRankingMonthLabel(month: string): string {
  const matched = /^(\d{4})-(\d{2})$/.exec(month);
  return matched ? `${matched[1]}年${Number(matched[2])}月份` : '';
}
export function teacherRankingMetricLabel(metric: TeacherRankingMetric): string {
  return metric === 'ATTENDANCE' ? '到课人次' : '课时费';
}
export function teacherRankingOwn(board: TeacherRankingPage): string {
  if (!board.own.hasActivity) return '本人本月暂无有效记录';
  const value = board.metric === 'EARNINGS' ? formatFenAmount(board.own.value) : `${board.own.value} 人次`;
  return `本人 ${value} · ${board.own.rank === null ? '未上榜' : `第 ${board.own.rank} 名`}`;
}
