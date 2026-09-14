import {
  PartnerAttendance,
  PartnerDashboard,
  PartnerEarningEntry,
  PartnerEarningPeriodQuery,
  PartnerEarningQuery,
  PartnerEarningRule,
  PartnerEarningSummary,
  PartnerLessonAccount,
  PartnerOperationsSummary,
  PartnerPage,
  PartnerPageQuery,
  PartnerProfile,
  PartnerPeriodQuery,
  PartnerSearchQuery,
  PartnerStudent,
  PartnerStudentDetail,
  PartnerTeacher,
  PartnerWarning,
} from '../types/partner';
import {
  GroupPage,
  GroupPromotionCampaignQuery,
  GroupPromotionCampaignView,
} from '../types/group-buying';

export interface PartnerDataSource {
  getDashboard(): Promise<PartnerDashboard>;
  getProfile(): Promise<PartnerProfile>;
  listGroupPromotionCampaigns(
    query: GroupPromotionCampaignQuery,
  ): Promise<GroupPage<GroupPromotionCampaignView>>;
  getGroupPromotionCampaign(id: string): Promise<GroupPromotionCampaignView>;
  listStudents(query: PartnerSearchQuery): Promise<PartnerPage<PartnerStudent>>;
  getStudent(studentId: string): Promise<PartnerStudentDetail>;
  getOperationsSummary(
    query: PartnerPeriodQuery,
  ): Promise<PartnerOperationsSummary>;
  listWarnings(query: PartnerSearchQuery): Promise<PartnerPage<PartnerWarning>>;
  getAttendance(query: PartnerPageQuery): Promise<PartnerAttendance>;
  listTeachers(query: PartnerSearchQuery): Promise<PartnerPage<PartnerTeacher>>;
  getLessonAccount(query: PartnerPageQuery): Promise<PartnerLessonAccount>;
  getEarningSummary(
    query?: PartnerEarningPeriodQuery,
  ): Promise<PartnerEarningSummary>;
  getCurrentEarningRule(): Promise<PartnerEarningRule | null>;
  listEarnings(query: PartnerEarningQuery): Promise<PartnerPage<PartnerEarningEntry>>;
}

export class PartnerDataSourceError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PartnerDataSourceError';
  }
}
