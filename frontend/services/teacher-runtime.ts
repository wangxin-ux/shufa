import {
  createTeacherRuntimeEnv,
  TeacherRuntimeEnv,
} from '../config/teacher-env';
import { createRuntimeAccessTokenProvider } from '../config/local-runtime';
import {
  ApiTeacherDataSource,
  TeacherHttpRequest,
} from '../data/api-teacher-data-source';
import { MockTeacherDataSource } from '../data/mock-teacher-data-source';
import { TeacherDataSource, TeacherDataSourceError } from '../data/teacher-data-source';
import { TeacherService } from './teacher.service';

let mockSession: {
  env: TeacherRuntimeEnv;
  account: string;
  source: MockTeacherDataSource;
} | undefined;

export function readTeacherMockAccount(): string {
  const value: unknown = typeof wx === 'undefined'
    ? undefined : wx.getStorageSync('education.test-account.current');
  return typeof value === 'string' ? value : '';
}

function createTeacherDataSource(
  env: TeacherRuntimeEnv,
  request?: TeacherHttpRequest,
): TeacherDataSource {
  if (env.dataDriver === 'api') {
    if (!env.apiBaseUrl.trim()) {
      throw new Error('教师端 API 地址不能为空');
    }
    return new ApiTeacherDataSource({
      baseUrl: env.apiBaseUrl,
      accessToken: createRuntimeAccessTokenProvider(env.accessToken),
      request,
    });
  }

  const normalized = { ...env, apiBaseUrl: env.apiBaseUrl.trim().replace(/\/+$/, '') };
  const account = readTeacherMockAccount();
  if (!mockSession || mockSession.account !== account ||
      !(Object.keys(normalized) as Array<keyof TeacherRuntimeEnv>)
        .every((key) => mockSession!.env[key] === normalized[key])) {
    mockSession = {
      env: normalized, account,
      source: new MockTeacherDataSource({ scenario: env.mockScenario }),
    };
  }
  return mockSession.source;
}

export function createTeacherService(
  env: TeacherRuntimeEnv = createTeacherRuntimeEnv(),
  request?: TeacherHttpRequest,
): TeacherService {
  return new TeacherService(createTeacherDataSource(env, request));
}

function currentDataSource(): TeacherDataSource {
  if (typeof wx !== 'undefined' && wx.getStorageSync('education.session.logged-out') === true) {
    mockSession = undefined;
    throw new TeacherDataSourceError(401, 'UNAUTHENTICATED', '请重新登录');
  }
  return createTeacherDataSource(createTeacherRuntimeEnv());
}

// Resolve each call against the current session.
const methods = [
  'getRankings', 'getDashboard', 'getProfile', 'listGroupPromotionCampaigns', 'getGroupPromotionCampaign',
  'listLessonSessions', 'getLessonSession', 'listStudents', 'getStudent', 'saveAttendance',
  'completeLesson', 'reverseLesson', 'saveFeedback', 'uploadFeedbackImage', 'listTeachingRecords',
  'listLessonLedger', 'getEarningSummary', 'getCurrentEarningRule', 'getEarnings',
  'getWithdrawals', 'createWithdrawal', 'cancelWithdrawal',
] as const satisfies readonly (keyof TeacherDataSource)[];
const lazySource = Object.fromEntries(methods.map((name) => [
  name, (...args: unknown[]) => {
    const source = currentDataSource();
    return Reflect.apply(source[name], source, args);
  },
])) as { [K in typeof methods[number]]: TeacherDataSource[K] };
export const teacherService = new TeacherService(lazySource);
