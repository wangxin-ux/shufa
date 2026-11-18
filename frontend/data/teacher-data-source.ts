import type * as T from '../types/teacher';
import type * as G from '../types/group-buying';
import type * as R from '../types/teacher-rankings';

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
  getRankings(query: R.TeacherRankingQuery): Promise<R.TeacherRankingPage>;

  getDashboard(): Promise<T.TeacherDashboard>;
  getProfile(): Promise<T.TeacherProfile>;
  listGroupPromotionCampaigns(
    query: G.GroupPromotionCampaignQuery,
  ): Promise<G.GroupPage<G.GroupPromotionCampaignView>>;
  getGroupPromotionCampaign(id: string): Promise<G.GroupPromotionCampaignView>;
  listLessonSessions(
    query: T.LessonSessionQuery,
  ): Promise<T.Page<T.TeacherLessonSession>>;
  getLessonSession(id: string): Promise<T.TeacherLessonDetail>;
  listStudents(query: T.TeacherStudentQuery): Promise<T.Page<T.TeacherStudent>>;
  getStudent(id: string, query?: T.TeacherStudentDetailQuery): Promise<T.TeacherStudentDetail>;
  saveAttendance(
    input: T.AttendanceDraft,
    idempotencyKey: string,
  ): Promise<T.TeacherLessonDetail>;
  completeLesson(
    input: T.CompleteLessonDraft,
    idempotencyKey: string,
  ): Promise<T.CompleteLessonResult>;
  reverseLesson(
    input: T.ReverseLessonDraft,
    idempotencyKey: string,
  ): Promise<T.CompleteLessonResult>;
  saveFeedback(
    input: T.FeedbackDraft,
    idempotencyKey: string,
  ): Promise<T.StudentFeedback>;
  uploadFeedbackImage(input: T.FeedbackImageUploadDraft): Promise<T.FeedbackImage>;
  listTeachingRecords(query: T.DatePageQuery): Promise<T.Page<T.TeachingRecord>>;
  listLessonLedger(
    query: T.DatePageQuery,
  ): Promise<T.Page<T.TeacherLedgerRecord>>;
  getEarningSummary(): Promise<T.TeacherEarningSummary>;
  getCurrentEarningRule(): Promise<T.TeacherEarningRuleView | null>;
  getEarnings(query: T.TeacherEarningQuery): Promise<T.Page<T.TeacherEarningEntry>>;
  getWithdrawals(
    query: T.TeacherWithdrawalQuery,
  ): Promise<T.Page<T.TeacherWithdrawal>>;
  createWithdrawal(
    amountFen: number,
    idempotencyKey: string,
  ): Promise<T.TeacherWithdrawal>;
  cancelWithdrawal(
    id: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<T.TeacherWithdrawal>;
}
