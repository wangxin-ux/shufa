import { LOCAL_RUNTIME_STORAGE_KEY } from '../config/local-runtime';
import { PartnerApplicantSessionService } from '../pages/partner/runtime/partner-applicant-session.service';
import type { SessionHttpRequestOptions } from '../services/session.service';
import { SessionService } from '../services/session.service';

const now = Date.parse('2026-10-09T08:00:00Z');
const identity = {
  applicantId: '03f20536-7c49-4eb0-bc68-f66ce27a735a',
  displayName: '入驻申请人', formalAccountReady: false,
};
const credentials = (token = 'applicant-token') => ({
  token, expiresAt: new Date(now + 900_000).toISOString(), me: { ...identity },
});

describe('separate partner applicant session', () => {
  let runtime: Record<string, unknown>;
  let calls: SessionHttpRequestOptions[];
  let service: PartnerApplicantSessionService;
  let loginCode: jest.Mock;
  const success = (index: number, data: unknown, statusCode = 200) =>
    calls[index].success({ statusCode, data: { data, requestId: 'request-id' } });
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    runtime = { accessToken: 'formal-token', apiBaseUrl: 'http://127.0.0.1:3000', marker: 'preserved' };
    calls = [];
    loginCode = jest.fn().mockResolvedValue('trusted-code');
    service = new PartnerApplicantSessionService({
      apiBaseUrl: 'http://127.0.0.1:3000/',
      storage: {
        get: (key) => key === LOCAL_RUNTIME_STORAGE_KEY ? runtime : undefined,
        set: (key, value) => {
          expect(key).toBe(LOCAL_RUNTIME_STORAGE_KEY);
          runtime = value as Record<string, unknown>;
        },
      },
      request: (options) => { calls.push(options); },
      loginCodeProvider: loginCode, now: () => now,
    });
  });

  it('uses only a trusted code and persists credentials separately', async () => {
    const pending = service.login();
    await flush();
    expect(calls[0]).toMatchObject({
      method: 'POST', url: 'http://127.0.0.1:3000/partner-applicants/auth/wechat',
      data: { code: 'trusted-code' },
    });
    expect(calls[0].header.Authorization).toBeUndefined();
    success(0, credentials());
    expect(await pending).toEqual(identity);
    expect(runtime).toMatchObject({
      accessToken: 'formal-token', marker: 'preserved', partnerApplicantSession: credentials(),
    });
  });

  it('deduplicates concurrent login and clears the lock on failure', async () => {
    const first = service.login();
    expect(service.login()).toBe(first);
    await flush();
    calls[0].fail(new Error('offline'));
    await expect(first).rejects.toThrow();
    const retry = service.login();
    await flush();
    success(1, credentials());
    await retry;
    expect(loginCode).toHaveBeenCalledTimes(2);
  });

  it('loads only applicant me with the isolated bearer token', async () => {
    runtime.partnerApplicantSession = credentials();
    const first = service.loadMe();
    expect(service.loadMe()).toBe(first);
    expect(calls[0]).toMatchObject({
      method: 'GET', url: 'http://127.0.0.1:3000/partner-applicants/me',
      header: { Authorization: 'Bearer applicant-token' },
    });
    success(0, { ...identity, formalAccountReady: true });
    expect((await first).formalAccountReady).toBe(true);
    expect(runtime.accessToken).toBe('formal-token');
  });

  it('clears only applicant credentials on matching 401', async () => {
    runtime.partnerApplicantSession = credentials();
    const pending = service.loadMe();
    success(0, null, 401);
    await expect(pending).rejects.toMatchObject({ statusCode: 401 });
    expect(runtime.partnerApplicantSession).toBeUndefined();
    expect(runtime.accessToken).toBe('formal-token');
  });

  it('does not discard another session on stale 401', async () => {
    runtime.partnerApplicantSession = credentials();
    const pending = service.loadMe();
    runtime.partnerApplicantSession = credentials('new-token');
    success(0, null, 401);
    await expect(pending).rejects.toThrow();
    expect(service.getToken()).toBe('new-token');
  });

  it('rejects a stale successful identity without overwriting a new session', async () => {
    runtime.partnerApplicantSession = credentials();
    const pending = service.loadMe();
    runtime.partnerApplicantSession = credentials('new-token');
    success(0, { ...identity, displayName: 'old-response' });
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' });
    expect((runtime.partnerApplicantSession as ReturnType<typeof credentials>).me).toEqual(identity);
  });

  it('expires applicant credentials without changing formal login', async () => {
    runtime.partnerApplicantSession = { ...credentials(), expiresAt: new Date(now).toISOString() };
    expect(service.getToken()).toBe('');
    expect(runtime.partnerApplicantSession).toBeUndefined();
    expect(runtime.accessToken).toBe('formal-token');
    await expect(service.loadMe()).rejects.toMatchObject({ statusCode: 401 });
    expect(calls).toHaveLength(0);
  });

  it('locally exits before server revocation and keeps formal credentials', async () => {
    runtime.partnerApplicantSession = credentials();
    const pending = service.logout();
    expect(service.getToken()).toBe('');
    expect(runtime.accessToken).toBe('formal-token');
    expect(calls[0]).toMatchObject({
      url: 'http://127.0.0.1:3000/partner-applicants/auth/logout',
      header: { Authorization: 'Bearer applicant-token' },
    });
    success(0, { revoked: true });
    await pending;
  });

  it('keeps a new login when an older logout response arrives', async () => {
    runtime.partnerApplicantSession = credentials();
    const logout = service.logout();
    const login = service.login();
    await flush();
    success(1, credentials('new-token'));
    await login;
    success(0, { revoked: true });
    await logout;
    expect(service.getToken()).toBe('new-token');
  });

  it('does not resurrect a login response after local logout', async () => {
    const login = service.login();
    await flush();
    await service.logout();
    success(0, credentials());
    await expect(login).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' });
    expect(service.getToken()).toBe('');
  });

  it('does not send a login after an obsolete code exchange finishes', async () => {
    let resolveCode!: (code: string) => void;
    loginCode.mockReturnValue(new Promise<string>((resolve) => { resolveCode = resolve; }));
    const pending = service.login();
    await service.logout();
    resolveCode('old-code');
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' });
    expect(calls).toHaveLength(0);
  });

  it('keeps local logout after network revocation fails', async () => {
    runtime.partnerApplicantSession = credentials();
    const pending = service.logout();
    calls[0].fail(new Error('offline'));
    await expect(pending).rejects.toThrow();
    expect(service.getToken()).toBe('');
    expect(runtime.accessToken).toBe('formal-token');
  });

  it.each([
    { ...credentials(), token: '' },
    { ...credentials(), expiresAt: 'invalid' },
    { ...credentials(), expiresAt: new Date(now - 1).toISOString() },
    { ...credentials(), me: { ...identity, formalAccountReady: 'true' } },
  ])('rejects malformed or expired credentials %#', async (value) => {
    const pending = service.login();
    await flush();
    success(0, value);
    await expect(pending).rejects.toThrow();
    expect(runtime.partnerApplicantSession).toBeUndefined();
    expect(runtime.accessToken).toBe('formal-token');
  });

  it('does not send formal credentials when no applicant session exists', async () => {
    await service.logout();
    expect(service.getToken()).toBe('');
    expect(calls).toHaveLength(0);
    expect(runtime.accessToken).toBe('formal-token');
  });

  it('leaves credentials intact after transient me failure', async () => {
    runtime.partnerApplicantSession = credentials();
    const pending = service.loadMe();
    calls[0].fail(new Error('offline'));
    await expect(pending).rejects.toThrow();
    expect(service.getToken()).toBe('applicant-token');
  });

  it('keeps the applicant session separate during fresh formal login and formal logout', async () => {
    runtime.partnerApplicantSession = credentials();
    const formal = new SessionService({
      dataDriver: 'api', apiBaseUrl: 'http://127.0.0.1:3000', accessToken: '',
      loginCodeProvider: loginCode,
      storage: {
        get: (key) => key === LOCAL_RUNTIME_STORAGE_KEY ? runtime : undefined,
        set: (key, value) => {
          if (key === LOCAL_RUNTIME_STORAGE_KEY) runtime = value as Record<string, unknown>;
        },
      },
      request: (options) => { calls.push(options); },
    });
    const pending = formal.load();
    await flush();
    expect(calls[0].url).toBe('http://127.0.0.1:3000/auth/wechat/login');
    success(0, {
      accessToken: 'fresh-formal-token',
      me: {
        userId: 'formal-user', displayName: '正式合作方',
        roles: [{ code: 'PARTNER', campusId: 'campus-one' }],
      },
    });
    expect((await pending)?.roles).toEqual([{ code: 'PARTNER', campusId: 'campus-one' }]);
    expect(runtime.accessToken).toBe('fresh-formal-token');
    expect(service.getToken()).toBe('applicant-token');
    formal.logout();
    expect(runtime.accessToken).toBe('');
    expect(service.getToken()).toBe('applicant-token');
  });
});
