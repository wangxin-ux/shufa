import {
  DEFAULT_PARENT_FEATURE_FLAGS,
  ParentFeatureFlags,
} from '../config/parent-feature-flags';
import { ParentDataSource } from '../data/parent-data-source';
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
import { loadRequestState, RequestState } from '../utils/request-state';

export class ParentService {
  constructor(
    private readonly dataSource: ParentDataSource,
    private readonly featureFlags: ParentFeatureFlags = DEFAULT_PARENT_FEATURE_FLAGS,
  ) {}

  loadCampuses(
    query: ParentCampusQuery,
  ): Promise<RequestState<ParentCampusPage>> {
    return loadRequestState(
      () => this.dataSource.listCampuses(query),
      (data) => data.data.length === 0,
    );
  }

  loadHomeSummary(): Promise<RequestState<ParentHomeSummary>> {
    return loadRequestState(
      () => this.dataSource.getHomeSummary(),
      (data) => data.nextLesson === null,
    );
  }

  loadHoursView(): Promise<RequestState<ParentHoursView>> {
    return loadRequestState(
      async () => {
        const data = await this.dataSource.getHoursView();
        return this.featureFlags.showGiftHours ? data : { ...data, giftHours: null };
      },
      (data) => data.entries.length === 0,
    );
  }

  loadLeavePage(): Promise<RequestState<LeavePageView>> {
    return loadRequestState(
      () => this.dataSource.getLeavePage(),
      (data) => data.students.length === 0 && data.lessons.length === 0 && data.records.length === 0,
    );
  }

  submitLeave(
    draft: LeaveDraft,
    idempotencyKey: string,
  ): Promise<RequestState<LeaveRecord>> {
    return loadRequestState(() => this.dataSource.submitLeave(draft, idempotencyKey));
  }

  loadProfile(): Promise<RequestState<ParentProfileView>> {
    return loadRequestState(
      () => this.dataSource.getProfile(),
      (data) => data.student === null,
    );
  }

  updateProfile(
    input: ParentProfileUpdateInput,
    idempotencyKey: string,
  ): Promise<RequestState<ParentProfileView>> {
    return loadRequestState(() =>
      this.dataSource.updateProfile(input, idempotencyKey),
    );
  }

  loadUpdates(): Promise<RequestState<ParentUpdatesView>> {
    return loadRequestState(
      () => this.dataSource.getUpdates(),
      (data) => data.records.length === 0,
    );
  }

  loadGroupCampaigns(
    query: ParentGroupCampaignQuery,
  ): Promise<RequestState<GroupPage<GroupCampaignView>>> {
    return loadRequestState(
      () => this.dataSource.listGroupCampaigns(query),
      (data) => data.data.length === 0,
    );
  }

  loadGroupCampaign(campaignId: string, teamId?: string): Promise<RequestState<GroupCampaignView>> {
    return loadRequestState(() => this.dataSource.getGroupCampaign(campaignId, teamId));
  }

  loadGroupOrders(
    query: GroupOrderQuery,
  ): Promise<RequestState<GroupPage<GroupOrderView>>> {
    return loadRequestState(
      () => this.dataSource.listGroupOrders(query),
      (data) => data.data.length === 0,
    );
  }

  createGroupTeam(input: GroupJoinInput, idempotencyKey: string): Promise<RequestState<GroupJoinView>> {
    return loadRequestState(() => this.dataSource.createGroupTeam(input, idempotencyKey));
  }

  joinGroupTeam(teamId: string, studentId: string, idempotencyKey: string): Promise<RequestState<GroupJoinView>> {
    return loadRequestState(() => this.dataSource.joinGroupTeam(teamId, studentId, idempotencyKey));
  }

  retryGroupPrepay(memberId: string, version: number, idempotencyKey: string): Promise<RequestState<GroupPrepayView>> {
    return loadRequestState(() => this.dataSource.retryGroupPrepay(memberId, version, idempotencyKey));
  }

  confirmMockGroupPayment(memberId: string, outTradeNo: string, idempotencyKey: string): Promise<RequestState<GroupOrderView>> {
    return loadRequestState(() => this.dataSource.confirmMockGroupPayment(memberId, outTradeNo, idempotencyKey));
  }
}
