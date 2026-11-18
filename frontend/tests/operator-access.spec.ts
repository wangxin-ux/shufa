import type { OperatorHttpRequestOptions } from '../pages/operator/runtime/data/api-operator-data-source';
import { capture, flush } from './operator-page-host';

const session = (roles: unknown[] = [{ code: 'OPERATOR', campusId: 'synthetic-campus-a' }], userId = 'synthetic-operator') =>
  ({ data: { userId, displayName: '测试运营', roles } });

function setup() {
  const module = require('../pages/operator/runtime/operator-access');
  let current = true;
  const calls: OperatorHttpRequestOptions[] = [];
  const clear = jest.fn();
  const access = new module.OperatorAccess({
    apiBaseUrl: 'https://operator.example.test/api', accessToken: 'synthetic-token',
    isCurrent: () => current, forbidden: clear,
    request: (options: OperatorHttpRequestOptions) => calls.push(options),
  });
  return { access, calls, clear, changeOwner: () => { current = false; } };
}

it('validates the single OPERATOR scope through the existing /me endpoint before sending a business request', async () => {
  const h = setup();
  const success = jest.fn();
  h.access.request({
    url: 'https://operator.example.test/api/operators/me/dashboard',
    method: 'GET', header: {}, success, fail: jest.fn(),
  });
  expect(h.calls).toHaveLength(1);
  expect(h.calls[0]).toMatchObject({
    url: 'https://operator.example.test/api/me', method: 'GET',
    header: { Authorization: 'Bearer synthetic-token' },
  });
  h.calls[0].success({ statusCode: 200, data: session() });
  await flush();
  expect(h.calls[1].url).toContain('/operators/me/dashboard');
  h.calls[1].success({ statusCode: 200, data: { data: {} } });
  expect(success).toHaveBeenCalledTimes(1);
});

it.each([
  [],
  [{ code: 'OPERATOR', campusId: null }],
  [{ code: 'OPERATOR', campusId: '' }],
  [{ code: 'OPERATOR', campusId: '  ' }],
  [{ code: 'CAMPUS_MANAGER', campusId: 'synthetic-campus-a' }],
  [{ code: 'OPERATOR', campusId: 'synthetic-campus-a' }, { code: 'TEACHER', campusId: 'synthetic-campus-a' }],
  [{ code: 'OPERATOR', campusId: 'synthetic-campus-a' }, { code: 'OPERATOR', campusId: 'synthetic-campus-b' }],
].map((roles) => ({ roles })))('blocks ordinary reads and writes for the rejected role set $roles', async ({ roles }) => {
  const h = setup();
  const response = jest.fn();
  h.access.request({
    url: 'https://operator.example.test/api/operators/me/lesson-sessions',
    method: 'POST', header: {}, success: response, fail: jest.fn(),
  });
  h.calls[0].success({ statusCode: 200, data: session(roles) });
  await flush();
  expect(h.calls).toHaveLength(1);
  expect(response).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  expect(h.clear).toHaveBeenCalledTimes(1);
});

it('stops a queued write when the runtime owner changes during /me', async () => {
  const h = setup();
  const failed = jest.fn();
  h.access.request({
    url: 'https://operator.example.test/api/operators/me/campus-settings',
    method: 'PATCH', header: {}, success: failed, fail: jest.fn(),
  });
  h.changeOwner();
  h.calls[0].success({ statusCode: 200, data: session() });
  await flush();
  expect(h.calls).toHaveLength(1);
  expect(failed).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
});

it('pins user and campus across repeated checks and rejects scope reassignment with the same token', async () => {
  const h = setup();
  const first = h.access.authorize();
  h.calls[0].success({ statusCode: 200, data: session() });
  await first;
  const second = h.access.authorize();
  const outcome = expect(second).rejects.toMatchObject({ statusCode: 403 });
  h.calls[1].success({ statusCode: 200, data: session([{ code: 'OPERATOR', campusId: 'synthetic-campus-b' }]) });
  await outcome;
  expect(h.clear).toHaveBeenCalledTimes(1);
});

it('ignores successful business responses from an obsolete owner', async () => {
  const h = setup();
  const response = jest.fn();
  h.access.request({
    url: 'https://operator.example.test/api/operators/me/students', method: 'GET',
    header: {}, success: response, fail: jest.fn(),
  });
  h.calls[0].success({ statusCode: 200, data: session() });
  await flush();
  h.changeOwner();
  h.calls[1].success({ statusCode: 200, data: { data: ['private'] } });
  expect(response).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  expect(JSON.stringify(response.mock.calls)).not.toContain('private');
});

it.each(['home', 'students', 'teachers', 'warnings', 'campus-settings', 'student-form', 'schedule-editor'] as const)(
  'direct-opening %s with an empty-campus operator clears ordinary content and sends no business calls',
  async (route) => {
    const h = capture([route]);
    h.setSession({ userId: 'synthetic-headquarters', displayName: '测试总号', roles: [{ code: 'OPERATOR', campusId: null }] });
    try {
      const page = h.instantiate(route);
      page.onLoad({});
      await flush();
      expect(page.data.viewState ?? page.data.optionsState).toBe('forbidden');
      expect(h.calls).toHaveLength(0);
      page.onSubmit?.();
      page.onQuickSubmit?.();
      await flush();
      expect(h.calls).toHaveLength(0);
    } finally { h.close(); }
  },
);

it.each([
  { roleCode: 'CAMPUS_MANAGER', campusId: '10000000-0000-4000-8000-000000000001' },
  { roleCode: 'OPERATOR', campusId: '' },
  { roleCode: 'OPERATOR', campusId: 'synthetic-another-campus' },
])('rejects a profile that disagrees with the authenticated role and campus: %j', async (profile) => {
  const h = capture(['profile']);
  try {
    const page = h.instantiate();
    page.onLoad(); page.onShow(); await flush();
    const index = h.calls.findIndex((call) => call.url.endsWith('/profile'));
    h.reply(index, { data: { ...profile, displayName: '不应展示', campusName: '不应展示' } });
    await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', displayName: '', campusName: '', studentCount: '' });
  } finally { h.close(); }
});
