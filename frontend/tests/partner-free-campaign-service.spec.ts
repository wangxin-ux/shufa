import { PartnerFreeCampaignService, normalizeFreeSettings } from '../pages/partner/runtime/free-campaign.service';
import { PartnerCampaignDraftService } from '../pages/partner/runtime/partner-campaign-draft.service';
import type { SessionHttpRequest } from '../services/session.service';
const id = '00000000-0000-4000-8000-000000000001';
const settings = { startsAt: '2099-10-13T08:00:00+08:00', endsAt: '2099-10-14T08:00:00+08:00', capacityMode: 'LIMITED' as const, maxRegistrations: 2 };
const config = { draftId: id, version: 1, campusTimezone: 'America/New_York', freeRegistration: { ...settings, startsAt: '2099-10-13T00:00:00.000Z', endsAt: '2099-10-14T00:00:00.000Z' }, campaignId: null, publishedVersionId: null, publishedVersion: null, publishedShareImage: null, campaignVersion: null, lifecycle: null };
const envelope = (data: unknown) => ({ requestId: 'synthetic-request', data });
describe('partner free campaign local service', () => {
  const make = (request: SessionHttpRequest, accessToken = () => 'synthetic') => new PartnerFreeCampaignService({
    dataDriver: 'api', apiBaseUrl: 'http://synthetic.invalid', accessToken, request,
  });
  it('uses the frozen paths, explicit version and settings without campus or payment fields', async () => {
    const request = jest.fn((options) => options.success({ statusCode: 200, data: envelope({
      draftId: id, status: 'DRAFT', version: 2, createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z',
    }) }));
    await make(request).saveConfiguration(id, 1, settings);
    expect(request.mock.calls[0][0]).toMatchObject({ url: `http://synthetic.invalid/partners/me/campaign-drafts/${id}/free-registration`,
      method: 'PUT', data: { expectedVersion: 1, freeRegistration: config.freeRegistration } });
  });
  it.each(['2099-02-30T00:00:00Z', '2099-10-13T00:00:00', '2099-10-13T24:00:00Z', '2099-10-13T00:00:00+24:00'])('rejects invalid explicit instant %s', (startsAt) => {
    expect(() => normalizeFreeSettings({ ...settings, startsAt })).toThrow();
  });
  it.each([0, -1, 1.1, 2147483648, '2'])('rejects invalid finite capacity %s', (maxRegistrations) => {
    expect(() => normalizeFreeSettings({ ...settings, maxRegistrations } as any)).toThrow();
  });
  it('does not invent missing dates or unlimited capacity and rejects unknown fields', () => {
    expect(normalizeFreeSettings({ startsAt: null, endsAt: null, capacityMode: null, maxRegistrations: null })).toEqual({
      startsAt: null, endsAt: null, capacityMode: null, maxRegistrations: null,
    });
    expect(() => normalizeFreeSettings({ ...settings, parentPhone: 'synthetic' } as any)).toThrow();
    expect(() => normalizeFreeSettings({ ...settings, capacityMode: 'UNLIMITED' })).toThrow();
  });
  it('retains a positive maximum in an incomplete private draft with no capacity selection', async () => {
    expect(normalizeFreeSettings({ ...settings, capacityMode: null })).toEqual({
      ...config.freeRegistration, capacityMode: null,
    });
    const request: SessionHttpRequest = (options) => options.success({ statusCode: 200,
      data: envelope({ ...config, freeRegistration: { ...config.freeRegistration, capacityMode: null } }) });
    expect((await make(request).getConfiguration(id)).freeRegistration.maxRegistrations).toBe(2);
  });
  it('accepts a positive newer receipt according to the receipt schema', async () => {
    const request: SessionHttpRequest = (options) => options.success({ statusCode: 200, data: envelope({
      draftId: id, status: 'DRAFT', version: 4, createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z',
    }) });
    expect((await make(request).saveConfiguration(id, 1, settings)).version).toBe(4);
  });
  it('strictly parses config and rejects publication pointers without a campaign', async () => {
    let value: unknown = config;
    const request: SessionHttpRequest = (options) => options.success({ statusCode: 200, data: envelope(value) });
    expect(await make(request).getConfiguration(id)).toEqual(config);
    value = { ...config, publishedVersionId: id };
    await expect(make(request).getConfiguration(id)).rejects.toMatchObject({ statusCode: 502 });
    value = { ...config, campusTimezone: 'Unknown/Zone' };
    await expect(make(request).getConfiguration(id)).rejects.toMatchObject({ statusCode: 502 });
  });
  it('reads an exact approved publication summary independently of history pages', async () => {
    const publishedVersion = { versionId: id, campaignId: id, draftId: id, campusId: id, title: '冻结批准标题',
      status: 'APPROVED', version: 2, sequence: 1, submittedAt: '2026-10-13T00:00:00.000Z',
      reviewedAt: '2026-10-13T01:00:00.000Z', reviewReason: null };
    const value = { ...config, campaignId: id, publishedVersionId: id, campaignVersion: 2,
      lifecycle: 'OPEN', publishedVersion };
    const request = jest.fn((options) => options.success({ statusCode: 200, data: envelope(value) }));
    expect(await make(request).getConfiguration(id)).toEqual(value);
    expect(request).toHaveBeenCalledTimes(1);
  });
  describe('approved share image projection', () => {
    const image = { id, mimeType: 'image/jpeg', sizeBytes: 1024,
      accessUrl: `/media/partner-campaign-images/${id}?expires=4070908800&signature=${'a'.repeat(64)}`,
      accessUrlExpiresAt: '2099-01-01T00:00:00.000Z' };
    const summary = { versionId: id, campaignId: id, draftId: id, campusId: id, title: '冻结批准标题',
      status: 'APPROVED', version: 2, sequence: 1, submittedAt: '2026-10-13T00:00:00.000Z',
      reviewedAt: '2026-10-13T01:00:00.000Z', reviewReason: null };
    const published = () => ({ ...config, campaignId: id, publishedVersionId: id, campaignVersion: 2,
      lifecycle: 'OPEN', publishedVersion: summary, publishedShareImage: { ...image } });
    it('resolves only a signed approved image against the configured API origin', async () => {
      const value = published();
      const request: SessionHttpRequest = options => options.success({ statusCode: 200, data: envelope(value) });
      expect((await make(request).getConfiguration(id) as any).publishedShareImage).toEqual({
        ...image, accessUrl: `http://synthetic.invalid${image.accessUrl}`,
      });
    });
    it.each(['missing', 'noPublication', 'externalUrl', 'wrongFile', 'privateField', 'invalidExpiry', 'oversize'])(
      'rejects %s approved image metadata', async variant => {
        const value: any = published();
        if (variant === 'missing') delete value.publishedShareImage;
        if (variant === 'noPublication') Object.assign(value, { publishedVersion: null, publishedVersionId: null });
        if (variant === 'externalUrl') value.publishedShareImage.accessUrl = 'https://other.invalid/private.jpg';
        if (variant === 'wrongFile') value.publishedShareImage.id = '00000000-0000-4000-8000-000000000002';
        if (variant === 'privateField') value.publishedShareImage.storagePath = 'private';
        if (variant === 'invalidExpiry') value.publishedShareImage.accessUrlExpiresAt = 'invalid';
        if (variant === 'oversize') value.publishedShareImage.sizeBytes = 3145729;
        const request: SessionHttpRequest = options => options.success({ statusCode: 200, data: envelope(value) });
        await expect(make(request).getConfiguration(id)).rejects.toMatchObject({ statusCode: 502 });
      });
  });
  it.each(['missing', 'null', 'unapproved', 'wrongVersion', 'wrongCampaign', 'wrongDraft', 'privateActor', 'noPointer'])(
    'rejects a %s publication summary instead of falling back to history or private draft text', async (variant) => {
      const other = '00000000-0000-4000-8000-000000000002';
      const summary: any = { versionId: id, campaignId: id, draftId: id, campusId: id, title: '冻结批准标题',
        status: 'APPROVED', version: 2, sequence: 1, submittedAt: '2026-10-13T00:00:00.000Z',
        reviewedAt: '2026-10-13T01:00:00.000Z', reviewReason: null };
      const value: any = { ...config, campaignId: id, publishedVersionId: id, campaignVersion: 2,
        lifecycle: 'OPEN', publishedVersion: summary };
      if (variant === 'missing') delete value.publishedVersion;
      if (variant === 'null') value.publishedVersion = null;
      if (variant === 'unapproved') summary.status = 'SUBMITTED';
      if (variant === 'wrongVersion') summary.versionId = other;
      if (variant === 'wrongCampaign') summary.campaignId = other;
      if (variant === 'wrongDraft') summary.draftId = other;
      if (variant === 'privateActor') summary.reviewedByUserId = other;
      if (variant === 'noPointer') value.publishedVersionId = null;
      const request: SessionHttpRequest = (options) => options.success({ statusCode: 200, data: envelope(value) });
      await expect(make(request).getConfiguration(id)).rejects.toMatchObject({ statusCode: 502 });
    });
  it('requires the frozen success envelope and accepts valid IANA zones with digits', async () => {
    let response: unknown = { data: config };
    const request: SessionHttpRequest = (options) => options.success({ statusCode: 200, data: response });
    await expect(make(request).getConfiguration(id)).rejects.toMatchObject({ statusCode: 502 });
    response = { ...envelope(config), parentPhone: 'synthetic-private' };
    await expect(make(request).getConfiguration(id)).rejects.toMatchObject({ statusCode: 502 });
    response = envelope({ ...config, campusTimezone: 'Etc/GMT+8' });
    expect((await make(request).getConfiguration(id)).campusTimezone).toBe('Etc/GMT+8');
  });
  it('sends the original expectedVersion and idempotency header for submission', async () => {
    const value = { versionId: id, campaignId: id, draftId: id, campusId: id, title: '免费登记',
      status: 'SUBMITTED', version: 1, sequence: 1, submittedAt: '2026-10-13T00:00:00.000Z', reviewedAt: null, reviewReason: null };
    const request = jest.fn((options) => options.success({ statusCode: 200, data: envelope(value) }));
    await make(request).submit(id, 9, 'synthetic-submit');
    expect(request.mock.calls[0][0]).toMatchObject({
      method: 'POST', url: `http://synthetic.invalid/partners/me/campaign-drafts/${id}/submit`,
      header: { 'Idempotency-Key': 'synthetic-submit' }, data: { expectedVersion: 9 },
    });
  });
  it.each([401, 403, 409, 500])('preserves HTTP status %s without hiding failure in 200', async (statusCode) => {
    const request: SessionHttpRequest = (options) => options.success({ statusCode, data: envelope(config) });
    await expect(make(request).getConfiguration(id)).rejects.toMatchObject({ statusCode });
  });
  it('rejects a late old-credential reply', async () => {
    let token = 'first'; let callback: any;
    const pending = make((options) => { callback = options; }, () => token).getConfiguration(id);
    token = 'second'; callback.success({ statusCode: 200, data: envelope(config) });
    await expect(pending).rejects.toMatchObject({ statusCode: 401 });
  });
  it('times out once and ignores a later callback', async () => {
    jest.useFakeTimers();
    try {
      let callback: any;
      const pending = make((options) => { callback = options; }).getConfiguration(id);
      const check = expect(pending).rejects.toMatchObject({ statusCode: 0 });
      jest.advanceTimersByTime(15000); await check;
      callback.success({ statusCode: 200, data: envelope(config) });
    } finally { jest.useRealTimers(); }
  });
  it('rejects malformed/private registration fields and wrong pagination', async () => {
    const request: SessionHttpRequest = (options) => options.success({ statusCode: 200, data: {
      ...envelope([{ registrationId: id, versionId: id, status: 'REGISTERED', registeredAt: '2026-10-13T00:00:00.000Z', cancelledAt: null, studentName: null, parentUserId: id }]),
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    } });
    await expect(make(request).registrations(id, 1)).rejects.toMatchObject({ statusCode: 502 });
  });
  it.each(['REGISTERED', 'CANCELLED'] as const)('requests server-side %s filtering with unchanged pagination and no campus override', async (status) => {
    const request = jest.fn((options) => options.success({ statusCode: 200, data: {
      ...envelope([]), meta: { page: 2, pageSize: 20, total: 0, totalPages: 0 },
    } }));
    await make(request).registrations(id, 2, status);
    expect(request.mock.calls[0][0]).toMatchObject({
      method: 'GET', url: `http://synthetic.invalid/partners/me/campaign-drafts/${id}/registrations?page=2&pageSize=20&status=${status}`,
    });
  });
  it('keeps the omitted-filter URL compatible and rejects unknown filters before issuing HTTP', async () => {
    const request = jest.fn((options) => options.success({ statusCode: 200, data: {
      ...envelope([]), meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    } }));
    const service = make(request);
    await service.registrations(id, 1);
    expect(request.mock.calls[0][0].url).toBe(`http://synthetic.invalid/partners/me/campaign-drafts/${id}/registrations?page=1&pageSize=20`);
    for (const filter of ['', 'ALL', 'APPROVED', 'registered', ['REGISTERED'], null]) {
      await expect((service.registrations as any)(id, 1, filter)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(['REGISTERED', 'CANCELLED'] as const)('rejects a valid row that does not match the requested %s filter', async (status) => {
    const other = status === 'REGISTERED' ? 'CANCELLED' : 'REGISTERED';
    const request: SessionHttpRequest = (options) => options.success({ statusCode: 200, data: {
      ...envelope([{ registrationId: id, versionId: id, status: other, registeredAt: '2026-10-13T00:00:00.000Z',
        cancelledAt: other === 'CANCELLED' ? '2026-10-13T01:00:00.000Z' : null, studentName: '合成学员' }]),
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    } });
    await expect(make(request).registrations(id, 1, status)).rejects.toMatchObject({ statusCode: 502 });
  });
  it('mock shares one global draft version across both partitions and never approves submissions', async () => {
    const basics = new PartnerCampaignDraftService({ dataDriver: 'mock', accessToken: () => '' });
    const service = new PartnerFreeCampaignService({ dataDriver: 'mock', accessToken: () => '', basics });
    const first = await basics.create({ title: '免费登记', campaignType: 'FREE_REGISTRATION', shareDescription: '纯登记' }, 'synthetic-key');
    const saved = await service.saveConfiguration(first.draftId, 1, settings);
    expect(saved.version).toBe(2);
    const next = await service.saveBasics(first.draftId, 2, { title: '新版标题', campaignType: 'FREE_REGISTRATION', shareDescription: '纯登记', contactPhone: null });
    expect(next.version).toBe(3);
    expect((await service.getConfiguration(first.draftId)).freeRegistration.maxRegistrations).toBe(2);
    const submitted = await service.submit(first.draftId, 3, 'synthetic-submit');
    expect(submitted.status).toBe('SUBMITTED');
    expect(await service.submit(first.draftId, 3, 'synthetic-submit')).toEqual(submitted);
    expect((await service.getConfiguration(first.draftId)).publishedVersionId).toBeNull();
    await expect(service.submit(first.draftId, 3, 'another-submit')).rejects.toMatchObject({ statusCode: 409 });
  });
  it('mock list reports the submitted global version and later edits without inventing approval', async () => {
    let owner = 'first-mock-owner';
    const basics = new PartnerCampaignDraftService({ dataDriver: 'mock', accessToken: () => owner });
    const service = new PartnerFreeCampaignService({ dataDriver: 'mock', accessToken: () => owner, basics });
    const first = await basics.create({ title: '免费登记', campaignType: 'FREE_REGISTRATION', shareDescription: '纯登记' }, 'synthetic-key');
    expect((await basics.list(1)).data[0]).toMatchObject({ latestSubmission: null, lifecycle: null });
    await service.saveConfiguration(first.draftId, 1, settings);
    await service.submit(first.draftId, 2, 'synthetic-submit');
    expect((await basics.list(1)).data[0]).toMatchObject({
      version: 2, lifecycle: 'OPEN',
      latestSubmission: { sequence: 1, sourceDraftVersion: 2, status: 'SUBMITTED', reviewReason: null },
    });
    await service.saveBasics(first.draftId, 2, { title: '私有修改', campaignType: 'FREE_REGISTRATION', shareDescription: '纯登记', contactPhone: null });
    expect((await basics.list(1)).data[0]).toMatchObject({ version: 3, latestSubmission: { sourceDraftVersion: 2 } });
    owner = 'other-mock-owner';
    expect((await basics.list(1)).data).toEqual([]);
  });
});
