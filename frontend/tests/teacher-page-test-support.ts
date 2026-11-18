import type { TeacherHttpRequestOptions } from '../data/api-teacher-data-source';
import { NORMAL_TEACHER_FIXTURE as fixture } from '../mock/fixtures/teacher.fixture';

export const flushTeacherPage = async () => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

export const teacherListing = (page = 1, ids = ['lesson-1'], totalPages = 2) => ({
  data: ids.map((id) => ({ ...fixture.lessonSessions[0], id })),
  meta: { page, pageSize: 10, total: totalPages === 1 ? ids.length : 11, totalPages },
});

export const teacherLesson = () => structuredClone(
  fixture.lessonDetails[fixture.lessonSessions[0].id],
);

type TeacherTestRoute = 'schedule' | 'lesson' | 'feedback' | 'feedback-detail' | 'records' | 'home' | 'profile'
  | 'students' | 'student-detail' | 'earnings' | 'ledger' | 'group-campaigns' | 'group-detail';

export function captureTeacherPage(
  route: TeacherTestRoute,
  options: { autoClock?: boolean; autoSession?: boolean; preload?: boolean } = {},
) {
  const host = globalThis as any;
  const previous = new Map(['wx', 'Page', 'getCurrentPages'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(host, key)],
  ));
  const values = new Map<string, any>([
    ['education.runtime', {
      dataDriver: 'api', apiBaseUrl: 'https://initial.synthetic.invalid',
      accessToken: 'synthetic-teacher-a', enableTestAccountSwitcher: false,
    }],
    ['education.session.logged-out', false],
  ]);
  const calls: TeacherHttpRequestOptions[] = [];
  const pages: any[] = [];
  const stack: Array<{ route: string }> = [];
  let definition: any;
  const request = jest.fn((input: TeacherHttpRequestOptions) => {
    if (options.autoSession !== false && input.url.endsWith('/me')) {
      queueMicrotask(() => input.success({
        statusCode: 200, data: { data: {
          userId: 'synthetic-teacher-user', displayName: '合成教师',
          roles: [{ code: 'TEACHER', campusId: 'synthetic-campus' }],
        } },
      }));
    } else if (options.autoClock !== false && input.url.endsWith('/dashboard')) {
      queueMicrotask(() => input.success({
        statusCode: 200, data: { data: fixture.dashboard },
      }));
    } else calls.push(input);
  });
  host.wx = {
    getStorageSync: (key: string) => values.get(key),
    setStorageSync: (key: string, value: unknown) => values.set(key, value),
    request,
    stopPullDownRefresh: jest.fn(), navigateTo: jest.fn(), reLaunch: jest.fn(),
    navigateBack: jest.fn(), redirectTo: jest.fn(),
    showToast: jest.fn(), showModal: jest.fn(),
  };
  host.getCurrentPages = () => stack;
  host.Page = (config: any) => { definition = config; };
  if (options.preload !== false) {
    jest.isolateModules(() => require(`../pages/teacher/${route}/index.ts`));
  }
  return {
    calls, values, request, stack, wx: host.wx,
    register: (nextRoute: TeacherTestRoute = route) =>
      jest.isolateModules(() => require(`../pages/teacher/${nextRoute}/index.ts`)),
    change(patch: object) {
      values.set('education.runtime', { ...values.get('education.runtime'), ...patch });
    },
    instantiate() {
      const page = { ...definition, data: structuredClone(definition.data) };
      page.setData = jest.fn((patch: object) => Object.assign(page.data, patch));
      pages.push(page);
      return page;
    },
    reply(index: number, data: unknown, statusCode = 200) {
      calls[index].success({ statusCode, data });
    },
    close() {
      for (const page of pages) page.onUnload?.();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(host, key, descriptor);
        else Reflect.deleteProperty(host, key);
      }
    },
  };
}

export const teacherTap = (id: string, status?: string) => ({
  currentTarget: { dataset: { id, status } },
});
