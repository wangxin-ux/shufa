import { TeacherDataSource } from '../data/teacher-data-source';
import {
  AttendanceDraft,
  CompleteLessonDraft,
  CompleteLessonResult,
  DatePageQuery,
  FeedbackDraft,
  FeedbackImage,
  FeedbackImageUploadDraft,
  LessonSessionQuery,
  Page,
  ReverseLessonDraft,
  StudentFeedback,
  TeacherDashboard,
  TeacherEarningEntry,
  TeacherEarningQuery,
  TeacherEarningRuleView,
  TeacherEarningSummary,
  TeacherLedgerRecord,
  TeacherLessonDetail,
  TeacherLessonSession,
  TeacherProfile,
  TeacherStudent,
  TeacherStudentDetail,
  TeacherStudentQuery,
  TeacherWithdrawal,
  TeacherWithdrawalQuery,
  TeachingRecord,
} from '../types/teacher';
import { loadRequestState, RequestState } from '../utils/request-state';
import {
  GroupPage,
  GroupPromotionCampaignQuery,
  GroupPromotionCampaignView,
} from '../types/group-buying';

export class TeacherService {
  constructor(private readonly dataSource: TeacherDataSource) {}

  loadDashboard(): Promise<RequestState<TeacherDashboard>> {
    return loadRequestState(
      () => this.dataSource.getDashboard(),
      (data) => data.nextLesson === null,
    );
  }

  loadProfile(): Promise<RequestState<TeacherProfile>> {
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

  loadLessonSessions(
    query: LessonSessionQuery,
  ): Promise<RequestState<Page<TeacherLessonSession>>> {
    return loadRequestState(
      () => this.dataSource.listLessonSessions(query),
      (data) => data.data.length === 0,
    );
  }

  loadLessonSession(id: string): Promise<RequestState<TeacherLessonDetail>> {
    return loadRequestState(() => this.dataSource.getLessonSession(id));
  }

  loadStudents(
    query: TeacherStudentQuery,
  ): Promise<RequestState<Page<TeacherStudent>>> {
    return loadRequestState(
      () => this.dataSource.listStudents(query),
      (data) => data.data.length === 0,
    );
  }

  loadStudent(id: string): Promise<RequestState<TeacherStudentDetail>> {
    return loadRequestState(() => this.dataSource.getStudent(id));
  }

  saveAttendance(
    input: AttendanceDraft,
    idempotencyKey: string,
  ): Promise<RequestState<TeacherLessonDetail>> {
    return loadRequestState(() =>
      this.dataSource.saveAttendance(input, idempotencyKey),
    );
  }

  completeLesson(
    input: CompleteLessonDraft,
    idempotencyKey: string,
  ): Promise<RequestState<CompleteLessonResult>> {
    return loadRequestState(() =>
      this.dataSource.completeLesson(input, idempotencyKey),
    );
  }

  reverseLesson(
    input: ReverseLessonDraft,
    idempotencyKey: string,
  ): Promise<RequestState<CompleteLessonResult>> {
    return loadRequestState(() =>
      this.dataSource.reverseLesson(input, idempotencyKey),
    );
  }

  saveFeedback(
    input: FeedbackDraft,
    idempotencyKey: string,
  ): Promise<RequestState<StudentFeedback>> {
    return loadRequestState(() =>
      this.dataSource.saveFeedback(input, idempotencyKey),
    );
  }

  uploadFeedbackImage(
    input: FeedbackImageUploadDraft,
  ): Promise<RequestState<FeedbackImage>> {
    return loadRequestState(() => this.dataSource.uploadFeedbackImage(input));
  }

  loadTeachingRecords(
    query: DatePageQuery,
  ): Promise<RequestState<Page<TeachingRecord>>> {
    return loadRequestState(
      () => this.dataSource.listTeachingRecords(query),
      (data) => data.data.length === 0,
    );
  }

  loadLessonLedger(
    query: DatePageQuery,
  ): Promise<RequestState<Page<TeacherLedgerRecord>>> {
    return loadRequestState(
      () => this.dataSource.listLessonLedger(query),
      (data) => data.data.length === 0,
    );
  }

  loadEarningSummary(): Promise<RequestState<TeacherEarningSummary>> {
    return loadRequestState(() => this.dataSource.getEarningSummary());
  }

  loadCurrentEarningRule(): Promise<
    RequestState<TeacherEarningRuleView | null>
  > {
    return loadRequestState(
      () => this.dataSource.getCurrentEarningRule(),
      (data) => data === null,
    );
  }

  loadEarnings(
    query: TeacherEarningQuery,
  ): Promise<RequestState<Page<TeacherEarningEntry>>> {
    return loadRequestState(
      () => this.dataSource.getEarnings(query),
      (data) => data.data.length === 0,
    );
  }

  loadWithdrawals(
    query: TeacherWithdrawalQuery,
  ): Promise<RequestState<Page<TeacherWithdrawal>>> {
    return loadRequestState(
      () => this.dataSource.getWithdrawals(query),
      (data) => data.data.length === 0,
    );
  }

  createWithdrawal(
    amountFen: number,
    idempotencyKey: string,
  ): Promise<RequestState<TeacherWithdrawal>> {
    return loadRequestState(() =>
      this.dataSource.createWithdrawal(amountFen, idempotencyKey),
    );
  }

  cancelWithdrawal(
    id: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<RequestState<TeacherWithdrawal>> {
    return loadRequestState(() =>
      this.dataSource.cancelWithdrawal(id, expectedVersion, idempotencyKey),
    );
  }
}
