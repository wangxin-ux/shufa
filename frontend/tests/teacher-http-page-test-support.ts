import { request as httpRequest, type ClientRequest } from 'node:http';
import type { TeacherHttpRequestOptions } from '../data/api-teacher-data-source';
import { captureTeacherPage, flushTeacherPage } from './teacher-page-test-support';

export interface TeacherHttpPageOptions {
  origin: string;
  accessToken: string;
  allowedTokens?: ReadonlySet<string>;
  routes: ReadonlyArray<{
    method: TeacherHttpRequestOptions['method'];
    path: string;
  }>;
}

export interface TeacherHttpWireCall {
  method: TeacherHttpRequestOptions['method'];
  url: string;
  body?: unknown;
  key?: string;
  status?: number;
  delivery?: 'response' | 'failure';
}

export class TeacherPageHttpTransport {
  readonly calls: TeacherHttpWireCall[] = [];
  private readonly origin: string;
  private readonly routes: Set<string>;
  private readonly tokens: Set<string>;
  private readonly pending = new Set<Promise<void>>();
  private readonly connections = new Set<ClientRequest>();
  private closed = false;

  constructor(options: TeacherHttpPageOptions) {
    const origin = new URL(options.origin);
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' ||
        origin.origin !== options.origin) {
      throw new Error('Teacher HTTP host requires an exact loopback origin');
    }
    this.origin = origin.origin;
    this.routes = new Set(options.routes.map(({ method, path }) => {
      if (!['GET', 'PUT', 'POST'].includes(method) ||
          !(path.startsWith('/teachers/me/') || (method === 'GET' && path === '/me')) ||
          new URL(path, origin).pathname !== path) {
        throw new Error('Teacher HTTP route must be an exact teacher pathname');
      }
      return `${method} ${path}`;
    }));
    this.tokens = new Set(options.allowedTokens ?? [options.accessToken]);
    if (!options.accessToken.trim() || !this.tokens.has(options.accessToken)) {
      throw new Error('Teacher HTTP session must belong to the token allowlist');
    }
  }

  get pendingCount() { return this.pending.size; }

  readonly request = (options: TeacherHttpRequestOptions) => {
    if (this.closed) throw new Error('Teacher HTTP host is closed');
    const target = new URL(options.url);
    const authorization = options.header.Authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (target.origin !== this.origin || target.username || target.password ||
        target.hash || !this.routes.has(`${options.method} ${target.pathname}`) ||
        !token || !this.tokens.has(token)) {
      throw new Error('Teacher HTTP request is outside the fixture allowlist');
    }
    const body = options.data === undefined ? undefined : JSON.stringify(options.data);
    const call: TeacherHttpWireCall = {
      method: options.method, url: target.pathname + target.search,
      ...(body === undefined ? {} : { body: JSON.parse(body) as unknown }),
      ...(options.header['Idempotency-Key'] ? { key: options.header['Idempotency-Key'] } : {}),
    };
    this.calls.push(call);
    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    this.pending.add(pending);
    let finished = false;
    const finish = (deliver: () => void) => {
      if (finished) return;
      finished = true;
      try { deliver(); } finally {
        this.pending.delete(pending);
        resolve();
      }
    };
    const fail = () => finish(() => {
      call.delivery = 'failure';
      options.fail(new Error('Local teacher HTTP connection failed'));
    });
    let outgoing: ClientRequest;
    try {
      outgoing = httpRequest(target, {
        method: options.method, agent: false,
        headers: { 'Content-Type': 'application/json', ...options.header },
      }, (response) => {
        response.setEncoding('utf8');
        let text = '';
        response.on('data', (chunk: string) => { text += chunk; });
        response.on('aborted', fail);
        response.on('error', fail);
        response.on('end', () => finish(() => {
          let data: unknown = text;
          try { data = JSON.parse(text) as unknown; } catch { /* Preserve non-JSON HTTP errors. */ }
          call.status = response.statusCode ?? 0;
          call.delivery = 'response';
          options.success({ statusCode: call.status, data });
        }));
      });
      this.connections.add(outgoing);
      outgoing.once('close', () => { this.connections.delete(outgoing); });
      outgoing.setTimeout(5000, () => outgoing.destroy());
      outgoing.on('error', fail);
      outgoing.end(body);
    } catch {
      fail();
      return;
    }
    return outgoing;
  };

  async idle() {
    for (let turn = 0; turn < 20; turn += 1) {
      await flushTeacherPage();
      await Promise.all([...this.pending]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (!this.pending.size) return;
    }
    throw new Error('Teacher HTTP Page did not settle');
  }

  async close() {
    this.closed = true;
    for (const connection of this.connections) connection.destroy();
    await this.idle();
  }
}

export function createTeacherHttpPageHost(options: TeacherHttpPageOptions) {
  const transport = new TeacherPageHttpTransport(options);
  const env = captureTeacherPage('schedule', { autoClock: false, preload: false });
  env.change({
    dataDriver: 'api', apiBaseUrl: options.origin, accessToken: options.accessToken,
  });
  env.wx.request = transport.request;
  let closed = false;
  return {
    values: env.values, change: env.change, stack: env.stack, wx: env.wx,
    transport,
    capture(route: Parameters<typeof captureTeacherPage>[0]) {
      if (closed) throw new Error('Teacher HTTP host is closed');
      env.register(route);
      return env.instantiate();
    },
    async idle() {
      await transport.idle();
    },
    async close() {
      if (closed) return;
      closed = true;
      try { env.close(); } finally { await transport.close(); }
    },
  };
}
