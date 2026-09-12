import { GroupPromotionCampaignView } from '../../types/group-buying';

export const GROUP_PROMOTION_CAMPAIGN_FIXTURE: GroupPromotionCampaignView = {
  id: 'mock-group-campaign-1',
  code: 'GROUP-1990-DEMO',
  campusId: '10000000-0000-4000-8000-000000000001',
  campusName: '启明东校区',
  courseProductId: 'mock-course-product-1',
  courseName: '创意体验课',
  title: '19.9 元创意体验课拼团',
  description: '好友同行更划算，三人拼成后每位孩子可获得五次线下体验课。',
  priceFen: 1990,
  maxPaidMembers: 3,
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: '2026-09-30T15:59:59.000Z',
  status: 'ACTIVE',
  posterImages: [],
  customerService: {
    name: '启明课程顾问',
    phone: '0731-88886666',
    qrCodeUrl: null,
  },
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-03T00:00:00.000Z',
};
