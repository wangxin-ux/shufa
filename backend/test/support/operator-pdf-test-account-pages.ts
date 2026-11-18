import { request as httpRequest, type ClientRequest } from 'node:http';
import { setTimeout, clearTimeout } from 'node:timers';
import type { OperatorHttpRequestOptions } from '../../../frontend/pages/operator/runtime/data/api-operator-data-source';
import type { presentOperatorAccountSummary } from '../../../frontend/pages/operator/runtime/services/operator-account.presenter';
import type { ClientObservation } from './operator-account-main-observation';

export interface AccountWireCall {
  path: string;
  query: Record<string, string>;
  credential: string;
  status?: number;
  responseText?: string;
  responseBody?: unknown;
  failure?: string;
}
const routes = new Set([
  '/me',
  '/operators/me/lesson-account',
  '/operators/me/subjects',
  '/operators/me/earnings/summary',
  '/operators/me/earnings',
]);

export class AccountPageWire {
  readonly calls: AccountWireCall[] = [];
  private accepting = true;
  private readonly pending = new Set<Promise<void>>();
  private readonly outgoing = new Set<ClientRequest>();
  constructor(
    private readonly origin: string,
    private readonly credentials: Map<string, string>,
    private readonly checkpoint: () => void = () => undefined,
    private readonly observation?: ClientObservation,
  ) {
    const target = new URL(origin);
    if (
      target.protocol !== 'http:' ||
      target.hostname !== '127.0.0.1' ||
      target.origin !== origin ||
      target.username ||
      target.password ||
      !target.port
    )
      throw new Error('E01 wire requires exact local HTTP origin');
  }
  readonly request = (options: OperatorHttpRequestOptions) => {
    this.checkpoint();
    if (!this.accepting) throw new Error('E01 HTTP admission closed');
    const target = new URL(options.url);
    const credential = this.credentials.get(
      options.header.Authorization?.replace(/^Bearer /, ''),
    );
    if (
      target.origin !== this.origin ||
      target.username ||
      target.password ||
      target.hash ||
      !routes.has(target.pathname) ||
      options.method !== 'GET' ||
      options.data !== undefined ||
      !credential
    )
      throw new Error('E01 request outside read fixture');
    const call: AccountWireCall = {
      path: target.pathname,
      query: Object.fromEntries(target.searchParams),
      credential,
    };
    this.calls.push(call);
    let outgoing: ClientRequest | undefined;
    let outcome: 'ended' | 'error' | 'aborted' | 'destroyed' = 'destroyed';
    const task = new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        if (outgoing) this.outgoing.delete(outgoing);
        if (error) reject(error);
        else resolve();
      };
      outgoing = httpRequest(
        target,
        { method: 'GET', headers: options.header, agent: false },
        (response) => {
          call.status = response.statusCode ?? 0;
          this.observation?.response(call.status);
          call.responseText = '';
          response.setEncoding('utf8');
          response.on('data', (part: string) => {
            call.responseText += part;
          });
          response.on('aborted', () => {
            outcome = 'aborted';
            finish(new Error('E01 response aborted'));
          });
          response.on('error', () => {
            outcome = 'error';
            finish(new Error('E01 response failed'));
          });
          response.on('end', () => {
            try {
              call.responseBody = JSON.parse(call.responseText!) as unknown;
            } catch {
              outcome = 'error';
              return finish(new Error('E01 response was not JSON'));
            }
            if (!finished) {
              outcome = 'ended';
            }
            finish();
          });
        },
      );
      this.outgoing.add(outgoing);
      outgoing.once('close', () => this.observation?.close(outcome));
      outgoing.on('error', () => {
        outcome = 'error';
        finish(new Error('E01 local connection failed or cancelled'));
      });
      const deadline = setTimeout(
        () => outgoing?.destroy(new Error('E01 HTTP deadline')),
        10_000,
      );
      outgoing.end();
    })
      .then(() => {
        if (this.accepting) {
          this.checkpoint();
          options.success({
            statusCode: call.status!,
            data: call.responseBody,
          });
        } else throw new Error('E01 delivery cancelled');
      })
      .catch(() => {
        call.failure = 'E01 HTTP failed or cancelled';
        options.fail(new Error(call.failure));
      });
    const tracked = task.finally(() => {
      this.pending.delete(tracked);
    });
    this.pending.add(tracked);
    void tracked.catch(() => undefined);
  };
  async idle() {
    let quiet = 0;
    for (let index = 0; index < 20; index++) {
      await Promise.allSettled([...this.pending]);
      await new Promise<void>((done) => setImmediate(done));
      quiet = this.pending.size ? 0 : quiet + 1;
      if (quiet === 2) return;
    }
    throw new Error('E01 Page work did not drain');
  }
  async closeAndDrain() {
    this.accepting = false;
    for (const outgoing of this.outgoing)
      outgoing.destroy(new Error('E01 wire closed'));
    await this.idle();
  }
  state() {
    return { accepting: this.accepting, inFlight: this.pending.size };
  }
}

export interface AccountTestPage {
  data: {
    viewState: string;
    summary: ReturnType<typeof presentOperatorAccountSummary> | null;
    rows: object[];
    subjectOptions: Array<{ label: string; value: string }>;
    subjectId: string;
    total: number;
    detailError: string;
  };
  onLoad(): void;
  onShow(): void;
  onUnload(): void;
  onLoadMore(): void;
  onRetryDetail(): void;
  onSubjectChange(event: { detail: { value: string } }): void;
  onCategoryChange(event: { detail: { value: string } }): void;
}

export function captureAccountPage(
  origin: string,
  token: string,
  wire: Pick<AccountPageWire, 'request'>,
) {
  const { capture, fixture } = jest.requireActual<
    typeof import('../../../frontend/tests/operator-page-host')
  >('../../../frontend/tests/operator-page-host');
  const captured = capture([], 'api');
  // Override the host's /me shortcut too, so all authentication reads traverse the wire.
  captured.platform.request = jest.fn(wire.request);
  captured.change({ apiBaseUrl: origin, accessToken: token });
  let definition: AccountTestPage & { setData(patch: object): void };
  const globals = globalThis as unknown as {
    Page(value: typeof definition): void;
  };
  const instances: Array<typeof definition> = [];
  globals.Page = (value) => {
    definition = value;
  };
  try {
    jest.isolateModules(() => {
      jest.requireActual(
        '../../../frontend/pages/operator/lesson-account/index.ts',
      );
    });
  } catch (error) {
    captured.close();
    throw error;
  }
  return {
    campusId: fixture.profile.campusId,
    instantiate() {
      if (!definition)
        throw new Error('Actual E01 account Page did not register');
      const page = { ...definition, data: structuredClone(definition.data) };
      page.setData = jest.fn((patch: object) =>
        Object.assign(page.data, patch),
      );
      instances.push(page);
      return page;
    },
    close() {
      const errors: unknown[] = [];
      for (const page of instances) {
        try {
          page.onUnload();
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        captured.close();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length)
        throw new AggregateError(errors, 'E01 Page unload failed');
    },
  };
}
