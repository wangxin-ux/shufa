import { PartnerFreeCampaignService } from '../pages/partner/runtime/free-campaign.service';
import type { SessionHttpRequest } from '../services/session.service';

const id = '00000000-0000-4000-8000-000000000001';
const row = {
  campaignId: id, versionId: id, draftId: id, sequence: 1, title: '免费体验登记',
  startsAt: '2026-10-13T00:00:00.000Z', endsAt: '2099-10-14T00:00:00.000Z',
  timezone: 'Asia/Shanghai', availability: 'AVAILABLE', registeredCount: 1,
  maxRegistrations: 2, remainingRegistrations: 1,
};
const envelope = (data: unknown[] = [row], page = 1, total = data.length) => ({
  data, requestId: 'synthetic-request',
  meta: { page, pageSize: 20, total, totalPages: Math.ceil(total / 20) },
});
const make = (request: SessionHttpRequest, accessToken = () => 'synthetic') =>
  new PartnerFreeCampaignService({
    dataDriver: 'api', apiBaseUrl: 'http://synthetic.invalid', accessToken, request,
  }) as PartnerFreeCampaignService & {
    published(page: number, phase: string): Promise<{ data: typeof row[] }>;
  };

describe('owned published free activity service', () => {
  it.each(['ONGOING', 'ENDED'])('uses the owned %s GET without a campus or parent route', async (phase) => {
    const data = phase === 'ENDED' ? { ...row, availability: 'ENDED' } : row;
    const request = jest.fn((options) => options.success({ statusCode: 200, data: envelope([data]) }));
    expect((await make(request).published(1, phase)).data).toEqual([data]);
    expect(request.mock.calls[0][0]).toMatchObject({
      method: 'GET', url: `http://synthetic.invalid/partners/me/free-campaigns?page=1&pageSize=20&phase=${phase}`,
    });
    expect(request.mock.calls[0][0].data).toBeUndefined();
  });
  it.each(['', 'DRAFT', 'ongoing', null, ['ENDED']])('rejects invalid phase %s before HTTP', async (phase) => {
    const request = jest.fn();
    await expect(make(request).published(1, phase as string)).rejects.toMatchObject({ statusCode: 400 });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    { parentUserId: id }, { title: '' }, { sequence: 0 }, { timezone: 'Unknown/Zone' },
    { availability: 'REPLACED' }, { remainingRegistrations: 2 }, { registeredCount: -1 },
    { maxRegistrations: null }, { availability: 'FULL' },
    { startsAt: '2099-10-15T00:00:00.000Z' },
  ])('rejects malformed or inconsistent frozen summary %j', async (mutation) => {
    const request: SessionHttpRequest = (options) => options.success({
      statusCode: 200, data: envelope([{ ...row, ...mutation }]),
    });
    await expect(make(request).published(1, 'ONGOING')).rejects.toMatchObject({ statusCode: 502 });
  });
  it('rejects a phase mismatch, duplicate identity, wrong page or incomplete envelope', async () => {
    let value: unknown = envelope([{ ...row, availability: 'CLOSED' }]);
    const request: SessionHttpRequest = (options) => options.success({ statusCode: 200, data: value });
    const service = make(request);
    for (const invalid of [
      value, envelope([row, row]), envelope([row], 2, 21),
      { data: [row], meta: envelope().meta },
    ]) {
      value = invalid;
      await expect(service.published(1, 'ONGOING')).rejects.toMatchObject({ statusCode: 502 });
    }
  });
  it.each([401, 403, 500])('preserves HTTP %s for the Page policy', async (statusCode) => {
    await expect(make((options) => options.success({ statusCode, data: {} }))
      .published(1, 'ONGOING')).rejects.toMatchObject({ statusCode });
  });
  it('rejects a late reply after identity replacement', async () => {
    let owner = 'first', callback: any;
    const pending = make((options) => { callback = options; }, () => owner).published(1, 'ONGOING');
    owner = 'second';
    callback.success({ statusCode: 200, data: envelope() });
    await expect(pending).rejects.toMatchObject({ statusCode: 401 });
  });
  it('keeps mock unapproved drafts out of the published list', async () => {
    const service = new PartnerFreeCampaignService({ dataDriver: 'mock', accessToken: () => '' }) as ReturnType<typeof make>;
    expect((await service.published(1, 'ONGOING')).data).toEqual([]);
    expect((await service.published(1, 'ENDED')).data).toEqual([]);
  });
});
