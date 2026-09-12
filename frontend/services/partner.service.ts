import { PartnerDataSource } from '../data/partner-data-source';
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
import { loadRequestState, RequestState } from '../utils/request-state';
import {
  GroupPage,
  GroupPromotionCampaignQuery,
  GroupPromotionCampaignView,
} from '../types/group-buying';

export class PartnerService {
  constructor(private readonly dataSource: PartnerDataSource) {}

  loadDashboard(): Promise<RequestState<PartnerDashboard>> {
    return loadRequestState(
      () => this.dataSource.getDashboard(),
      (data) => data.activeStudentCount === 0,
    );
  }

  loadProfile(): Promise<RequestState<PartnerProfile>> {
    return loadRequestState(() => this.dataSource.getProfile());
  }

  loadGroupPromotionCampaigns(
    query: GroupPromotionCampaignQuery,
  ): Promise<RequestState<GroupPage<GroupPromotionCampaignView>>> {
    return loadRequestState(
      () => this.dataSource.listGroupPromotionCampaigns(query),
      (data) => data.data.length === 0,
    );
  }

  loadGroupPromotionCampaign(
    id: string,
  ): Promise<RequestState<GroupPromotionCampaignView>> {
    return loadRequestState(() =>
      this.dataSource.getGroupPromotionCampaign(id),
    );
  }

  loadStudents(
    query: PartnerSearchQuery,
  ): Promise<RequestState<PartnerPage<PartnerStudent>>> {
    return loadRequestState(
      () => this.dataSource.listStudents(query),
      (data) => data.data.length === 0,
    );
  }

  loadStudent(
    studentId: string,
  ): Promise<RequestState<PartnerStudentDetail>> {
    return loadRequestState(() => this.dataSource.getStudent(studentId));
  }

  loadOperationsSummary(
    query: PartnerPeriodQuery,
  ): Promise<RequestState<PartnerOperationsSummary>> {
    return loadRequestState(
      () => this.dataSource.getOperationsSummary(query),
      (data) =>
        data.completedLessonCount === 0 &&
        data.recordedCount === 0 &&
        data.consumedLessonUnits === 0,
    );
  }

  loadWarnings(
    query: PartnerSearchQuery,
  ): Promise<RequestState<PartnerPage<PartnerWarning>>> {
    return loadRequestState(
      () => this.dataSource.listWarnings(query),
      (data) => data.data.length === 0,
    );
  }

  loadAttendance(
    query: PartnerPageQuery,
  ): Promise<RequestState<PartnerAttendance>> {
    return loadRequestState(
      () => this.dataSource.getAttendance(query),
      (data) => data.items.length === 0,
    );
  }

  loadTeachers(
    query: PartnerSearchQuery,
  ): Promise<RequestState<PartnerPage<PartnerTeacher>>> {
    return loadRequestState(
      () => this.dataSource.listTeachers(query),
      (data) => data.data.length === 0,
    );
  }

  loadLessonAccount(
    query: PartnerPageQuery,
  ): Promise<RequestState<PartnerLessonAccount>> {
    return loadRequestState(
      () => this.dataSource.getLessonAccount(query),
      (data) => data.items.length === 0 && data.totalBalanceUnits === 0,
    );
  }

  loadEarningSummary(
    query: PartnerEarningPeriodQuery = {},
  ): Promise<RequestState<PartnerEarningSummary>> {
    return loadRequestState(() => this.dataSource.getEarningSummary(query));
  }

  loadCurrentEarningRule(): Promise<RequestState<PartnerEarningRule | null>> {
    return loadRequestState(
      () => this.dataSource.getCurrentEarningRule(),
      (data) => data === null,
    );
  }

  loadEarnings(
    query: PartnerEarningQuery,
  ): Promise<RequestState<PartnerPage<PartnerEarningEntry>>> {
    return loadRequestState(
      () => this.dataSource.listEarnings(query),
      (data) => data.data.length === 0,
    );
  }
}
