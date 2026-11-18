import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApiTeacherDataSource } from '../data/api-teacher-data-source';
import {
  createTeacherHttpPageHost, TeacherPageHttpTransport,
} from './teacher-http-page-test-support';

interface WireRequest {
  method: string;
  url: string;
  authorization?: string;
}

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function stop(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

const wireRequest = (request: IncomingMessage): WireRequest => ({
  method: request.method!, url: request.url!, authorization: request.headers.authorization,
});

const token = 'synthetic-teacher-http';
const lessonId = '70000000-0000-4000-8000-000000000002';
const lessonPath = `/teachers/me/lesson-sessions/${lessonId}`;
const feedbackRecordsPath = '/teachers/me/teaching-records';

it('sends the actual feedback Page request over loopback HTTP without a business reply', async () => {
  const received: WireRequest[] = [];
  const server = createServer((request, response) => {
    received.push(wireRequest(request));
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ code: 'WIRING_PROBE', message: 'No business fixture attached' }));
  });
  const origin = await listen(server);
  const host = createTeacherHttpPageHost({
    origin, accessToken: token,
    routes: [{ method: 'GET', path: feedbackRecordsPath }],
  });
  try {
    const page = host.capture('feedback');
    page.onLoad(); page.onShow();
    await host.idle();
    expect(received).toEqual([{
      method: 'GET', url: `${feedbackRecordsPath}?page=1&pageSize=20`,
      authorization: `Bearer ${token}`,
    }]);
    expect(page.data).toMatchObject({ viewState: 'error', items: [], page: 0, hasMore: false });
    expect(page.data.errorMessage).toBeTruthy();
    expect(host).not.toHaveProperty('reply');
    expect(host.transport.calls.map(({ status }) => status)).toEqual([503]);
    expect(host.transport.pendingCount).toBe(0);
  } finally {
    await host.close();
    await stop(server);
  }
});

it('preserves Shanghai date bounds and status in the adapter HTTP query', async () => {
  const received: WireRequest[] = [];
  const server = createServer((request, response) => {
    received.push(wireRequest(request));
    response.writeHead(503).end('No business fixture attached');
  });
  const origin = await listen(server);
  const transport = new TeacherPageHttpTransport({
    origin, accessToken: token, routes: [{ method: 'GET', path: '/teachers/me/lesson-sessions' }],
  });
  try {
    const source = new ApiTeacherDataSource({ baseUrl: origin, accessToken: token, request: transport.request });
    await expect(source.listLessonSessions({
      page: 1, pageSize: 10, from: '2026-08-30T00:00:00+08:00',
      to: '2026-08-31T00:00:00+08:00', status: 'SCHEDULED',
    })).rejects.toMatchObject({ statusCode: 503 });
    await transport.idle();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: 'GET', authorization: `Bearer ${token}` });
    const query = new URL(received[0].url, origin);
    expect(query.pathname).toBe('/teachers/me/lesson-sessions');
    expect(Object.fromEntries(query.searchParams)).toEqual({
      page: '1', pageSize: '10', from: '2026-08-30T00:00:00+08:00',
      to: '2026-08-31T00:00:00+08:00', status: 'SCHEDULED',
    });
    expect(transport.calls).toMatchObject([{ status: 503, delivery: 'response' }]);
    expect(transport.pendingCount).toBe(0);
  } finally {
    await transport.close();
    await stop(server);
  }
});

it.each([401, 403, 503])('delivers HTTP %i to the actual feedback detail Page without a roster', async (status) => {
  const received: WireRequest[] = [];
  const server = createServer((request, response) => {
    received.push(wireRequest(request));
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ code: 'WIRING_PROBE', message: 'No business fixture attached' }));
  });
  const origin = await listen(server);
  const host = createTeacherHttpPageHost({
    origin, accessToken: token, routes: [{ method: 'GET', path: lessonPath }],
  });
  try {
    const page = host.capture('feedback-detail');
    page.onLoad({ id: lessonId }); page.onShow(); await host.idle();
    expect(received).toEqual([{ method: 'GET', url: lessonPath, authorization: `Bearer ${token}` }]);
    expect(page.data).toMatchObject({
      viewState: status === 503 ? 'error' : 'forbidden', students: [], detail: null,
      feedbackSubmittingId: '', feedbackUploadingId: '', draftImageUrls: {},
      lessonId: status === 503 ? lessonId : '',
    });
    expect(page.data.errorMessage).toBeTruthy();
    page.onRetry(); await host.idle();
    expect(received).toHaveLength(status === 503 ? 2 : 1);
    expect(host.transport.calls.every((call) => call.status === status)).toBe(true);
  } finally {
    await host.close();
    await stop(server);
  }
});

it.each(['PUT', 'POST'] as const)('sends adapter %s JSON and idempotency headers without accepting a mutation', async (method) => {
  const received: Array<WireRequest & { key?: string; contentType?: string; body: unknown }> = [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => { body += chunk; });
    request.on('end', () => {
      received.push({
        ...wireRequest(request), key: request.headers['idempotency-key'] as string,
        contentType: request.headers['content-type'], body: JSON.parse(body) as unknown,
      });
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ code: 'WIRING_PROBE', message: 'No mutation handler attached' }));
    });
  });
  const origin = await listen(server);
  const path = `${lessonPath}/${method === 'PUT' ? 'attendance' : 'complete'}`;
  const transport = new TeacherPageHttpTransport({
    origin, accessToken: token, routes: [{ method, path }],
  });
  try {
    const source = new ApiTeacherDataSource({ baseUrl: origin, accessToken: token, request: transport.request });
    const draft = {
      lessonSessionId: lessonId, lessonVersion: 3,
      attendance: [{ studentId: '70000000-0000-4000-8000-000000000003', status: 'PRESENT' as const }],
    };
    const sending = method === 'PUT'
      ? source.saveAttendance(draft, 'synthetic-http-idempotency')
      : source.completeLesson(draft, 'synthetic-http-idempotency');
    await expect(sending).rejects.toMatchObject({ statusCode: 503, code: 'WIRING_PROBE' });
    await transport.idle();
    expect(received).toEqual([{
      method, url: path, authorization: `Bearer ${token}`,
      contentType: 'application/json', key: 'synthetic-http-idempotency',
      body: { lessonVersion: 3, attendance: draft.attendance },
    }]);
    expect(transport.calls[0]).toMatchObject({ status: 503, delivery: 'response' });
    expect(JSON.stringify(transport.calls)).not.toContain(token);
  } finally {
    await transport.close();
    await stop(server);
  }
});

it('reports a real closed socket to the feedback detail Page as a read failure', async () => {
  const server = createServer((request) => request.socket.destroy());
  const origin = await listen(server);
  const host = createTeacherHttpPageHost({
    origin, accessToken: token, routes: [{ method: 'GET', path: lessonPath }],
  });
  try {
    const page = host.capture('feedback-detail');
    page.onLoad({ id: lessonId }); page.onShow(); await host.idle();
    expect(page.data).toMatchObject({ viewState: 'error', students: [], detail: null });
    expect(host.transport.calls).toMatchObject([{ delivery: 'failure' }]);
    expect(host.transport.pendingCount).toBe(0);
  } finally {
    await host.close();
    await stop(server);
  }
});

it('does not follow an HTTP redirect outside the request allowlist', async () => {
  const received: WireRequest[] = [];
  const server = createServer((request, response) => {
    received.push(wireRequest(request));
    response.writeHead(302, { Location: '/unapproved' }).end();
  });
  const origin = await listen(server);
  const host = createTeacherHttpPageHost({
    origin, accessToken: token, routes: [{ method: 'GET', path: lessonPath }],
  });
  try {
    const page = host.capture('feedback-detail');
    page.onLoad({ id: lessonId }); page.onShow(); await host.idle();
    expect(received).toHaveLength(1);
    expect(received[0].url).toBe(lessonPath);
    expect(host.transport.calls[0]).toMatchObject({ status: 302, delivery: 'response' });
    expect(page.data.viewState).toBe('error');
  } finally {
    await host.close();
    await stop(server);
  }
});

it('unloads Pages, aborts in-flight HTTP and restores the original host globals', async () => {
  const globals = ['wx', 'Page', 'getCurrentPages'].map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  let started!: () => void;
  const incoming = new Promise<void>((resolve) => { started = resolve; });
  const server = createServer(() => { started(); });
  const origin = await listen(server);
  const host = createTeacherHttpPageHost({
    origin, accessToken: token, routes: [{ method: 'GET', path: lessonPath }],
  });
  try {
    const page = host.capture('feedback-detail');
    page.onLoad({ id: lessonId }); page.onShow();
    await incoming;
    expect(host.transport.pendingCount).toBe(1);
    const writes = page.setData.mock.calls.length;
    await host.close();
    expect(page.disposed).toBe(true);
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(host.transport.pendingCount).toBe(0);
    for (const [key, descriptor] of globals) {
      expect(Object.getOwnPropertyDescriptor(globalThis, key)).toEqual(descriptor);
    }
    expect(() => host.capture('feedback-detail')).toThrow('closed');
  } finally {
    await host.close();
    await stop(server);
  }
});

describe('teacher HTTP fixture boundaries', () => {
  const options = {
    origin: 'http://127.0.0.1:49152', accessToken: token,
    routes: [{ method: 'GET' as const, path: lessonPath }],
  };

  it.each([
    'https://127.0.0.1:49152', 'http://example.invalid:49152',
    'http://localhost:49152', 'http://127.0.0.1:49152/path',
    'http://user:password@127.0.0.1:49152',
  ])('rejects a non-exact loopback origin before installing globals: %s', (origin) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'wx');
    expect(() => createTeacherHttpPageHost({ ...options, origin })).toThrow('loopback origin');
    expect(Object.getOwnPropertyDescriptor(globalThis, 'wx')).toEqual(original);
  });

  it.each([
    { url: 'http://127.0.0.1:49153' + lessonPath },
    { url: 'http://example.invalid' + lessonPath },
    { url: options.origin + '/teachers/me/lesson-sessions/unowned' },
    { url: options.origin + '/parents/me/profile' },
    { url: options.origin + lessonPath + '#fragment' },
    { url: 'http://user:password@127.0.0.1:49152' + lessonPath },
    { method: 'POST' as const },
    { header: { Authorization: 'Bearer unknown-token' } },
    { header: { Authorization: '' } },
  ])('rejects a request outside the fixture before opening a socket: %j', async (patch) => {
    const transport = new TeacherPageHttpTransport(options);
    try {
      expect(() => transport.request({
        url: options.origin + lessonPath, method: 'GET',
        header: { Authorization: `Bearer ${token}` }, success: jest.fn(), fail: jest.fn(),
        ...patch,
      })).toThrow('fixture allowlist');
      expect(transport.calls).toHaveLength(0);
      expect(transport.pendingCount).toBe(0);
    } finally { await transport.close(); }
  });

  it('snapshots the origin instead of trusting a later mutation of caller configuration', async () => {
    const mutable = { ...options };
    const transport = new TeacherPageHttpTransport(mutable);
    const opening = jest.spyOn(require('node:http'), 'request').mockImplementation(() => {
      throw new Error('No socket may open in this boundary test');
    });
    mutable.origin = 'http://example.invalid:49152';
    try {
      expect(() => transport.request({
        url: mutable.origin + lessonPath, method: 'GET',
        header: { Authorization: `Bearer ${token}` }, success: jest.fn(), fail: jest.fn(),
      })).toThrow('fixture allowlist');
      expect(transport.calls).toHaveLength(0);
      expect(opening).not.toHaveBeenCalled();
    } finally {
      opening.mockRestore();
      await transport.close();
    }
  });
});
