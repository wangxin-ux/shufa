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
import {
  GroupPage,
  GroupPromotionCampaignQuery,
  GroupPromotionCampaignView,
} from '../types/group-buying';

export class TeacherDataSourceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = TeacherDataSourceError.name;
  }
}

export interface TeacherDataSource {
  getDashboard(): Promise<TeacherDashboard>;
  getProfile(): Promise<TeacherProfile>;
  listGroupPromotionCampaigns(
    query: GroupPromotionCampaignQuery,
  ): Promise<GroupPage<GroupPromotionCampaignView>>;
  getGroupPromotionCampaign(id: string): Promise<GroupPromotionCampaignView>;
  listLessonSessions(
    query: LessonSessionQuery,
  ): Promise<Page<TeacherLessonSession>>;
  getLessonSession(id: string): Promise<TeacherLessonDetail>;
  listStudents(query: TeacherStudentQuery): Promise<Page<TeacherStudent>>;
  getStudent(id: string): Promise<TeacherStudentDetail>;
  saveAttendance(
    input: AttendanceDraft,
    idempotencyKey: string,
  ): Promise<TeacherLessonDetail>;
  completeLesson(
    input: CompleteLessonDraft,
    idempotencyKey: string,
  ): Promise<CompleteLessonResult>;
  reverseLesson(
    input: ReverseLessonDraft,
    idempotencyKey: string,
  ): Promise<CompleteLessonResult>;
  saveFeedback(
    input: FeedbackDraft,
    idempotencyKey: string,
  ): Promise<StudentFeedback>;
  uploadFeedbackImage(input: FeedbackImageUploadDraft): Promise<FeedbackImage>;
  listTeachingRecords(query: DatePageQuery): Promise<Page<TeachingRecord>>;
  listLessonLedger(
    query: DatePageQuery,
  ): Promise<Page<TeacherLedgerRecord>>;
  getEarningSummary(): Promise<TeacherEarningSummary>;
  getCurrentEarningRule(): Promise<TeacherEarningRuleView | null>;
  getEarnings(query: TeacherEarningQuery): Promise<Page<TeacherEarningEntry>>;
  getWithdrawals(
    query: TeacherWithdrawalQuery,
  ): Promise<Page<TeacherWithdrawal>>;
  createWithdrawal(
    amountFen: number,
    idempotencyKey: string,
  ): Promise<TeacherWithdrawal>;
  cancelWithdrawal(
    id: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<TeacherWithdrawal>;
}
