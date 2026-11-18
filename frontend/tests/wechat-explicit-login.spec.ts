import { SessionHttpRequest, SessionService, SessionView } from '../services/session.service';
import { WechatFormalLoginService } from '../pages/partner/runtime/wechat-formal-login-runtime';

const me: SessionView = {
  userId: 'synthetic-approved-partner', displayName: '合成申请人',
  roles: [{ code: 'PARTNER', campusId: 'synthetic-campus' }],
};
const envelope = (identity: unknown = me, accessToken = 'synthetic-formal-token') => ({
  data: { accessToken, me: identity },
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
};

describe('explicit existing WeChat identity formal login', () => {
  let values: Map<string, unknown>;
  let requests: Parameters<SessionHttpRequest>[0][];
  let codeProvider: jest.Mock;
  let service: WechatFormalLoginService;
  let formalSession: SessionService;
  beforeEach(() => {
    values = new Map([
      ['education.runtime', { accessToken: '', partnerApplicantSession: { token: 'synthetic-applicant-token' }, apiBaseUrl: 'https://example.test' }],
      ['education.session.logged-out', true],
    ] as Array<[string, unknown]>);
    requests = [];
    codeProvider = jest.fn().mockResolvedValue('synthetic-fresh-wechat-code');
    const options = {
      dataDriver: 'api', apiBaseUrl: 'https://example.test',
      storage: { get: (key: string) => values.get(key), set: (key: string, value: unknown) => { values.set(key, value); } },
      accessToken: () => (values.get('education.runtime') as { accessToken: string }).accessToken,
      loginCodeProvider: codeProvider,
      request: (options: Parameters<SessionHttpRequest>[0]) => { requests.push(options); },
    } as const;
    formalSession = new SessionService(options);
    service = new WechatFormalLoginService({ ...options, session: formalSession });
  });
  const login = () => service.loginWithWechat();
  const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

  it('actively logs in after logout without reusing an applicant token or requiring a phone code', async () => {
    await expect(service.load()).resolves.toBeNull();
    const pending = login();
    await flush();
    expect(requests[0]).toMatchObject({
      method: 'POST', url: 'https://example.test/auth/wechat/login',
      data: { code: 'synthetic-fresh-wechat-code' },
    });
    expect(requests[0].header.Authorization).toBeUndefined();
    requests[0].success({ statusCode: 200, data: envelope() });
    await expect(pending).resolves.toEqual(me);
    expect(values.get('education.session.logged-out')).toBe(false);
    expect(values.get('education.runtime')).toMatchObject({
      accessToken: 'synthetic-formal-token', partnerApplicantSession: { token: 'synthetic-applicant-token' },
    });
    expect(JSON.stringify([...values])).not.toContain('synthetic-fresh-wechat-code');
  });
  it('deduplicates explicit login and obtains a new code for a later login', async () => {
    const first = login();
    expect(login()).toBe(first);
    await flush();
    expect(codeProvider).toHaveBeenCalledTimes(1);
    requests[0].success({ statusCode: 200, data: envelope() });
    await first;
    const next = login();
    await flush();
    expect(codeProvider).toHaveBeenCalledTimes(2);
    requests[1].success({ statusCode: 200, data: envelope() });
    await next;
  });
  it('does not resurrect a logged-out session through a late successful response', async () => {
    const pending = login();
    const outcome = expect(pending).rejects.toThrow('登录状态已更新');
    await flush();
    formalSession.logout();
    requests[0].success({ statusCode: 200, data: envelope() });
    await outcome;
    expect(values.get('education.session.logged-out')).toBe(true);
    expect(values.get('education.runtime')).toMatchObject({ accessToken: '', partnerApplicantSession: { token: 'synthetic-applicant-token' } });
  });
  it('does not send an old code after logout and allows a new explicit login', async () => {
    const code = deferred<string>();
    codeProvider.mockReturnValueOnce(code.promise);
    const old = login();
    const rejected = expect(old).rejects.toThrow('登录状态已更新');
    await flush();
    formalSession.logout();
    const current = login();
    await flush();
    code.resolve('synthetic-stale-code');
    await rejected;
    expect(requests).toHaveLength(1);
    requests[0].success({ statusCode: 200, data: envelope() });
    await current;
  });
  it('does not overwrite a newer phone-binding login', async () => {
    const pending = login();
    const rejected = expect(pending).rejects.toThrow('登录状态已更新');
    await flush();
    const phone = formalSession.bindWechatStaffPhone('synthetic-phone-code');
    await flush();
    requests[1].success({ statusCode: 200, data: envelope(me, 'synthetic-newer-token') });
    await phone;
    requests[0].success({ statusCode: 200, data: envelope() });
    await rejected;
    expect(values.get('education.runtime')).toMatchObject({ accessToken: 'synthetic-newer-token' });
  });
  it('does not let an older phone-binding response overwrite the new explicit login', async () => {
    const old = formalSession.bindWechatStaffPhone('synthetic-old-phone');
    const rejected = expect(old).rejects.toThrow('登录状态已更新');
    await flush();
    const pending = login();
    await flush();
    requests[1].success({ statusCode: 200, data: envelope() });
    await pending;
    requests[0].success({ statusCode: 200, data: envelope(me, 'synthetic-old-binding-token') });
    await rejected;
    expect(values.get('education.runtime')).toMatchObject({ accessToken: 'synthetic-formal-token' });
  });
  it('does not let an older silent login response overwrite the new explicit login', async () => {
    values.set('education.session.logged-out', false);
    const old = formalSession.load();
    const rejected = expect(old).rejects.toThrow('登录状态已更新');
    await flush();
    const pending = login();
    await flush();
    requests[1].success({ statusCode: 200, data: envelope() });
    await pending;
    requests[0].success({ statusCode: 200, data: envelope(me, 'synthetic-old-silent-token') });
    await rejected;
    expect(values.get('education.runtime')).toMatchObject({ accessToken: 'synthetic-formal-token' });
  });
  it('does not clear a new token or start silent login after an older me request returns 401', async () => {
    values.set('education.session.logged-out', false);
    (values.get('education.runtime') as { accessToken: string }).accessToken = 'synthetic-old-token';
    const old = formalSession.load();
    const rejected = expect(old).rejects.toThrow('登录状态已更新');
    await flush();
    expect(requests[0].url).toBe('https://example.test/me');
    const pending = login();
    await flush();
    requests[1].success({ statusCode: 200, data: envelope() });
    await pending;
    requests[0].success({ statusCode: 401, data: { code: 'UNAUTHORIZED' } });
    await flush();
    requests[2]?.success({ statusCode: 200, data: envelope(me, 'synthetic-unexpected-fallback') });
    await rejected;
    await flush();
    expect(values.get('education.runtime')).toMatchObject({ accessToken: 'synthetic-formal-token' });
    expect(requests).toHaveLength(2);
  });
  it('does not accept a phone-binding response after logout', async () => {
    const old = formalSession.bindWechatStaffPhone('synthetic-old-phone');
    const rejected = expect(old).rejects.toThrow('登录状态已更新');
    await flush();
    formalSession.logout();
    requests[0].success({ statusCode: 200, data: envelope() });
    await rejected;
    expect(values.get('education.session.logged-out')).toBe(true);
    expect(values.get('education.runtime')).toMatchObject({ accessToken: '' });
  });
  it('does not send a phone-binding code that arrived after logout', async () => {
    const code = deferred<string>();
    codeProvider.mockReturnValueOnce(code.promise);
    const old = formalSession.bindWechatStaffPhone('synthetic-old-phone');
    const rejected = expect(old).rejects.toThrow('登录状态已更新');
    await flush();
    formalSession.logout();
    code.resolve('synthetic-stale-code');
    await flush();
    requests[0]?.success({ statusCode: 200, data: envelope() });
    await rejected;
    expect(requests).toHaveLength(0);
  });
  it('coalesces parallel ordinary session restoration without treating it as a new identity', async () => {
    values.set('education.session.logged-out', false);
    const outcome = expect(Promise.all([formalSession.load(), formalSession.load()])).resolves.toEqual([me, me]);
    await flush();
    expect(requests).toHaveLength(1);
    requests[0].success({ statusCode: 200, data: envelope() });
    await outcome;
    expect(codeProvider).toHaveBeenCalledTimes(1);
  });
  it('releases a shared binding-required restoration so a later recovery uses a fresh code', async () => {
    values.set('education.session.logged-out', false);
    const first = Promise.all([formalSession.load(), formalSession.load()]);
    const outcome = expect(first).resolves.toEqual([null, null]);
    await flush();
    requests[0].success({ statusCode: 409, data: { code: 'STAFF_PHONE_BINDING_REQUIRED' } });
    await outcome;
    const next = formalSession.load();
    await flush();
    requests[1].success({ statusCode: 200, data: envelope() });
    await expect(next).resolves.toEqual(me);
    expect(codeProvider).toHaveBeenCalledTimes(2);
  });
  it.each([
    { ...me, roles: [] },
    { ...me, roles: [...me.roles, { code: 'TEACHER', campusId: 'synthetic-campus' }] },
    { ...me, roles: [{ code: 'PARTNER', campusId: null }] },
    // 校区运营（OPERATOR + campusId）是合法身份，改验总部角色带校区的越界形态。
    { ...me, roles: [{ code: 'SUPER_ADMIN', campusId: 'synthetic-campus' }] },
    { ...me, roles: [{ code: 'OPERATOR', campusId: '' }] },
    { userId: 'synthetic', displayName: '合成', roles: [null] },
    { userId: 'synthetic', displayName: '合成' },
  ])('rejects malformed or unsupported identities before persisting credentials: %j', async (identity) => {
    const pending = login();
    const rejected = expect(pending).rejects.toThrow();
    await flush();
    requests[0].success({ statusCode: 200, data: envelope(identity) });
    await rejected;
    expect(values.get('education.session.logged-out')).toBe(true);
    expect(values.get('education.runtime')).toMatchObject({ accessToken: '' });
  });
  it('keeps credentials unchanged on binding-required and permits an explicit retry', async () => {
    const pending = login();
    const rejected = expect(pending).rejects.toMatchObject({ code: 'STAFF_PHONE_BINDING_REQUIRED' });
    await flush();
    requests[0].success({ statusCode: 409, data: { code: 'STAFF_PHONE_BINDING_REQUIRED' } });
    await rejected;
    expect(values.get('education.runtime')).toMatchObject({ accessToken: '' });
    const retry = login();
    await flush();
    requests[1].success({ statusCode: 200, data: envelope() });
    await retry;
  });
  it.each(['mock', 'api-test'])('does not invoke real WeChat in %s mode', async (mode) => {
    service = new WechatFormalLoginService({
      dataDriver: mode === 'mock' ? 'mock' : 'api', apiBaseUrl: 'https://example.test',
      testAccountSwitcherEnabled: mode === 'api-test', loginCodeProvider: codeProvider,
    });
    await expect(login()).rejects.toThrow('当前环境不支持');
    expect(codeProvider).not.toHaveBeenCalled();
  });
  it('rejects an empty login code without making a protected request', async () => {
    codeProvider.mockResolvedValueOnce(' ');
    await expect(login()).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
});
