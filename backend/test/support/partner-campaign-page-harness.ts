import { request as httpRequest } from 'node:http';

interface RequestOptions {
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  header: Record<string, string>;
  data?: unknown;
  success(response: { statusCode: number; data: unknown }): void;
  fail(error: { errMsg: string }): void;
}

export interface CampaignWireCall {
  method: string;
  path: string;
  body: unknown;
  key?: string;
  status?: number;
  delivery?: 'success' | 'lost' | 'held';
}

export class CampaignPageTransport {
  readonly calls: CampaignWireCall[] = [];
  private readonly pending = new Set<Promise<void>>();
  private readonly held: Array<() => void> = [];
  private nextDelivery: 'lost' | 'held' | undefined;

  constructor(
    private readonly origin: string,
    private readonly allowedTokens: Set<string>,
    private readonly freeFlow = false,
    private readonly legacyDetailFlow = false,
    private readonly studentDetailFlow = false,
    private readonly lessonAccountFlow = false,
    private readonly earningsFlow = false,
    private readonly studentsFlow = false,
    private readonly teachersFlow = false,
    private readonly entryFlow = false,
    private readonly readonlyFlow = false,
  ) {
    const target = new URL(origin);
    if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:') {
      throw new Error('Campaign Page fixture requires local HTTP');
    }
  }

  deliverNext(mode: 'lost' | 'held') {
    this.nextDelivery = mode;
  }

  release() {
    for (const deliver of this.held.splice(0)) deliver();
  }

  async drain() {
    await this.idle();
    this.release();
    await this.idle();
  }

  readonly request = (options: RequestOptions) => {
    const target = new URL(options.url);
    const drafts =
      /^\/partners\/me\/campaign-drafts(?:\/[0-9a-f-]{36}(?:\/basic-information)?)?$/i;
    const freePartner =
      /^\/partners\/me\/campaign-drafts\/[0-9a-f-]{36}\/(?:free-registration|submit|versions|registrations)$/i;
    const freeParent =
      /^\/parents\/me\/(?:free-campaigns(?:\/[0-9a-f-]{36}(?:\/registrations)?)?|campaign-registrations(?:\/[0-9a-f-]{36}(?:\/cancel)?)?)$/i;
    const freeManagement =
      /^\/management\/(?:campaign-reviews(?:\/[0-9a-f-]{36}(?:\/(?:approve|reject))?)?|campaigns\/[0-9a-f-]{36}\/close)$/i;
    const freeRoute =
      freePartner.test(target.pathname) ||
      freeParent.test(target.pathname) ||
      freeManagement.test(target.pathname);
    const read =
      options.method === 'GET' &&
      (drafts.test(target.pathname) ||
        target.pathname === '/partners/me' ||
        target.pathname === '/partners/me/group-campaigns' ||
        (this.teachersFlow && target.pathname === '/partners/me/teachers') ||
        (this.entryFlow &&
          ['/partners/me/dashboard', '/partners/me/profile'].includes(
            target.pathname,
          )) ||
        (this.readonlyFlow &&
          [
            '/partners/me/profile',
            '/partners/me/operations-summary',
            '/partners/me/warnings',
            '/partners/me/attendance',
          ].includes(target.pathname)) ||
        (this.studentsFlow &&
          (target.pathname === '/partners/me/students' ||
            target.pathname === '/partners/me/subjects' ||
            /^\/partners\/me\/students\/[0-9a-f-]{36}$/i.test(
              target.pathname,
            ))) ||
        (this.earningsFlow &&
          [
            '/partners/me/earnings/summary',
            '/partners/me/earning-rule',
            '/partners/me/earnings',
          ].includes(target.pathname)) ||
        (this.lessonAccountFlow &&
          (target.pathname === '/partners/me/profile' ||
            target.pathname === '/partners/me/subjects' ||
            target.pathname === '/partners/me/lesson-account')) ||
        (this.studentDetailFlow &&
          (target.pathname === '/partners/me/profile' ||
            /^\/partners\/me\/students\/[0-9a-f-]{36}(?:\/growth)?$/i.test(
              target.pathname,
            ))) ||
        (this.legacyDetailFlow &&
          /^\/partners\/me\/group-campaigns\/[0-9a-f-]{36}$/i.test(
            target.pathname,
          )) ||
        (this.freeFlow &&
          (freeRoute || target.pathname === '/partners/me/free-campaigns')));
    const write =
      (options.method === 'POST' &&
        target.pathname === '/partners/me/campaign-drafts') ||
      (options.method === 'PUT' &&
        /^\/partners\/me\/campaign-drafts\/[0-9a-f-]{36}\/basic-information$/i.test(
          target.pathname,
        )) ||
      (this.freeFlow && freeRoute && options.method === 'POST') ||
      (this.freeFlow &&
        options.method === 'PUT' &&
        /^\/partners\/me\/campaign-drafts\/[0-9a-f-]{36}\/free-registration$/i.test(
          target.pathname,
        ));
    const token = options.header.Authorization?.replace(/^Bearer /, '');
    if (
      target.origin !== this.origin ||
      (!read && !write) ||
      !this.allowedTokens.has(token)
    ) {
      throw new Error('Campaign Page fixture request is outside its scope');
    }
    const delivery = this.nextDelivery;
    this.nextDelivery = undefined;
    const call: CampaignWireCall = {
      method: options.method,
      path: target.pathname,
      body: options.data,
      key: options.header['Idempotency-Key'],
    };
    this.calls.push(call);
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    this.pending.add(pending);
    let ended = false;
    const finish = (deliver: () => void) => {
      if (ended) return;
      ended = true;
      try {
        deliver();
      } finally {
        this.pending.delete(pending);
        complete();
      }
    };
    const outgoing = httpRequest(
      target,
      { method: options.method, headers: options.header },
      (response) => {
        response.setEncoding('utf8');
        let text = '';
        response.on('data', (chunk: string) => {
          text += chunk;
        });
        response.on('error', () =>
          finish(() => options.fail({ errMsg: 'synthetic response failure' })),
        );
        response.on('end', () => {
          call.status = response.statusCode ?? 0;
          finish(() => {
            const deliver = () => {
              const data: unknown = JSON.parse(text);
              options.success({ statusCode: call.status!, data });
            };
            call.delivery = delivery ?? 'success';
            if (delivery === 'held') this.held.push(deliver);
            else if (delivery === 'lost')
              options.fail({ errMsg: 'synthetic response lost after commit' });
            else deliver();
          });
        });
      },
    );
    outgoing.setTimeout(10_000, () => outgoing.destroy());
    outgoing.on('error', () =>
      finish(() =>
        options.fail({ errMsg: 'synthetic local connection failure' }),
      ),
    );
    if (options.data !== undefined)
      outgoing.write(JSON.stringify(options.data));
    outgoing.end();
    return outgoing;
  };

  async idle() {
    for (let count = 0; count < 20; count++) {
      await Promise.all([...this.pending]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (!this.pending.size) return;
    }
    throw new Error('Campaign Page fixture did not become idle');
  }
}

export function captureCampaignPage<T extends { data: object }>(
  kind:
    | 'campaign-editor'
    | 'group-campaigns'
    | 'group-detail'
    | 'student-detail'
    | 'students'
    | 'teachers'
    | 'home'
    | 'profile'
    | 'operations'
    | 'warnings'
    | 'attendance'
    | 'lesson-account'
    | 'earnings',
): T {
  let page: T | undefined;
  const host = globalThis as unknown as Record<string, unknown>;
  host.Page = (config: T) => {
    page = {
      ...config,
      data: structuredClone(config.data),
      setData: jest.fn((patch: object) => Object.assign(page!.data, patch)),
    };
  };
  jest.isolateModules(() => {
    jest.requireActual(`../../../frontend/pages/partner/${kind}/index.ts`);
  });
  if (!page) throw new Error('Campaign Page did not register');
  return page;
}
