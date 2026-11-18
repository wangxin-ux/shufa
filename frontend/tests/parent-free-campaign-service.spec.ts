import { ParentFreeCampaignService } from '../pages/parent/runtime/free-campaign.service';
import type { SessionHttpRequestOptions } from '../services/session.service';
import * as fs from 'node:fs';
import * as path from 'node:path';

const campaignId = '00000000-0000-4000-8000-000000000001';
const versionId = '00000000-0000-4000-8000-000000000002';
const studentId = '00000000-0000-4000-8000-000000000003';
const registrationId = '00000000-0000-4000-8000-000000000004';
const imageId = '50000000-0000-4000-8000-000000000001';
const imagePath = `/media/partner-campaign-images/${imageId}?expires=1792195200&signature=${'a'.repeat(64)}`;
const image = { id: imageId, mimeType: 'image/png', sizeBytes: 1,
  accessUrl: imagePath, accessUrlExpiresAt: '2026-10-17T00:00:00.000Z' };
const configuration = {
  title: '免费体验', campaignType: 'FREE_REGISTRATION', shareDescription: '纯登记',
  contactPhone: null, startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: '2030-10-01T00:00:00.000Z', timezone: 'Asia/Shanghai',
  capacityMode: 'UNLIMITED', maxRegistrations: null, feeFen: 0,
  benefitMode: 'NONE', registrationLimit: 'ONCE_PER_STUDENT',
};
const receipt = {
  registrationId, campaignId, versionId, studentId, status: 'REGISTERED', version: 1,
  registeredAt: '2026-10-13T00:00:00.000Z', cancelledAt: null,
};
const detail = {
  campaignId, versionId, configuration, availability: 'AVAILABLE',
  registeredCount: 0, remainingRegistrations: null,
  eligibleStudents: [{ studentId, displayName: '合成学员', eligibility: 'ELIGIBLE', registration: null }],
};
const result = {
  ...receipt, title: configuration.title, startsAt: configuration.startsAt,
  endsAt: configuration.endsAt, timezone: configuration.timezone, canCancel: true,
};
const summary = {
  campaignId, versionId, title: configuration.title, startsAt: configuration.startsAt,
  endsAt: configuration.endsAt, timezone: configuration.timezone, availability: 'AVAILABLE',
  registeredCount: 0, maxRegistrations: null, remainingRegistrations: null,
};
describe('parent free campaign real service contract', () => {
  let owner: string;
  let calls: SessionHttpRequestOptions[];
  let service: ParentFreeCampaignService;
  const respond = (data: unknown, index = calls.length - 1) =>
    calls[index].success({ statusCode: 200, data: { data, requestId: 'synthetic-request' } });
  beforeEach(() => {
    owner = 'synthetic-parent';
    calls = [];
    service = new ParentFreeCampaignService({
      dataDriver: 'api', apiBaseUrl: 'http://127.0.0.1:3001/',
      accessToken: () => owner, request: (options) => calls.push(options),
    });
  });
  afterEach(() => { jest.useRealTimers(); });
  it.each([
    { cover: null, share: null },
    { cover: image, share: null },
    { cover: null, share: { ...image, mimeType: 'image/jpeg', sizeBytes: 3145728 } },
    { cover: image, share: image },
  ])('resolves frozen images against the API prefix without changing body case %#', async (images) => {
    service = new ParentFreeCampaignService({
      dataDriver: 'api', apiBaseUrl: 'https://api.example.test/api/v1///',
      accessToken: () => owner, request: (options) => calls.push(options),
    });
    const pending = service.getCampaign(campaignId);
    respond({ ...detail, configuration: { ...configuration, activityContent: ' 正文\n保留 ', images } });
    const parsed = (await pending).configuration as unknown as Record<string, unknown>;
    expect(parsed).toEqual({ ...configuration, activityContent: '正文\n保留', images: {
      cover: images.cover && { ...images.cover, accessUrl: `https://api.example.test/api/v1${imagePath}` },
      share: images.share && { ...images.share, accessUrl: `https://api.example.test/api/v1${imagePath}` },
    } });
    expect(calls[0].url).toContain('https://api.example.test/api/v1/parents/me/');
    expect(image.accessUrl).toBe(imagePath);
  });
  it('accepts images without the optional activity body', async () => {
    const pending = service.getCampaign(campaignId);
    respond({ ...detail, configuration: { ...configuration, images: { cover: image, share: null } } });
    expect((await pending).configuration).toMatchObject({
      images: { cover: { ...image, accessUrl: `http://127.0.0.1:3001${imagePath}` }, share: null },
    });
  });
  it.each([
    undefined, null, [], {}, { cover: null }, { cover: null, share: null, extra: true },
    ...['id', 'mimeType', 'sizeBytes', 'accessUrl', 'accessUrlExpiresAt'].map((field) =>
      ({ cover: Object.fromEntries(Object.entries(image).filter(([key]) => key !== field)), share: null })),
    ...[
      { extra: true }, { id: campaignId.replace('-4000-', '-1000-') },
      { id: imageId.replace('-8000-', '-7000-') }, { mimeType: 'image/webp' },
      { sizeBytes: 0 }, { sizeBytes: 3145729 }, { sizeBytes: 1.5 }, { sizeBytes: '1' },
      { accessUrlExpiresAt: '2026-02-30T00:00:00.000Z' },
      { accessUrlExpiresAt: '2026-10-17T08:00:00+08:00' }, { accessUrlExpiresAt: 'invalid' },
      ...[
        `https://external.test${imagePath}`, `//external.test${imagePath}`, 'javascript:alert(1)',
        imagePath.replace(imageId, campaignId), imagePath.replace('/media/', '/other/'),
        `${imagePath}&extra=1`, `${imagePath}&expires=2`, `${imagePath}#fragment`, `${imagePath}\n`,
        imagePath.replace('/media/', '/MEDIA/'), imagePath.replace('expires=', 'Expires='),
        imagePath.replace('a'.repeat(64), 'A'.repeat(64)),
        imagePath.replace('signature=', 'signature=A'), imagePath.replace('expires=1792195200', 'expires=1.5'),
        imagePath.replace('expires=1792195200', 'expires=1e3'), imagePath.replace('expires=1792195200', 'expires='),
        imagePath.replace('a'.repeat(64), 'a'.repeat(63)), imagePath.replace('/media/', '/media/../media/'),
      ].map((accessUrl) => ({ accessUrl })),
    ].flatMap((change) => [
      { cover: { ...image, ...change }, share: null },
      { cover: null, share: { ...image, ...change } },
    ]),
  ])('rejects malformed frozen image shapes and unsafe paths case %#', async (images) => {
    const pending = service.getCampaign(campaignId);
    respond({ ...detail, configuration: { ...configuration, images } });
    await expect(pending).rejects.toMatchObject({ statusCode: 502, code: 'INVALID_RESPONSE' });
  });
  it.each([
    'ftp://api.example.test/api', 'https://api.example.test/api?x=1', 'https://api.example.test/api#part',
    'https://user:secret@api.example.test/api', 'https://api.example.test\\other/api', 'https:///api',
  ])('rejects unsafe API base before dispatch case %#', async (apiBaseUrl) => {
    const unsafe = new ParentFreeCampaignService({
      dataDriver: 'api', apiBaseUrl, accessToken: () => owner, request: (options) => {
        calls.push(options);
        options.success({ statusCode: 200, data: { data: detail, requestId: 'synthetic-unsafe-base' } });
      },
    });
    await expect(unsafe.getCampaign(campaignId)).rejects.toMatchObject({ code: 'CONFIGURATION_REQUIRED' });
    expect(calls).toHaveLength(0);
  });
  it('conditionally renders titled cover and share images with stable uncropped ratios', () => {
    const template = fs.readFileSync(path.resolve(__dirname, '../pages/parent/campaign-registration/index.wxml'), 'utf8');
    const styles = fs.readFileSync(path.resolve(__dirname, '../pages/parent/campaign-registration/index.wxss'), 'utf8');
    for (const [slot, label] of [['cover', '活动封面'], ['share', '转发图']]) {
      expect(template).toContain(`wx:if="{{campaign.configuration.images.${slot}}}"`);
      expect(template).toContain(`>${label}</text>`);
      expect(template).toContain(`class="campaign-image campaign-image--${slot}" src="{{campaign.configuration.images.${slot}.accessUrl}}" mode="aspectFit"`);
    }
    expect(styles).toMatch(/\.campaign-image\s*\{[^}]*width:\s*100%/);
    expect(styles).toMatch(/\.campaign-image--cover\s*\{[^}]*aspect-ratio:\s*2\s*\/\s*3/);
    expect(styles).toMatch(/\.campaign-image--share\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3/);
    expect(template).not.toContain('rich-text');
  });
  it('keeps legacy configuration without activityContent compatible', async () => {
    const pending = service.getCampaign(campaignId, versionId);
    respond(detail);
    expect((await pending).configuration).toEqual(configuration);
  });
  it.each([
    [null, null],
    ['', null],
    [' \t\r\n\u3000', null],
    [' \n第一行\n第二行\n ', '第一行\n第二行'],
    ['<b>活动</b>\n<script>alert(1)</script>', '<b>活动</b>\n<script>alert(1)</script>'],
    ['a'.repeat(10000), 'a'.repeat(10000)],
    ['\u{1f600}'.repeat(10000), '\u{1f600}'.repeat(10000)],
  ])('accepts and normalizes activityContent case %#', async (input, expected) => {
    const pending = service.getCampaign(campaignId, versionId);
    respond({ ...detail, configuration: { ...configuration, activityContent: input } });
    expect((await pending).configuration).toEqual({ ...configuration, activityContent: expected });
  });
  it.each([
    undefined, 1, false, {}, [], 'a'.repeat(10001), '\u{1f600}'.repeat(10001),
    'a\u0000b', '\ud800', '\udfff', '\ud800x', 'x\udfff',
  ])('rejects invalid present activityContent case %#', async (activityContent) => {
    const pending = service.getCampaign(campaignId);
    const check = expect(pending).rejects.toMatchObject({ statusCode: 502, code: 'INVALID_RESPONSE' });
    respond({ ...detail, configuration: { ...configuration, activityContent } });
    await check;
  });
  it.each([
    { privateField: 'unexpected' }, { feeFen: 1 }, { title: '\ud800' }, { startsAt: undefined },
  ])('keeps other configuration validation strict with activityContent case %#', async (change) => {
    const pending = service.getCampaign(campaignId);
    const check = expect(pending).rejects.toMatchObject({ statusCode: 502, code: 'INVALID_RESPONSE' });
    respond({ ...detail, configuration: { ...configuration, activityContent: '正文', ...change } });
    await check;
  });
  it('renders activityContent only when nonempty as plain text with preserved newlines', () => {
    const template = fs.readFileSync(path.resolve(__dirname, '../pages/parent/campaign-registration/index.wxml'), 'utf8');
    const styles = fs.readFileSync(path.resolve(__dirname, '../pages/parent/campaign-registration/index.wxss'), 'utf8');
    expect(template).toMatch(/<view wx:if="{{campaign\.configuration\.activityContent}}"[^>]*>\s*<text[^>]*>活动正文<\/text>\s*<text class="description">{{campaign\.configuration\.activityContent}}<\/text>\s*<\/view>/);
    expect(template).not.toContain('rich-text');
    expect(styles).toMatch(/\.description\s*\{[^}]*white-space:\s*pre-wrap;[^}]*overflow-wrap:\s*anywhere/);
  });
  it('reads the exact approved link without silently replacing its version', async () => {
    const pending = service.getCampaign(campaignId, versionId);
    expect(calls[0]).toMatchObject({
      method: 'GET', url: `http://127.0.0.1:3001/parents/me/free-campaigns/${campaignId}?versionId=${versionId}`,
      header: { Authorization: 'Bearer synthetic-parent' },
    });
    respond({ ...detail, availability: 'REPLACED' });
    expect((await pending).availability).toBe('REPLACED');
  });
  it('sends only approved version/student identifiers with the caller key', async () => {
    const pending = service.register(campaignId, versionId, studentId, 'synthetic-key');
    expect(calls[0]).toMatchObject({
      method: 'POST', data: { versionId, studentId },
      header: { 'Idempotency-Key': 'synthetic-key' },
    });
    respond(receipt);
    expect(await pending).toEqual(receipt);
  });
  it('uses the own cancellation endpoint with version and key only', async () => {
    const pending = service.cancel(registrationId, 1, 'synthetic-cancel');
    expect(calls[0]).toMatchObject({
      url: `http://127.0.0.1:3001/parents/me/campaign-registrations/${registrationId}/cancel`,
      data: { expectedVersion: 1 },
    });
    respond({ ...receipt, status: 'CANCELLED', version: 2, cancelledAt: '2026-10-13T01:00:00.000Z' });
    expect((await pending).status).toBe('CANCELLED');
  });
  it('deduplicates concurrent reads and identical writes but never different keys', async () => {
    const a = service.getCampaign(campaignId);
    const b = service.getCampaign(campaignId);
    expect(calls).toHaveLength(1);
    respond(detail);
    await Promise.all([a, b]);
    const c = service.register(campaignId, versionId, studentId, 'synthetic-key');
    const d = service.register(campaignId, versionId, studentId, 'synthetic-key');
    expect(calls).toHaveLength(2);
    respond(receipt);
    await Promise.all([c, d]);
    const e = service.register(campaignId, versionId, studentId, 'different-key');
    expect(calls).toHaveLength(3);
    respond(receipt);
    await e;
  });
  it.each(['campaign', 'campaign-list', 'registration', 'registration-list'] as const)(
    'invalidates old %s reads while deduplicating only the current scope generation', async (mode) => {
      const scope = service.createReadScope();
      const read = () => mode === 'campaign' ? service.getCampaign(campaignId, versionId, scope)
        : mode === 'campaign-list' ? service.listCampaigns(1, scope)
          : mode === 'registration' ? service.getRegistration(registrationId, scope)
            : service.listRegistrations(1, scope);
      const old = read();
      const sameOld = read();
      const oldCheck = expect(old).rejects.toMatchObject({ code: 'READ_INVALIDATED' });
      const sameOldCheck = expect(sameOld).rejects.toMatchObject({ code: 'READ_INVALIDATED' });
      expect(calls).toHaveLength(1);
      scope.invalidate();
      const fresh = read();
      const sameFresh = read();
      expect(calls).toHaveLength(2);
      const data = mode === 'campaign' ? detail : mode === 'registration' ? result
        : mode === 'campaign-list' ? [summary] : [result];
      const reply = (index: number) => calls[index].success({
        statusCode: 200, data: { data, requestId: 'synthetic-read-scope',
          ...(mode.endsWith('-list') ? { meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } } : {}) },
      });
      reply(0);
      await Promise.all([oldCheck, sameOldCheck]);
      const stillFresh = read();
      expect(calls).toHaveLength(2);
      reply(1);
      await Promise.all([fresh, sameFresh, stillFresh]);
    },
  );
  it('isolates read scopes of separate Pages sharing the same service and token', async () => {
    const a = service.createReadScope();
    const b = service.createReadScope();
    const oldA = service.getCampaign(campaignId, versionId, a);
    const checkA = expect(oldA).rejects.toMatchObject({ code: 'READ_INVALIDATED' });
    const currentB = service.getCampaign(campaignId, versionId, b);
    expect(calls).toHaveLength(2);
    a.invalidate();
    respond(detail, 1);
    expect(await currentB).toEqual(detail);
    respond(detail, 0);
    await checkA;
    const freshA = service.getCampaign(campaignId, versionId, a);
    expect(calls).toHaveLength(3);
    respond(detail, 2);
    expect(await freshA).toEqual(detail);
  });
  it.each(['register', 'cancel'] as const)('retains in-flight %s write deduplication when reads are invalidated', async (kind) => {
    const scope = service.createReadScope();
    const oldRead = service.getCampaign(campaignId, versionId, scope);
    const oldCheck = expect(oldRead).rejects.toMatchObject({ code: 'READ_INVALIDATED' });
    const write = () => kind === 'register'
      ? service.register(campaignId, versionId, studentId, 'same-write-key')
      : service.cancel(registrationId, 1, 'same-write-key');
    const first = write();
    scope.invalidate();
    const repeated = write();
    expect(calls).toHaveLength(2);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(calls[1].header['Idempotency-Key']).toBe('same-write-key');
    respond(detail, 0);
    await oldCheck;
    const writeReceipt = kind === 'register' ? receipt
      : { ...receipt, status: 'CANCELLED', version: 2, cancelledAt: '2026-10-13T01:00:00.000Z' };
    respond(writeReceipt, 1);
    expect(await Promise.all([first, repeated])).toEqual([writeReceipt, writeReceipt]);
  });
  it('parses the standard pagination envelope for both independent lists', async () => {
    for (const [read, item] of [
      [() => service.listCampaigns(2), summary],
      [() => service.listRegistrations(2), result],
    ] as const) {
      const pending = read();
      expect(calls[calls.length - 1].url).toContain('?page=2&pageSize=20');
      calls[calls.length - 1].success({
        statusCode: 200,
        data: { data: [item], requestId: 'synthetic-request', meta: { page: 2, pageSize: 20, total: 21, totalPages: 2 } },
      });
      expect((await pending).meta.page).toBe(2);
    }
  });
  it.each([
    { ...detail, privatePhone: 'forbidden' },
    { ...detail, configuration: { ...configuration, feeFen: 1 } },
    { ...detail, configuration: { ...configuration, benefitMode: 'LESSONS' } },
    { ...detail, configuration: { ...configuration, registrationLimit: 'REPEAT' } },
    { ...detail, configuration: { ...configuration, title: '\ud800' } },
    { ...detail, configuration: { ...configuration, title: 'a\u0000b' } },
    { ...detail, configuration: { ...configuration, title: '😀'.repeat(41) } },
    { ...detail, configuration: { ...configuration, endsAt: '2030-02-30T00:00:00.000Z' } },
    { ...detail, configuration: { ...configuration, capacityMode: 'LIMITED', maxRegistrations: 0 } },
    { ...detail, availability: 'APPROVED' },
    { ...detail, eligibleStudents: [{ ...detail.eligibleStudents[0], parentUserId: 'private' }] },
    { ...detail, eligibleStudents: [detail.eligibleStudents[0], detail.eligibleStudents[0]] },
  ])('rejects malformed or out-of-scope detail %#', async (value) => {
    const pending = service.getCampaign(campaignId);
    const check = expect(pending).rejects.toMatchObject({ statusCode: 502 });
    respond(value);
    await check;
  });
  it('accepts Unicode scalar boundaries and another guardian lifetime claim without a receipt', async () => {
    const pending = service.getCampaign(campaignId);
    respond({
      ...detail, configuration: { ...configuration, title: '😀'.repeat(40) },
      eligibleStudents: [{ ...detail.eligibleStudents[0], eligibility: 'ALREADY_REGISTERED', registration: null }],
    });
    expect((await pending).eligibleStudents[0].registration).toBeNull();
  });
  it('rejects a mismatched or expanded write receipt before exposing it', async () => {
    const pending = service.register(campaignId, versionId, studentId, 'synthetic-key');
    const check = expect(pending).rejects.toMatchObject({ statusCode: 502 });
    respond({ ...receipt, studentId: registrationId, parentUserId: 'private' });
    await check;
  });
  it('does not treat an original REGISTERED receipt as the current result', async () => {
    const pending = service.getRegistration(registrationId);
    respond({ ...result, status: 'CANCELLED', version: 2, cancelledAt: '2026-10-13T01:00:00.000Z', canCancel: false });
    expect((await pending).status).toBe('CANCELLED');
  });
  it.each([
    { data: detail },
    { data: detail, requestId: '', extra: true },
  ])('rejects invalid success envelope %#', async (value) => {
    const pending = service.getCampaign(campaignId);
    const check = expect(pending).rejects.toMatchObject({ statusCode: 502 });
    calls[0].success({ statusCode: 200, data: value });
    await check;
  });
  it('rejects forged page metadata and sensitive result expansion', async () => {
    const pending = service.listRegistrations(1);
    const check = expect(pending).rejects.toMatchObject({ statusCode: 502 });
    calls[0].success({
      statusCode: 200, data: { requestId: 'synthetic', data: [{ ...result, studentName: 'extra' }],
        meta: { page: 2, pageSize: 20, total: 1, totalPages: 7 } },
    });
    await check;
  });
  it('fails closed after credentials or runtime scope change while a response is in flight', async () => {
    const pending = service.getCampaign(campaignId);
    const check = expect(pending).rejects.toMatchObject({ statusCode: 401 });
    owner = 'another-parent';
    respond(detail);
    await check;
  });
  it('bounds reads/writes and ignores late native callbacks after timeout', async () => {
    jest.useFakeTimers();
    const pending = service.register(campaignId, versionId, studentId, 'synthetic-key');
    const check = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT', statusCode: 0 });
    jest.advanceTimersByTime(15_000);
    await check;
    respond(receipt);
    calls[0].fail({});
    const retry = service.register(campaignId, versionId, studentId, 'synthetic-key');
    expect(calls).toHaveLength(2);
    respond(receipt);
    await retry;
  });
  it('rejects invalid identifiers, versions and keys without native requests', async () => {
    await expect(service.getCampaign('private-draft')).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.cancel(registrationId, 0, 'synthetic-key')).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.register(campaignId, versionId, studentId, 'bad')).rejects.toMatchObject({ statusCode: 400 });
    expect(calls).toHaveLength(0);
  });
  it('keeps 409 a failure and does not expose server internal wording', async () => {
    const pending = service.register(campaignId, versionId, studentId, 'synthetic-key');
    const check = expect(pending).rejects.toMatchObject({ statusCode: 409, code: 'FREE_CAMPAIGN_FULL' });
    calls[0].success({ statusCode: 409, data: { error: { code: 'FREE_CAMPAIGN_FULL', message: 'internal SQL' } } });
    await check;
  });
  it('uses explicit approved synthetic fixtures and retains lifetime qualification after cancellation', async () => {
    const mock = new ParentFreeCampaignService({ dataDriver: 'mock', accessToken: () => 'synthetic-mock' });
    const list = await mock.listCampaigns(1);
    expect(list.data[0].title).toContain('合成');
    const campaign = await mock.getCampaign(list.data[0].campaignId);
    const child = campaign.eligibleStudents[0];
    const registered = await mock.register(campaign.campaignId, campaign.versionId, child.studentId, 'synthetic-register');
    expect((await mock.getCampaign(campaign.campaignId)).registeredCount).toBe(1);
    await mock.cancel(registered.registrationId, registered.version, 'synthetic-cancel');
    const replay = await mock.register(campaign.campaignId, campaign.versionId, child.studentId, 'synthetic-register');
    expect(replay.status).toBe('REGISTERED');
    expect((await mock.getRegistration(replay.registrationId)).status).toBe('CANCELLED');
    await expect(mock.register(campaign.campaignId, campaign.versionId, child.studentId, 'another-register'))
      .rejects.toMatchObject({ statusCode: 409 });
    expect((await mock.getCampaign(campaign.campaignId)).eligibleStudents[0].eligibility).toBe('ALREADY_REGISTERED');
  });
  it('does not accept concurrent different synthetic payloads using one key', async () => {
    const mock = new ParentFreeCampaignService({ dataDriver: 'mock', accessToken: () => 'synthetic-mock' });
    const row = (await mock.listCampaigns(1)).data[0];
    const children = (await mock.getCampaign(row.campaignId)).eligibleStudents;
    const results = await Promise.allSettled(children.map((child) =>
      mock.register(row.campaignId, row.versionId, child.studentId, 'same-mock-key')));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await mock.listRegistrations(1)).data).toHaveLength(1);
  });
  it('uses the live runtime/provider instead of capturing credentials or falling back to mock', async () => {
    let current = true;
    const scoped = new ParentFreeCampaignService({
      dataDriver: 'api', apiBaseUrl: 'http://127.0.0.1:3001', accessToken: () => owner,
      request: (options) => calls.push(options), isCurrent: () => current,
    });
    const pending = scoped.getCampaign(campaignId);
    const check = expect(pending).rejects.toMatchObject({ statusCode: 401 });
    current = false;
    respond(detail);
    await check;
    expect(scoped.getSessionKey()).toBe('');
    const noConfig = new ParentFreeCampaignService({ dataDriver: 'api', accessToken: () => owner });
    await expect(noConfig.listCampaigns(1)).rejects.toMatchObject({ code: 'CONFIGURATION_REQUIRED' });
  });
});
