import { LOCAL_RUNTIME_STORAGE_KEY } from '../config/local-runtime';
import { PartnerApplicantSessionService } from '../pages/partner/runtime/partner-applicant-session.service';
import { PartnerApplicationService } from '../pages/partner/runtime/partner-application.service';
import type { SessionHttpRequestOptions } from '../services/session.service';

const applicantId = '03f20536-7c49-4eb0-bc68-f66ce27a735a';
const applicationId = '55883f08-c9f5-4f26-927c-82ea07cb8a02';
const credentials = (token = 'applicant-token') => ({
  token, expiresAt: new Date(Date.now() + 900_000).toISOString(),
  me: { applicantId, displayName: '入驻申请人', formalAccountReady: false },
});
const draft = (version = 1) => ({
  applicationId, status: 'DRAFT', version,
  basicInformation: { institutionName: '合成机构', province: null, city: null, district: null, detailedAddress: null, contactPhone: null },
  createdAt: '2026-10-09T08:00:00.000Z', updatedAt: '2026-10-09T08:00:00.000Z',
});

describe('partner application basics client with restricted applicant transport', () => {
  let runtime: Record<string, unknown>;
  let calls: SessionHttpRequestOptions[];
  let sessions: PartnerApplicantSessionService;
  let applications: PartnerApplicationService;
  const success = (index: number, value: unknown) =>
    calls[index].success({ statusCode: 200, data: { data: value, requestId: 'synthetic-request' } });

  beforeEach(() => {
    runtime = { accessToken: 'formal-token', partnerApplicantSession: credentials() };
    calls = [];
    sessions = new PartnerApplicantSessionService({
      apiBaseUrl: 'http://127.0.0.1:3000',
      storage: {
        get: (key) => key === LOCAL_RUNTIME_STORAGE_KEY ? runtime : undefined,
        set: (_key, value) => { runtime = value as Record<string, unknown>; },
      },
      request: (options) => { calls.push(options); },
    });
    applications = new PartnerApplicationService(sessions);
  });

  it('loads null or the owned draft using only restricted credentials', async () => {
    const pending = applications.load();
    expect(calls[0]).toMatchObject({
      method: 'GET', url: 'http://127.0.0.1:3000/partner-applicants/me/application',
      header: { Authorization: 'Bearer applicant-token' },
    });
    success(0, null);
    expect(await pending).toBeNull();
    const reload = applications.load();
    success(1, draft());
    expect(await reload).toEqual(draft());
    expect(runtime.accessToken).toBe('formal-token');
  });

  it('coalesces repeated load for the same current session', async () => {
    const first = applications.load();
    expect(applications.load()).toBe(first);
    success(0, draft());
    await first;
    expect(calls).toHaveLength(1);
  });

  it('saves a normalized versioned basic section without persisting a local draft', async () => {
    const pending = applications.saveBasics(0, { institutionName: ' 合成机构 ' });
    expect(calls[0]).toMatchObject({
      method: 'PUT', url: 'http://127.0.0.1:3000/partner-applicants/me/application/basic-information',
      header: { Authorization: 'Bearer applicant-token' },
      data: { expectedVersion: 0, basicInformation: {
        institutionName: '合成机构', province: null, city: null, district: null, detailedAddress: null,
      } },
    });
    success(0, draft());
    expect(await pending).toEqual(draft());
    expect(Object.keys(runtime).sort()).toEqual(['accessToken', 'partnerApplicantSession']);
  });

  it('coalesces identical pending saves and rejects competing local saves', async () => {
    const first = applications.saveBasics(0, { institutionName: '合成机构' });
    expect(applications.saveBasics(0, { institutionName: ' 合成机构 ' })).toBe(first);
    await expect(applications.saveBasics(0, { institutionName: '另一合成机构' }))
      .rejects.toMatchObject({ code: 'SAVE_IN_PROGRESS' });
    success(0, draft());
    await first;
    expect(calls).toHaveLength(1);
  });

  it('sends a contact as trimmed text without storing it or changing formal credentials', async () => {
    const phone = '0000-00000000';
    const pending = applications.saveBasics(0, { contactPhone: ` ${phone} ` } as never).catch((error: unknown) => error);
    expect(calls[0].data).toMatchObject({ basicInformation: { contactPhone: phone } });
    const response = { ...draft(), basicInformation: { ...draft().basicInformation, contactPhone: phone } };
    success(0, response);
    expect(await pending).toEqual(response);
    expect(JSON.stringify(runtime)).not.toContain(phone);
    expect(runtime.accessToken).toBe('formal-token');
  });

  it.each([null, ''])('explicitly sends a cleared contact %s', async (contactPhone) => {
    const pending = applications.saveBasics(0, { contactPhone } as never).catch((error: unknown) => error);
    expect(calls[0].data).toMatchObject({ basicInformation: { contactPhone: null } });
    success(0, draft());
    await pending;
  });

  it('accepts an exact 30 character contact in the request and response', async () => {
    const contactPhone = '0000-00000000-0000000000000000';
    expect(contactPhone).toHaveLength(30);
    const pending = applications.saveBasics(0, { contactPhone });
    expect(calls[0].data).toMatchObject({ basicInformation: { contactPhone } });
    const response = {
      ...draft(), basicInformation: { ...draft().basicInformation, contactPhone },
    };
    success(0, response);
    expect(await pending).toEqual(response);
  });

  it('normalizes an older response with no contact to null without relaxing other field checks', async () => {
    const pending = applications.load();
    const { contactPhone: _phone, ...older } = draft().basicInformation;
    success(0, { ...draft(), basicInformation: older });
    expect(await pending).toEqual(draft());
  });

  it('keeps concurrent saves and their locks independent across sessions', async () => {
    const old = applications.saveBasics(0, { institutionName: '合成机构' });
    runtime.partnerApplicantSession = credentials('new-applicant-token');
    const next = applications.saveBasics(0, { institutionName: '新机构' });
    success(0, draft());
    await expect(old).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' });
    expect(applications.saveBasics(0, { institutionName: '新机构' })).toBe(next);
    await expect(applications.saveBasics(1, { institutionName: '新机构' }))
      .rejects.toMatchObject({ code: 'SAVE_IN_PROGRESS' });
    success(1, { ...draft(), basicInformation: { ...draft().basicInformation, institutionName: '新机构' } });
    await next;
    expect(calls).toHaveLength(2);
  });

  it('snapshots input and deliberately clears omitted, blank and null basic fields', async () => {
    const input = { institutionName: ' 合成机构 ', province: ' ', city: null, district: ' 合成区 ' };
    const pending = applications.saveBasics(0, input);
    input.institutionName = '后续修改';
    expect(calls[0].data).toEqual({
      expectedVersion: 0,
      basicInformation: {
        institutionName: '合成机构', province: null, city: null,
        district: '合成区', detailedAddress: null,
      },
    });
    success(0, draft());
    await pending;
  });

  it('releases save lock on version conflict and allows an explicit retry with the same input', async () => {
    const first = applications.saveBasics(1, { institutionName: '合成机构' });
    calls[0].success({ statusCode: 409, data: { error: { code: 'CONFLICT', message: '草稿已更新' } } });
    await expect(first).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    const retry = applications.saveBasics(2, { institutionName: '合成机构' });
    success(1, draft(3));
    expect((await retry).version).toBe(3);
  });

  it('clears only matching applicant credentials on 401', async () => {
    const pending = applications.load();
    calls[0].success({ statusCode: 401, data: { error: { code: 'UNAUTHORIZED' } } });
    await expect(pending).rejects.toMatchObject({ statusCode: 401 });
    expect(runtime.partnerApplicantSession).toBeUndefined();
    expect(runtime.accessToken).toBe('formal-token');
  });

  it('preserves the actual top-level conflict code and allows retry', async () => {
    const pending = applications.saveBasics(1, {});
    calls[0].success({ statusCode: 409, data: { code: 'CONFLICT', message: '草稿已更新', requestId: 'synthetic' } });
    await expect(pending).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect(sessions.getToken()).toBe('applicant-token');
    const retry = applications.saveBasics(2, {});
    success(1, draft(3));
    await retry;
  });

  it('clears only applicant credentials on a rejected save without retrying the write', async () => {
    const pending = applications.saveBasics(0, {});
    calls[0].success({ statusCode: 401, data: { code: 'UNAUTHORIZED' } });
    await expect(pending).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
    expect(runtime.partnerApplicantSession).toBeUndefined();
    expect(runtime.accessToken).toBe('formal-token');
    expect(calls).toHaveLength(1);
  });

  it('does not clear a new session when an older protected request returns 401', async () => {
    const pending = applications.load();
    runtime.partnerApplicantSession = credentials('new-applicant-token');
    calls[0].success({ statusCode: 401, data: { error: { code: 'UNAUTHORIZED' } } });
    await expect(pending).rejects.toThrow();
    expect(sessions.getToken()).toBe('new-applicant-token');
  });

  it('keeps a new save and credentials when an older save returns 401', async () => {
    const old = applications.saveBasics(0, {});
    runtime.partnerApplicantSession = credentials('new-applicant-token');
    const next = applications.saveBasics(0, { institutionName: '新机构' });
    calls[0].success({ statusCode: 401, data: { code: 'UNAUTHORIZED' } });
    await expect(old).rejects.toMatchObject({ statusCode: 401 });
    expect(sessions.getToken()).toBe('new-applicant-token');
    expect(applications.saveBasics(0, { institutionName: '新机构' })).toBe(next);
    success(1, draft());
    await next;
  });

  it('invalidates old reads after local logout even if the same token is restored', async () => {
    const old = applications.load();
    const logout = sessions.logout();
    runtime.partnerApplicantSession = credentials();
    const next = applications.load();
    expect(next).not.toBe(old);
    success(2, null);
    expect(await next).toBeNull();
    success(0, draft());
    await expect(old).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' });
    success(1, { revoked: true });
    await logout;
  });

  it('rejects stale successful save and can independently read a new identity', async () => {
    const old = applications.saveBasics(0, { institutionName: '合成机构' });
    runtime.partnerApplicantSession = credentials('new-applicant-token');
    const next = applications.load();
    success(1, null);
    expect(await next).toBeNull();
    success(0, draft());
    await expect(old).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' });
  });

  it('does not reuse an older identity pending read for a new session', async () => {
    const first = applications.load();
    runtime.partnerApplicantSession = credentials('new-applicant-token');
    const next = applications.load();
    expect(next).not.toBe(first);
    success(1, null);
    expect(await next).toBeNull();
    success(0, draft());
    await expect(first).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' });
  });

  it('does not substitute a formal token when the applicant token is absent', async () => {
    delete runtime.partnerApplicantSession;
    await expect(applications.load()).rejects.toMatchObject({ statusCode: 401 });
    await expect(applications.saveBasics(0, {})).rejects.toMatchObject({ statusCode: 401 });
    expect(calls).toHaveLength(0);
  });

  it.each([
    { institutionName: 'X'.repeat(201) }, { detailedAddress: 'X'.repeat(301) },
    { bankAccount: 'synthetic' }, { contactPhone: '0'.repeat(31) }, { contactPhone: 1 }, { institutionName: 1 },
    { province: 'X'.repeat(101) }, { city: 'X'.repeat(101) }, { district: 'X'.repeat(101) },
    null, [], new Date(), { institutionName: {} },
  ])('rejects unsupported or malformed input before sending %#', async (value) => {
    await expect(applications.saveBasics(0, value as never)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it.each([-1, 1.5, 2_147_483_648])('rejects invalid expected version %s', async (version) => {
    await expect(applications.saveBasics(version, {})).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it.each([
    { ...draft(), version: 0 }, { ...draft(), applicationId: 'not-a-uuid' },
    { ...draft(), status: 'PUBLISHED' }, { ...draft(), updatedAt: 'not-a-date' },
    { ...draft(), basicInformation: { ...draft().basicInformation, bankAccount: 'synthetic' } },
    { ...draft(), basicInformation: { ...draft().basicInformation, institutionName: 'X'.repeat(201) } },
    { ...draft(), applicantId }, { ...draft(), version: 2_147_483_648 },
    { ...draft(), createdAt: '2026-02-30T08:00:00Z' },
    { ...draft(), basicInformation: { institutionName: null } },
    { ...draft(), basicInformation: { ...draft().basicInformation, city: 1 } },
    { ...draft(), basicInformation: { ...draft().basicInformation, contactPhone: 1 } },
    { ...draft(), basicInformation: { ...draft().basicInformation, contactPhone: '0'.repeat(31) } },
  ])('rejects a malformed server draft %#', async (value) => {
    const pending = applications.load();
    success(0, value);
    await expect(pending).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('does not accept null as a successful save response', async () => {
    const pending = applications.saveBasics(0, {});
    success(0, null);
    await expect(pending).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([
    { data: draft() },
    { data: draft(), requestId: 1 },
    { data: draft(), requestId: 'synthetic', bankAccount: 'synthetic' },
  ])('rejects a malformed success envelope %#', async (value) => {
    const pending = applications.load();
    calls[0].success({ statusCode: 200, data: value });
    await expect(pending).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each(['SUBMITTED', 'REJECTED', 'APPROVED'])('can read a future non-draft state %s', async (status) => {
    const pending = applications.load();
    success(0, { ...draft(), status });
    expect((await pending)?.status).toBe(status);
  });

  it('keeps credentials after network failure and permits retry', async () => {
    const pending = applications.load();
    calls[0].fail(new Error('synthetic offline'));
    await expect(pending).rejects.toThrow();
    expect(sessions.getToken()).toBe('applicant-token');
    const retry = applications.load();
    success(1, draft());
    await retry;
  });

  it('releases a failed save without automatic retry or local draft storage', async () => {
    const pending = applications.saveBasics(0, { institutionName: '合成机构' });
    calls[0].fail(new Error('synthetic offline'));
    await expect(pending).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(calls).toHaveLength(1);
    expect(Object.keys(runtime).sort()).toEqual(['accessToken', 'partnerApplicantSession']);
    const retry = applications.saveBasics(0, { institutionName: '合成机构' });
    success(1, draft());
    await retry;
  });
});
