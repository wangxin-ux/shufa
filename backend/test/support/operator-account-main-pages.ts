import { AccountPageWire } from './operator-pdf-test-account-pages';
import type { OperatorHttpResponse } from '../../../frontend/pages/operator/runtime/data/api-operator-data-source';
import type { ClientObservation } from './operator-account-main-observation';

export type MainPageName = 'lesson-account' | 'earnings';
export interface MainTestPage {
  data: {
    viewState: string;
    summary: unknown;
    rows: Array<{ id: string; negative?: boolean; amountLabel?: string }>;
    page: number;
    total: number;
    detailError: string;
    subjectOptions: Array<{ value: string; label: string }>;
  };
  onLoad(): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onRefresh(): void;
  onRetryDetail(): void;
  onLoadMore(): void;
  onRetrySubjects(): void;
  onSubjectChange(event: { detail: { value: string } }): void;
  onCategoryChange(event: { detail: { value: string } }): void;
  onStatusChange(event: { detail: { value: string } }): void;
  onTypeChange(event: { detail: { value: string } }): void;
}
export function openMainPage(
  name: MainPageName,
  origin: string,
  token: string,
  checkpoint: () => void,
) {
  const wire = new AccountPageWire(
    origin,
    new Map([[token, 'owned-access']]),
    checkpoint,
  );
  const { capture } = jest.requireActual<
    typeof import('../../../frontend/tests/operator-page-host')
  >('../../../frontend/tests/operator-page-host');
  const env = capture([name as never], 'api');
  env.change({ apiBaseUrl: origin, accessToken: token });
  const page = env.instantiate(name as never) as MainTestPage;
  let held:
    | {
        path: string;
        observed(value: OperatorHttpResponse): void;
        release(): void;
      }
    | undefined;
  env.platform.request = jest.fn((options) => {
    const path = new URL(options.url).pathname;
    wire.request({
      ...options,
      success(response) {
        if (held?.path === path && response.statusCode === 200) {
          const hold = held;
          held = undefined;
          hold.release = () => options.success(response);
          hold.observed(response);
        } else options.success(response);
      },
    });
  });
  const releases = new Set<() => void>();
  return {
    page,
    calls: wire.calls,
    changeRuntime(patch: object) {
      env.change(patch);
    },
    async settle() {
      await wire.idle();
    },
    holdSuccess(path: string) {
      if (held) throw new Error('A Page delivery is already held');
      let observed!: (value: OperatorHttpResponse) => void;
      let received = false;
      const entered = new Promise<OperatorHttpResponse>((done) => {
        observed = done;
      });
      const hold = {
        path,
        observed(value: OperatorHttpResponse) {
          received = true;
          observed(value);
        },
        release: () => undefined,
      };
      held = hold;
      const release = () => {
        hold.release();
        releases.delete(release);
      };
      releases.add(release);
      return { entered, release, received: () => received };
    },
    async close() {
      const failures: unknown[] = [];
      try {
        env.close();
      } catch (error) {
        failures.push(error);
      }
      for (const release of releases) release();
      held = undefined;
      try {
        await wire.closeAndDrain();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length)
        throw new AggregateError(failures, 'Main Page close failed');
    },
  };
}
export async function readMainHttp(
  origin: string,
  token: string,
  path: string,
  query: Record<string, string> = {},
  checkpoint: () => void = () => undefined,
  observation?: ClientObservation,
) {
  const wire = new AccountPageWire(
    origin,
    new Map([[token, 'owned-credential']]),
    checkpoint,
    observation,
  );
  const target = new URL(path, origin);
  for (const [name, value] of Object.entries(query))
    target.searchParams.set(name, value);
  try {
    const response = await new Promise<OperatorHttpResponse>((done, reject) => {
      wire.request({
        url: target.href,
        method: 'GET',
        header: { Authorization: `Bearer ${token}`,
          ...(observation ? { 'X-E01-Observation-Id': observation.requestId } : {}) },
        success: done,
        fail: reject,
      });
    });
    const call = wire.calls[0];
    return {
      status: response.statusCode,
      body: response.data,
      call,
      provenance: 'allocated-http-postgres' as const,
    };
  } finally {
    await wire.closeAndDrain();
  }
}
