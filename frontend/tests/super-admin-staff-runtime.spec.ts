import type { SuperAdminHttpRequestOptions } from '../data/api-super-admin-data-source';
import type { SuperAdminCampus, SuperAdminStaffAccount } from '../types/super-admin';
import { partnerApplicationAcceptanceFixture } from './fixtures/partner-application-acceptance.fixture';

const apiA = 'https://staff-a.example.test';
const apiB = 'https://staff-b.example.test';
const fixture = partnerApplicationAcceptanceFixture('APPROVED');
const flush = async () => { for (let i = 0; i < 240; i++) await Promise.resolve(); };
const campus: SuperAdminCampus = {
  id: fixture.account.campusId!, name: fixture.account.campusName, code: 'SYNTHETIC',
  timezone: 'Asia/Shanghai', contactPhone: null, address: null, lessonWarningThresholdUnits: 100,
  activeStudentCount: 0, teacherCount: 0, classCount: 0, warningStudentCount: 0,
};
const createdAccount: SuperAdminStaffAccount = {
  ...fixture.account, displayName: '合成工作人员', maskedPhone: '+86****0000',
  roleCode: 'HR', campusId: null, campusName: '总部', bindingStatus: 'UNBOUND', version: 1,
};
const meta = { page: 1, pageSize: 100, total: 1, totalPages: 1 };
const campusCatalog = (count: number): SuperAdminCampus[] =>
  Array.from({ length: count }, (_, index) => ({
    ...campus, id: `00000000-0000-4000-8000-${String(index + 1000).padStart(12, '0')}`,
    code: `SYNTHETIC-${index + 1}`, name: `合成校区${index + 1}`,
  }));
const campusChoice = ({ id, name }: SuperAdminCampus) => ({ id, name });
const replyCampusPage = (
  input: SuperAdminHttpRequestOptions,
  rows: SuperAdminCampus[],
  patch: Partial<typeof meta> = {},
) => {
  const requestedPage = Number(new URL(input.url).searchParams.get('page'));
  input.success({ statusCode: 200, data: {
    data: rows.slice((requestedPage - 1) * 100, requestedPage * 100),
    meta: { ...meta, page: requestedPage, total: rows.length, totalPages: Math.ceil(rows.length / 100), ...patch },
  } });
};

describe('staff account actual Page and environment assembly', () => {
  let stored: Record<string, unknown>;
  let requests: SuperAdminHttpRequestOptions[];
  let authorizationRequests: SuperAdminHttpRequestOptions[];
  let authorize: (input: SuperAdminHttpRequestOptions) => void;
  let page: any;
  const setRuntime = (patch: object = {}) => {
    stored = { dataDriver: 'api', apiBaseUrl: apiB, accessToken: 'synthetic-reviewer', ...patch };
  };
  const assemble = (initial: object = {}) => {
    setRuntime(initial);
    jest.isolateModules(() => { require('../pages/super-admin/staff-accounts/index'); });
  };
  const open = async () => { page.onLoad(); page.onShow(); await flush(); };
  const fill = () => {
    page.onToggleCreate();
    page.onNameInput({ detail: { value: '合成工作人员' } });
    page.onPhoneInput({ detail: { value: '13900000000' } });
    page.onRoleChange({ detail: { value: '2' } });
  };
  const serveCatalog = (
    rows: SuperAdminCampus[],
    intercept?: (input: SuperAdminHttpRequestOptions, requestedPage: number) => boolean,
  ) => {
    const transport = (global as any).wx.request;
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => {
      const url = new URL(input.url);
      if (url.pathname !== '/management/campuses') { transport(input); return; }
      requests.push(input);
      if (!intercept?.(input, Number(url.searchParams.get('page')))) replyCampusPage(input, rows);
    };
  };
  beforeEach(() => {
    page = undefined; requests = []; authorizationRequests = [];
    authorize = (input) => input.success({ statusCode: 200, data: { data: {
      userId: '00000000-0000-4000-8000-000000009001',
      roles: [{ code: 'SUPER_ADMIN', campusId: null }],
    } } });
    (global as any).wx = {
      getStorageSync: (key: string) => key === 'education.runtime' ? stored : undefined,
      request: (input: SuperAdminHttpRequestOptions) => {
        requests.push(input);
        const isCampus = new URL(input.url).pathname === '/management/campuses';
        input.success({ statusCode: 200, data: {
          data: isCampus ? [campus] : [fixture.account], meta,
        } });
      },
      showModal: jest.fn(), showToast: jest.fn(),
    };
    let transport = (global as any).wx.request;
    Object.defineProperty((global as any).wx, 'request', {
      configurable: true,
      get: () => transport,
      set: (businessTransport: (input: SuperAdminHttpRequestOptions) => void) => {
        transport = (input: SuperAdminHttpRequestOptions) => {
          if (new URL(input.url).pathname === '/me') {
            authorizationRequests.push(input); authorize(input); return;
          }
          businessTransport(input);
        };
      },
    });
    (global as any).wx.request = transport;
    (global as any).Page = (definition: any) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
      page.setData = jest.fn((patch: object) => {
        const values = JSON.parse(JSON.stringify(patch)) as Record<string, unknown>;
        for (const [key, value] of Object.entries(values)) {
          const indexed = /^campuses\[(\d+)\]$/.exec(key);
          if (indexed) page.data.campuses[Number(indexed[1])] = value;
          else page.data[key] = value;
        }
      });
    };
  });
  afterEach(() => {
    page?.onUnload();
    delete (global as any).Page; delete (global as any).wx;
  });

  it.each([{ dataDriver: 'mock' }, { apiBaseUrl: apiA }])('uses the current environment after modules were loaded with %j', async (initial) => {
    assemble(initial); setRuntime(); await open();
    expect(requests.map((input) => input.url)).toEqual([
      `${apiB}/management/campuses?page=1&pageSize=100`,
      `${apiB}/management/staff-accounts?page=1&pageSize=100`,
    ]);
    expect(page.data.accounts[0]).toMatchObject({ id: fixture.account.id, maskedPhone: '未绑定个人手机号' });
  });
  it('reassembles both reads after the API address changes on a retry', async () => {
    assemble({ apiBaseUrl: apiA }); await open(); setRuntime();
    await page.load();
    expect(requests.slice(-2).map((input) => input.url)).toEqual([
      `${apiB}/management/campuses?page=1&pageSize=100`,
      `${apiB}/management/staff-accounts?page=1&pageSize=100`,
    ]);
  });
  it.each([{ accessToken: 'synthetic-next-reviewer' }, { apiBaseUrl: apiA }])(
    'restores campus choices as well as accounts when a search notices %j', async (patch) => {
      assemble(); await open(); fill();
      page.onKeywordInput({ detail: { value: '旧机构' } }); setRuntime(patch);
      page.onSearch(); await flush();
      const baseUrl = 'apiBaseUrl' in patch ? apiA : apiB;
      expect(requests.slice(-2).map((input) => input.url)).toEqual([
        `${baseUrl}/management/campuses?page=1&pageSize=100`,
        `${baseUrl}/management/staff-accounts?page=1&pageSize=100`,
      ]);
      expect(page.data.viewState).toBe('success'); expect(page.data.campuses).toEqual([campusChoice(campus)]);
      expect(page.data.createName).toBe(''); expect(page.data.keyword).toBe('');
      fill(); page.onRoleChange({ detail: { value: '1' } });
      (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => {
        requests.push(input);
        input.success({ statusCode: input.method === 'POST' ? 201 : 200, data: {
          data: input.method === 'POST' ? { ...createdAccount, roleCode: 'PARTNER', campusId: campus.id, campusName: campus.name }
            : [fixture.account], meta,
        } });
      };
      await page.onCreate();
      expect(requests.find((input) => input.method === 'POST')).toMatchObject({
        url: `${baseUrl}/management/staff-accounts`,
        data: { displayName: '合成工作人员', phone: '13900000000', roleCode: 'PARTNER', campusId: campus.id },
      });
    },
  );
  it.each([{ accessToken: 'synthetic-next-reviewer' }, { apiBaseUrl: apiA }])(
    'preserves the held campus recovery when another search follows %j', async (patch) => {
      assemble(); await open(); setRuntime(patch);
      (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => { requests.push(input); };
      page.onSearch(); await flush();
      expect(new URL(requests[2].url).pathname).toBe('/management/campuses');
      page.onKeywordInput({ detail: { value: '新机构' } }); page.onSearch(); await flush();
      expect(requests).toHaveLength(3);
      requests[2].success({ statusCode: 200, data: { data: [campus], meta } }); await flush();
      expect(requests[3].url).toContain(`query=${encodeURIComponent('新机构')}`);
      requests[3].success({ statusCode: 200, data: { data: [fixture.account], meta } }); await flush();
      expect(page.data.viewState).toBe('success'); expect(page.data.campuses).toEqual([campusChoice(campus)]);
      expect(page.data.keyword).toBe('新机构');
    },
  );
  it('switches from API into mock without continuing requests to the former API', async () => {
    assemble(); await open(); setRuntime({ dataDriver: 'mock' });
    await page.load();
    expect(requests).toHaveLength(2);
  });
  const serveAccounts = (
    count: number,
    intercept?: (input: SuperAdminHttpRequestOptions, requestedPage: number) => boolean,
  ) => {
    const transport = (global as any).wx.request;
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => {
      const url = new URL(input.url);
      if (url.pathname !== '/management/staff-accounts' || input.method !== 'GET') { transport(input); return; }
      requests.push(input);
      const requestedPage = Number(url.searchParams.get('page'));
      if (intercept?.(input, requestedPage)) return;
      const start = (requestedPage - 1) * 100;
      input.success({ statusCode: 200, data: {
        data: Array.from({ length: Math.min(100, Math.max(0, count - start)) }, (_, offset) => ({
          ...fixture.account, id: `synthetic-account-${start + offset + 1}`,
          displayName: `合成账号${start + offset + 1}`,
        })),
        meta: { page: requestedPage, pageSize: 100, total: count, totalPages: Math.ceil(count / 100) },
      } });
    };
  };
  it('browses all 201 accounts and returns to the first page without growing the displayed list', async () => {
    serveAccounts(201); assemble(); await open();
    expect(page.data).toMatchObject({ page: 1, total: 201, totalPages: 3, pageLoading: false });
    await page.onPreviousPage(); expect(requests).toHaveLength(2);
    await page.onNextPage();
    expect(page.data.accounts).toHaveLength(100);
    expect(page.data.accounts[0].id).toBe('synthetic-account-101');
    await page.onNextPage();
    expect(page.data.accounts.map((account: { id: string }) => account.id)).toEqual(['synthetic-account-201']);
    await page.onNextPage(); expect(requests).toHaveLength(4);
    await page.onPreviousPage(); await page.onPreviousPage();
    expect(page.data.page).toBe(1); expect(page.data.accounts).toHaveLength(100);
    expect(requests.map((input) => new URL(input.url).searchParams.get('page'))).toEqual(['1', '1', '2', '3', '2', '1']);
  });
  it('uses the submitted search for paging even while an unsubmitted keyword is edited', async () => {
    serveAccounts(201); assemble(); await open();
    page.onKeywordInput({ detail: { value: ' 原机构 ' } }); page.onSearch(); await flush();
    page.onKeywordInput({ detail: { value: '新机构' } }); await page.onNextPage();
    expect(new URL(requests[requests.length - 1].url).searchParams.get('query')).toBe('原机构');
    page.onSearch(); await flush();
    expect(new URL(requests[requests.length - 1].url).searchParams.get('query')).toBe('新机构');
    expect(page.data).toMatchObject({ page: 1, total: 201 });
  });
  it('keeps the last successful page and retries the same page after a network failure', async () => {
    let fail = true;
    serveAccounts(201, (input, requestedPage) => {
      if (requestedPage !== 2 || !fail) return false;
      input.fail(new Error('synthetic response lost')); return true;
    });
    assemble(); await open(); await page.onNextPage();
    expect(page.data).toMatchObject({ page: 1, viewState: 'success', pageLoading: false });
    expect(page.data.accounts).toHaveLength(100); expect(page.data.pageError).not.toBe('');
    fail = false; await page.onNextPage();
    expect(page.data).toMatchObject({ page: 2, pageError: '', pageLoading: false });
  });
  it.each([200, 403])('ignores repeated next clicks and handles a stale page %s after a newer search completes', async (statusCode) => {
    let held: SuperAdminHttpRequestOptions | undefined;
    serveAccounts(201, (input, requestedPage) => {
      if (requestedPage !== 2) return false;
      held = input; return true;
    });
    assemble(); await open(); const pending = page.onNextPage(); await flush();
    await page.onNextPage(); expect(requests).toHaveLength(3);
    page.onKeywordInput({ detail: { value: '新机构' } }); page.onSearch(); await flush();
    const snapshot = JSON.stringify(page.data);
    held!.success({ statusCode, data: statusCode === 403
      ? { code: 'FORBIDDEN', message: '旧请求' }
      : { data: [fixture.account], meta: { ...meta, page: 2, total: 101, totalPages: 2 } } }); await pending;
    if (statusCode === 200) {
      expect(JSON.stringify(page.data)).toBe(snapshot);
      expect(page.data).toMatchObject({ page: 1, viewState: 'success', pageLoading: false });
    } else {
      expect(page.data).toMatchObject({ page: 0, viewState: 'forbidden', pageLoading: false,
        accounts: [], campuses: [], keyword: '' });
    }
  });
  it.each([401, 403])('clears private accounts and paging metadata when page two receives %s', async (statusCode) => {
    serveAccounts(201, (input, requestedPage) => {
      if (requestedPage !== 2) return false;
      input.success({ statusCode, data: { code: 'FORBIDDEN', message: '无权限' } }); return true;
    });
    assemble(); await open(); fill(); await page.onNextPage();
    expect(page.data).toMatchObject({ viewState: 'forbidden', accounts: [], campuses: [],
      page: 0, total: 0, totalPages: 0, pageLoading: false, createName: '', createPhone: '' });
    await page.onNextPage(); expect(requests).toHaveLength(3);
  });
  it.each(['hide', 'owner'])('does not deliver held paging data after %s', async (cause) => {
    let held!: SuperAdminHttpRequestOptions;
    serveAccounts(201, (input, requestedPage) => {
      if (requestedPage !== 2) return false;
      held = input; return true;
    });
    assemble(); await open(); const pending = page.onNextPage(); await flush();
    if (cause === 'hide') page.onHide();
    else setRuntime({ accessToken: 'synthetic-next-reviewer' });
    held.success({ statusCode: 200, data: { data: [fixture.account], meta: { ...meta, page: 2 } } });
    await pending;
    expect(page.data).toMatchObject({ accounts: [], page: 0, total: 0, totalPages: 0, pageLoading: false });
    if (cause === 'owner') expect(page.data.viewState).toBe('forbidden');
  });
  it.each(['wrong-page', 'invalid-total', 'missing-meta', 'duplicate-id'])(
    'keeps page one readable when page two returns %s', async (failure) => {
      serveAccounts(201, (input, requestedPage) => {
        if (requestedPage !== 2) return false;
        const response: { data: unknown[]; meta?: object } = {
          data: Array.from({ length: 100 }, (_, index) => ({ ...fixture.account, id: `synthetic-page-two-${index}` })),
          meta: { page: 2, pageSize: 100, total: 201, totalPages: 3 },
        };
        if (failure === 'wrong-page') response.meta = { ...response.meta, page: 1 };
        if (failure === 'invalid-total') response.meta = { ...response.meta, total: -1 };
        if (failure === 'missing-meta') delete response.meta;
        if (failure === 'duplicate-id') response.data[1] = response.data[0];
        input.success({ statusCode: 200, data: response }); return true;
      });
      assemble(); await open(); await page.onNextPage();
      expect(page.data).toMatchObject({ page: 1, pageLoading: false, viewState: 'success' });
      expect(page.data.accounts[0].id).toBe('synthetic-account-1');
      expect(page.data.pageError).not.toBe('');
    },
  );
  it('moves back to the last available page if the result set shrinks between requests', async () => {
    serveAccounts(101); assemble(); await open();
    serveAccounts(50); await page.onNextPage();
    expect(page.data).toMatchObject({ page: 1, total: 50, totalPages: 1, pageLoading: false, pageError: '' });
    expect(page.data.accounts).toHaveLength(50);
    expect(requests.slice(-2).map((input) => new URL(input.url).searchParams.get('page'))).toEqual(['2', '1']);
  });
  it.each(['status', 'unbind'])('refreshes the displayed page and submitted query after %s succeeds', async (action) => {
    const transport = (global as any).wx.request;
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => {
      if (input.method === 'GET') { transport(input); return; }
      requests.push(input);
      input.success({ statusCode: 200, data: { data: {
        ...fixture.account, status: 'DISABLED', version: 3, bindingStatus: 'UNBOUND',
      } } });
    };
    serveAccounts(201);
    assemble(); await open();
    page.onKeywordInput({ detail: { value: '已查询机构' } }); page.onSearch(); await flush();
    await page.onNextPage();
    page.onKeywordInput({ detail: { value: '未提交机构' } });
    const account = page.data.accounts[0];
    if (action === 'status') await page.updateStatus(account.id, account.version, 'DISABLED');
    else {
      account.maskedPhone = '+86****0000';
      await page.unbindWechat(account.id, account.version);
    }
    expect(requests.filter((input) => input.method !== 'GET')).toHaveLength(1);
    expect(page.data.page).toBe(2);
    expect(new URL(requests[requests.length - 1].url).searchParams.get('query')).toBe('已查询机构');
    expect(new URL(requests[requests.length - 1].url).searchParams.get('page')).toBe('2');
  });
  it('blocks status and unbind commands while a replacement page is pending', async () => {
    let held!: SuperAdminHttpRequestOptions;
    serveAccounts(201, (input, requestedPage) => {
      if (requestedPage !== 2) return false;
      held = input; return true;
    });
    assemble(); await open();
    const account = page.data.accounts[0]; account.maskedPhone = '+86****0000';
    const event = { currentTarget: { dataset: { id: account.id, version: account.version, status: account.status } } };
    const pending = page.onNextPage(); await flush();
    page.onStatusAction(event); page.onUnbindAction(event);
    await page.updateStatus(account.id, account.version, 'DISABLED');
    await page.unbindWechat(account.id, account.version);
    expect((global as any).wx.showModal).not.toHaveBeenCalled();
    expect(requests.filter((input) => input.method !== 'GET')).toHaveLength(0);
    held.fail(new Error('synthetic response lost')); await pending;
    expect(page.data.pageLoading).toBe(false);
  });
  it('shows an empty first page when every matching account disappears before paging', async () => {
    serveAccounts(101); assemble(); await open(); serveAccounts(0);
    await page.onNextPage();
    expect(page.data).toMatchObject({ viewState: 'empty', page: 1, total: 0, totalPages: 0, accounts: [], pageLoading: false });
  });
  it('stops after one last-page recovery if the result set keeps shrinking', async () => {
    let recovery = false;
    serveAccounts(301, (input, requestedPage) => {
      if (requestedPage === 3) recovery = true;
      const total = requestedPage === 3 ? 150 : recovery && requestedPage === 2 ? 50 : undefined;
      if (total === undefined) return false;
      input.success({ statusCode: 200, data: {
        data: [], meta: { page: requestedPage, pageSize: 100, total, totalPages: Math.ceil(total / 100) },
      } }); return true;
    });
    assemble(); await open(); await page.onNextPage();
    const start = requests.length; await page.onNextPage();
    expect(requests.slice(start).map((input) => new URL(input.url).searchParams.get('page'))).toEqual(['3', '2']);
    expect(page.data).toMatchObject({ page: 2, total: 301, pageLoading: false, viewState: 'success' });
    expect(page.data.pageError).not.toBe('');
  });
  it('reports an invalid first page and recovers on a fresh read', async () => {
    let invalid = true;
    serveAccounts(201, (input) => {
      if (!invalid) return false;
      input.success({ statusCode: 200, data: { data: [fixture.account] } }); return true;
    });
    assemble(); await open();
    expect(page.data).toMatchObject({ viewState: 'error', page: 0, total: 0, accounts: [], pageLoading: false });
    invalid = false; page.onSearch(); await flush();
    expect(page.data).toMatchObject({ viewState: 'success', page: 1, total: 201, pageLoading: false });
  });
  it('shows an observable failure after rechecking an empty list and then recovers', async () => {
    let fail = false;
    serveAccounts(0, (input) => {
      if (!fail) return false;
      input.success({ statusCode: 503, data: { code: 'UNAVAILABLE', message: '合成服务暂不可用' } }); return true;
    });
    assemble(); await open();
    expect(page.data.viewState).toBe('empty');
    fail = true; page.onSearch(); await flush();
    expect(page.data).toMatchObject({ viewState: 'error', accounts: [], pageLoading: false, pageError: '' });
    expect(page.data.errorMessage).not.toBe('');
    fail = false; page.onSearch(); await flush();
    expect(page.data).toMatchObject({ viewState: 'empty', page: 1, total: 0, errorMessage: '', pageLoading: false });
  });
  it('keeps the page available with an invalid API address and fails closed before transport', async () => {
    expect(() => assemble({ apiBaseUrl: '' })).not.toThrow();
    await open();
    expect(requests).toHaveLength(0); expect(page.data.viewState).toBe('forbidden');
    expect(page.data.errorMessage).not.toBe('');
  });
  it('does not send an API read without a current formal token', async () => {
    assemble({ accessToken: '' }); await open();
    expect(requests).toHaveLength(0); expect(page.data.viewState).toBe('forbidden');
    expect(page.data.accounts).toEqual([]); expect(page.data.campuses).toEqual([]);
  });
  it('updates an approved account through the current API with its displayed version', async () => {
    assemble({ apiBaseUrl: apiA }); setRuntime(); await open();
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => {
      requests.push(input);
      const account = { ...fixture.account, status: 'DISABLED', version: 3 };
      input.success({ statusCode: 200, data: { data: input.method === 'PATCH' ? account : [account], meta } });
    };
    await page.updateStatus(fixture.account.id, fixture.account.version, 'DISABLED');
    expect(requests.find((input) => input.method === 'PATCH')).toMatchObject({
      url: `${apiB}/management/staff-accounts/${fixture.account.id}/status`,
      data: { expectedVersion: fixture.account.version, status: 'DISABLED' },
      header: { Authorization: 'Bearer synthetic-reviewer', 'Idempotency-Key': expect.any(String) },
    });
    expect(page.data.viewState).toBe('success');
    expect(page.data.accounts[0]).toMatchObject({ status: 'DISABLED', version: 3 });
  });
  it('clears the old campus and form before replacement-owner reads are dispatched', async () => {
    assemble(); await open(); fill(); page.onKeywordInput({ detail: { value: '旧机构' } });
    setRuntime({ accessToken: 'synthetic-next-reviewer' });
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => { requests.push(input); };
    const pending = page.load();
    expect(page.data.accounts).toEqual([]); expect(page.data.campuses).toEqual([]);
    expect(page.data.createOpen).toBe(false); expect(page.data.createName).toBe('');
    expect(page.data.createPhone).toBe(''); expect(page.data.keyword).toBe('');
    await flush();
    requests[2].success({ statusCode: 200, data: { data: [], meta: { ...meta, total: 0, totalPages: 0 } } });
    await flush();
    requests[3].success({ statusCode: 200, data: { data: [], meta: { ...meta, total: 0, totalPages: 0 } } });
    await pending;
  });
  it.each(['hidden', 'replacement'])('does not create from an old form after %s', async (cause) => {
    assemble(); await open(); fill();
    if (cause === 'hidden') page.onHide();
    else setRuntime({ accessToken: 'synthetic-next-reviewer' });
    await page.onCreate();
    expect(requests.filter((input) => input.method === 'POST')).toHaveLength(0);
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
    if (cause === 'replacement') {
      expect(page.data.createName).toBe(''); expect(page.data.createPhone).toBe('');
      expect(page.data.campuses).toEqual([]);
    }
  });
  it('does not deliver a late creation success to a hidden page and unlocks its form after return', async () => {
    assemble(); await open(); fill();
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => { requests.push(input); };
    const pending = page.onCreate(); await flush();
    expect(requests[2]).toMatchObject({ method: 'POST', data: {
      displayName: '合成工作人员', phone: '13900000000', roleCode: 'HR', campusId: null,
    } });
    page.onHide();
    requests[2].success({ statusCode: 201, data: { data: createdAccount } });
    await pending;
    expect(page.data.accounts).toEqual([]); expect(page.data.createName).toBe('');
    expect(page.data.createPhone).toBe('');
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
    expect(requests).toHaveLength(3);
    page.onShow(); await flush();
    requests[3].success({ statusCode: 200, data: { data: [campus], meta } }); await flush();
    requests[4].success({ statusCode: 200, data: { data: [fixture.account], meta } }); await flush();
    expect(page.data.submitting).toBe(false);
  });
  it.each([
    ['campuses', 401], ['campuses', 403], ['accounts', 401], ['accounts', 403],
    ['create', 401], ['create', 403],
  ])('clears every private field after a current %s reply denies access with %s', async (operation, statusCode) => {
    assemble(); await open(); fill(); page.onKeywordInput({ detail: { value: '旧机构' } });
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => {
      requests.push(input);
      input.success({ statusCode: Number(statusCode), data: { code: 'FORBIDDEN', message: '无权限' } });
    };
    if (operation === 'campuses') await page.load();
    else if (operation === 'accounts') await page.loadAccounts();
    else await page.onCreate();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', errorMessage: '当前账号无总部账号管理权限',
      accounts: [], campuses: [],
      keyword: '', createOpen: false, createName: '', createPhone: '', createRoleIndex: 0,
      createCampusIndex: 0, createHeadquarters: false, submitting: false, submittingId: '',
    });
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });
  it.each([401, 403])('restores campus choices when searching after same-owner access returns from %s', async (statusCode) => {
    assemble(); await open(); fill();
    const transport = (global as any).wx.request;
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => {
      requests.push(input); input.success({ statusCode, data: { code: 'FORBIDDEN', message: '无权限' } });
    };
    await page.loadAccounts(); expect(page.data.viewState).toBe('forbidden');
    (global as any).wx.request = transport;
    page.onSearch(); await flush();
    expect(requests.slice(-2).map((input) => new URL(input.url).pathname)).toEqual([
      '/management/campuses', '/management/staff-accounts',
    ]);
    expect(page.data.campuses).toEqual([campusChoice(campus)]); expect(page.data.viewState).toBe('success');
    expect(page.data.createName).toBe(''); expect(page.data.createPhone).toBe('');
  });
  it('retains the same-owner creation lock through hide and show until the held reply arrives', async () => {
    assemble(); await open(); fill();
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => { requests.push(input); };
    const pending = page.onCreate(); await flush();
    page.onHide(); page.onShow(); await flush();
    requests[3].success({ statusCode: 200, data: { data: [campus], meta } }); await flush();
    requests[4].success({ statusCode: 200, data: { data: [fixture.account], meta } }); await flush();
    expect(page.data.submitting).toBe(true);
    await page.onCreate();
    expect(requests.filter((input) => input.method === 'POST')).toHaveLength(1);
    requests[2].success({ statusCode: 201, data: { data: createdAccount } }); await pending;
    expect(page.data.submitting).toBe(false); expect(page.data.createName).toBe('');
    expect(page.data.createPhone).toBe('');
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });
  it('does not let an old creation completion unlock the replacement-owner creation', async () => {
    assemble(); await open(); fill();
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => { requests.push(input); };
    const oldCreation = page.onCreate(); await flush();
    setRuntime({ accessToken: 'synthetic-next-reviewer' });
    const loading = page.load();
    await flush();
    requests[3].success({ statusCode: 200, data: { data: [campus], meta } }); await flush();
    requests[4].success({ statusCode: 200, data: { data: [fixture.account], meta } }); await loading;
    fill(); const newCreation = page.onCreate(); await flush();
    requests[2].success({ statusCode: 201, data: { data: createdAccount } }); await oldCreation;
    expect(page.data.submitting).toBe(true); expect(page.data.createName).toBe('合成工作人员');
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
    await page.onCreate();
    expect(requests.filter((input) => input.method === 'POST')).toHaveLength(2);
    requests[5].success({ statusCode: 201, data: { data: createdAccount } }); await flush();
    requests[6].success({ statusCode: 200, data: { data: [fixture.account], meta } }); await newCreation;
    expect(page.data.submitting).toBe(false); expect(page.data.createName).toBe('');
    expect((global as any).wx.showToast).toHaveBeenCalledTimes(1);
  });
  it.each(['network', '500', '502', '408', '429'])('reuses the original creation key and body after an unknown %s result', async (failure) => {
    assemble(); await open(); fill();
    const transport = (global as any).wx.request;
    let first = true;
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => {
      if (input.method !== 'POST') { transport(input); return; }
      requests.push(input);
      if (first) {
        first = false;
        if (failure === 'network') input.fail(new Error('合成回复丢失'));
        else input.success({ statusCode: Number(failure), data: { code: 'SYNTHETIC_FAILURE', message: '合成失败' } });
      } else input.success({ statusCode: 201, data: { data: createdAccount } });
    };
    await page.onCreate();
    expect(page.data.createName).toBe('合成工作人员'); expect(page.data.submitting).toBe(false);
    page.onNameInput({ detail: { value: ' 合成工作人员 ' } });
    page.onPhoneInput({ detail: { value: ' 13900000000 ' } });
    await page.onCreate();
    const posts = requests.filter((input) => input.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1].header['Idempotency-Key']).toBe(posts[0].header['Idempotency-Key']);
    expect(posts[1].data).toEqual(posts[0].data);
    expect(page.data.createName).toBe(''); expect(page.data.createPhone).toBe('');
    expect((global as any).wx.showToast).toHaveBeenLastCalledWith({ title: '账号已创建', icon: 'success' });
  });
  it('retains the original creation key when a successful reply was hidden before return', async () => {
    assemble(); await open(); fill();
    const transport = (global as any).wx.request;
    let held: SuperAdminHttpRequestOptions | undefined;
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => {
      if (input.method !== 'POST') { transport(input); return; }
      requests.push(input);
      if (!held) held = input;
      else input.success({ statusCode: 201, data: { data: createdAccount } });
    };
    const pending = page.onCreate(); await flush(); page.onHide();
    held!.success({ statusCode: 201, data: { data: createdAccount } }); await pending;
    expect(page.data.createName).toBe(''); expect(page.data.createPhone).toBe('');
    page.onShow(); await flush(); fill(); await page.onCreate();
    const posts = requests.filter((input) => input.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1].header['Idempotency-Key']).toBe(posts[0].header['Idempotency-Key']);
    expect(posts[1].data).toEqual(posts[0].data);
  });
  it.each(['name', 'phone', 'role', 'campus'])('uses a new key for an intentionally changed %s payload', async (field) => {
    assemble(); await open(); fill();
    if (field === 'campus') {
      page.setData({ campuses: [campus, { ...campus, id: fixture.account.id, name: '合成另一校区' }] });
      page.onRoleChange({ detail: { value: '1' } });
    }
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => {
      requests.push(input); input.fail(new Error('合成回复丢失'));
    };
    await page.onCreate();
    if (field === 'name') page.onNameInput({ detail: { value: '合成另一工作人员' } });
    if (field === 'phone') page.onPhoneInput({ detail: { value: '13900000001' } });
    if (field === 'role') page.onRoleChange({ detail: { value: '3' } });
    if (field === 'campus') page.onCampusChange({ detail: { value: '1' } });
    await page.onCreate();
    const posts = requests.filter((input) => input.method === 'POST');
    expect(posts).toHaveLength(2); expect(posts[1].data).not.toEqual(posts[0].data);
    expect(posts[1].header['Idempotency-Key']).not.toBe(posts[0].header['Idempotency-Key']);
  });
  it.each([400, 409])('does not retain a creation retry key after a definite %s rejection', async (statusCode) => {
    assemble(); await open(); fill();
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => {
      requests.push(input); input.success({ statusCode, data: { code: 'SYNTHETIC_REJECTION', message: '合成拒绝' } });
    };
    await page.onCreate(); await page.onCreate();
    const posts = requests.filter((input) => input.method === 'POST');
    expect(posts[1].header['Idempotency-Key']).not.toBe(posts[0].header['Idempotency-Key']);
  });
  it('starts a new creation key after the previous creation was visibly acknowledged', async () => {
    assemble(); await open(); fill();
    const transport = (global as any).wx.request;
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => {
      if (input.method !== 'POST') { transport(input); return; }
      requests.push(input); input.success({ statusCode: 201, data: { data: createdAccount } });
    };
    await page.onCreate(); fill(); await page.onCreate();
    const posts = requests.filter((input) => input.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1].header['Idempotency-Key']).not.toBe(posts[0].header['Idempotency-Key']);
  });
  it.each([{ accessToken: 'synthetic-next-reviewer' }, { apiBaseUrl: apiA }])(
    'does not carry a previous creation key into a replacement runtime %j', async (patch) => {
      assemble(); await open(); fill();
      const transport = (global as any).wx.request;
      (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => {
        if (input.method !== 'POST') { transport(input); return; }
        requests.push(input); input.fail(new Error('合成回复丢失'));
      };
      await page.onCreate(); setRuntime(patch); await page.load(); fill(); await page.onCreate();
      const posts = requests.filter((input) => input.method === 'POST');
      expect(posts).toHaveLength(2);
      expect(posts[1].data).toEqual(posts[0].data);
      expect(posts[1].header['Idempotency-Key']).not.toBe(posts[0].header['Idempotency-Key']);
    },
  );
  it.each([201, 403])('keeps a replacement-owner retry key after an old creation replies %s', async (statusCode) => {
    assemble(); await open(); fill();
    const transport = (global as any).wx.request;
    let held: SuperAdminHttpRequestOptions | undefined;
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => {
      if (input.method !== 'POST') { transport(input); return; }
      requests.push(input);
      if (!held) held = input;
      else input.fail(new Error('合成回复丢失'));
    };
    const oldCreation = page.onCreate(); await flush();
    setRuntime({ accessToken: 'synthetic-next-reviewer' }); await page.load(); fill(); await page.onCreate();
    held!.success({ statusCode, data: { data: createdAccount } }); await oldCreation;
    await page.onCreate();
    const posts = requests.filter((input) => input.method === 'POST');
    expect(posts).toHaveLength(3);
    expect(posts[1].header['Idempotency-Key']).not.toBe(posts[0].header['Idempotency-Key']);
    expect(posts[2].header['Idempotency-Key']).toBe(posts[1].header['Idempotency-Key']);
    expect((global as any).wx.showToast).not.toHaveBeenCalledWith({ title: '账号已创建', icon: 'success' });
  });
  it('rejects a retained old runtime before it dispatches a request for the replacement owner', async () => {
    assemble(); await open();
    const service = page.service; setRuntime({ accessToken: 'synthetic-next-reviewer' });
    const state = await service.loadStaffAccounts({ page: 1, pageSize: 100 });
    expect(state).toMatchObject({ status: 'error', statusCode: 0, message: '操作已中断，请重新核对' });
    expect(requests).toHaveLength(2);
  });
  it.each([0, 100, 101, 201])('reads all %s campus choices before making the account list available', async (count) => {
    const rows = campusCatalog(count); serveCatalog(rows);
    assemble(); await open();
    expect(page.data.campuses.map((row: SuperAdminCampus) => row.id)).toEqual(rows.map((row) => row.id));
    const reads = requests.filter((input) => new URL(input.url).pathname === '/management/campuses');
    expect(reads.map((input) => Number(new URL(input.url).searchParams.get('page'))))
      .toEqual(Array.from({ length: Math.max(1, Math.ceil(count / 100)) }, (_, index) => index + 1));
    expect(requests[requests.length - 1]?.url).toContain('/management/staff-accounts?');
    expect(page.campusesReady).toBe(true);
  });
  it('creates a partner in the campus beyond the first 100 choices', async () => {
    const rows = campusCatalog(101); serveCatalog(rows);
    assemble(); await open(); fill();
    page.onRoleChange({ detail: { value: '1' } });
    page.onCampusChange({ detail: { value: '100' } });
    const transport = (global as any).wx.request;
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => {
      if (input.method !== 'POST') { transport(input); return; }
      requests.push(input);
      input.success({ statusCode: 201, data: { data: {
        ...createdAccount, roleCode: 'PARTNER', campusId: rows[100].id, campusName: rows[100].name,
      } } });
    };
    await page.onCreate();
    expect(requests.find((input) => input.method === 'POST')?.data).toMatchObject({
      roleCode: 'PARTNER', campusId: rows[100].id,
    });
  });
  it('keeps a partial refresh private and refuses creation from old choices until the last page arrives', async () => {
    assemble(); await open(); fill(); page.onRoleChange({ detail: { value: '1' } });
    const rows = [campus, ...campusCatalog(100)];
    let held!: SuperAdminHttpRequestOptions;
    serveCatalog(rows, (input, requestedPage) => {
      if (requestedPage !== 2) return false;
      held = input; return true;
    });
    const pending = page.load(); await flush();
    expect(held).toBeDefined(); expect(page.campusesReady).toBe(false);
    expect(page.data.campuses).toEqual([campusChoice(campus)]);
    await page.onCreate();
    expect(requests.filter((input) => input.method === 'POST')).toHaveLength(0);
    replyCampusPage(held, rows); await pending;
    expect(page.campusesReady).toBe(true); expect(page.data.campuses).toEqual(rows.map(campusChoice));
    expect(page.data.createName).toBe('合成工作人员');
  });
  it('retains the form on a later-page failure and retries the catalog from page one', async () => {
    assemble(); await open(); fill(); page.onRoleChange({ detail: { value: '1' } });
    const rows = [campus, ...campusCatalog(100)]; let fail = true;
    serveCatalog(rows, (input, requestedPage) => {
      if (requestedPage !== 2 || !fail) return false;
      input.success({ statusCode: 503, data: { code: 'UNAVAILABLE', message: '合成读取失败' } }); return true;
    });
    await page.load();
    expect(page.data.viewState).toBe('error'); expect(page.campusesReady).toBe(false);
    expect(page.data.createName).toBe('合成工作人员');
    await page.onCreate(); expect(requests.filter((input) => input.method === 'POST')).toHaveLength(0);
    fail = false; const before = requests.length; await page.load();
    expect(requests.slice(before, before + 2).map((input) => Number(new URL(input.url).searchParams.get('page'))))
      .toEqual([1, 2]);
    expect(page.data.campuses).toEqual(rows.map(campusChoice)); expect(page.data.viewState).toBe('success');
  });
  it.each([401, 403])('clears the form when a later campus page denies access with %s', async (statusCode) => {
    assemble(); await open(); fill();
    serveCatalog(campusCatalog(201), (input, requestedPage) => {
      if (requestedPage !== 2) return false;
      input.success({ statusCode, data: { code: 'FORBIDDEN', message: '合成失权' } }); return true;
    });
    await page.load();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', campuses: [], accounts: [], createName: '',
    });
    expect(page.data.createPhone === '').toBe(true);
    expect(requests.filter((input) => new URL(input.url).searchParams.get('page') === '3')).toHaveLength(0);
  });
  it.each(['hide', 'unload', 'token', 'api'])('stops the old campus pagination after %s', async (cause) => {
    const rows = campusCatalog(201); let held!: SuperAdminHttpRequestOptions;
    serveCatalog(rows, (input, requestedPage) => {
      if (requestedPage !== 2) return false;
      held = input; return true;
    });
    assemble(); page.onLoad(); page.onShow(); await flush();
    expect(held).toBeDefined();
    if (cause === 'hide') page.onHide();
    else if (cause === 'unload') page.onUnload();
    else setRuntime(cause === 'token' ? { accessToken: 'synthetic-new-reviewer' } : { apiBaseUrl: apiA });
    replyCampusPage(held, rows); await flush();
    expect(requests).toHaveLength(2);
    expect(page.campusesReady).toBe(false); expect(page.data.campuses).toEqual([]);
  });
  it.each(['wrong-page', 'changed-total', 'duplicate', 'short-page'])(
    'rejects an incomplete or inconsistent campus catalog (%s)', async (cause) => {
      const rows = campusCatalog(101);
      serveCatalog(rows, (input, requestedPage) => {
        if (requestedPage !== 2) return false;
        if (cause === 'wrong-page') replyCampusPage(input, rows, { page: 1 });
        else if (cause === 'changed-total') replyCampusPage(input, rows, { total: 102 });
        else input.success({ statusCode: 200, data: {
          data: cause === 'duplicate' ? [rows[0]] : [],
          meta: { ...meta, page: 2, total: 101, totalPages: 2 },
        } });
        return true;
      });
      assemble(); await open();
      expect(page.data.viewState).toBe('error'); expect(page.campusesReady).toBe(false);
      expect(page.data.campuses).toEqual([]);
      expect(requests.every((input) => new URL(input.url).pathname === '/management/campuses')).toBe(true);
    },
  );
  it('preserves the selected campus identity when refreshed ordering changes', async () => {
    const rows = campusCatalog(2); serveCatalog(rows);
    assemble(); await open(); fill(); page.onRoleChange({ detail: { value: '1' } });
    page.onCampusChange({ detail: { value: '1' } });
    serveCatalog([...rows].reverse()); await page.load();
    expect(page.data.campuses[page.data.createCampusIndex].id).toBe(rows[1].id);
    expect(page.data.createName).toBe('合成工作人员');
  });
  it('requires a new choice if the selected campus disappears during refresh', async () => {
    const rows = campusCatalog(2); serveCatalog(rows);
    assemble(); await open(); fill(); page.onRoleChange({ detail: { value: '1' } });
    page.onCampusChange({ detail: { value: '1' } });
    serveCatalog([rows[0]]); await page.load(); await page.onCreate();
    expect(page.data.createCampusMissing).toBe(true);
    expect(requests.filter((input) => input.method === 'POST')).toHaveLength(0);
    page.onCampusChange({ detail: { value: '0' } });
    expect(page.data.createCampusMissing).toBe(false);
    expect(page.data.campuses[page.data.createCampusIndex].id).toBe(rows[0].id);
  });
  it.each([601, 1601])('installs %s long campus names without an oversized view update', async (count) => {
    const rows = campusCatalog(count).map((row) => ({
      ...row, name: '长'.repeat(200), code: 'S'.repeat(50), address: '址'.repeat(300),
    }));
    serveCatalog(rows); assemble(); await page.load();
    expect(page.data.campuses).toHaveLength(count);
    const largestPatch = Math.max(...page.setData.mock.calls.map(
      ([patch]: [object]) => Buffer.byteLength(JSON.stringify(patch), 'utf8'),
    ));
    expect(largestPatch).toBeLessThanOrEqual(128 * 1024);
    expect(page.data.campuses.every((row: object) => Object.keys(row).sort().join(',') === 'id,name')).toBe(true);
    expect(page.campusesReady).toBe(true);
    process.stdout.write(`CAMPUS_VIEW_PAYLOAD ${JSON.stringify({
      campuses: count, largestPatchBytes: largestPatch, limitBytes: 128 * 1024,
      source: 'test-host JSON UTF-8; native rendering pending',
    })}\n`);
  });

  it('authorizes each ordinary read and creation through the current identity endpoint', async () => {
    assemble(); await open();
    expect(authorizationRequests).toHaveLength(2);
    expect(authorizationRequests.every((input) => input.url === `${apiB}/me` &&
      input.method === 'GET' && input.header.Authorization === 'Bearer synthetic-reviewer')).toBe(true);
    const transport = (global as any).wx.request;
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => {
      if (input.method !== 'POST') { transport(input); return; }
      requests.push(input); input.success({ statusCode: 201, data: { data: createdAccount } });
    };
    fill(); await page.onCreate();
    expect(authorizationRequests).toHaveLength(4);
    expect(requests.filter((input) => input.method === 'POST')).toHaveLength(1);
    expect(page.data.createName).toBe('');
  });

  it.each([
    { label: 'ordinary operator', roles: [{ code: 'OPERATOR', campusId: fixture.account.campusId }] },
    { label: 'headquarters reader', roles: [{ code: 'OPERATOR', campusId: null }] },
    { label: 'mixed roles', roles: [{ code: 'SUPER_ADMIN', campusId: null }, { code: 'HR', campusId: null }] },
    { label: 'campus-bound administrator', roles: [{ code: 'SUPER_ADMIN', campusId: fixture.account.campusId }] },
    { label: 'missing campus', roles: [{ code: 'SUPER_ADMIN' }] },
    { label: 'empty campus', roles: [{ code: 'SUPER_ADMIN', campusId: '' }] },
  ])('rejects $label before any staff or campus transport', async ({ roles }) => {
    authorize = (input) => input.success({ statusCode: 200, data: { data: {
      userId: '00000000-0000-4000-8000-000000009001', roles,
    } } });
    assemble(); await open();
    expect(authorizationRequests).toHaveLength(1); expect(requests).toHaveLength(0);
    expect(page.data).toMatchObject({ viewState: 'forbidden', accounts: [], campuses: [] });
  });

  it.each([401, 403])('blocks a formerly authorized ordinary creation after current identity returns %s', async (statusCode) => {
    assemble(); await open(); fill();
    authorize = (input) => input.success({ statusCode, data: { code: 'FORBIDDEN' } });
    await page.onCreate();
    expect(requests.filter((input) => input.method === 'POST')).toHaveLength(0);
    expect(page.data).toMatchObject({ viewState: 'forbidden', accounts: [], campuses: [],
      createName: '', createPhone: '', submitting: false });
  });

  it.each(['hide', 'unload', 'owner'])('does not send ordinary creation after a held identity reply and %s', async (cause) => {
    assemble(); await open(); fill();
    const authorized = authorize; let held!: SuperAdminHttpRequestOptions;
    authorize = (input) => { held = input; };
    const pending = page.onCreate(); await flush();
    expect(held).toBeDefined();
    expect(requests.filter((input) => input.method === 'POST')).toHaveLength(0);
    if (cause === 'hide') page.onHide();
    else if (cause === 'unload') page.onUnload();
    else setRuntime({ accessToken: 'synthetic-next-reviewer' });
    authorized(held); await pending;
    expect(requests.filter((input) => input.method === 'POST')).toHaveLength(0);
    expect(page.data).toMatchObject({ accounts: [], campuses: [], createName: '', createPhone: '' });
  });

  it.each(['disable', 'enable', 'unbind'])('confirms and completes the ordinary %s button flow with the displayed version', async (action) => {
    const transport = (global as any).wx.request;
    let managed: SuperAdminStaffAccount = {
      ...fixture.account, maskedPhone: '+86****0000', status: action === 'enable' ? 'DISABLED' : 'ACTIVE',
    };
    (global as any).wx.request = (input: SuperAdminHttpRequestOptions) => {
      const route = new URL(input.url).pathname;
      if (route === '/management/staff-accounts' && input.method === 'GET') {
        requests.push(input); input.success({ statusCode: 200, data: { data: [managed], meta } }); return;
      }
      if (input.method === 'GET') { transport(input); return; }
      requests.push(input);
      managed = { ...managed, version: managed.version + 1,
        ...(action === 'unbind' ? { bindingStatus: 'UNBOUND' } : { status: action === 'disable' ? 'DISABLED' : 'ACTIVE' }) };
      input.success({ statusCode: 200, data: { data: managed } });
    };
    assemble(); await open();
    const displayed = page.data.accounts[0];
    const event = { currentTarget: { dataset: { id: displayed.id, version: displayed.version, status: displayed.status } } };
    const invoke = () => action === 'unbind' ? page.onUnbindAction(event) : page.onStatusAction(event);
    invoke();
    (global as any).wx.showModal.mock.calls[0][0].success({ confirm: false });
    await flush();
    expect(requests.filter((input) => input.method !== 'GET')).toHaveLength(0);
    invoke();
    (global as any).wx.showModal.mock.calls[1][0].success({ confirm: true });
    await flush();
    const writes = requests.filter((input) => input.method !== 'GET');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      url: `${apiB}/management/staff-accounts/${displayed.id}/${action === 'unbind' ? 'unbind-wechat' : 'status'}`,
      method: action === 'unbind' ? 'POST' : 'PATCH',
      data: { expectedVersion: displayed.version },
      header: { Authorization: 'Bearer synthetic-reviewer', 'Idempotency-Key': expect.any(String) },
    });
    if (action !== 'unbind') expect(writes[0].data).toMatchObject({ status: action === 'disable' ? 'DISABLED' : 'ACTIVE' });
    expect(authorizationRequests).toHaveLength(4);
    expect(page.data.accounts[0]).toMatchObject(managed);
  });
});
