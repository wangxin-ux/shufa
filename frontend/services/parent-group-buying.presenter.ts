import {
  GroupCampaignView,
  GroupMemberStatus,
  GroupOrderView,
  GroupTeamView,
} from '../types/group-buying';
import { formatDateTimeLabel } from '../utils/format';

const MEMBER_STATUS: Record<GroupMemberStatus, string> = {
  PENDING_PAYMENT: '待支付',
  PAID: '拼团中',
  SETTLED: '已结算',
  REFUNDING: '退款中',
  REFUNDED: '已退款',
  CANCELLED: '已取消',
};

export const formatGroupMoney = (fen: number): string => (fen / 100).toFixed(1).replace(/\.0$/, '');

export function buildGroupShareCopy(
  campaign: { title: string; priceLabel: string; endsAtLabel: string },
  studentName?: string,
): string {
  const subject = studentName ? `${studentName}正在参加` : '正在参加';
  return `${subject}「${campaign.title}」，邀请你一起拼！${campaign.priceLabel} 元参与：1 人得 1 次、2 人得 3 次、3 人得 5 次线下体验课。活动截止 ${campaign.endsAtLabel}。`;
}

export function presentParentGroupCampaign(campaign: GroupCampaignView) {
  const now = Date.now();
  const startsAt = new Date(campaign.startsAt).getTime();
  const endsAt = new Date(campaign.endsAt).getTime();
  const canParticipate = campaign.status === 'ACTIVE' && startsAt <= now && endsAt > now;
  return {
    ...campaign,
    priceLabel: formatGroupMoney(campaign.priceFen),
    endsAtLabel: formatDateTimeLabel(campaign.endsAt),
    canParticipate,
    actionLabel: canParticipate
      ? '发起拼团'
      : campaign.status === 'ACTIVE' && startsAt > now
        ? '活动未开始'
        : '活动已结束',
    teamCountLabel: campaign.joinableTeams.length
      ? `${campaign.joinableTeams.length} 个团可加入`
      : '现在开团',
  };
}

export function presentParentGroupTeam(team: GroupTeamView) {
  return {
    ...team,
    progressLabel: `${team.paidMemberCount}/${team.paidMemberCount + team.remainingSlots} 人`,
    memberSlots: Array.from({ length: 3 }, (_, index) => {
      const member = team.members[index];
      return member ? { ...member, avatarLabel: member.maskedParentName.slice(0, 1) || '友' } : null;
    }),
  };
}

export function presentParentGroupOrder(order: GroupOrderView) {
  const grantedUnits = (order.grantedMainUnits ?? 0) + (order.grantedGiftUnits ?? 0);
  return {
    ...order,
    priceLabel: formatGroupMoney(order.priceFen),
    statusLabel: MEMBER_STATUS[order.memberStatus],
    statusTone:
      order.memberStatus === 'SETTLED'
        ? 'success'
        : order.memberStatus === 'REFUNDED' || order.memberStatus === 'CANCELLED'
          ? 'muted'
          : 'orange',
    grantedLabel: grantedUnits ? `${grantedUnits / 100} 次课` : '结算后发放',
    createdAtLabel: formatDateTimeLabel(order.createdAt),
    canPay: order.memberStatus === 'PENDING_PAYMENT',
  };
}

export function groupSharePath(campaignId: string, teamId?: string): string {
  const query = [`id=${encodeURIComponent(campaignId)}`];
  if (teamId) query.push(`teamId=${encodeURIComponent(teamId)}`);
  return `/pages/parent/group-detail/index?${query.join('&')}`;
}
