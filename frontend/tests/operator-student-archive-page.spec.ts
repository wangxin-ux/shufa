import { capture, flush, tap } from './operator-page-host';
import { archive, growth, image } from './operator-student-archive.fixture';

type Env = ReturnType<typeof capture>;
const growthBody = (items = [growth], page = 1, total = items.length) => ({
  data: { items }, meta: { page, pageSize: 5, total, totalPages: Math.ceil(total / 5) }, requestId: 'synthetic',
});
async function loaded(photo = false, images = false, total = 1) {
  const env = capture(['student-detail']);
  const page = env.instantiate();
  page.onLoad({ id: archive.id }); page.onShow(); await flush();
  expect(env.calls.map((call) => new URL(call.url).pathname)).toEqual([
    `/operators/me/students/${archive.id}/archive`,
    `/operators/me/students/${archive.id}/archive/growth`,
  ]);
  env.reply(0, { data: { ...archive, photo: photo ? image : null } });
  env.reply(1, growthBody([{ ...growth, feedbackImages: images ? [image] : [] }], 1, total));
  await flush();
  return { env, page };
}

it('renders the approved archive and independent growth without exposing remote media or birthdate', async () => {
  const { env, page } = await loaded(true, true);
  try {
    expect(page.data.detail).toMatchObject({ id: archive.id, ageLabel: '8岁', mainBalanceLabel: '11' });
    expect(page.data.growthItems[0]).toMatchObject({ id: growth.lessonSessionId, feedbackAuthorLabel: '反馈李老师' });
    expect(JSON.stringify(page.data)).not.toMatch(/birthDate|accessUrl|Bearer/);
    expect(env.downloads).toHaveLength(1);
    expect(env.downloads[0]).toMatchObject({
      url: `https://operator.example.test${image.accessUrl}`, header: { Authorization: 'Bearer synthetic-owner-a' },
    });
    env.downloads[0].success({ statusCode: 200, tempFilePath: 'wxfile://authorized.png' }); await flush();
    expect(page.data.photo.localPath).toBe('wxfile://authorized.png');
    expect(page.data.growthItems[0].images[0].localPath).toBe('wxfile://authorized.png');
  } finally { env.close(); }
});

it('keeps growth page one after page-two failure, retries page two and merges by lesson ID', async () => {
  const { env, page } = await loaded(false, false, 12);
  try {
    page.onGrowthLoadMore(); page.onGrowthLoadMore(); await flush();
    expect(env.calls).toHaveLength(3);
    expect(new URL(env.calls[2].url).search).toBe('?page=2&pageSize=5');
    env.reply(2, {}, 503); await flush();
    expect(page.data).toMatchObject({ growthPage: 1, growthHasMore: true, growthLoading: false });
    expect(page.data.growthItems).toHaveLength(1);
    expect(page.data.growthError).toBeTruthy();
    page.onGrowthLoadMore(); await flush();
    expect(new URL(env.calls[3].url).searchParams.get('page')).toBe('2');
    env.reply(3, growthBody([growth, { ...growth, lessonSessionId: 'synthetic-lesson-b' }], 2, 12)); await flush();
    expect(page.data.growthItems.map((item: any) => item.id)).toEqual([growth.lessonSessionId, 'synthetic-lesson-b']);
    expect(page.data.growthError).toBe('');
  } finally { env.close(); }
});

it('retries failed growth refresh at page one even when the prior history had no more pages', async () => {
  const { env, page } = await loaded();
  try {
    page.onRetry(); await flush();
    env.reply(2, { data: archive }); env.reply(3, {}, 503); await flush();
    expect(page.data.growthItems).toHaveLength(1);
    expect(page.data.growthError).toBeTruthy();
    page.onGrowthRetry(); await flush();
    expect(env.calls).toHaveLength(5);
    expect(new URL(env.calls[4].url).searchParams.get('page')).toBe('1');
    env.reply(4, growthBody([])); await flush();
    expect(page.data).toMatchObject({ growthState: 'empty', growthItems: [], growthError: '' });
  } finally { env.close(); }
});

it('keeps pending row errors and photo errors when list pagination appends new students', async () => {
  const env = capture(['students']);
  try {
    const page = env.instantiate(); page.onLoad(); page.onShow(); await flush();
    const roster = { id: archive.id, campusId: 'synthetic-campus', displayName: '陈晨', ageYears: null, classNames: [] };
    env.reply(0, { data: [roster], meta: { page: 1, pageSize: 20, total: 21, totalPages: 2 } }); await flush();
    page.onStudentToggle(tap(archive.id)); await flush();
    env.reply(1, {}, 503); await flush();
    const message = page.data.items[0].archiveError;
    page.onLoadMore(); await flush();
    env.reply(2, { data: [{ ...roster, id: 'synthetic-next' }],
      meta: { page: 2, pageSize: 20, total: 21, totalPages: 2 } }); await flush();
    expect(page.data.items[0]).toMatchObject({ archiveState: 'error', archiveError: message });
  } finally { env.close(); }
});

async function gallery() {
  const env = capture(['student-detail']);
  const page = env.instantiate();
  page.onLoad({ id: archive.id }); page.onShow(); await flush();
  const secondImage = { ...image, id: 'synthetic-image-b',
    accessUrl: image.accessUrl.replace(image.id, 'synthetic-image-b') };
  env.reply(0, { data: archive });
  env.reply(1, growthBody([{ ...growth, feedbackImages: [image, secondImage] }], 1, 6)); await flush();
  env.downloads[0].success({ statusCode: 200, tempFilePath: 'wxfile://thumb-a.png' });
  env.downloads[1].success({ statusCode: 200, tempFilePath: 'wxfile://thumb-b.png' }); await flush();
  return { env, page };
}

it.each([401, 403])('handles every gallery result when an earlier download failed before a late %s', async (status) => {
  const { env, page } = await gallery();
  try {
    page.onPreviewImage(tap(image.id)); await flush();
    env.downloads[2].success({ statusCode: 503, tempFilePath: 'wxfile://error' }); await flush();
    env.downloads[3].success({ statusCode: status, tempFilePath: 'wxfile://error' }); await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', detail: null, growthItems: [], photo: null });
  } finally { env.close(); }
});

it('refuses a pending preview whose feedback image association was replaced by an overlapping growth page', async () => {
  const { env, page } = await gallery();
  try {
    page.onPreviewImage(tap(image.id)); page.onGrowthLoadMore(); await flush();
    env.reply(2, growthBody([{ ...growth, feedbackImages: [] }], 2, 6)); await flush();
    env.downloads[2].success({ statusCode: 200, tempFilePath: 'wxfile://obsolete-a.png' });
    env.downloads[3].success({ statusCode: 200, tempFilePath: 'wxfile://obsolete-b.png' }); await flush();
    expect(env.platform.previewImage).not.toHaveBeenCalled();
    expect(page.data.previewBusy).toBe(false);
    expect(page.mediaFiles.has(image.id)).toBe(false);
    expect(env.downloads[2].abort).toHaveBeenCalled();
  } finally { env.close(); }
});

it('provides row retry when a list refresh interrupted an archive read and then failed', async () => {
  const env = capture(['students']);
  try {
    const page = env.instantiate(); page.onLoad(); page.onShow(); await flush();
    env.reply(0, { data: [{ id: archive.id, campusId: 'synthetic-campus', displayName: '陈晨', ageYears: null, classNames: [] }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }); await flush();
    page.onStudentToggle(tap(archive.id)); await flush();
    page.onPullDownRefresh(); await flush();
    env.reply(2, {}, 503); await flush();
    expect(page.archiveRequests.size).toBe(0);
    expect(page.data.items[0]).toMatchObject({ archiveState: 'error', archiveError: expect.any(String) });
    expect(page.data.items[0].archiveError).toBeTruthy();
    page.onArchiveRetry(tap(archive.id)); await flush();
    env.reply(3, { data: archive }); await flush();
    expect(page.data.items[0].archiveState).toBe('ready');
    env.reply(1, { data: { ...archive, displayName: '旧摘要' } }); await flush();
    expect(page.data.items[0].archive.displayName).toBe('陈晨');
  } finally { env.close(); }
});

it('waits for both reads when a pull refresh is repeated while growth is still pending', async () => {
  const { env, page } = await loaded();
  try {
    page.onPullDownRefresh(); page.onPullDownRefresh(); await flush();
    env.reply(2, { data: archive }); await flush();
    expect(page.data.growthLoading).toBe(true);
    expect(env.platform.stopPullDownRefresh).not.toHaveBeenCalled();
    env.reply(3, growthBody([])); await flush();
    expect(env.platform.stopPullDownRefresh).toHaveBeenCalledTimes(1);
    expect(page.data.growthLoading).toBe(false);
  } finally { env.close(); }
});

it.each([401, 403])('clears both read lanes and protected image references on hidden growth %s', async (status) => {
  const { env, page } = await loaded(true, false, 12);
  try {
    env.downloads[0].success({ statusCode: 200, tempFilePath: 'wxfile://private.png' }); await flush();
    page.onGrowthLoadMore(); await flush(); page.onHide();
    env.reply(2, {}, status); await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', detail: null, growthItems: [], photo: null, studentId: '' });
    page.onShow(); page.onRetry(); page.onGrowthLoadMore(); await flush();
    expect(env.calls).toHaveLength(3);
  } finally { env.close(); }
});

it('redownloads for every preview, locks duplicate taps, and recovers from native failure and throw', async () => {
  const { env, page } = await loaded(true);
  try {
    env.downloads[0].success({ statusCode: 200, tempFilePath: 'wxfile://thumbnail.png' }); await flush();
    page.onPreviewImage(tap(image.id)); page.onPreviewImage(tap(image.id)); await flush();
    expect(env.downloads).toHaveLength(2);
    expect(env.platform.previewImage).not.toHaveBeenCalled();
    env.downloads[1].success({ statusCode: 200, tempFilePath: 'wxfile://preview.png' }); await flush();
    expect(env.platform.previewImage).toHaveBeenCalledWith(expect.objectContaining({
      current: 'wxfile://preview.png', urls: ['wxfile://preview.png'],
    }));
    env.platform.previewImage.mock.calls[0][0].fail({ errMsg: 'synthetic' }); await flush();
    expect(page.data.previewBusy).toBe(false);
    env.platform.previewImage.mockImplementationOnce(() => { throw new Error('native'); });
    page.onPreviewImage(tap(image.id)); await flush();
    env.downloads[2].success({ statusCode: 200, tempFilePath: 'wxfile://retry.png' }); await flush();
    expect(page.data.previewBusy).toBe(false);
    page.onPreviewImage(tap(image.id)); await flush();
    expect(env.downloads).toHaveLength(4);
  } finally { env.close(); }
});

it.each([401, 403])('clears archive and growth on protected media %s', async (status) => {
  const { env, page } = await loaded(true, true);
  try {
    env.downloads[0].success({ statusCode: status, tempFilePath: 'wxfile://error' }); await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', detail: null, growthItems: [], photo: null });
    expect(env.platform.previewImage).not.toHaveBeenCalled();
  } finally { env.close(); }
});

it('clears image paths on hide, ignores old bytes and reloads current association on return', async () => {
  const { env, page } = await loaded(true);
  try {
    page.onHide();
    expect(env.downloads[0].abort).toHaveBeenCalled();
    const writes = page.setData.mock.calls.length;
    env.downloads[0].success({ statusCode: 200, tempFilePath: 'wxfile://old.png' }); await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(page.data.photo.localPath).toBe('');
    page.onShow(); await flush();
    env.reply(2, { data: { ...archive, photo: null } }); env.reply(3, growthBody([])); await flush();
    expect(page.data.photo).toBeNull();
    expect(page.data.growthItems).toEqual([]);
  } finally { env.close(); }
});

it('rejects a prior owners media/preview callbacks without altering the new owner', async () => {
  const { env, page } = await loaded(true);
  try {
    env.change({ accessToken: 'synthetic-new-owner', apiBaseUrl: 'https://current.example.test/api' });
    env.downloads[0].success({ statusCode: 200, tempFilePath: 'wxfile://old-owner.png' }); await flush();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.photo).toBeNull();
    page.onPreviewImage(tap(image.id));
    expect(env.platform.previewImage).not.toHaveBeenCalled();
    page.onLogin();
    expect(env.values.get('education.runtime').accessToken).toBe('synthetic-new-owner');
  } finally { env.close(); }
});

it('lazily reads per-ID list summaries, isolates errors and does not fetch growth for expanded rows', async () => {
  const env = capture(['students']);
  try {
    const page = env.instantiate(); page.onLoad(); page.onShow(); await flush();
    const roster = (id: string) => ({ id, campusId: 'synthetic-campus', displayName: '陈晨',
      ageYears: 8, classNames: ['创意班'] });
    env.reply(0, { data: [roster(archive.id), roster('synthetic-student-b')],
      meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 } }); await flush();
    expect(env.calls).toHaveLength(1);
    page.onStudentToggle(tap(archive.id)); page.onStudentToggle(tap('synthetic-student-b')); await flush();
    expect(env.calls.slice(1).every((call) => call.url.endsWith('/archive'))).toBe(true);
    env.reply(2, {}, 503); env.reply(1, { data: archive }); await flush();
    expect(page.data.items[0].archive).toMatchObject({ ageLabel: '8岁', totalBalanceLabel: '13' });
    expect(page.data.items[1]).toMatchObject({ archive: null, archiveState: 'error' });
    expect(JSON.stringify(page.data.items)).not.toContain('birthDate');
    page.onArchiveRetry(tap('synthetic-student-b')); await flush();
    env.reply(3, { data: { ...archive, id: 'synthetic-student-b', ageYears: null } }); await flush();
    expect(page.data.items[1].archive.ageLabel).toBe('年龄未填写');
    expect(env.calls).toHaveLength(4);
  } finally { env.close(); }
});
