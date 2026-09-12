export type GroupCampaignStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'CANCELLED';
export type GroupTeamStatus = 'OPEN' | 'SETTLED' | 'CANCELLED';
export type GroupMemberStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'SETTLED'
  | 'REFUNDING'
  | 'REFUNDED'
  | 'CANCELLED';

export interface GroupMemberView {
  id: string;
  maskedParentName: string;
  studentName: string;
  status: GroupMemberStatus;
  paidAt: string | null;
}

export interface GroupTeamView {
  id: string;
  status: GroupTeamStatus;
  paidMemberCount: number;
  remainingSlots: number;
  finalTier: number | null;
  members: GroupMemberView[];
  shareScene: string;
  settledAt: string | null;
  createdAt: string;
}

export interface GroupCampaignPosterImage {
  id: string;
  storedFileId: string;
  sortOrder: number;
  mimeType: 'image/jpeg' | 'image/png';
  sizeBytes: number;
  accessUrl: string;
  accessUrlExpiresAt: string;
}

export interface GroupCampaignView {
  id: string;
  code: string;
  campusId: string;
  campusName: string;
  courseProductId: string;
  courseName: string;
  title: string;
  description: string;
  priceFen: number;
  maxPaidMembers: number;
  startsAt: string;
  endsAt: string;
  status: GroupCampaignStatus;
  version: number;
  posterImages: GroupCampaignPosterImage[];
  joinableTeams: GroupTeamView[];
  boundStudents: Array<{ id: string; name: string }>;
  customerService: { name: string; phone: string; qrCodeUrl: string | null };
  createdAt: string;
  updatedAt: string;
}

export interface GroupPromotionCampaignView {
  id: string;
  code: string;
  campusId: string;
  campusName: string;
  courseProductId: string;
  courseName: string;
  title: string;
  description: string;
  priceFen: number;
  maxPaidMembers: number;
  startsAt: string;
  endsAt: string;
  status: 'ACTIVE';
  posterImages: GroupCampaignPosterImage[];
  customerService: { name: string; phone: string; qrCodeUrl: string | null };
  createdAt: string;
  updatedAt: string;
}

export interface GroupOrderView {
  id: string;
  orderNo: string;
  campaignId: string;
  campaignTitle: string;
  teamId: string;
  memberId: string;
  campusId: string;
  campusName: string;
  studentId: string;
  studentName: string;
  priceFen: number;
  memberStatus: GroupMemberStatus;
  orderStatus: string;
  teamStatus: GroupTeamStatus;
  paidMemberCount: number;
  grantedMainUnits: number | null;
  grantedGiftUnits: number | null;
  paidAt: string | null;
  settledAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface GroupPrepayView {
  mode: 'MOCK' | 'WECHAT';
  memberId: string;
  orderId: string;
  outTradeNo: string;
  timeStamp: string | null;
  nonceStr: string | null;
  package: string | null;
  signType: string | null;
  paySign: string | null;
}

export interface GroupJoinView {
  team: GroupTeamView;
  order: GroupOrderView;
  prepay: GroupPrepayView;
}

export interface GroupPage<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface GroupPageQuery {
  page: number;
  pageSize: number;
}

export type GroupPromotionCampaignQuery = GroupPageQuery;

export interface ParentGroupCampaignQuery extends GroupPageQuery {
  studentId?: string;
}

export interface GroupOrderQuery extends GroupPageQuery {
  status?: GroupMemberStatus;
  campusId?: string;
}

export interface GroupJoinInput {
  campaignId: string;
  studentId: string;
}

export interface GroupCampaignMutationInput {
  campusId: string;
  courseProductId: string;
  title: string;
  description: string;
  priceFen: number;
  startsAt: string;
  endsAt: string;
}

export interface ManagementGroupCampaignQuery extends GroupPageQuery {
  campusId?: string;
  status?: GroupCampaignStatus;
}

export type CourseProductStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';

export interface ManagementCourseProductView {
  id: string;
  campusId: string;
  campusName: string;
  name: string;
  summary: string;
  coverFileId: string | null;
  priceFen: number;
  mainUnits: number;
  giftUnits: number;
  validityDays: number;
  status: CourseProductStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ManagementCourseProductQuery extends GroupPageQuery {
  campusId?: string;
  status?: CourseProductStatus;
}
