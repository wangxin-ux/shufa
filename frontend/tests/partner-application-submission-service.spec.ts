import { PartnerApplicantSessionService } from '../pages/partner/runtime/partner-applicant-session.service';
import { PartnerApplicationSubmissionService } from '../pages/partner/runtime/partner-application-submission.service';
import type { SessionHttpRequestOptions } from '../services/session.service';

const id = '55883f08-c9f5-4f26-927c-82ea07cb8a02';
const receipt = () => ({ applicationId: id, submissionId: id, version: 9, status: 'SUBMITTED', submittedAt: '2026-10-13T00:00:00.000Z' });
describe('submission through actual restricted transport', () => {
  let calls: SessionHttpRequestOptions[]; let state: any;
  let sessions: PartnerApplicantSessionService; let service: PartnerApplicationSubmissionService;
  const respond = (value: unknown, statusCode = 200) => calls[calls.length - 1].success({ statusCode, data: { data: value, requestId: 'synthetic' } });
  beforeEach(() => {
    calls = []; state = { accessToken: 'formal-token', partnerApplicantSession: { token: 'applicant-token',
      expiresAt: '2099-01-01T00:00:00.000Z', me: { applicantId: id, displayName: '申请人', formalAccountReady: false } } };
    sessions = new PartnerApplicantSessionService({ apiBaseUrl: 'http://127.0.0.1:3000',
      request: (input) => { calls.push(input); }, storage: { get: () => state, set: (_key, value) => { state = value; } } });
    service = new PartnerApplicationSubmissionService(sessions);
  });
  it('posts only a version and applicant auth with a stable idempotency header', async () => {
    const pending = service.submit(8, id);
    expect(service.submit(8, id)).toBe(pending);
    await expect(service.submit(7, id)).rejects.toMatchObject({ statusCode: 409 });
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:3000/partner-applicants/me/application/submit',
      data: { expectedVersion: 8 }, header: { Authorization: 'Bearer applicant-token', 'Idempotency-Key': id } });
    respond(receipt()); expect(await pending).toEqual(receipt());
    expect(JSON.stringify(state)).not.toContain('submissionId');
  });
  it.each([{ ...receipt(), accountNumber: 'forbidden' }, { ...receipt(), status: 'APPROVED' },
    { ...receipt(), version: 8 }, { ...receipt(), submittedAt: 'invalid' }, {}])('rejects malformed or over-disclosing receipt %#', async (value) => {
    const pending = service.submit(8, id); respond(value);
    await expect(pending).rejects.toMatchObject({ statusCode: 502 });
  });
  it('allows a hidden write to resolve but rejects success after a session replacement', async () => {
    const pending = service.submit(8, id); sessions.invalidateReads(); respond(receipt());
    await expect(pending).resolves.toEqual(receipt());
    const old = service.submit(8, id); state.partnerApplicantSession.token = 'new-token'; respond(receipt());
    await expect(old).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' });
  });
  it('clears current applicant 401 while preserving formal credentials', async () => {
    const pending = service.submit(8, id); respond(null, 401);
    await expect(pending).rejects.toMatchObject({ statusCode: 401 });
    expect(state.partnerApplicantSession).toBeUndefined(); expect(state.accessToken).toBe('formal-token');
  });
  it.each([0, -1, 1.5, 2_147_483_647])('rejects unsendable version %s before transport', async (version) => {
    await expect(service.submit(version, id)).rejects.toMatchObject({ statusCode: 400 }); expect(calls).toEqual([]);
  });
});
