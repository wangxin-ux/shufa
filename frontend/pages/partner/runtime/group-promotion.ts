import type { GroupPageQuery, GroupPromotionCampaignView } from '../../../types/group-buying';
import { presentGroupPromotionCampaign } from '../../../services/group-promotion.presenter';
import { GROUP_PROMOTION_CAMPAIGN_FIXTURE } from '../../../mock/fixtures/group-promotion.fixture';

export type PartnerCampaignPhase = 'ONGOING' | 'ENDED';
export interface PartnerCampaignQuery extends GroupPageQuery {
  phase?: PartnerCampaignPhase;
}
export interface PartnerCampaignView extends Omit<GroupPromotionCampaignView, 'status'> {
  status: 'ACTIVE' | 'CLOSED';
  canPromote: boolean;
}

export function presentPartnerPromotionCampaign(campaign: PartnerCampaignView) {
  const canPromote = campaign.status === 'ACTIVE' && campaign.canPromote === true;
  return {
    ...presentGroupPromotionCampaign(campaign),
    canPromote,
    statusLabel: canPromote ? '进行中'
      : campaign.status === 'CLOSED' || campaign.canPromote === false ? '已结束' : '不可推广',
  };
}

export function createMockPartnerCampaigns(): PartnerCampaignView[] {
  const campaign = JSON.parse(JSON.stringify(GROUP_PROMOTION_CAMPAIGN_FIXTURE)) as GroupPromotionCampaignView;
  const now = Date.now();
  const day = 86_400_000;
  return [
    { ...campaign, canPromote: true, startsAt: new Date(now - day).toISOString(),
      endsAt: new Date(now + 30 * day).toISOString() },
    { ...campaign, id: `${campaign.id}-ended`, status: 'CLOSED', canPromote: false,
      startsAt: new Date(now - 30 * day).toISOString(), endsAt: new Date(now - day).toISOString() },
  ];
}
