import { CAMPAIGN_TYPES, PartnerCampaignDraftService, normalizeCampaignBasics } from '../pages/partner/runtime/partner-campaign-draft.service';
import type { SessionHttpRequestOptions } from '../services/session.service';
import { getPartnerCampaignDraftService } from '../pages/partner/runtime/partner-campaign-draft.service';
import * as partnerEnv from '../config/partner-env';

const id = '00000000-0000-4000-8000-000000000001';
const receipt = { draftId: id, status: 'DRAFT', version: 1, createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z' };
const basics = { title: null, campaignType: null, shareDescription: null, contactPhone: null };
describe('partner private campaign draft transport', () => {
  let owner: string;
  let options: SessionHttpRequestOptions;
  let service: PartnerCampaignDraftService;
  beforeEach(() => {
    owner = 'synthetic-token';
    options = undefined as unknown as SessionHttpRequestOptions;
    service = new PartnerCampaignDraftService({
      dataDriver: 'api', apiBaseUrl: 'http://127.0.0.1:3001/',
      accessToken: () => owner,
      request: (value) => { options = value; },
    });
  });
  const respond = (value: unknown, statusCode = 200) =>
    options.success({ statusCode, data: value });
  it('uses the formal bearer and stable creation key, normalizes four fields', async () => {
    const pending = service.create({ title: ' 草稿 ' }, 'synthetic-key');
    expect(options).toMatchObject({
      method: 'POST', url: 'http://127.0.0.1:3001/partners/me/campaign-drafts',
      header: { Authorization: 'Bearer synthetic-token', 'Idempotency-Key': 'synthetic-key' },
      data: { ...basics, title: '草稿' },
    });
    respond({ data: receipt });
    expect(await pending).toEqual(receipt);
  });
  it('puts only version plus basic partition and validates the requested ID', async () => {
    const pending = service.save(id, 1, { contactPhone: ' 0000 ' });
    expect(options.method).toBe('PUT');
    expect(options.data).toEqual({ expectedVersion: 1, basicInformation: { ...basics, contactPhone: '0000' } });
    respond({ data: receipt });
    expect(await pending).toEqual(receipt);
    await expect(service.get('invalid')).rejects.toMatchObject({ statusCode: 400 });
  });
  it('saves an independent normalized plain-text body and reads it without widening basic fields', async () => {
    const pending = (service as any).saveContent(id, 1, ' 正文\n<不是HTML> ');
    expect(options).toMatchObject({
      method: 'PUT', url: `http://127.0.0.1:3001/partners/me/campaign-drafts/${id}/content`,
      data: { expectedVersion: 1, activityContent: '正文\n<不是HTML>' },
    });
    respond({ data: { ...receipt, version: 2 } });
    expect(await pending).toMatchObject({ version: 2 });
    const detail = service.get(id);
    respond({ data: { ...receipt, activityContent: '正文\n<不是HTML>', basicInformation: basics } });
    expect(await detail).toMatchObject({ activityContent: '正文\n<不是HTML>' });
  });
  it.each(['x'.repeat(10001), '\u0000', '\ud800', 1, undefined])('rejects invalid independent content (%#)', async (value) => {
    await expect((service as any).saveContent(id, 1, value)).rejects.toMatchObject({ statusCode: 400 });
  });
  it('preserves content across legacy basic replacement and keeps it out of summaries', async () => {
    const mock = new PartnerCampaignDraftService({ dataDriver: 'mock', accessToken: () => owner });
    const first = await mock.create({ title: '合成正文' }, 'synthetic-content');
    await (mock as any).saveContent(first.draftId, 1, '😀'.repeat(10000));
    await mock.save(first.draftId, 2, { title: '只改名称' });
    expect(await mock.get(first.draftId)).toMatchObject({ activityContent: '😀'.repeat(10000), version: 3 });
    expect((await mock.list(1)).data[0]).not.toHaveProperty('activityContent');
    owner = 'other-owner';
    await expect((mock as any).saveContent(first.draftId, 3, null)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('counts Unicode code points consistently and allows clear/incomplete values', () => {
    expect(normalizeCampaignBasics({ title: '😀'.repeat(40), contactPhone: ' ' })).toEqual({
      ...basics, title: '😀'.repeat(40),
    });
    expect(() => normalizeCampaignBasics({ title: '😀'.repeat(41) })).toThrow();
    expect(() => normalizeCampaignBasics({ title: 'e\u0301'.repeat(21) })).toThrow();
  });
  it.each([
    { title: 1 }, { campaignType: 'ACTIVE' }, { shareDescription: 'x'.repeat(1001) },
    { contactPhone: 'x'.repeat(31) }, { priceFen: 5 }, { campusId: id },
  ])('rejects malformed outgoing basics (%#)', async (value) => {
    await expect(service.create(value as never, 'synthetic-key')).rejects.toMatchObject({ statusCode: 400 });
  });
  it.each([
    { ...receipt, status: 'ACTIVE' }, { ...receipt, version: 0 },
    { ...receipt, contactPhone: '0000' }, { ...receipt, draftId: 'wrong' },
    { ...receipt, updatedAt: 'bad' }, { ...receipt, version: 1.5 },
  ])('rejects malformed minimal receipts (%#)', async (value) => {
    const pending = service.create({}, 'synthetic-key');
    respond({ data: value });
    await expect(pending).rejects.toMatchObject({ statusCode: 502 });
  });
  it('reads strict basic detail and flattens only the standard list envelope', async () => {
    const detail = service.get(id);
    respond({ data: { ...receipt, basicInformation: basics } });
    expect(await detail).toEqual({ ...receipt, basicInformation: basics });
    const list = service.list(1);
    respond({ data: [{ ...receipt, title: null, campaignType: null, latestSubmission: null, lifecycle: null }], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    expect((await list).data).toHaveLength(1);
  });
  it('sends the selected draft category to the API and rejects a different category response', async () => {
    const pending = (service.list as any)(2, 'FLASH_SALE');
    respond({ data: [{ ...receipt, title: null, campaignType: 'FREE_REGISTRATION', latestSubmission: null, lifecycle: null }],
      meta: { page: 2, pageSize: 20, total: 21, totalPages: 2 } });
    expect(options.url).toBe('http://127.0.0.1:3001/partners/me/campaign-drafts?page=2&pageSize=20&campaignType=FLASH_SALE');
    await expect(pending).rejects.toMatchObject({ statusCode: 502 });
  });
  it('filters mock drafts before pagination while all includes unclassified drafts and excludes another owner', async () => {
    const mock = new PartnerCampaignDraftService({ dataDriver: 'mock', accessToken: () => owner });
    await mock.create({}, 'unclassified-key');
    for (const [index, type] of CAMPAIGN_TYPES.entries()) {
      await mock.create({ campaignType: type.value }, `category-key-${index}`);
    }
    for (let index = 0; index < 20; index++) {
      await mock.create({ campaignType: 'FLASH_SALE' }, `flash-page-key-${index}`);
    }
    owner = 'different-owner';
    await mock.create({ campaignType: 'FLASH_SALE' }, 'foreign-owner-key');
    owner = 'synthetic-token';
    const first = await (mock.list as any)(1, 'FLASH_SALE');
    const second = await (mock.list as any)(2, 'FLASH_SALE');
    expect(first.meta).toEqual({ page: 1, pageSize: 20, total: 21, totalPages: 2 });
    expect(first.data).toHaveLength(20);
    expect(second.data).toHaveLength(1);
    expect([...first.data, ...second.data].every((row: { campaignType: string }) => row.campaignType === 'FLASH_SALE')).toBe(true);
    expect(new Set([...first.data, ...second.data].map((row: { draftId: string }) => row.draftId)).size).toBe(21);
    for (const type of CAMPAIGN_TYPES.filter(item => item.value !== 'FLASH_SALE')) {
      expect((await (mock.list as any)(1, type.value)).meta.total).toBe(1);
    }
    const all = [...(await mock.list(1)).data, ...(await mock.list(2)).data];
    expect(all).toHaveLength(26);
    expect(all.some(row => row.campaignType === null)).toBe(true);
  });
  it.each(['', 'ALL', 'flash_sale', null, ['FLASH_SALE', 'FREE_REGISTRATION']])(
    'rejects an invalid outgoing draft category (%#)', async (type) => {
      await expect((service.list as any)(1, type)).rejects.toMatchObject({ statusCode: 400 });
      expect(options).toBeUndefined();
    },
  );
  it('reads the latest frozen review separately from a newer private draft', async () => {
    const list = service.list(1);
    const latestSubmission = { sequence: 2, sourceDraftVersion: 2, status: 'REJECTED', reviewReason: '请补充活动内容' };
    respond({ data: [{ ...receipt, version: 3, title: '已修改', campaignType: null, latestSubmission, lifecycle: 'OPEN' }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    expect((await list).data[0]).toMatchObject({ version: 3, latestSubmission, lifecycle: 'OPEN' });
  });
  it.each([
    { sequence: 0, sourceDraftVersion: 1, status: 'SUBMITTED', reviewReason: null },
    { sequence: 1, sourceDraftVersion: 2, status: 'SUBMITTED', reviewReason: null },
    { sequence: 1, sourceDraftVersion: 1, status: 'ACTIVE', reviewReason: null },
    { sequence: 1, sourceDraftVersion: 1, status: 'REJECTED', reviewReason: null },
    { sequence: 1, sourceDraftVersion: 1, status: 'REJECTED', reviewReason: ' ' },
    { sequence: 1, sourceDraftVersion: 1, status: 'APPROVED', reviewReason: '私有异常' },
    { sequence: 1, sourceDraftVersion: 1, status: 'SUBMITTED', reviewReason: null, reviewerId: id },
  ])('rejects invalid or excessive review summaries (%#)', async (latestSubmission) => {
    const pending = service.list(1);
    respond({ data: [{ ...receipt, title: null, campaignType: null, latestSubmission, lifecycle: 'OPEN' }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    await expect(pending).rejects.toMatchObject({ statusCode: 502 });
  });
  it.each([
    { latestSubmission: null, lifecycle: 'OPEN' },
    { latestSubmission: { sequence: 1, sourceDraftVersion: 1, status: 'SUBMITTED', reviewReason: null }, lifecycle: null },
    { latestSubmission: null, lifecycle: 'ACTIVE' },
  ])('rejects inconsistent review and lifecycle fields (%#)', async (fields) => {
    const pending = service.list(1);
    respond({ data: [{ ...receipt, title: null, campaignType: null, ...fields }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    await expect(pending).rejects.toMatchObject({ statusCode: 502 });
  });
  it('rejects a detail with the wrong ID or an unexpected sensitive field', async () => {
    const pending = service.get(id);
    respond({ data: { ...receipt, draftId: '00000000-0000-4000-8000-000000000002', basicInformation: basics } });
    await expect(pending).rejects.toMatchObject({ statusCode: 502 });
  });
  it.each([401, 403, 404, 409, 500])('preserves HTTP %s without leaking server details', async (statusCode) => {
    const pending = service.get(id);
    respond({ error: { code: 'PRIVATE_INTERNAL', message: 'raw SQL or secrets' } }, statusCode);
    await expect(pending).rejects.toMatchObject({ statusCode });
    await expect(pending).rejects.not.toThrow('raw SQL');
  });
  it('rejects stale responses after a runtime credential change', async () => {
    const pending = service.get(id);
    owner = 'new-owner';
    respond({ data: { ...receipt, basicInformation: basics } });
    await expect(pending).rejects.toMatchObject({ statusCode: 401 });
  });
  it('handles synchronous/native transport failures and missing configuration', async () => {
    const pending = service.create({}, 'synthetic-key');
    options.fail(new Error('internal'));
    await expect(pending).rejects.toMatchObject({ statusCode: 0 });
    owner = '';
    await expect(service.get(id)).rejects.toMatchObject({ statusCode: 401 });
  });
  it('keeps mock drafts private per owner and implements replay/version conflicts', async () => {
    const mock = new PartnerCampaignDraftService({ dataDriver: 'mock', accessToken: () => owner });
    const first = await mock.create({ title: '示例草稿' }, 'synthetic-key');
    expect(await mock.create({ title: ' 示例草稿 ' }, 'synthetic-key')).toEqual(first);
    await expect(mock.create({ title: '不同' }, 'synthetic-key')).rejects.toMatchObject({ statusCode: 409 });
    const updated = await mock.save(first.draftId, 1, {});
    expect(updated.version).toBe(2);
    expect(await mock.save(first.draftId, 1, {})).toEqual(updated);
    owner = 'other-owner';
    expect((await mock.list(1)).data).toEqual([]);
    await expect(mock.get(first.draftId)).rejects.toMatchObject({ statusCode: 404 });
  });
  it.each(['base', 'driver'])('invalidates a runtime key when only its %s changes', (field) => {
    let env = { dataDriver: 'api' as 'api' | 'mock', apiBaseUrl: 'http://127.0.0.1:3001', accessToken: 'same-token', mockScenario: 'normal' as const };
    const spy = jest.spyOn(partnerEnv, 'createPartnerRuntimeEnv').mockImplementation(() => env);
    try {
      const runtime = getPartnerCampaignDraftService();
      expect(runtime.getSessionKey()).toContain('same-token');
      env = field === 'base' ? { ...env, apiBaseUrl: 'http://127.0.0.1:3002' } : { ...env, dataDriver: 'mock' };
      expect(runtime.getSessionKey()).toBe('');
    } finally { spy.mockRestore(); }
  });
  it('times out a native request and ignores both kinds of late callback', async () => {
    jest.useFakeTimers();
    try {
      const pending = service.create({}, 'synthetic-key');
      const rejected = expect(pending).rejects.toMatchObject({ statusCode: 0, code: 'TIMEOUT' });
      jest.advanceTimersByTime(15_000);
      await rejected;
      respond({ data: receipt });
      options.fail({});
      await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    } finally { jest.useRealTimers(); }
  });
});
