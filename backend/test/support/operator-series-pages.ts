import { resolve } from "node:path";
import { createRequire } from "node:module";
import { requireSeries } from "./operator-series-admission";

// Dynamic Page registration is the only untyped boundary; data is never injected.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ActualPage = { data: any; [name: string]: any };
interface RequestOptions {
  url: string;
  method?: string;
  header?: Record<string, string>;
  data?: unknown;
  success(value: { statusCode: number; data: unknown }): void;
  fail(error: { errMsg: string }): void;
}
interface Navigation {
  url: string;
  events?: Record<string, (value: unknown) => void>;
}
export interface HttpRecord {
  method: string;
  path: string;
  key?: string;
  body?: unknown;
  status: number;
  response: unknown;
  deliberatelyLost?: boolean;
}
export type Transport = (
  method: string,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
) => Promise<{ status: number; body: unknown }>;
export const change = (value: unknown) => ({ detail: { value } });
export const tap = (id: string) => ({
  currentTarget: { dataset: { id, key: id } },
});
export async function captureSeriesPages(
  root: string,
  token: string,
  base: string,
  transport: Transport,
) {
  const nodeRequire = createRequire(__filename);
  const globals = globalThis as unknown as Record<string, unknown>;
  const old = ["wx", "Page", "getCurrentPages"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globals, key)] as const,
  );
  const prefix = resolve(root, "frontend") + "\\";
  const cached = new Map(
    Object.entries(nodeRequire.cache).filter(([file]) =>
      file.startsWith(prefix),
    ),
  );
  for (const file of cached.keys()) delete nodeRequire.cache[file];
  const definitions = new Map<string, ActualPage>(),
    pages: ActualPage[] = [];
  const pending = new Set<Promise<unknown>>(),
    records: HttpRecord[] = [];
  const values = new Map<string, unknown>([
    [
      "education.runtime",
      {
        dataDriver: "api",
        apiBaseUrl: base,
        accessToken: token,
        enableTestAccountSwitcher: false,
      },
    ],
    ["education.session.logged-out", false],
  ]);
  let registering = "",
    stack: Array<{ route: string }> = [],
    lost: string | undefined;
  let navigation: Navigation | undefined;
  const modals: Array<{
    success(value: { confirm: boolean; cancel: boolean }): void;
  }> = [];
  const returns: Array<{ delta?: number }> = [],
    relaunches: unknown[] = [];
  const savedEvents: Array<{ name: string; value: unknown }> = [];
  let consumedReturns = 0;
  const platform = {
    env: { USER_DATA_PATH: "unused-f02" },
    getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ top: 28, height: 32, left: 294 }),
    getStorageSync: (key: string) => values.get(key),
    setStorageSync: (key: string, value: unknown) => values.set(key, value),
    removeStorageSync: (key: string) => values.delete(key),
    request: (options: RequestOptions) => {
      const url = new URL(options.url);
      requireSeries(
        url.origin === new URL(base).origin,
        "Page attempted another HTTP origin",
      );
      const path = url.pathname + url.search,
        method = options.method ?? "GET";
      const task = (async () => {
        try {
          const response = await transport(
            method,
            path,
            options.data,
            options.header,
          );
          const record: HttpRecord = {
            method,
            path,
            key: options.header?.["Idempotency-Key"],
            body: options.data,
            status: response.status,
            response: response.body,
          };
          records.push(record);
          if (
            lost &&
            path === lost &&
            method !== "GET" &&
            response.status === 200
          ) {
            lost = undefined;
            record.deliberatelyLost = true;
            options.fail({
              errMsg:
                "request:fail deliberate receipt loss after real HTTP commit",
            });
          } else
            options.success({
              statusCode: response.status,
              data: response.body,
            });
        } catch {
          options.fail({ errMsg: "request:fail real HTTP transport failure" });
        }
      })();
      pending.add(task);
      void task.finally(() => pending.delete(task));
      return {
        abort() {
          /* no in-flight request is discarded; close drains all */
        },
      };
    },
    showModal: (options: (typeof modals)[number]) => modals.push(options),
    navigateTo: (options: Navigation) => {
      navigation = options;
    },
    navigateBack: (options: { delta?: number }) => returns.push(options),
    reLaunch: (options: unknown) => relaunches.push(options),
    redirectTo: () => undefined,
    showToast: () => undefined,
    stopPullDownRefresh: () => undefined,
    enableAlertBeforeUnload: () => undefined,
    disableAlertBeforeUnload: () => undefined,
    loadFontFace: (options: { fail?(): void }) => options.fail?.(),
  };
  globals.wx = platform;
  globals.getCurrentPages = () => stack;
  globals.Page = (definition: ActualPage) =>
    definitions.set(registering, definition);
  for (const route of ["schedule", "schedule-editor"]) {
    registering = route;
    nodeRequire(resolve(root, `frontend/pages/operator/${route}/index.ts`));
  }
  const settle = async () => {
    for (let round = 0; round < 100; round++) {
      await Promise.allSettled([...pending]);
      await new Promise<void>((done) => setTimeout(done, 0));
      if (pending.size === 0) return;
    }
    throw Error("Page HTTP did not settle in bounded rounds");
  };
  const instantiate = (route: string) => {
    const definition = definitions.get(route);
    requireSeries(definition, `actual Page missing: ${route}`);
    const page: ActualPage = {
      ...definition,
      data: structuredClone(definition.data),
    };
    page.setData = (patch: object) => Object.assign(page.data, patch);
    pages.push(page);
    return page;
  };
  const schedule = instantiate("schedule");
  stack = [{ route: "pages/operator/schedule/index" }];
  schedule.onLoad();
  schedule.onShow();
  await settle();
  return {
    schedule,
    records,
    settle,
    loseNextSuccess(path: string) {
      lost = path;
    },
    async editor(id?: string) {
      navigation = undefined;
      if (id) schedule.onEditTap(tap(id));
      else schedule.onCreateTap();
      requireSeries(navigation, "schedule did not navigate");
      const events = (navigation as Navigation).events;
      schedule.onHide?.();
      stack = [
        { route: "pages/operator/schedule/index" },
        { route: "pages/operator/schedule-editor/index" },
      ];
      const editor = instantiate("schedule-editor");
      editor.getOpenerEventChannel = () => ({
        emit: (name: string, value: unknown) => {
          savedEvents.push({ name, value });
          events?.[name]?.(value);
        },
      });
      editor.onLoad(id ? { mode: "edit", id } : {});
      editor.onShow();
      await settle();
      return editor;
    },
    async confirm() {
      const modal = modals.pop();
      requireSeries(modal, "explicit Page confirmation missing");
      modal.success({ confirm: true, cancel: false });
      await settle();
    },
    modalCount: () => modals.length,
    async back(editor: ActualPage) {
      requireSeries(
        returns.length === consumedReturns + 1 &&
          returns.at(-1)?.delta === 1 &&
          relaunches.length === 0,
        "product did not request the expected return navigation",
      );
      const event = savedEvents.at(-1);
      const result = event?.value as
        { id?: string; version?: number } | undefined;
      requireSeries(
        event?.name === "scheduleSaved" &&
          result?.id === editor.data.savedId &&
          result?.version === editor.verified?.version,
        "product saved return event missing or changed",
      );
      consumedReturns++;
      editor.onUnload?.();
      stack = [{ route: "pages/operator/schedule/index" }];
      schedule.onShow();
      await settle();
    },
    async allScheduleRows() {
      schedule.onPullDownRefresh();
      await settle();
      for (let page = 0; page < 100 && schedule.data.hasMore; page++) {
        schedule.onLoadMore();
        await settle();
      }
      requireSeries(
        !schedule.data.hasMore,
        "schedule pagination did not finish",
      );
      requireSeries(
        schedule.data.items.length === schedule.data.total &&
          !schedule.data.refreshing &&
          !schedule.data.loadingMore &&
          !schedule.data.refreshError &&
          !schedule.data.loadMoreError &&
          new Set(schedule.data.items.map((x: { id: string }) => x.id)).size ===
            schedule.data.total,
        "schedule authoritative pagination incomplete",
      );
      return schedule.data;
    },
    async close() {
      await settle();
      for (const page of pages) page.onUnload?.();
      await settle();
      for (const [key, descriptor] of old) {
        if (descriptor) Object.defineProperty(globals, key, descriptor);
        else Reflect.deleteProperty(globals, key);
      }
      for (const file of Object.keys(nodeRequire.cache))
        if (file.startsWith(prefix)) delete nodeRequire.cache[file];
      for (const [file, module] of cached) nodeRequire.cache[file] = module;
    },
  };
}
