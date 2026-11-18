import * as fs from 'node:fs';
import * as path from 'node:path';

interface DownloadOptions {
  url: string;
  header: Record<string, string>;
  success(value: { statusCode: number; tempFilePath: string }): void;
  fail(value: unknown): void;
}
const apiBaseUrl = 'https://operator.example.test/api';
const mediaRoot = '/operators/me/students/student-a/archive/media';
const file = { id: 'file-a', mimeType: 'image/png', sizeBytes: 120, accessUrl: `${mediaRoot}/file-a` };
const flush = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };

function setup() {
  const modulePath = path.resolve(__dirname, '../pages/operator/runtime/services/operator-student-media.ts');
  const loaded = fs.existsSync(modulePath) ? require(modulePath) : {};
  expect(typeof loaded.OperatorStudentMediaReader).toBe('function');
  let token = 'synthetic-manager';
  let current = true;
  const calls: DownloadOptions[] = [];
  const abort = jest.fn();
  const download = jest.fn((options: DownloadOptions) => {
    calls.push(options);
    return { abort };
  });
  const reader = new loaded.OperatorStudentMediaReader({
    apiBaseUrl, studentId: 'student-a', accessToken: () => token, isCurrent: () => current, download,
  });
  return {
    reader, calls, abort, download,
    token(value: string) { token = value; },
    current(value: boolean) { current = value; },
  };
}

it('downloads only the authorized file with the current bearer token', async () => {
  const env = setup();
  const result = env.reader.load(file);
  await flush();
  expect(env.calls[0]).toMatchObject({
    url: `${apiBaseUrl}${file.accessUrl}`, header: { Authorization: 'Bearer synthetic-manager' },
  });
  env.calls[0].success({ statusCode: 200, tempFilePath: 'wxfile://private-a.png' });
  await expect(result).resolves.toBe('wxfile://private-a.png');
});

it('coalesces in-flight reads but reauthorizes every later read instead of caching private files', async () => {
  const env = setup();
  const first = env.reader.load(file);
  expect(env.reader.load(file)).toBe(first);
  await flush();
  expect(env.calls).toHaveLength(1);
  env.calls[0].success({ statusCode: 200, tempFilePath: 'wxfile://first.png' });
  await first;
  env.token('synthetic-current-manager');
  const next = env.reader.load(file);
  await flush();
  expect(env.calls).toHaveLength(2);
  expect(env.calls[1].header.Authorization).toBe('Bearer synthetic-current-manager');
  env.calls[1].success({ statusCode: 200, tempFilePath: 'wxfile://second.png' });
  await expect(next).resolves.toBe('wxfile://second.png');
});

it.each([
  'https://outside.example.test/file-a',
  `${apiBaseUrl}${file.accessUrl}`,
  '//outside.example.test/file-a',
  `${mediaRoot.replace('student-a', 'student-b')}/file-a`,
  `${mediaRoot}/file-b`,
  `${mediaRoot}/file-a?signature=public`,
  `${mediaRoot}/file-a#private`,
])('rejects an unrelated or signed media URL before sending credentials (%s)', async (accessUrl) => {
  const env = setup();
  await expect(env.reader.load({ ...file, accessUrl })).rejects.toMatchObject({ statusCode: 400 });
  expect(env.download).not.toHaveBeenCalled();
});

it.each(['image/svg+xml', 'image/webp', 'text/html'])('rejects a non-contract media type (%s)', async (mimeType) => {
  const env = setup();
  await expect(env.reader.load({ ...file, mimeType })).rejects.toMatchObject({ statusCode: 400 });
  expect(env.download).not.toHaveBeenCalled();
});

it.each(['', '   '])('requires an active access token (%j)', async (token) => {
  const env = setup();
  env.token(token);
  await expect(env.reader.load(file)).rejects.toMatchObject({ statusCode: 401 });
  expect(env.download).not.toHaveBeenCalled();
});

it('does not dispatch queued media after its page or owner changes', async () => {
  const env = setup();
  const result = env.reader.load(file).catch((error: unknown) => error);
  env.current(false);
  await flush();
  expect(env.download).not.toHaveBeenCalled();
  expect(await result).toMatchObject({ statusCode: 0 });
});

it('rejects late private bytes when the owner changes during download', async () => {
  const env = setup();
  const result = env.reader.load(file).catch((error: unknown) => error);
  await flush();
  env.current(false);
  env.calls[0].success({ statusCode: 200, tempFilePath: 'wxfile://old-owner.png' });
  expect(await result).toMatchObject({ statusCode: 0 });
});

it('aborts and settles invalidated reads while ignoring old callbacks after a fresh read', async () => {
  const env = setup();
  const first = env.reader.load(file).catch((error: unknown) => error);
  await flush();
  env.reader.invalidate();
  expect(env.abort).toHaveBeenCalledTimes(1);
  expect(await first).toMatchObject({ statusCode: 0 });
  const next = env.reader.load(file);
  await flush();
  env.calls[0].success({ statusCode: 200, tempFilePath: 'wxfile://obsolete.png' });
  expect(env.reader.load(file)).toBe(next);
  env.calls[1].success({ statusCode: 200, tempFilePath: 'wxfile://current.png' });
  await expect(next).resolves.toBe('wxfile://current.png');
});

it('cancels only unlinked in-flight files and leaves retained reads usable', async () => {
  const env = setup();
  const second = { ...file, id: 'file-b', accessUrl: `${mediaRoot}/file-b` };
  const firstRead = env.reader.load(file).catch((error: unknown) => error);
  const secondRead = env.reader.load(second);
  await flush();
  expect(typeof env.reader.retain).toBe('function');
  env.reader.retain(new Set(['file-b']));
  expect(await firstRead).toMatchObject({ statusCode: 0 });
  env.calls[0].success({ statusCode: 200, tempFilePath: 'wxfile://unlinked.png' });
  env.calls[1].success({ statusCode: 200, tempFilePath: 'wxfile://retained.png' });
  await expect(secondRead).resolves.toBe('wxfile://retained.png');
});

it.each([401, 403, 404, 503])('preserves media HTTP %s without treating its temp path as an image', async (statusCode) => {
  const env = setup();
  const result = env.reader.load(file);
  await flush();
  env.calls[0].success({ statusCode, tempFilePath: 'wxfile://error-body' });
  await expect(result).rejects.toMatchObject({ statusCode });
});

it('rejects an empty native file and releases the pending read for a retry', async () => {
  const env = setup();
  const first = env.reader.load(file);
  await flush();
  env.calls[0].success({ statusCode: 200, tempFilePath: '' });
  await expect(first).rejects.toMatchObject({ statusCode: 0 });
  const retry = env.reader.load(file);
  await flush();
  env.calls[1].success({ statusCode: 200, tempFilePath: 'wxfile://retry.png' });
  await expect(retry).resolves.toBe('wxfile://retry.png');
});

it('releases the read after native failure or a synchronous native exception without exposing its URL', async () => {
  const env = setup();
  const first = env.reader.load(file);
  await flush();
  env.calls[0].fail({ errMsg: `download failed ${file.accessUrl}` });
  await expect(first).rejects.toMatchObject({ statusCode: 0, message: '图片读取失败，请重试' });
  env.download.mockImplementationOnce(() => { throw new Error('private native URL'); });
  await expect(env.reader.load(file)).rejects.toMatchObject({ statusCode: 0, message: '图片读取失败，请重试' });
});
