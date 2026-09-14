import { GroupPromotionCampaignView } from '../types/group-buying';
import { formatDateTimeLabel } from '../utils/format';

export function presentGroupPromotionCampaign(
  campaign: GroupPromotionCampaignView,
) {
  const endsAtLabel = formatDateTimeLabel(campaign.endsAt);
  return {
    ...campaign,
    priceLabel: `¥${formatYuan(campaign.priceFen)}`,
    endsAtLabel,
    deadlineLabel: `截至 ${endsAtLabel}`,
    posterCountLabel: campaign.posterImages.length
      ? `${campaign.posterImages.length} 张活动海报`
      : '活动暂未配置海报',
  };
}

export function buildGroupPromotionShareCopy(campaign: {
  title: string;
  campusName: string;
  priceLabel: string;
  maxPaidMembers: number;
  endsAtLabel: string;
}): string {
  return `「${campaign.title}」正在${campaign.campusName}招募中，${campaign.priceLabel} 参与，${campaign.maxPaidMembers} 人拼团可享五次线下体验课。活动截止 ${campaign.endsAtLabel}，欢迎转发给有需要的家长。`;
}

export function groupPromotionRecipientPath(campaignId: string): string {
  return `/pages/parent/group-detail/index?id=${encodeURIComponent(campaignId)}`;
}

function formatYuan(fen: number): string {
  return (fen / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}
