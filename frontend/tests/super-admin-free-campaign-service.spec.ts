import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SessionHttpRequestOptions } from '../services/session.service';

const file = '../pages/super-admin/runtime/free-campaign-review.service';
const implemented = fs.existsSync(path.resolve(__dirname, `${file}.ts`)) ? require(file) : {};
const vid = '10000000-0000-4000-8000-000000000001';
const cid = '20000000-0000-4000-8000-000000000001';
const did = '30000000-0000-4000-8000-000000000001';
const campus = '40000000-0000-4000-8000-000000000001';
const at = '2026-10-13T00:00:00.000Z';
const imageId = '50000000-0000-4000-8000-000000000001';
const imagePath = `/media/partner-campaign-images/${imageId}?expires=1792195200&signature=${'a'.repeat(64)}`;
const image = { id: imageId, mimeType: 'image/png', sizeBytes: 1,
  accessUrl: imagePath, accessUrlExpiresAt: '2026-10-17T00:00:00.000Z' };
const summary = (status = 'SUBMITTED', version = 1) => ({
  versionId: vid, campaignId: cid, draftId: did, campusId: campus,
  title: '合成免费活动', status, version, sequence: 1, submittedAt: at,
  reviewedAt: status === 'SUBMITTED' ? null : at, reviewReason: status === 'REJECTED' ? '补充说明' : null,
});
const detail = () => ({
  ...summary(), configuration: {
    title: '合成免费活动', campaignType: 'FREE_REGISTRATION', shareDescription: '合成报名说明',
    contactPhone: null, startsAt: at, endsAt: '2099-10-13T00:00:00.000Z', timezone: 'Asia/Shanghai',
    capacityMode: 'LIMITED', maxRegistrations: 2, feeFen: 0, benefitMode: 'NONE',
    registrationLimit: 'ONCE_PER_STUDENT',
  }, sourceDraftVersion: 4, campaignVersion: 3, lifecycle: 'OPEN', publishedVersionId: null,
});
const envelope = (data: unknown) => ({ data, requestId: 'synthetic-free-review' });

describe('super admin free campaign review transport', () => {
  let service: any;
  let calls: SessionHttpRequestOptions[];
  let owner: string;
  let request: jest.Mock;
  const api = () => { expect(service).toBeDefined(); return service; };
  const respond = (data: unknown, statusCode = 200) => calls[calls.length - 1].success({ statusCode, data });
  beforeEach(() => {
    owner = 'synthetic-owner-a'; calls = [];
    request = jest.fn((input: SessionHttpRequestOptions) => { calls.push(input); });
    const Class = implemented.ApiFreeCampaignReviewService;
    service = Class && new Class({ baseUrl: 'http://127.0.0.1:3000', session: () => ({ key: owner, token: owner }), request });
  });
  afterEach(() => jest.useRealTimers());
  it.each([
    { cover: null, share: null },
    { cover: image, share: null },
    { cover: null, share: { ...image, mimeType: 'image/jpeg', sizeBytes: 3145728 } },
    { cover: image, share: image },
  ])('resolves frozen images against the API prefix without changing body case %#', async (images) => {
    service = new implemented.ApiFreeCampaignReviewService({
      baseUrl: 'https://api.example.test/api/v1///', session: () => ({ key: owner, token: owner }), request,
    });
    const value = detail();
    const read = api().detail(vid);
    respond(envelope({ ...value, configuration: { ...value.configuration, activityContent: ' 正文\n保留 ', images } }));
    expect((await read).configuration).toEqual({ ...value.configuration, activityContent: '正文\n保留', images: {
      cover: images.cover && { ...images.cover, accessUrl: `https://api.example.test/api/v1${imagePath}` },
      share: images.share && { ...images.share, accessUrl: `https://api.example.test/api/v1${imagePath}` },
    } });
    expect(calls[0].url).toContain('https://api.example.test/api/v1/management/');
    expect(image.accessUrl).toBe(imagePath);
  });
  it('accepts images without the optional activity body', async () => {
    const value = detail();
    const read = api().detail(vid);
    respond(envelope({ ...value, configuration: { ...value.configuration, images: { cover: image, share: null } } }));
    expect((await read).configuration).toMatchObject({
      images: { cover: { ...image, accessUrl: `http://127.0.0.1:3000${imagePath}` }, share: null },
    });
  });
  it.each([
    undefined, null, [], {}, { cover: null }, { cover: null, share: null, extra: true },
    ...['id', 'mimeType', 'sizeBytes', 'accessUrl', 'accessUrlExpiresAt'].map((field) =>
      ({ cover: Object.fromEntries(Object.entries(image).filter(([key]) => key !== field)), share: null })),
    ...[
      { extra: true }, { id: cid.replace('-4000-', '-1000-') },
      { id: imageId.replace('-8000-', '-7000-') }, { mimeType: 'image/webp' },
      { sizeBytes: 0 }, { sizeBytes: 3145729 }, { sizeBytes: 1.5 }, { sizeBytes: '1' },
      { accessUrlExpiresAt: '2026-02-30T00:00:00.000Z' },
      { accessUrlExpiresAt: '2026-10-17T08:00:00+08:00' }, { accessUrlExpiresAt: 'invalid' },
      ...[
        `https://external.test${imagePath}`, `//external.test${imagePath}`, 'javascript:alert(1)',
        imagePath.replace(imageId, cid), imagePath.replace('/media/', '/other/'),
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
    const value = detail();
    const read = api().detail(vid);
    respond(envelope({ ...value, configuration: { ...value.configuration, images } }));
    await expect(read).rejects.toMatchObject({ statusCode: 502, code: 'INVALID_RESPONSE' });
  });
  it.each([
    'ftp://api.example.test/api', 'https://api.example.test/api?x=1', 'https://api.example.test/api#part',
    'https://user:secret@api.example.test/api', 'https://api.example.test\\other/api', 'https:///api',
  ])('rejects unsafe API base before dispatch case %#', async (baseUrl) => {
    const unsafe = new implemented.ApiFreeCampaignReviewService({
      baseUrl, session: () => ({ key: owner, token: owner }), request: (options: SessionHttpRequestOptions) => {
        calls.push(options);
        options.success({ statusCode: 200, data: envelope(detail()) });
      },
    });
    await expect(unsafe.detail(vid)).rejects.toMatchObject({ statusCode: 400 });
    expect(calls).toHaveLength(0);
  });
  it('conditionally renders titled cover and share images with stable uncropped ratios', () => {
    const template = fs.readFileSync(path.resolve(__dirname, '../pages/super-admin/campaign-review-detail/index.wxml'), 'utf8');
    const styles = fs.readFileSync(path.resolve(__dirname, '../pages/super-admin/campaign-review-detail/index.wxss'), 'utf8');
    for (const [slot, label] of [['cover', '活动封面'], ['share', '转发图']]) {
      expect(template).toContain(`wx:if="{{detail.configuration.images.${slot}}}"`);
      expect(template).toContain(`>${label}</text>`);
      expect(template).toContain(`class="free-review-detail__image free-review-detail__image--${slot}" src="{{detail.configuration.images.${slot}.accessUrl}}" mode="aspectFit"`);
    }
    expect(styles).toMatch(/\.free-review-detail__image\s*\{[^}]*width:\s*100%/);
    expect(styles).toMatch(/\.free-review-detail__image--cover\s*\{[^}]*aspect-ratio:\s*2\s*\/\s*3/);
    expect(styles).toMatch(/\.free-review-detail__image--share\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3/);
    expect(template).not.toContain('rich-text');
  });
  it('keeps legacy frozen configuration without activityContent compatible', async () => {
    const read = api().detail(vid);
    respond(envelope(detail()));
    expect(await read).toEqual(detail());
  });
  it.each([
    [null, null],
    ['', null],
    [' \t\r\n\u3000', null],
    [' \n第一行\n第二行\n ', '第一行\n第二行'],
    ['<b>活动</b>\n<script>alert(1)</script>', '<b>活动</b>\n<script>alert(1)</script>'],
    ['a'.repeat(10000), 'a'.repeat(10000)],
    ['\u{1f600}'.repeat(10000), '\u{1f600}'.repeat(10000)],
  ])('accepts and normalizes frozen activityContent case %#', async (input, expected) => {
    const value = detail();
    const read = api().detail(vid);
    respond(envelope({ ...value, configuration: { ...value.configuration, activityContent: input } }));
    expect((await read).configuration).toEqual({ ...value.configuration, activityContent: expected });
  });
  it.each([
    undefined, 1, false, {}, [], 'a'.repeat(10001), '\u{1f600}'.repeat(10001),
    'a\u0000b', '\ud800', '\udfff', '\ud800x', 'x\udfff',
  ])('rejects invalid present frozen activityContent case %#', async (activityContent) => {
    const value = detail();
    const read = api().detail(vid);
    respond(envelope({ ...value, configuration: { ...value.configuration, activityContent } }));
    await expect(read).rejects.toMatchObject({ statusCode: 502, code: 'INVALID_RESPONSE' });
  });
  it.each([
    { privateField: 'unexpected' }, { feeFen: 1 }, { title: '\ud800' }, { startsAt: undefined },
  ])('keeps other frozen configuration validation strict with activityContent case %#', async (change) => {
    const value = detail();
    const read = api().detail(vid);
    respond(envelope({ ...value, configuration: { ...value.configuration, activityContent: '正文', ...change } }));
    await expect(read).rejects.toMatchObject({ statusCode: 502, code: 'INVALID_RESPONSE' });
  });
  it('renders frozen activityContent only when nonempty as plain text with preserved newlines', () => {
    const template = fs.readFileSync(path.resolve(__dirname, '../pages/super-admin/campaign-review-detail/index.wxml'), 'utf8');
    const styles = fs.readFileSync(path.resolve(__dirname, '../pages/super-admin/campaign-review-detail/index.wxss'), 'utf8');
    expect(template).toMatch(/<view wx:if="{{detail\.configuration\.activityContent}}"[^>]*>\s*<text[^>]*>活动正文<\/text>\s*<text class="free-review-detail__content-text">{{detail\.configuration\.activityContent}}<\/text>\s*<\/view>/);
    expect(template).not.toContain('rich-text');
    expect(styles).toMatch(/\.free-review-detail__content-text\s*\{[^}]*white-space:\s*pre-wrap;[^}]*overflow-wrap:\s*anywhere/);
  });
  it('reads the actual filtered flat paginated envelope with formal bearer auth', async () => {
    const read = api().list(2, 'REJECTED');
    expect(calls[0]).toMatchObject({ method: 'GET',
      url: 'http://127.0.0.1:3000/management/campaign-reviews?page=2&pageSize=20&status=REJECTED',
      header: { Authorization: 'Bearer synthetic-owner-a' } });
    respond({ ...envelope([summary('REJECTED', 2)]), meta: { page: 2, pageSize: 20, total: 21, totalPages: 2 } });
    expect((await read).data[0].reviewReason).toBe('补充说明');
  });
  it('reads a complete immutable candidate including independent lifecycle version', async () => {
    const read = api().detail(vid); respond(envelope(detail()));
    expect(await read).toEqual(detail());
  });
  it.each([
    (value: any) => ({ ...value, parentPhone: 'private' }),
    (value: any) => ({ ...value, configuration: { ...value.configuration, feeFen: 1990 } }),
    (value: any) => ({ ...value, configuration: { ...value.configuration, benefitMode: 'GIFT' } }),
    (value: any) => ({ ...value, configuration: { ...value.configuration, endsAt: '2026-02-30T00:00:00.000Z' } }),
    (value: any) => ({ ...value, configuration: { ...value.configuration, maxRegistrations: null } }),
    (value: any) => ({ ...value, configuration: { ...value.configuration, timezone: 'not-a-zone' } }),
    (value: any) => ({ ...value, configuration: { ...value.configuration, title: '\ud800' } }),
    (value: any) => ({ ...value, versionId: cid }),
  ])('fails closed on malformed, mismatched or over-disclosing detail %#', async (change) => {
    const read = api().detail(vid); respond(envelope(change(detail())));
    await expect(read).rejects.toMatchObject({ statusCode: 502 });
  });
  it.each([
    { ...envelope([]), meta: { page: 2, pageSize: 20, total: 0, totalPages: 0 } },
    { ...envelope([summary()]), meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
    { ...envelope([{ ...summary(), studentId: vid }]), meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } },
    { ...envelope([]), meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 }, privateUrl: 'forbidden' },
  ])('rejects invalid pagination and unexpected private fields %#', async (value) => {
    const read = api().list(1, 'SUBMITTED'); respond(value);
    await expect(read).rejects.toMatchObject({ statusCode: 502 });
  });
  it('uses candidate version for approval and trims rejection reason with stable keys', async () => {
    const approve = api().approve(vid, 1, 'synthetic-approve');
    expect(calls[0]).toMatchObject({ method: 'POST', data: { expectedVersion: 1 },
      header: { 'Idempotency-Key': 'synthetic-approve' } });
    respond(envelope(summary('APPROVED', 2))); await approve;
    const reject = api().reject(vid, 1, ' 补充说明 ', 'synthetic-reject');
    expect(calls[1]).toMatchObject({ url: `http://127.0.0.1:3000/management/campaign-reviews/${vid}/reject`,
      data: { expectedVersion: 1, reason: '补充说明' } });
    respond(envelope(summary('REJECTED', 2))); await reject;
  });
  it('closes using campaignVersion and requires a matching CLOSED receipt', async () => {
    const close = api().close(cid, 3, ' 下架 ', 'synthetic-close');
    expect(calls[0]).toMatchObject({ url: `http://127.0.0.1:3000/management/campaigns/${cid}/close`,
      data: { expectedVersion: 3, reason: '下架' } });
    respond(envelope({ campaignId: cid, lifecycle: 'CLOSED', version: 4 }));
    expect(await close).toEqual({ campaignId: cid, lifecycle: 'CLOSED', version: 4 });
  });
  it.each(['approve', 'reject', 'close'])('explicitly declares JSON for the %s POST without transport defaults', async (action) => {
    const key = `synthetic-json-${action}`;
    const write = action === 'approve' ? api().approve(vid, 1, key)
      : action === 'reject' ? api().reject(vid, 1, '补充说明', key)
        : api().close(cid, 3, '下架', key);
    respond(envelope(action === 'close'
      ? { campaignId: cid, lifecycle: 'CLOSED', version: 4 }
      : summary(action === 'approve' ? 'APPROVED' : 'REJECTED', 2)));
    await write;
    expect(calls[0]).toMatchObject({
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer synthetic-owner-a',
        'Idempotency-Key': key,
      },
    });
  });
  it.each([
    { campaignId: cid, lifecycle: 'OPEN', version: 4 },
    { campaignId: vid, lifecycle: 'CLOSED', version: 4 },
    { campaignId: cid, lifecycle: 'CLOSED', version: 3 },
    { campaignId: cid, lifecycle: 'CLOSED', version: 4, private: true },
  ])('rejects a false closure or mismatched lifecycle receipt %#', async (value) => {
    const write = api().close(cid, 3, '下架', 'synthetic-close'); respond(envelope(value));
    await expect(write).rejects.toMatchObject({ statusCode: 502 });
  });
  it('rejects a wrong action or stale review receipt rather than claiming success', async () => {
    const write = api().approve(vid, 1, 'synthetic-approve');
    respond(envelope(summary('REJECTED', 2)));
    await expect(write).rejects.toMatchObject({ statusCode: 502 });
  });
  it.each([401, 403, 409, 503])('preserves statusCode %s without exposing server messages', async (statusCode) => {
    const read = api().detail(vid); respond({ message: 'private server contents' }, statusCode);
    await expect(read).rejects.toMatchObject({ statusCode });
  });
  it('rejects owner changes before returning a late write receipt', async () => {
    const write = api().approve(vid, 1, 'synthetic-approve'); owner = 'synthetic-owner-b';
    respond(envelope(summary('APPROVED', 2)));
    await expect(write).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' });
  });
  it('invalidates reads while preserving an already dispatched write for same-key resolution', async () => {
    const read = api().detail(vid); const readOptions = calls[0];
    api().invalidateReads(); readOptions.success({ statusCode: 200, data: envelope(detail()) });
    await expect(read).rejects.toMatchObject({ code: 'READ_SUPERSEDED' });
    const write = api().approve(vid, 1, 'synthetic-approve'); api().invalidateReads();
    respond(envelope(summary('APPROVED', 2)));
    await expect(write).resolves.toMatchObject({ status: 'APPROVED' });
  });
  it('times out once, ignores late callbacks, and permits replay with the original key', async () => {
    jest.useFakeTimers();
    const write = api().approve(vid, 1, 'synthetic-approve');
    const failed = expect(write).rejects.toMatchObject({ statusCode: 0 });
    jest.advanceTimersByTime(15_000); await failed;
    respond(envelope(summary('APPROVED', 2))); calls[0].fail({});
    const retry = api().approve(vid, 1, 'synthetic-approve');
    expect(calls[1].header['Idempotency-Key']).toBe(calls[0].header['Idempotency-Key']);
    respond(envelope(summary('APPROVED', 2))); await retry;
  });
  it('catches synchronous native transport failure and releases the timer', async () => {
    request.mockImplementationOnce(() => { throw new Error('native error'); });
    await expect(api().detail(vid)).rejects.toMatchObject({ statusCode: 0 });
  });
  it.each(['', ' ', '\ud800', 'x'.repeat(1001)])('rejects invalid reasons before dispatch %#', async (reason) => {
    await expect(api().reject(vid, 1, reason, 'synthetic-reject')).rejects.toMatchObject({ statusCode: 400 });
    expect(request).not.toHaveBeenCalled();
  });
  it('accepts 1000 Unicode code points even when UTF16 length is larger', async () => {
    const reason = '\u{1f600}'.repeat(1000);
    const write = api().reject(vid, 1, reason, 'synthetic-reject');
    respond(envelope({ ...summary('REJECTED', 2), reviewReason: reason })); await write;
  });
});

describe('explicit synthetic free campaign review service', () => {
  it('provides isolated synthetic candidates, respects terminal states and replays original actions', async () => {
    const Class = implemented.MockFreeCampaignReviewService; expect(Class).toBeDefined();
    let owner = 'synthetic-owner-a';
    const mock = new Class(() => owner);
    expect(mock.isMock).toBe(true);
    const first = (await mock.list(1, 'SUBMITTED')).data[0]; expect(first.title).toContain('合成');
    const approved = await mock.approve(first.versionId, first.version, 'synthetic-approve');
    expect(approved.status).toBe('APPROVED');
    expect(await mock.approve(first.versionId, first.version, 'synthetic-approve')).toEqual(approved);
    await expect(mock.reject(first.versionId, first.version, '补充说明', 'synthetic-reject')).rejects.toMatchObject({ statusCode: 409 });
    await expect(mock.approve(cid, 1, 'synthetic-unknown')).rejects.toMatchObject({ statusCode: 404 });
    owner = 'synthetic-owner-b';
    expect((await mock.list(1, 'SUBMITTED')).data.some((row: any) => row.versionId === first.versionId)).toBe(true);
    owner = '';
    await expect(mock.list(1, '')).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('free campaign review actual runtime identity boundaries', () => {
  let stored: Map<string, unknown>;
  let runtime: () => any;
  beforeEach(() => {
    stored = new Map<string, unknown>([
      ['education.runtime', { dataDriver: 'mock', apiBaseUrl: '', accessToken: '' }],
      ['education.test-account.current', 'SUPER_ADMIN'],
    ]);
    (global as any).wx = { getStorageSync: (key: string) => stored.get(key), request: jest.fn() };
    jest.isolateModules(() => {
      runtime = require('../pages/super-admin/runtime/free-campaign-review-runtime').getFreeCampaignReviewRuntime;
    });
  });
  afterEach(() => { delete (global as any).wx; });
  it.each(['PARENT', 'HR', '13800000001'])('denies synthetic review reads and writes to %s', async (account) => {
    stored.set('education.test-account.current', account);
    const service = runtime();
    await expect(service.list(1, '')).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.approve(vid, 1, 'synthetic-approve')).rejects.toMatchObject({ statusCode: 403 });
    expect((global as any).wx.request).not.toHaveBeenCalled();
  });
  it('requires an explicit current mock session instead of inventing an owner', async () => {
    stored.set('education.test-account.current', '');
    expect(runtime().getSessionKey()).toBe('');
    await expect(runtime().list(1, '')).rejects.toMatchObject({ statusCode: 401 });
  });
  it('uses the current session role for phone accounts and blocks an old owner during authorization', async () => {
    stored.set('education.test-account.current', '13800000005');
    const service = runtime();
    const row = (await service.list(1, 'SUBMITTED')).data[0];
    const pending = service.approve(row.versionId, row.version, 'synthetic-approve');
    stored.set('education.test-account.current', 'HR');
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' });
    stored.set('education.test-account.current', '13800000005');
    expect((await service.detail(row.versionId)).status).toBe('SUBMITTED');
  });
  it('rechecks the owner after async authorization before touching its synthetic records', async () => {
    const service = runtime();
    const row = (await service.list(1, 'SUBMITTED')).data[0];
    const pending = service.approve(row.versionId, row.version, 'synthetic-after-auth');
    await Promise.resolve(); await Promise.resolve();
    stored.set('education.test-account.current', 'HR');
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' });
    stored.set('education.test-account.current', 'SUPER_ADMIN');
    expect((await service.detail(row.versionId)).status).toBe('SUBMITTED');
  });
  it('invalidates old reads and session keys across normalized base, token and driver changes', async () => {
    stored.set('education.runtime', { dataDriver: 'api', apiBaseUrl: 'http://127.0.0.1:3000/', accessToken: 'synthetic-a' });
    const old = runtime(); const oldKey = old.getSessionKey();
    const pending = old.detail(vid);
    const failed = expect(pending).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' });
    stored.set('education.runtime', { dataDriver: 'api', apiBaseUrl: 'http://127.0.0.1:3000', accessToken: 'synthetic-b' });
    expect(runtime()).toBe(old); expect(old.getSessionKey()).not.toBe(oldKey);
    (global as any).wx.request.mock.calls[0][0].success({ statusCode: 200, data: envelope(detail()) });
    await failed;
    stored.set('education.runtime', { dataDriver: 'api', apiBaseUrl: 'http://127.0.0.1:3001', accessToken: 'synthetic-b' });
    expect(runtime()).not.toBe(old); expect(old.getSessionKey()).toBe('');
    const api = runtime();
    stored.set('education.runtime', { dataDriver: 'mock', apiBaseUrl: '', accessToken: '' });
    expect(runtime().isMock).toBe(true); expect(api.getSessionKey()).toBe('');
    stored.set('education.session.logged-out', true);
    expect(runtime().getSessionKey()).toBe('');
  });
});
