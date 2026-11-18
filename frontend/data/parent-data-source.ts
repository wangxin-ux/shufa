import {
  LeaveDraft,
  LeavePageView,
  LeaveRecord,
  ParentHomeSummary,
  ParentCampusPage,
  ParentCampusQuery,
  ParentCourseCatalogQuery,
  ParentCourseCatalogPage,
  ParentHoursView,
  ParentHoursQuery,
  ParentProfileView,
  ParentProfileUpdateInput,
  ParentUpdatesView,
  ParentGrowthStudent,
  ParentReviewDraft,
  ParentLessonReview,
  ParentPhotoUpload,
  ParentProfileSetupView,
  ParentProfileSetupInput,
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
  listCourseCatalog(query: ParentCourseCatalogQuery): Promise<ParentCourseCatalogPage>;
  listCampuses(query: ParentCampusQuery): Promise<ParentCampusPage>;
  getHomeSummary(): Promise<ParentHomeSummary>;
  getHoursView(query?: ParentHoursQuery): Promise<ParentHoursView>;
  getLeavePage(studentId?: string): Promise<LeavePageView>;
  submitLeave(draft: LeaveDraft, idempotencyKey: string): Promise<LeaveRecord>;
  getProfile(): Promise<ParentProfileView>;
  getProfileSetup(): Promise<ParentProfileSetupView>;
  completeProfileSetup(studentId: string, input: ParentProfileSetupInput, key: string): Promise<ParentProfileSetupView>;
  updateProfile(
    input: ParentProfileUpdateInput,
    idempotencyKey: string,
  ): Promise<ParentProfileView>;
  getUpdates(): Promise<ParentUpdatesView>;
  uploadStudentPhoto(studentId: string, filePath: string): Promise<ParentPhotoUpload>;
  replaceStudentPhoto(studentId: string, input: { fileId: string; expectedVersion: number }, key: string): Promise<ParentGrowthStudent>;
  submitLessonReview(lessonId: string, studentId: string, draft: ParentReviewDraft, key: string): Promise<ParentLessonReview>;
  listGroupCampaigns(query: ParentGroupCampaignQuery): Promise<GroupPage<GroupCampaignView>>;
  getGroupCampaign(campaignId: string, teamId?: string): Promise<GroupCampaignView>;
  listGroupOrders(query: GroupOrderQuery): Promise<GroupPage<GroupOrderView>>;
  createGroupTeam(input: GroupJoinInput, idempotencyKey: string): Promise<GroupJoinView>;
  joinGroupTeam(teamId: string, studentId: string, idempotencyKey: string): Promise<GroupJoinView>;
  retryGroupPrepay(memberId: string, expectedVersion: number, idempotencyKey: string): Promise<GroupPrepayView>;
  confirmMockGroupPayment(memberId: string, outTradeNo: string, idempotencyKey: string): Promise<GroupOrderView>;
}
