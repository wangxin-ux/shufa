import { GroupCampaignView, GroupOrderView } from '../types/group-buying';
import { formatLocalDateTime, formatMoneyFen } from '../utils/super-admin-format';

const CAMPAIGN_STATUS = {
  DRAFT: '草稿', ACTIVE: '进行中', CLOSED: '已结束', CANCELLED: '已取消',
} as const;
const MEMBER_STATUS = {
  PENDING_PAYMENT: '待支付', PAID: '拼团中', SETTLED: '已结算',
  REFUNDING: '退款中', REFUNDED: '已退款', CANCELLED: '已取消',
} as const;

export function presentManagementGroupCampaign(campaign: GroupCampaignView) {
  return {
    ...campaign,
    priceLabel: formatMoneyFen(campaign.priceFen),
    statusLabel: CAMPAIGN_STATUS[campaign.status],
    periodLabel: `${formatLocalDateTime(campaign.startsAt)} 至 ${formatLocalDateTime(campaign.endsAt)}`,
    canEdit: campaign.status === 'DRAFT',
    canActivate: campaign.status === 'DRAFT',
    canClose: campaign.status === 'ACTIVE',
    canCancel: campaign.status === 'DRAFT' || campaign.status === 'ACTIVE',
    canManagePosters: campaign.status === 'DRAFT' || campaign.status === 'ACTIVE',
  };
}

export function presentManagementGroupOrder(order: GroupOrderView) {
  const granted = (order.grantedMainUnits ?? 0) + (order.grantedGiftUnits ?? 0);
  return {
    ...order,
    priceLabel: formatMoneyFen(order.priceFen),
    memberStatusLabel: MEMBER_STATUS[order.memberStatus],
    paymentStatusLabel: order.orderStatus === 'AWAITING_PAYMENT' ? '待支付' : order.orderStatus === 'PAID' ? '已支付' : order.orderStatus === 'EFFECTIVE' ? '已生效' : order.orderStatus === 'REFUNDED' ? '已退款' : order.orderStatus,
    packageLabel: granted ? `${granted / 100} 次课（主课 ${order.grantedMainUnits! / 100} + 赠送 ${(order.grantedGiftUnits ?? 0) / 100}）` : '尚未发放',
    createdAtLabel: formatLocalDateTime(order.createdAt),
    canRefund: order.memberStatus === 'PAID' || order.memberStatus === 'SETTLED',
  };
}
