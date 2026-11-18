import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { createConnection } from 'node:net';
import { assertFreeCampaignNativeTarget } from './support/free-campaign-native-policy';
import {
  CampaignPageTransport,
  captureCampaignPage,
} from './support/partner-campaign-page-harness';

assertFreeCampaignNativeTarget(process.env);
jest.setTimeout(60_000);

interface Editor {
  data: {
    viewState: string;
    draftId: string;
    version: number;
    form: Record<string, string>;
    freeForm: Record<string, string>;
    freeReady: boolean;
    dirty: boolean;
    freeDirty: boolean;
    freeSaveUnknown: boolean;
    needsVersionRefresh: boolean;
    savingAll: boolean;
    history: Array<{ versionId: string; status: string }>;
    registrations: unknown[];
    publishedPath: string;
  };
  pendingLoad?: Promise<void>;
  pendingSave?: Promise<void>;
  pendingSaveAll?: Promise<void>;
  freePending?: Promise<void>;
  listPending?: Promise<void>;
  freeSaveAttempt?: unknown;
  onLoad(query: { id: string }): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onInput(event: {
    currentTarget: { dataset: { field: string } };
    detail: { value: string };
  }): void;
  onFreeInput: Editor['onInput'];
  onSave(): Promise<void>;
  onSaveAll(): Promise<void>;
  onFreeSave(): Promise<void>;
  onSubmit(): Promise<void>;
  onReload(): Promise<void>;
}
interface Facts {
  draft: Record<string, unknown>;
  campaign: Record<string, unknown>;
  versions: unknown[];
  registrations: unknown[];
  submitAudit: number;
  configurationAudit: { basics: number; settings: number };
  financial: Record<string, number>;
  activeRequests: number;
}
interface Event {
  kind: string;
  summary: Facts;
  traces: unknown[];
  count?: number;
  users?: Array<{
    id: string;
    status: string;
    displayName: string;
    roles: Array<{ roleCode: string; campusId: string | null }>;
  }>;
  ownedUsers?: string[];
}
interface Ready extends Event {
  runTag: string;
  port: number;
  origin: string;
  profile: string;
  parentId: string;
  partnerId: string;
  adminId: string;
  campusId: string;
  loginCode: string;
  draftId: string;
  draftVersion: number;
  campaignId: string;
  publishedVersionId: string;
  before: Facts;
  configuration: {
    basics: {
      expectedVersion: number;
      basicInformation: Record<string, string>;
    };
    settings: {
      expectedVersion: number;
      freeRegistration: {
        startsAt: string;
        endsAt: string;
        capacityMode: string;
        maxRegistrations: number;
      };
    };
  };
}

describe('owned partner configuration profile through actual Page and TCP', () => {
  const pages: Editor[] = [];
  const events: Event[] = [];
  const states: object[] = [];
  const host = globalThis as unknown as Record<string, unknown>;
  const globals = new Map<string, PropertyDescriptor | undefined>();
  let child: ChildProcessWithoutNullStreams;
  let exit: Promise<{ code: number | null; signal: string | null }>;
  let ready: Ready;
  let finalFacts: Facts;
  let transport: CampaignPageTransport;
  let token = '';
  let diagnostics = '';
  let runtime: { dataDriver: string; apiBaseUrl: string; accessToken: string };
  let waiter:
    | { kind: string; accept(value: Event): void; reject(error: Error): void }
    | undefined;
  const queued: Event[] = [];
  const receive = (kind: string): Promise<Event> => {
    const found = queued.findIndex(
      (v) => v.kind === kind || v.kind === 'failure',
    );
    if (found >= 0) {
      const value = queued.splice(found, 1)[0];
      return value.kind === 'failure'
        ? Promise.reject(
            new Error('Exclusive fixture failed; details withheld'),
          )
        : Promise.resolve(value);
    }
    if (waiter) throw new Error('Only one fixture response reader is allowed');
    return new Promise((accept, reject) => {
      const timer = setTimeout(() => {
        waiter = undefined;
        reject(new Error(`Exclusive fixture timeout: ${kind}`));
      }, 45_000);
      waiter = {
        kind,
        accept(value) {
          clearTimeout(timer);
          accept(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
      };
    });
  };
  const control = async (command: string, kind = command) => {
    const response = receive(kind);
    child.stdin.write(`${command}\n`);
    return response;
  };
  const snapshot = async () => (await control('snapshot')).summary;
  const settle = async (page: Editor) => {
    for (let round = 0; round < 4; round++) {
      await Promise.all(
        [
          page.pendingLoad,
          page.pendingSave,
          page.pendingSaveAll,
          page.freePending,
          page.listPending,
        ].filter((task): task is Promise<void> => task !== undefined),
      );
      await transport.idle();
      await new Promise<void>((done) => setImmediate(done));
    }
  };
  const record = (label: string, page: Editor) => {
    states.push({ label, ...structuredClone(page.data) });
  };
  const open = async () => {
    const page = captureCampaignPage<Editor>('campaign-editor');
    pages.push(page);
    page.onLoad({ id: ready.draftId });
    page.onShow();
    await settle(page);
    return page;
  };
  const edit = (page: Editor, field: string, value: string, free = false) => {
    const event = { currentTarget: { dataset: { field } }, detail: { value } };
    if (free) page.onFreeInput(event);
    else page.onInput(event);
  };
  const send = async (method: string, path: string, body?: object) => {
    const response = await fetch(ready.origin + path, {
      method,
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    await response.json();
    return response.status;
  };
  const immutable = (facts: Facts) => {
    expect(facts.campaign).toEqual(ready.before.campaign);
    expect(facts.versions).toEqual(ready.before.versions);
    expect(facts.registrations).toEqual(ready.before.registrations);
    expect(facts.submitAudit).toBe(ready.before.submitAudit);
    expect(facts.financial).toEqual(ready.before.financial);
    expect(Object.values(facts.financial).every((v) => v === 0)).toBe(true);
    expect(facts.activeRequests).toBe(0);
  };

  beforeAll(async () => {
    child = spawn(
      process.execPath,
      [
        '-r',
        'ts-node/register/transpile-only',
        'test/support/partner-free-native-server.ts',
      ],
      {
        cwd: resolve(__dirname, '..'),
        env: { ...process.env, PARTNER_FREE_NATIVE_PROFILE: 'configuration' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    exit = new Promise((done) => {
      child.once('exit', (code, signal) => {
        waiter?.reject(
          new Error('Exclusive fixture exited before its response'),
        );
        waiter = undefined;
        done({ code, signal });
      });
      child.once('error', () => {
        waiter?.reject(new Error('Exclusive fixture could not start'));
        waiter = undefined;
        done({ code: null, signal: 'SPAWN_ERROR' });
      });
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (value: string) => {
      diagnostics += value;
    });
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (!line.startsWith('{')) return;
      const value = JSON.parse(line) as Event;
      events.push(value);
      if (waiter && (waiter.kind === value.kind || value.kind === 'failure')) {
        const current = waiter;
        waiter = undefined;
        if (value.kind === 'failure')
          current.reject(
            new Error('Exclusive fixture failed; details withheld'),
          );
        else current.accept(value);
      } else queued.push(value);
    });
    ready = (await receive('ready')) as Ready;
    expect(ready.profile).toBe('configuration');
    expect(ready.before.versions).toHaveLength(20);
    expect(ready.before.registrations).toHaveLength(21);
    const response = await fetch(ready.origin + '/auth/login', {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: ready.loginCode }),
    });
    const session = (await response.json()) as {
      data: { accessToken: string; me: { userId: string; roles: object[] } };
    };
    expect(response.status).toBe(200);
    expect(session.data.me).toMatchObject({
      userId: ready.partnerId,
      roles: [{ code: 'PARTNER', campusId: ready.campusId }],
    });
    expect(session.data.me.roles).toHaveLength(1);
    token = session.data.accessToken;
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    transport = new CampaignPageTransport(ready.origin, new Set([token]), true);
    runtime = {
      dataDriver: 'api',
      apiBaseUrl: ready.origin,
      accessToken: token,
    };
    for (const key of ['wx', 'Page', 'getCurrentPages'])
      globals.set(key, Object.getOwnPropertyDescriptor(host, key));
    host.wx = {
      getStorageSync: (key: string) =>
        key === 'education.runtime' ? runtime : undefined,
      request: transport.request,
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 47 }),
      getMenuButtonBoundingClientRect: () => ({
        top: 51,
        left: 296,
        height: 31,
      }),
      enableAlertBeforeUnload: jest.fn(),
      disableAlertBeforeUnload: jest.fn(),
    };
    host.getCurrentPages = () => [{}, ...pages];
  });

  afterAll(async () => {
    let evidenceWritten = false;
    let stopped: Event | undefined;
    let drainError: Error | undefined;
    let stopError: Error | undefined;
    try {
      try {
        for (const page of pages) page.onUnload();
        await transport?.drain();
      } catch (error) {
        drainError =
          error instanceof Error ? error : new Error('Page drainage failed');
      }
      token = '';
      if (runtime) runtime.accessToken = '';
      try {
        if (child && child.exitCode === null) {
          stopped = await control('stop', 'stopped');
        }
      } catch (error) {
        stopError =
          error instanceof Error ? error : new Error('Fixture stop failed');
      } finally {
        child?.stdin.end();
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const exitResult = await Promise.race([
        exit,
        new Promise<never>((_done, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error('Exclusive fixture exit timeout; recovery retained'),
              ),
            15_000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (stopError) throw stopError;
      expect(exitResult).toEqual({ code: 0, signal: null });
      if (drainError) throw drainError;
      expect(diagnostics).toBe('');
      if (stopped && ready) {
        expect(stopped.ownedUsers?.slice().sort()).toEqual(
          [ready.parentId, ready.partnerId, ready.adminId].sort(),
        );
        expect(stopped.users).toHaveLength(3);
        for (const user of stopped.users ?? []) {
          expect(user.status).toBe('DISABLED');
          expect(user.roles).toHaveLength(1);
          const role = user.roles[0];
          expect(user.displayName).toBe(`${ready.runTag}-${role.roleCode}`);
          expect(role.campusId).toBe(
            role.roleCode === 'SUPER_ADMIN' ? null : ready.campusId,
          );
        }
        expect(stopped.summary).toEqual(finalFacts ?? ready.before);
      }
      if (!ready) return;
      const listenerClosed = await new Promise<boolean>((done) => {
        const socket = createConnection({
          host: '127.0.0.1',
          port: ready.port,
        });
        socket.once('connect', () => {
          socket.destroy();
          done(false);
        });
        socket.once('error', (error: NodeJS.ErrnoException) =>
          done(error.code === 'ECONNREFUSED'),
        );
        socket.setTimeout(1500, () => {
          socket.destroy();
          done(false);
        });
      });
      expect(listenerClosed).toBe(true);
      process.stdout.write(
        `PARTNER_FREE_CONFIGURATION_EVIDENCE ${JSON.stringify({
          mode: 'Actual Page/defaultRequest with Node TCP transport; native navigation blocked',
          ready,
          events,
          states,
          finalFacts,
          listenerClosed,
          wire: transport.calls,
          tokenReleased: token === '' && runtime.accessToken === '',
          disposition:
            'three exact owned synthetic users disabled; records retained; no deletion',
        })}\n`,
      );
      evidenceWritten = true;
    } finally {
      if (!evidenceWritten)
        process.stdout.write(
          `PARTNER_FREE_CONFIGURATION_RECOVERY ${JSON.stringify({
            ready: ready ?? null,
            events,
            tokenReleased:
              token === '' && (!runtime || runtime.accessToken === ''),
            disposition:
              'Failure recovery retained; use exact server ownership and closeout flags',
          })}\n`,
        );
      for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(host, key, descriptor);
        else Reflect.deleteProperty(host, key);
      }
    }
  });

  it('refuses undeclared writes and leaves every database fact unchanged', async () => {
    const base = `/partners/me/campaign-drafts/${ready.draftId}`;
    for (const [method, path, body] of [
      [
        'POST',
        '/partners/me/campaign-drafts',
        ready.configuration.basics.basicInformation,
      ],
      ['POST', base + '/submit', { expectedVersion: 2 }],
      [
        'PUT',
        base + '/basic-information',
        { ...ready.configuration.basics, campusId: ready.campusId },
      ],
      [
        'PUT',
        base + '/free-registration',
        { ...ready.configuration.settings, expectedVersion: 2 },
      ],
      [
        'PUT',
        `/partners/me/campaign-drafts/${ready.campaignId}/basic-information`,
        ready.configuration.basics,
      ],
      ['GET', '/parents/me/campaign-registrations', undefined],
    ] as const) {
      expect(await send(method, path, body)).toBe(403);
    }
    expect(await snapshot()).toEqual(ready.before);
  });

  it('saves all dirty sections from one command with exact lost-reply replays and fresh version4 readback', async () => {
    const page = await open();
    expect(page.data.version).toBe(2);
    expect(page.data.history).toHaveLength(20);
    record('loaded', page);
    const { basics, settings } = ready.configuration;
    for (const field of ['title', 'shareDescription', 'contactPhone'])
      edit(page, field, basics.basicInformation[field]);
    for (const field of ['startsAt', 'endsAt', 'maxRegistrations'] as const)
      edit(page, field, String(settings.freeRegistration[field]), true);
    expect(page.data).toMatchObject({ dirty: true, freeDirty: true });
    const freeForm = structuredClone(page.data.freeForm);
    transport.deliverNext('lost');
    await page.onSaveAll();
    await settle(page);
    expect(page.data).toMatchObject({
      version: 2,
      dirty: true,
      freeDirty: true,
    });
    expect(page.data.freeForm).toEqual(freeForm);
    record('basic-reply-lost', page);
    const afterBasic = await snapshot();
    expect(afterBasic.draft).toMatchObject({
      version: 3,
      ...basics.basicInformation,
    });
    expect(afterBasic.configurationAudit.basics).toBe(
      ready.before.configurationAudit.basics + 1,
    );
    immutable(afterBasic);
    const wxHost = host.wx as { request: typeof transport.request };
    wxHost.request = (options) => {
      if (
        options.method === 'PUT' &&
        options.url.endsWith('/free-registration')
      )
        transport.deliverNext('lost');
      return transport.request(options);
    };
    await page.onSaveAll();
    wxHost.request = transport.request;
    await settle(page);
    expect(page.data).toMatchObject({
      version: 3,
      freeDirty: true,
      freeSaveUnknown: true,
      dirty: false,
      savingAll: false,
    });
    const afterConfig = await snapshot();
    expect(afterConfig.draft).toMatchObject({
      version: 4,
      ...basics.basicInformation,
      freeStartsAt: settings.freeRegistration.startsAt,
      freeEndsAt: settings.freeRegistration.endsAt,
      freeCapacityMode: settings.freeRegistration.capacityMode,
      freeMaxRegistrations: settings.freeRegistration.maxRegistrations,
    });
    expect(afterConfig.configurationAudit).toEqual({
      basics: ready.before.configurationAudit.basics + 1,
      settings: ready.before.configurationAudit.settings + 1,
    });
    immutable(afterConfig);
    page.onHide();
    page.onShow();
    await settle(page);
    const writes = transport.calls.filter((v) => v.method !== 'GET').length;
    await page.onSave();
    await page.onSubmit();
    edit(page, 'title', '不得替换原操作');
    edit(page, 'maxRegistrations', '999', true);
    expect(transport.calls.filter((v) => v.method !== 'GET')).toHaveLength(
      writes,
    );
    expect(page.data.form.title).toBe(basics.basicInformation.title);
    expect(page.data.freeForm).toEqual(freeForm);
    record('configuration-unknown-return', page);
    await page.onSaveAll();
    await settle(page);
    expect(page.data).toMatchObject({
      version: 4,
      dirty: false,
      freeDirty: false,
      freeSaveUnknown: false,
      needsVersionRefresh: false,
      savingAll: false,
    });
    expect(page.freeSaveAttempt).toBeUndefined();
    expect(await snapshot()).toEqual(afterConfig);
    const put = transport.calls.filter((v) => v.method === 'PUT');
    expect(put).toHaveLength(4);
    expect(put.map((v) => v.status)).toEqual([200, 200, 200, 200]);
    expect(put.map((v) => v.delivery)).toEqual([
      'lost',
      'success',
      'lost',
      'success',
    ]);
    expect(put[0].body).toEqual(basics);
    expect(put[1].body).toEqual(basics);
    expect(put[2].body).toEqual(settings);
    expect(put[3].body).toEqual(settings);
    await page.onReload();
    await settle(page);
    expect(page.data.form).toEqual(basics.basicInformation);
    expect(page.data.freeForm).toEqual(freeForm);
    expect(page.data.publishedPath).toBe(
      `/pages/parent/campaign-registration/index?campaignId=${ready.campaignId}&versionId=${ready.publishedVersionId}`,
    );
    record('fresh-readback', page);
    const reopened = await open();
    expect(reopened.data).toMatchObject({
      version: 4,
      dirty: false,
      freeDirty: false,
      freeSaveUnknown: false,
      form: basics.basicInformation,
      freeForm,
    });
    expect(reopened.data.history).toHaveLength(20);
    expect(reopened.data.history.every((v) => v.status === 'APPROVED')).toBe(
      true,
    );
    record('fresh-instance', reopened);
    finalFacts = afterConfig;
  });

  it('returns actual409 for an old exact basic payload without overwriting the saved configuration', async () => {
    expect(
      await send(
        'PUT',
        `/partners/me/campaign-drafts/${ready.draftId}/basic-information`,
        ready.configuration.basics,
      ),
    ).toBe(409);
    expect(await snapshot()).toEqual(finalFacts);
  });

  it('clears current Page content on actual401 with its unchanged token after exact partner disable', async () => {
    const page = pages[pages.length - 1];
    expect((await control('disable-partner', 'disabled-partner')).count).toBe(
      1,
    );
    await page.onReload();
    await settle(page);
    expect(transport.calls.at(-1)?.status).toBe(401);
    expect(page.data).toMatchObject({
      viewState: 'forbidden',
      draftId: '',
      version: 0,
      form: { title: '', shareDescription: '', contactPhone: '' },
      freeReady: false,
      freeDirty: false,
      freeSaveUnknown: false,
      freeForm: { startsAt: '', endsAt: '', maxRegistrations: '' },
      history: [],
      registrations: [],
      publishedPath: '',
    });
    record('actual401-cleared', page);
    expect(await snapshot()).toEqual(finalFacts);
  });
});
