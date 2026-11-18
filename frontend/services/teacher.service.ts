import type { TeacherDataSource } from '../data/teacher-data-source';
import { loadRequestState, RequestState } from '../utils/request-state';

const calls = {
  loadRankings: ['getRankings', 1],
  loadDashboard: ['getDashboard', 0],
  loadProfile: ['getProfile', 0],
  loadGroupPromotionCampaigns: ['listGroupPromotionCampaigns', 1],
  loadGroupPromotionCampaign: ['getGroupPromotionCampaign', 1],
  loadLessonSessions: ['listLessonSessions', 1],
  loadLessonSession: ['getLessonSession', 1],
  loadStudents: ['listStudents', 1],
  loadStudent: ['getStudent', 2],
  saveAttendance: ['saveAttendance', 2],
  completeLesson: ['completeLesson', 2],
  reverseLesson: ['reverseLesson', 2],
  saveFeedback: ['saveFeedback', 2],
  uploadFeedbackImage: ['uploadFeedbackImage', 1],
  loadTeachingRecords: ['listTeachingRecords', 1],
  loadLessonLedger: ['listLessonLedger', 1],
  loadEarningSummary: ['getEarningSummary', 0],
  loadCurrentEarningRule: ['getCurrentEarningRule', 0],
  loadEarnings: ['getEarnings', 1],
  loadWithdrawals: ['getWithdrawals', 1],
  createWithdrawal: ['createWithdrawal', 2],
  cancelWithdrawal: ['cancelWithdrawal', 3],
} as const satisfies Record<string, readonly [keyof TeacherDataSource, number]>;
type Name = keyof typeof calls;
type Source<K extends Name> = TeacherDataSource[typeof calls[K][0]];
type Data<K extends Name> = Awaited<ReturnType<Source<K>>>;
type Methods = { [K in Name]: (...args: Parameters<Source<K>>) => Promise<RequestState<Data<K>>> };
const empty: { [K in Name]?: (data: Data<K>) => boolean } = {
  loadRankings: data => data.rows.length === 0,
  loadDashboard: data => data.nextLesson === null,
  loadGroupPromotionCampaigns: data => data.data.length === 0,
  loadLessonSessions: data => data.data.length === 0,
  loadStudents: data => data.data.length === 0,
  loadTeachingRecords: data => data.data.length === 0,
  loadLessonLedger: data => data.data.length === 0,
  loadCurrentEarningRule: data => data === null,
  loadEarnings: data => data.data.length === 0,
  loadWithdrawals: data => data.data.length === 0,
};

export interface TeacherService extends Methods {}
export class TeacherService {
  constructor(private readonly dataSource: TeacherDataSource) {}

  static {
    // Install the same prototype calls, preserving receiver, errors and empty-state predicates.
    for (const name of Object.keys(calls) as Name[]) {
      const [method, arity] = calls[name];
      const forward = {
        [name](this: TeacherService, ...args: unknown[]) {
          args.length = arity;
          return loadRequestState(
            () => Reflect.apply(this.dataSource[method], this.dataSource, args) as Promise<unknown>,
            empty[name] as ((data: unknown) => boolean) | undefined,
          );
        },
      }[name];
      Object.defineProperty(forward, 'length', { value: arity });
      Object.defineProperty(this.prototype, name, { value: forward, writable: true, configurable: true });
    }
  }
}
