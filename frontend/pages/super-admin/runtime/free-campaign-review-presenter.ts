import type { FreeCampaignReviewStatus } from './free-campaign-review.service';
export const freeCampaignReviewStatuses: Array<{ value: FreeCampaignReviewStatus | ''; label: string }> = [
  { value: 'SUBMITTED', label: '待审核' }, { value: 'APPROVED', label: '已批准' },
  { value: 'REJECTED', label: '已驳回' }, { value: '', label: '全部' },
];
export const freeCampaignStatusLabel = (status: FreeCampaignReviewStatus) =>
  freeCampaignReviewStatuses.find((item) => item.value === status)!.label;
export const freeCampaignErrorStatus = (error: unknown) =>
  typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 0;
export function freeCampaignTimeLabel(value: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(value));
  } catch { return `${value}（UTC）`; }
}
