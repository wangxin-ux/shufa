import { LOCAL_RUNTIME_STORAGE_KEY } from '../config/local-runtime';
import { PartnerApplicantSessionService } from '../pages/partner/runtime/partner-applicant-session.service';
import { PartnerApplicationBankService } from '../pages/partner/runtime/partner-application-bank.service';
import type { SessionHttpRequestOptions } from '../services/session.service';

const applicationId = '55883f08-c9f5-4f26-927c-82ea07cb8a02';
const bankRecordId = 'a4b42383-8bd1-4f06-bf3c-a4e9c7426162';
const bank = { bankName: '合成开户行', accountHolder: '合成户名', accountNumber: '00000000000000000001' };
const view = () => ({ applicationId, status: 'DRAFT', version: 1, readonly: false, bankInformation: { ...bank } });
const receipt = { applicationId, version: 2, bankRecordId };
const credentials = (token = 'synthetic-applicant') => ({
  token, expiresAt: new Date(Date.now() + 900_000).toISOString(),
  me: { applicantId: applicationId, displayName: '申请人', formalAccountReady: false },
});
describe('private bank service with the actual applicant transport', () => {
  let runtime: Record<string, unknown>;
  let calls: SessionHttpRequestOptions[];
  let sessions: PartnerApplicantSessionService;
  let banks: PartnerApplicationBankService;
  const success = (index: number, data: unknown) => calls[index].success({
    statusCode: 200, data: { data, requestId: 'synthetic-bank' },
  });
  const deny = (index: number) => calls[index].success({
    statusCode: 401, data: { code: 'UNAUTHORIZED' },
  });
  beforeEach(() => {
    runtime = { accessToken: 'formal-token', partnerApplicantSession: credentials() };
    calls = [];
    sessions = new PartnerApplicantSessionService({
      apiBaseUrl: 'http://127.0.0.1:3000',
      storage: {
        get: (key) => key === LOCAL_RUNTIME_STORAGE_KEY ? runtime : undefined,
        set: (_key, data) => { runtime = data as Record<string, unknown>; },
      },
      request: (options) => { calls.push(options); },
    });
    banks = new PartnerApplicationBankService(sessions);
  });
  it('uses only the bank route and applicant credential, deduplicates reads and never persists plaintext', async () => {
    const pending = banks.load();
    expect(banks.load()).toBe(pending);
    expect(calls[0]).toMatchObject({
      method: 'GET', url: 'http://127.0.0.1:3000/partner-applicants/me/application/bank-information',
      header: { Authorization: 'Bearer synthetic-applicant' },
    });
    success(0, view());
    expect(await pending).toEqual(view());
    expect(JSON.stringify(runtime)).not.toContain(bank.accountNumber);
    expect(runtime.accessToken).toBe('formal-token');
  });
  it('snapshots and trims text, clears omitted fields and returns a minimal receipt', async () => {
    const input = { accountNumber: ` ${bank.accountNumber} ` };
    const pending = banks.save(1, input);
    input.accountNumber = 'changed';
    expect(calls[0]).toMatchObject({
      method: 'PUT', data: { expectedVersion: 1, bankInformation: {
        bankName: null, accountHolder: null, accountNumber: bank.accountNumber,
      } },
    });
    success(0, receipt);
    expect(await pending).toEqual(receipt);
    expect(JSON.stringify(runtime)).not.toContain(bank.accountNumber);
  });
  it('coalesces identical writes and blocks a different pending write', async () => {
    const pending = banks.save(1, bank);
    expect(banks.save(1, bank)).toBe(pending);
    await expect(banks.save(1, {})).rejects.toMatchObject({ code: 'SAVE_IN_PROGRESS' });
    success(0, receipt);
    await pending;
  });
  it.each([{}, { ...view(), extra: true }, { ...view(), bankInformation: { ...bank, fileId: 'wrong' } },
    { ...view(), bankInformation: { ...bank, accountNumber: 1 } },
    { ...view(), applicationId: null }, { ...view(), status: 'SUBMITTED', readonly: false },
  ])('strictly rejects invalid private responses %#', async (data) => {
    const pending = banks.load();
    success(0, data);
    await expect(pending).rejects.toMatchObject({ statusCode: 502 });
  });
  it.each([-1, 2_147_483_648, 1.5])('rejects invalid version %s before issuing a write', async (version) => {
    await expect(banks.save(version, bank)).rejects.toMatchObject({ statusCode: 400 });
    expect(calls).toHaveLength(0);
  });
  it.each([{ accountNumber: 123 }, { accountNumber: '0'.repeat(81) }, { ownerUserId: applicationId }])(
    'rejects invalid bank input %# before transport', async (input) => {
      await expect(banks.save(0, input as never)).rejects.toMatchObject({ statusCode: 400 });
      expect(calls).toHaveLength(0);
    },
  );
  it('invalidates a hidden read and keeps its late 401 from clearing current credentials', async () => {
    const old = banks.load();
    sessions.invalidateReads();
    const next = banks.load();
    deny(0);
    await expect(old).rejects.toMatchObject({ statusCode: 401 });
    expect(sessions.getToken()).toBe('synthetic-applicant');
    success(1, view());
    expect(await next).toEqual(view());
  });
  it('does not clear new credentials or deliver old plaintext on a replaced session', async () => {
    const old = banks.save(1, bank);
    runtime.partnerApplicantSession = credentials('next-applicant');
    const next = banks.save(1, {});
    deny(0);
    await expect(old).rejects.toMatchObject({ statusCode: 401 });
    expect(sessions.getToken()).toBe('next-applicant');
    success(1, receipt);
    await next;
    const reading = banks.load();
    runtime.partnerApplicantSession = credentials('third-applicant');
    success(2, view());
    await expect(reading).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' });
  });
  it('clears only current applicant credentials on current 401', async () => {
    const pending = banks.load();
    deny(0);
    await expect(pending).rejects.toMatchObject({ statusCode: 401 });
    expect(runtime.partnerApplicantSession).toBeUndefined();
    expect(runtime.accessToken).toBe('formal-token');
  });
  it('rejects save receipts carrying a plaintext copy', async () => {
    const pending = banks.save(1, bank);
    success(0, { ...receipt, bankInformation: bank });
    await expect(pending).rejects.toMatchObject({ statusCode: 502 });
  });
});
