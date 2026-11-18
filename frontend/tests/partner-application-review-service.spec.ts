import { PartnerApplicantSessionService } from '../pages/partner/runtime/partner-applicant-session.service';
import { PartnerApplicationReviewService } from '../pages/partner/runtime/partner-application-review.service';
import { ApiPartnerApplicationReviewService, MockPartnerApplicationReviewService } from '../pages/super-admin/runtime/partner-application-review.service';
import type { SessionHttpRequestOptions } from '../services/session.service';
import { partnerApplicationAcceptanceFixture } from './fixtures/partner-application-acceptance.fixture';
const id = '55883f08-c9f5-4f26-927c-82ea07cb8a02';
const time = '2026-10-13T00:00:00.000Z';
const meta = { page: 1, pageSize: 20, total: 0, totalPages: 0 };
const history = () => ({ applicationId: id, status: 'REJECTED', version: 10, editSourceSubmissionId: null, data: [], meta });
describe('review transport and closed responses', () => {
  let calls: SessionHttpRequestOptions[]; let runtime: any;
  let sessions: PartnerApplicantSessionService; let applicant: PartnerApplicationReviewService;
  let admin: ApiPartnerApplicationReviewService; let token: string;
  let download: jest.Mock;
  const respond = (body: unknown, statusCode = 200) => calls[calls.length - 1].success({ statusCode, data: body });
  beforeEach(() => {
    calls = []; token = 'admin-token'; download = jest.fn();
    runtime = { accessToken: 'formal-token', partnerApplicantSession: { token: 'applicant-token', expiresAt: '2099-01-01T00:00:00.000Z',
      me: { applicantId: id, displayName: '申请人', formalAccountReady: false } } };
    sessions = new PartnerApplicantSessionService({ apiBaseUrl: 'http://127.0.0.1:3000', request: (input) => { calls.push(input); },
      storage: { get: () => runtime, set: (_key, value) => { runtime = value; } } });
    applicant = new PartnerApplicationReviewService(sessions);
    admin = new ApiPartnerApplicationReviewService({ baseUrl: 'http://127.0.0.1:3000', session: () => ({ key: token, token }),
      request: (input) => { calls.push(input); }, download });
  });
  it('loads only the restricted applicant own history and posts closed reopen input', async () => {
    const read = applicant.history(); expect(calls[0]).toMatchObject({ url: 'http://127.0.0.1:3000/partner-applicants/me/application/history?page=1&pageSize=20',
      header: { Authorization: 'Bearer applicant-token' } });
    respond({ data: history(), requestId: 'synthetic' }); expect(await read).toEqual(history());
    const write = applicant.reopen(id, 10, id);
    expect(calls[1]).toMatchObject({ method: 'POST', data: { submissionId: id, expectedVersion: 10 },
      header: { Authorization: 'Bearer applicant-token', 'Idempotency-Key': id } });
    respond({ data: { applicationId: id, sourceSubmissionId: id, version: 11, status: 'DRAFT' }, requestId: 'synthetic' });
    await expect(write).resolves.toMatchObject({ version: 11 });
    expect(runtime.accessToken).toBe('formal-token'); expect(JSON.stringify(runtime)).not.toContain('sourceSubmissionId');
  });
  it.each([{ ...history(), bankInformation: {} }, { ...history(), data: [{ accountNumber: 'private' }] },
    { ...history(), meta: { ...meta, page: 2 } }])('rejects malformed or over-disclosing own history %#', async (value) => {
    const read = applicant.history(); respond({ data: value, requestId: 'synthetic' });
    await expect(read).rejects.toMatchObject({ statusCode: 502 });
  });
  it('rejects stale history after read invalidation and keeps the formal credential on 401', async () => {
    const read = applicant.history(); sessions.invalidateReads(); respond({ data: history(), requestId: 'synthetic' });
    await expect(read).rejects.toMatchObject({ code: 'READ_SUPERSEDED' });
    const denied = applicant.history(); respond({ code: 'UNAUTHORIZED' }, 401);
    await expect(denied).rejects.toMatchObject({ statusCode: 401 });
    expect(runtime.partnerApplicantSession).toBeUndefined(); expect(runtime.accessToken).toBe('formal-token');
  });
  it('uses formal bearer auth and the actual flat paginated envelope for review list', async () => {
    const read = admin.list(1, 'SUBMITTED', '合成 机构');
    expect(calls[0].header.Authorization).toBe('Bearer admin-token');
    expect(calls[0].url).toContain('query=%E5%90%88%E6%88%90%20%E6%9C%BA%E6%9E%84');
    respond({ data: [], meta, requestId: 'synthetic' }); await expect(read).resolves.toMatchObject({ data: [], meta });
  });
  it('validates the shared long-field fixture through actual review list, detail and bank parsers', async () => {
    const fixture = partnerApplicationAcceptanceFixture('SUBMITTED');
    const list = admin.list(1, 'SUBMITTED', '');
    respond({ data: [fixture.summary], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 }, requestId: 'synthetic' });
    expect((await list).data[0]).toEqual(fixture.summary);
    const detail = admin.detail(fixture.detail.applicationId, fixture.detail.submissionId);
    respond({ data: fixture.detail, requestId: 'synthetic' });
    expect((await detail).materials).toHaveLength(14);
    const bank = admin.bank(fixture.detail.applicationId, fixture.detail.submissionId);
    respond({ data: {
      applicationId: fixture.detail.applicationId, submissionId: fixture.detail.submissionId,
      bankInformation: fixture.bank.bankInformation,
    }, requestId: 'synthetic' });
    expect((await bank).bankInformation.accountNumber).toBe('0'.repeat(80));
  });
  it.each([
    { data: [{ applicationId: id, bankInformation: { accountNumber: 'private' } }], meta, requestId: 'synthetic' },
    { data: [], meta: { ...meta, pageSize: 100 }, requestId: 'synthetic' },
    { data: [], meta, requestId: 'synthetic', privateUrl: 'forbidden' },
  ])('rejects over-disclosing or malformed review lists %#', async (value) => {
    const read = admin.list(1, 'SUBMITTED', ''); respond(value);
    await expect(read).rejects.toMatchObject({ statusCode: 502 });
  });
  it('reads only frozen snapshot bank with authorization and validates exact fields', async () => {
    const read = admin.bank(id, id);
    expect(calls[0].url).toBe(`http://127.0.0.1:3000/management/partner-applications/${id}/submissions/${id}/bank-information`);
    respond({ data: { applicationId: id, submissionId: id, bankInformation: { bankName: '合成银行', accountHolder: '合成账户', accountNumber: '0000001' } }, requestId: 'synthetic' });
    await expect(read).resolves.toMatchObject({ bankInformation: { accountNumber: '0000001' } });
    const invalid = admin.bank(id, id); respond({ data: { applicationId: id, submissionId: id, bankInformation: { accountNumber: 1 } }, requestId: 'synthetic' });
    await expect(invalid).rejects.toMatchObject({ statusCode: 502 });
  });
  it('downloads private bytes through authorized native transport and invalidates hidden reads', async () => {
    const image = admin.image(id, id, id);
    expect(download.mock.calls[0][0].header).toEqual({ Authorization: 'Bearer admin-token' });
    admin.invalidateReads(); download.mock.calls[0][0].success({ statusCode: 200, tempFilePath: '/synthetic.png' });
    await expect(image).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' });
  });
  it('prevents stale admin success after session replacement', async () => {
    const read = admin.bank(id, id); token = 'new-token';
    respond({ data: {}, requestId: 'synthetic' });
    await expect(read).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' });
  });
  it('sends a stable rejection version/reason/key and validates the minimal receipt', async () => {
    const write = admin.reject(id, id, 9, ' 请补交 ', id);
    expect(calls[0]).toMatchObject({ method: 'POST', data: { expectedVersion: 9, reason: '请补交' },
      header: { 'Idempotency-Key': id } });
    admin.invalidateReads();
    respond({ data: { applicationId: id, submissionId: id, reviewId: id, version: 10, status: 'REJECTED', reviewedAt: time }, requestId: 'synthetic' });
    await expect(write).resolves.toMatchObject({ version: 10 });
  });
  it.each([400, 401, 403, 409, 503])('preserves real HTTP error status %s', async (status) => {
    const write = admin.reject(id, id, 9, '请补交', id);
    respond({ code: 'synthetic' }, status); await expect(write).rejects.toMatchObject({ statusCode: status });
  });
  it('approves with a closed version/key and validates the original user and campus receipt', async () => {
    const write = (admin as any).approve(id, id, 9, id);
    expect(calls[0]).toMatchObject({ method: 'POST', url: `http://127.0.0.1:3000/management/partner-applications/${id}/submissions/${id}/approve`,
      data: { expectedVersion: 9 }, header: { Authorization: 'Bearer admin-token', 'Idempotency-Key': id } });
    admin.invalidateReads();
    respond({ data: { applicationId: id, submissionId: id, reviewId: id, userId: id, campusId: id,
      status: 'APPROVED', version: 10, reviewedAt: time }, requestId: 'synthetic' });
    await expect(write).resolves.toMatchObject({ userId: id, campusId: id, version: 10 });
  });
  it.each([{ userId: 'invalid' }, { campusId: null }, { bankInformation: {} }, { status: 'REJECTED' }, { version: 11 }])(
    'rejects an invalid approval receipt %#', async (patch) => {
      const write = (admin as any).approve(id, id, 9, id);
      respond({ data: { applicationId: id, submissionId: id, reviewId: id, userId: id, campusId: id,
        status: 'APPROVED', version: 10, reviewedAt: time, ...patch }, requestId: 'synthetic' });
      await expect(write).rejects.toMatchObject({ statusCode: 502 });
    });
  it('never invents successful approval in the mock review runtime', async () => {
    await expect(new MockPartnerApplicationReviewService(() => 'mock-review').approve()).rejects.toMatchObject({ statusCode: 404 });
  });
});
