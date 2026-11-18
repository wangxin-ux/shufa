import { PartnerRankingService } from '../pages/partner/runtime/partner-ranking.service';
import type { SessionHttpRequestOptions } from '../services/session.service';
import { currentRankingMonth } from '../pages/partner/runtime/partner-ranking.types';

const id = '00000000-0000-4000-8000-000000000001';
const row = { campusId: id, campusName: '合成校区', rank: 1, previousRank: 2, rankDelta: 1, isOwnCampus: true };
const query = { metric: 'STUDENTS' as const, month: '2026-10', page: 1, pageSize: 20 };
const response = () => ({
  metric: 'STUDENTS', month: '2026-10', timezone: 'Asia/Shanghai', asOf: '2026-10-15T00:00:00.000Z',
  calculationVersion: 'monthly-rankings-2026-10-15-v1', availability: 'LIVE', unavailableReason: null,
  revisionId: id, data: [row], ownCampus: row, meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
});

describe('partner private ranking transport', () => {
  let token: string;
  let current: boolean;
  let sent: SessionHttpRequestOptions;
  let service: PartnerRankingService;
  beforeEach(() => {
    sent = undefined as unknown as SessionHttpRequestOptions;
    token = 'synthetic-ranking-token';
    current = true;
    service = new PartnerRankingService({
      dataDriver: 'api', apiBaseUrl: 'http://127.0.0.1:3001/',
      accessToken: () => token, isCurrent: () => current, now: () => new Date('2026-10-15T00:00:00Z'),
      request: (options) => { sent = options; },
    });
  });
  const deliver = (value: unknown, statusCode = 200) => sent.success({ statusCode, data: { data: value } });
  it('sends only the ranking query and bearer and parses a minimal response', async () => {
    const pending = service.list(query);
    expect(sent).toMatchObject({
      method: 'GET', url: 'http://127.0.0.1:3001/partners/me/rankings?metric=STUDENTS&month=2026-10&page=1&pageSize=20',
      header: { Authorization: 'Bearer synthetic-ranking-token' },
    });
    deliver(response());
    expect(await pending).toEqual(response());
  });
  it('keeps a requested revision in subsequent pages', async () => {
    const pending = service.list({ ...query, page: 2, revisionId: id });
    expect(sent.url).toContain(`&revisionId=${id}`);
    deliver({ ...response(), data: [], meta: { page: 2, pageSize: 20, total: 1, totalPages: 1 } });
    expect((await pending).ownCampus).toEqual(row);
  });
  it('accepts the standard request ID and equivalent field order in the independent own row', async () => {
    const pending = service.list(query);
    const ownCampus = { isOwnCampus: true, rankDelta: 1, previousRank: 2, rank: 1, campusName: row.campusName, campusId: id };
    sent.success({ statusCode: 200, data: { data: { ...response(), ownCampus }, requestId: 'synthetic-request' } });
    expect((await pending).ownCampus).toEqual(row);
  });
  it.each([
    { ...query, metric: 'OTHER' }, { ...query, month: '2026-13' }, { ...query, month: '2026-11' },
    { ...query, page: 0 }, { ...query, pageSize: 101 }, { ...query, revisionId: 'bad' },
    { ...query, campusId: id },
  ])('rejects invalid or excessive queries before transport (%#)', async (value) => {
    await expect(service.list(value as never)).rejects.toMatchObject({ statusCode: 400 });
    expect(sent).toBeUndefined();
  });
  it.each([
    (value: ReturnType<typeof response>) => ({ ...value, amountFen: 10 }),
    (value: ReturnType<typeof response>) => ({ ...value, data: [{ ...row, value: 10 }] }),
    (value: ReturnType<typeof response>) => ({ ...value, metric: 'PARTNER_EARNINGS' }),
    (value: ReturnType<typeof response>) => ({ ...value, month: '2026-09' }),
    (value: ReturnType<typeof response>) => ({ ...value, timezone: 'UTC' }),
    (value: ReturnType<typeof response>) => ({ ...value, revisionId: null }),
    (value: ReturnType<typeof response>) => ({ ...value, ownCampus: { ...row, isOwnCampus: false } }),
    (value: ReturnType<typeof response>) => ({ ...value, data: [{ ...row, rankDelta: -1 }] }),
    (value: ReturnType<typeof response>) => ({ ...value, meta: { ...value.meta, total: 2 } }),
    (value: ReturnType<typeof response>) => ({ ...value, asOf: 'invalid' }),
  ])('rejects inconsistent or sensitive response fields (%#)', async (change) => {
    const pending = service.list(query);
    deliver(change(response()));
    await expect(pending).rejects.toMatchObject({ statusCode: 502 });
  });
  it('keeps explicitly missing history empty', async () => {
    const pending = service.list({ ...query, month: '2026-09' });
    deliver({ ...response(), month: '2026-09', availability: 'UNAVAILABLE',
      unavailableReason: 'HISTORY_UNAVAILABLE', revisionId: null, data: [], ownCampus: null,
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    expect((await pending).availability).toBe('UNAVAILABLE');
  });
  it.each([401, 403, 404, 500])('preserves HTTP %s with a local message', async (statusCode) => {
    const pending = service.list(query);
    deliver({ secret: 'raw-server-detail' }, statusCode);
    await expect(pending).rejects.toMatchObject({ statusCode, message: expect.not.stringContaining('raw-server-detail') });
  });
  it('rejects replies after the token or environment changes', async () => {
    const first = service.list(query);
    token = 'next-synthetic-token';
    deliver(response());
    await expect(first).rejects.toMatchObject({ statusCode: 401 });
    const second = service.list(query);
    current = false;
    deliver(response());
    await expect(second).rejects.toMatchObject({ statusCode: 401 });
    expect(service.getSessionKey()).toBe('');
  });
  it('uses Beijing calendar months at UTC boundaries', () => {
    expect(currentRankingMonth(new Date('2026-09-30T16:00:00Z'))).toBe('2026-10');
  });
  it('shows three different synthetic leaders without inventing older history', async () => {
    const mock = new PartnerRankingService({ dataDriver: 'mock', accessToken: () => '',
      now: () => new Date('2026-10-15T00:00:00Z') });
    const leaders = await Promise.all(['STUDENTS', 'PARTNER_EARNINGS', 'HEADQUARTERS_EARNINGS']
      .map(async (metric) => (await mock.list({ ...query, metric: metric as never })).data[0].campusId));
    expect(new Set(leaders).size).toBe(3);
    expect((await mock.list({ ...query, month: '2026-09' })).availability).toBe('UNAVAILABLE');
  });
});
