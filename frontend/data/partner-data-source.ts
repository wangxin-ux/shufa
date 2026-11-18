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
  PartnerStudentQuery,
  PartnerStudentDetail,
  PartnerStudentGrowth,
  PartnerTeacher,
  PartnerWarning,
} from '../types/partner';
import {
  GroupPage,
  PartnerCampaignQuery,
  PartnerCampaignView,
} from '../types/group-buying';

export interface PartnerDataSource {
  getDashboard(): Promise<PartnerDashboard>;
  getProfile(): Promise<PartnerProfile>;
  listGroupPromotionCampaigns(
    query: PartnerCampaignQuery,
  ): Promise<GroupPage<PartnerCampaignView>>;
  getGroupPromotionCampaign(id: string): Promise<PartnerCampaignView>;
  listStudents(query: PartnerStudentQuery): Promise<PartnerPage<PartnerStudent>>;
  getStudent(studentId: string): Promise<PartnerStudentDetail>;
  getStudentGrowth(studentId: string, query: PartnerPageQuery): Promise<PartnerStudentGrowth>;
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
