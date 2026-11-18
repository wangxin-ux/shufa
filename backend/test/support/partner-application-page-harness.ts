import { request as httpRequest, type ClientRequest } from 'node:http';
import { randomUUID } from 'node:crypto';

interface RequestOptions {
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  header: Record<string, string>;
  data?: unknown;
  success(response: { statusCode: number; data: unknown }): void;
  fail(error: { errMsg: string }): void;
}
interface TransferOptions {
  url: string;
  header?: Record<string, string>;
  success?(response: {
    statusCode: number;
    data: string;
    tempFilePath: string;
  }): void;
  fail?(error: { errMsg: string }): void;
}
export interface ApplicationWireCall {
  method: string;
  path: string;
  body?: unknown;
  key?: string;
  status?: number;
  delivery?: 'success' | 'lost' | 'held';
  bytes?: number;
}

const uuid = '[0-9a-f-]{36}';
const own = '/partner-applicants/me/application';
const review = `/management/partner-applications/${uuid}/submissions/${uuid}`;
const routes = {
  GET: [
    /^\/partner-applicants\/me$/,
    new RegExp(`^${own}(?:/(?:bank-information|materials|history))?$`),
    new RegExp(`^${own}/materials/${uuid}/content$`),
    /^\/management\/partner-applications$/,
    new RegExp(`^${review}(?:/bank-information|/materials/${uuid}/content)?$`),
    /^\/me$/,
    /^\/partners\/me(?:\/(?:dashboard|profile|application|earnings\/summary))?$/,
  ],
  PUT: [
    new RegExp(`^${own}/(?:basic-information|bank-information|materials)$`),
  ],
  POST: [
    /^\/partner-applicants\/auth\/wechat$/,
    /^\/auth\/wechat\/login$/,
    new RegExp(`^${own}/(?:material-uploads(?:/${uuid})?|submit|reopen)$`),
    new RegExp(`^${review}/(?:approve|reject)$`),
  ],
};

export class ApplicationPageTransport {
  readonly calls: ApplicationWireCall[] = [];
  readonly downloads: Buffer[] = [];
  readonly images = new Map<string, Buffer>();
  readonly applications = new Map<string, string>();
  readonly submissions = new Map<string, string>();
  readonly uploads = new Map<string, string>();
  readonly files = new Map<string, string>();
  private readonly pending = new Set<Promise<void>>();
  private readonly connections = new Set<ClientRequest>();
  private readonly held: Array<() => void> = [];
  private next?: { path: string; mode: 'lost' | 'held' };

  constructor(
    private readonly origin: string,
    readonly tokens: Set<string>,
    private readonly codes: Set<string>,
  ) {
    const target = new URL(origin);
    if (
      target.origin !== origin ||
      target.protocol !== 'http:' ||
      target.hostname !== '127.0.0.1'
    )
      throw new Error('Application Page fixture requires exact local HTTP');
  }

  deliverNext(path: string, mode: 'lost' | 'held') {
    if (this.next) throw new Error('Previous delivery control not consumed');
    this.next = { path, mode };
  }
  release() {
    for (const deliver of this.held.splice(0)) deliver();
  }
  async drain() {
    try {
      await this.idle();
      this.release();
      await this.idle();
    } finally {
      this.abort();
    }
  }
  abort() {
    for (const connection of this.connections) connection.destroy();
    this.next = undefined;
    this.release();
  }

  private target(
    options: Pick<RequestOptions, 'url' | 'method' | 'header' | 'data'>,
  ) {
    const target = new URL(options.url);
    const token = options.header.Authorization?.replace(/^Bearer /, '');
    const login = [
      '/partner-applicants/auth/wechat',
      '/auth/wechat/login',
    ].includes(target.pathname);
    const code = (options.data as { code?: string } | undefined)?.code;
    if (
      target.origin !== this.origin ||
      target.username ||
      target.password ||
      target.hash ||
      !routes[options.method]?.some((route) => route.test(target.pathname)) ||
      (login
        ? options.method !== 'POST' || !code || !this.codes.has(code)
        : !token || !this.tokens.has(token))
    )
      throw new Error('Application Page request is outside fixture scope');
    const management = target.pathname.match(
      new RegExp(
        `^/management/partner-applications/(${uuid})/submissions/(${uuid})(?:/materials/(${uuid})/content|/[^/]+)?$`,
      ),
    );
    const upload = target.pathname.match(
      new RegExp(`^${own}/material-uploads/(${uuid})$`),
    );
    const file = target.pathname.match(
      new RegExp(`^${own}/materials/(${uuid})/content$`),
    );
    const reopen =
      target.pathname === `${own}/reopen`
        ? (options.data as { submissionId?: string } | undefined)?.submissionId
        : undefined;
    const materials =
      options.method === 'PUT' && target.pathname === `${own}/materials`
        ? (
            options.data as
              { materials?: Array<{ storedFileId: string }> } | undefined
          )?.materials
        : undefined;
    const applicationId = this.applications.get(token ?? '');
    if (
      (management &&
        (![...this.applications.values()].includes(management[1]) ||
          this.submissions.get(management[2]) !== management[1] ||
          (management[3] &&
            this.files.get(management[3]) !== management[1]))) ||
      (upload &&
        (!applicationId || this.uploads.get(upload[1]) !== applicationId)) ||
      (file && (!applicationId || this.files.get(file[1]) !== applicationId)) ||
      (materials &&
        materials.some(
          (item) =>
            !applicationId ||
            this.files.get(item.storedFileId) !== applicationId,
        )) ||
      (reopen &&
        (!applicationId || this.submissions.get(reopen) !== applicationId)) ||
      (target.pathname === `${own}/material-uploads` && !applicationId)
    )
      throw new Error('Application Page entity is outside owned fixture scope');
    return target;
  }

  readonly request = (options: RequestOptions) => {
    const target = this.target(options);
    const login =
      target.pathname.endsWith('/auth/wechat') ||
      target.pathname === '/auth/wechat/login';
    return this.send(
      target,
      options,
      options.data === undefined
        ? undefined
        : Buffer.from(JSON.stringify(options.data)),
      { 'Content-Type': 'application/json', ...options.header },
      (statusCode, bytes) => {
        const data = JSON.parse(bytes.toString('utf8')) as {
          data?: { token?: string; accessToken?: string };
        };
        if (login && statusCode === 200) {
          const token = data.data?.token ?? data.data?.accessToken;
          if (typeof token === 'string' && token) this.tokens.add(token);
        }
        if (
          target.pathname === `${own}/material-uploads` &&
          statusCode === 200
        ) {
          const receipt = data.data as unknown as {
            uploadId: string;
            storedFileId: string;
            requestKey: string;
            expectedVersion: number;
            kind: string;
          };
          const input = options.data as {
            requestKey: string;
            expectedVersion: number;
            kind: string;
          };
          const applicationId = this.applications.get(
            options.header.Authorization.replace(/^Bearer /, ''),
          )!;
          if (
            receipt.requestKey !== input.requestKey ||
            receipt.expectedVersion !== input.expectedVersion ||
            receipt.kind !== input.kind ||
            !new RegExp(`^${uuid}$`).test(receipt.uploadId) ||
            !new RegExp(`^${uuid}$`).test(receipt.storedFileId)
          )
            throw new Error('Uncorrelated synthetic upload reservation');
          this.uploads.set(receipt.uploadId, applicationId);
          this.files.set(receipt.storedFileId, applicationId);
        }
        options.success({ statusCode, data });
      },
    );
  };

  readonly upload = (
    options: TransferOptions & { filePath: string; name: string },
  ) => {
    const target = this.target({
      ...options,
      method: 'POST',
      header: options.header ?? {},
    });
    const image = this.images.get(options.filePath);
    if (
      !image ||
      options.name !== 'file' ||
      !new RegExp(`^${own}/material-uploads/${uuid}$`).test(target.pathname)
    )
      throw new Error('Only owned synthetic PNG uploads are allowed');
    const boundary = `synthetic-${randomUUID()}`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      image,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return this.send(
      target,
      { ...options, method: 'POST' },
      body,
      {
        ...options.header,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      (statusCode, bytes) =>
        options.success?.({
          statusCode,
          data: bytes.toString('utf8'),
          tempFilePath: '',
        }),
    );
  };

  readonly download = (options: TransferOptions) => {
    const target = this.target({
      ...options,
      method: 'GET',
      header: options.header ?? {},
    });
    if (!target.pathname.endsWith('/content'))
      throw new Error('Only application image downloads are allowed');
    return this.send(
      target,
      { ...options, method: 'GET' },
      undefined,
      options.header ?? {},
      (statusCode, bytes) => {
        if (statusCode === 200) this.downloads.push(bytes);
        options.success?.({
          statusCode,
          data: '',
          tempFilePath: `wxfile://synthetic-download-${this.downloads.length}.png`,
        });
      },
    );
  };

  private send(
    target: URL,
    options: {
      method: string;
      data?: unknown;
      header?: Record<string, string>;
      fail?(error: { errMsg: string }): void;
    },
    body: Buffer | undefined,
    headers: Record<string, string>,
    success: (status: number, bytes: Buffer) => void,
  ) {
    const control = this.next?.path === target.pathname ? this.next : undefined;
    if (control) this.next = undefined;
    const call: ApplicationWireCall = {
      method: options.method,
      path: target.pathname,
      body: options.data,
      key: options.header?.['Idempotency-Key'],
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
      clearTimeout(deadline);
      this.connections.delete(outgoing);
      try {
        deliver();
      } finally {
        this.pending.delete(pending);
        complete();
      }
    };
    const outgoing = httpRequest(
      target,
      { method: options.method, headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', () =>
          finish(() =>
            options.fail?.({ errMsg: 'synthetic local response failure' }),
          ),
        );
        response.on('aborted', () =>
          finish(() =>
            options.fail?.({ errMsg: 'synthetic response aborted' }),
          ),
        );
        response.on('end', () =>
          finish(() => {
            const bytes = Buffer.concat(chunks);
            call.status = response.statusCode ?? 0;
            call.bytes = bytes.length;
            call.delivery = control?.mode ?? 'success';
            const deliver = () => {
              try {
                success(call.status!, bytes);
              } catch {
                options.fail?.({ errMsg: 'synthetic invalid response' });
              }
            };
            if (control?.mode === 'held') this.held.push(deliver);
            else if (control?.mode === 'lost')
              options.fail?.({
                errMsg: 'synthetic response lost after commit',
              });
            else deliver();
          }),
        );
      },
    );
    this.connections.add(outgoing);
    const deadline = setTimeout(() => outgoing.destroy(), 10_000);
    outgoing.setTimeout(10_000, () => outgoing.destroy());
    outgoing.on('error', () =>
      finish(() =>
        options.fail?.({ errMsg: 'synthetic local connection failure' }),
      ),
    );
    if (body) outgoing.write(body);
    outgoing.end();
    return outgoing;
  }

  async idle() {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        (async () => {
          for (let index = 0; index < 30; index++) {
            await Promise.all([...this.pending]);
            await new Promise<void>((resolve) => setImmediate(resolve));
            if (!this.pending.size) return;
          }
          throw new Error('Application Page transport did not become idle');
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            this.abort();
            reject(new Error('Application Page transport deadline exceeded'));
          }, 12_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function captureApplicationPage<T extends { data: object }>(
  kind: 'application' | 'review' | 'login' | 'home' | 'profile',
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
    jest.requireActual(
      kind === 'review'
        ? '../../../frontend/pages/super-admin/partner-applications/index.ts'
        : `../../../frontend/pages/partner/${kind}/index.ts`,
    );
  });
  if (!page) throw new Error('Application fixture Page did not register');
  return page;
}
