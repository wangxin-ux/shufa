import {
  LeaveDraft,
  LeavePageView,
  LeaveRecord,
  ParentHomeSummary,
  ParentCampusPage,
  ParentCampusQuery,
  ParentHoursView,
  ParentProfileView,
  ParentProfileUpdateInput,
  ParentUpdatesView,
} from '../types/parent';
import {
  GroupCampaignView,
  GroupJoinInput,
  GroupJoinView,
  GroupOrderQuery,
  GroupOrderView,
  GroupPage,
  GroupPrepayView,
  ParentGroupCampaignQuery,
} from '../types/group-buying';

export class ParentDataSourceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = ParentDataSourceError.name;
  }
}

export interface ParentDataSource {
  listCampuses(query: ParentCampusQuery): Promise<ParentCampusPage>;
  getHomeSummary(): Promise<ParentHomeSummary>;
  getHoursView(): Promise<ParentHoursView>;
  getLeavePage(): Promise<LeavePageView>;
  submitLeave(draft: LeaveDraft, idempotencyKey: string): Promise<LeaveRecord>;
  getProfile(): Promise<ParentProfileView>;
  updateProfile(
    input: ParentProfileUpdateInput,
    idempotencyKey: string,
  ): Promise<ParentProfileView>;
  getUpdates(): Promise<ParentUpdatesView>;
  listGroupCampaigns(query: ParentGroupCampaignQuery): Promise<GroupPage<GroupCampaignView>>;
  getGroupCampaign(campaignId: string, teamId?: string): Promise<GroupCampaignView>;
  listGroupOrders(query: GroupOrderQuery): Promise<GroupPage<GroupOrderView>>;
  createGroupTeam(input: GroupJoinInput, idempotencyKey: string): Promise<GroupJoinView>;
  joinGroupTeam(teamId: string, studentId: string, idempotencyKey: string): Promise<GroupJoinView>;
  retryGroupPrepay(memberId: string, expectedVersion: number, idempotencyKey: string): Promise<GroupPrepayView>;
  confirmMockGroupPayment(memberId: string, outTradeNo: string, idempotencyKey: string): Promise<GroupOrderView>;
}
