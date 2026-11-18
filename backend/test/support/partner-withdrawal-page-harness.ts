import { request as httpRequest } from 'node:http';

interface RequestOptions {
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  header: Record<string, string>;
  data?: unknown;
  success(response: { statusCode: number; data: unknown }): void;
  fail(error: { errMsg: string }): void;
}
export class WithdrawalPageTransport {
  readonly calls: Array<{
    path: string;
    method: string;
    body: unknown;
    key?: string;
    status?: number;
  }> = [];
  private readonly pending = new Set<Promise<void>>();
  private lostPath = '';
  constructor(
    private readonly origin: string,
    private readonly tokens: Set<string>,
    private readonly campusId: string,
    private readonly campusQuery: string,
  ) {
    const url = new URL(origin);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      url.origin !== origin
    )
      throw Error('Local origin required');
  }
  loseNext(path: string) {
    if (this.lostPath) throw Error('Delivery control already set');
    this.lostPath = path;
  }
  readonly request = (options: RequestOptions) => {
    const target = new URL(options.url),
      path = target.pathname;
    const token = options.header.Authorization?.replace(/^Bearer /, '');
    const read =
      options.method === 'GET' &&
      (path === '/partners/me/withdrawal-summary' ||
        path === '/partners/me/withdrawals' ||
        (path === '/management/partner-withdrawals' &&
          target.searchParams.get('campusId') === this.campusId) ||
        (path === '/management/campuses' &&
          target.searchParams.get('query') === this.campusQuery) ||
        path === `/management/campuses/${this.campusId}/partner-settlement` ||
        path ===
          `/management/campuses/${this.campusId}/partner-settlement/sources`);
    const write =
      (options.method === 'PUT' &&
        path === `/management/campuses/${this.campusId}/partner-settlement`) ||
      (options.method === 'POST' &&
        (path === '/partners/me/withdrawals' ||
          /^\/partners\/me\/withdrawals\/[0-9a-f-]{36}\/cancel$/.test(path) ||
          new RegExp(
            `^/management/campuses/${this.campusId}/partner-settlement/sources/[0-9a-f-]{36}$`,
          ).test(path) ||
          /^\/management\/partner-withdrawals\/[0-9a-f-]{36}\/(?:approve|reject|mark-paying|mark-unknown|mark-paid|mark-failed|mock-proof)$/.test(
            path,
          )));
    if (
      target.origin !== this.origin ||
      !this.tokens.has(token) ||
      !(read || write)
    )
      throw Error('Withdrawal Page request outside fixture');
    const call: (typeof this.calls)[number] = {
      path,
      method: options.method,
      body: options.data,
      key: options.header['Idempotency-Key'],
    };
    this.calls.push(call);
    const lost = path === this.lostPath;
    if (lost) this.lostPath = '';
    let complete!: () => void,
      done = false;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    this.pending.add(pending);
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      try {
        fn();
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
        response.on('data', (part: string) => {
          text += part;
        });
        response.on('error', () =>
          finish(() => options.fail({ errMsg: 'synthetic response failure' })),
        );
        response.on('end', () =>
          finish(() => {
            call.status = response.statusCode ?? 0;
            if (lost)
              options.fail({ errMsg: 'synthetic lost receipt after commit' });
            else
              options.success({
                statusCode: call.status,
                data: JSON.parse(text) as unknown,
              });
          }),
        );
      },
    );
    outgoing.setTimeout(10000, () => outgoing.destroy());
    outgoing.on('error', () =>
      finish(() => options.fail({ errMsg: 'synthetic connection failure' })),
    );
    if (options.data !== undefined)
      outgoing.write(JSON.stringify(options.data));
    outgoing.end();
    return outgoing;
  };
  async idle() {
    for (let i = 0; i < 20; i++) {
      await Promise.all([...this.pending]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (!this.pending.size) return;
    }
    throw Error('Withdrawal Page did not settle');
  }
}

export interface WithdrawalFixturePage {
  data: Record<string, unknown>;
  onLoad(): void;
  onShow(): void;
  onUnload(): void;
  pending?: Promise<void>;
  onAmountInput(event: unknown): void;
  onSubmit(): Promise<void>;
  onRetryAction(): Promise<void>;
  onSelect(event: unknown): void;
  onAction(event: unknown): Promise<void>;
  onField(event: unknown): void;
}
export function captureWithdrawalPage(
  role: 'partner' | 'super-admin',
): WithdrawalFixturePage {
  let page: WithdrawalFixturePage | undefined;
  const host = globalThis as unknown as Record<string, unknown>;
  host.Page = (definition: WithdrawalFixturePage) => {
    page = {
      ...definition,
      data: structuredClone(definition.data),
      ...{ setData: (patch: object) => Object.assign(page!.data, patch) },
    };
  };
  jest.isolateModules(() => {
    jest.requireActual(
      `../../../frontend/pages/${role}/${role === 'partner' ? 'withdrawals' : 'partner-withdrawals'}/index.ts`,
    );
  });
  if (!page) throw Error('Withdrawal Page missing');
  return page;
}
export const withdrawalPageEvent = (
  dataset: Record<string, string> = {},
  value = '',
) => ({
  currentTarget: { dataset },
  detail: { value },
});
