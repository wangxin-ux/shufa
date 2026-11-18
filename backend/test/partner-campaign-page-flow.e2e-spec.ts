import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { AuthService } from '../src/modules/auth/auth.service';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import {
  CampaignPageTransport,
  captureCampaignPage,
} from './support/partner-campaign-page-harness';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);

interface Form {
  title: string;
  campaignType: string;
  shareDescription: string;
  contactPhone: string;
}
interface Editor {
  data: {
    viewState: string;
    form: Form;
    draftId: string;
    version: number;
    dirty: boolean;
    saving: boolean;
    message: string;
    createUncertain: boolean;
    needsVersionRefresh: boolean;
  };
  pendingLoad?: Promise<void>;
  onLoad(query: { id?: string }): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onInput(event: {
    currentTarget: { dataset: { field: string } };
    detail: { value: string };
  }): void;
  onTypeChange(event: { detail: { value: string } }): void;
  onSave(): Promise<void>;
  onReload(): Promise<void>;
}
interface DraftList {
  data: {
    phase: string;
    viewState: string;
    drafts: Array<{ draftId: string; titleLabel: string; typeLabel: string }>;
    campaigns: unknown[];
  };
  pendingRequest?: Promise<void>;
  onLoad(): void;
  onShow(): void;
  onUnload(): void;
  onPhaseTap(event: { currentTarget: { dataset: { phase: string } } }): void;
}
interface Actor {
  id: string;
  token: string;
}

describe('actual campaign Page and frontend transport through local HTTP and PostgreSQL', () => {
  const runTag = `cpage-${randomUUID().slice(0, 8)}`;
  const users: string[] = [];
  const pages: Array<{
    onUnload(): void;
    pendingLoad?: Promise<void>;
    pendingSave?: Promise<void>;
    pendingRequest?: Promise<void>;
  }> = [];
  const calls: Array<{ method: string; status?: number; delivery?: string }> =
    [];
  const host = globalThis as unknown as Record<string, unknown>;
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const tokens = new Set<string>();
  let app: INestApplication;
  let prisma: PrismaService;
  let campusId: string;
  let outsideCampusId: string;
  let origin: string;
  let owner: Actor;
  let colleague: Actor;
  let outsider: Actor;
  let runtime: { dataDriver: string; apiBaseUrl: string; accessToken: string };
  let transport: CampaignPageTransport;

  const makeActor = async (campus: string): Promise<Actor> => {
    const user = await prisma.user.create({
      data: {
        displayName: `${runTag}-${users.length}`,
        roles: { create: { roleCode: 'PARTNER', campusId: campus } },
      },
    });
    users.push(user.id);
    const token = (await app.get(AuthService).issueSessionForUser(user.id))
      .accessToken;
    tokens.add(token);
    return { id: user.id, token };
  };
  const edit = (page: Editor, field: string, value: string) =>
    page.onInput({
      currentTarget: { dataset: { field } },
      detail: { value },
    });
  const open = async (id?: string): Promise<Editor> => {
    const page = captureCampaignPage<Editor>('campaign-editor');
    pages.push(page);
    page.onLoad(id ? { id } : {});
    page.onShow();
    await page.pendingLoad;
    await transport.idle();
    return page;
  };
  const stored = (id: string) =>
    prisma.partnerCampaignDraft.findUniqueOrThrow({ where: { id } });
  const auditCount = (id: string) =>
    prisma.auditLog.count({
      where: { resourceId: id, action: 'PARTNER_CAMPAIGN_DRAFT_BASIC_SAVE' },
    });
  const create = async (title = '合成活动草稿') => {
    const page = await open();
    edit(page, 'title', title);
    await page.onSave();
    expect(page.data.viewState).toBe('ready');
    expect(page.data.draftId).not.toBe('');
    return page;
  };

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    await app.listen(0, '127.0.0.1');
    const address = (
      app.getHttpServer() as { address(): AddressInfo }
    ).address();
    origin = `http://127.0.0.1:${address.port}`;
    campusId = (
      await prisma.campus.create({
        data: { code: runTag, name: `${runTag}合成校区` },
      })
    ).id;
    outsideCampusId = (
      await prisma.campus.create({
        data: { code: `${runTag}-outside`, name: `${runTag}其他校区` },
      })
    ).id;
    colleague = await makeActor(campusId);
    outsider = await makeActor(outsideCampusId);
  });
  beforeEach(async () => {
    owner = await makeActor(campusId);
    runtime = {
      dataDriver: 'api',
      apiBaseUrl: origin,
      accessToken: owner.token,
    };
    transport = new CampaignPageTransport(origin, tokens, true);
    for (const key of ['wx', 'Page', 'getCurrentPages']) {
      globals.set(key, Object.getOwnPropertyDescriptor(host, key));
    }
    host.wx = {
      getStorageSync: (key: string) =>
        key === 'education.runtime' ? runtime : undefined,
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 24 }),
      getMenuButtonBoundingClientRect: () => ({
        top: 32,
        left: 295,
        height: 32,
      }),
      request: transport.request,
      enableAlertBeforeUnload: jest.fn(),
      disableAlertBeforeUnload: jest.fn(),
      stopPullDownRefresh: jest.fn(),
    };
    host.getCurrentPages = () => [{}, ...pages];
  });
  afterEach(async () => {
    try {
      const frontendTasks = pages.flatMap((page) =>
        [page.pendingLoad, page.pendingSave, page.pendingRequest].filter(
          (task): task is Promise<void> => task !== undefined,
        ),
      );
      for (const page of pages.splice(0)) page.onUnload();
      await transport?.drain();
      await Promise.all(frontendTasks);
      calls.push(
        ...(transport?.calls ?? []).map(({ method, status, delivery }) => ({
          method,
          status,
          delivery,
        })),
      );
    } finally {
      jest.restoreAllMocks();
      for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(host, key, descriptor);
        else Reflect.deleteProperty(host, key);
      }
      globals.clear();
    }
  });
  afterAll(async () => {
    try {
      if (!prisma) return;
      assertPartnerPdfTestTarget(process.env);
      await prisma.user.updateMany({
        where: { id: { in: users }, displayName: { startsWith: `${runTag}-` } },
        data: { status: 'DISABLED' },
      });
      const actors = await prisma.user.findMany({
        where: { id: { in: users }, displayName: { startsWith: `${runTag}-` } },
        select: { id: true, status: true },
      });
      const drafts = await prisma.partnerCampaignDraft.findMany({
        where: {
          campusId: { in: [campusId, outsideCampusId] },
          createdByUserId: { in: users },
        },
        select: { id: true },
      });
      expect(actors).toHaveLength(users.length);
      expect(actors.every((actor) => actor.status === 'DISABLED')).toBe(true);
      expect(
        await prisma.groupCampaign.count({
          where: { campusId: { in: [campusId, outsideCampusId] } },
        }),
      ).toBe(0);
      process.stdout.write(
        `PARTNER_CAMPAIGN_PAGE_FIXTURE_OWNERSHIP ${JSON.stringify({
          runTag,
          userIds: users,
          campusIds: [campusId, outsideCampusId],
          draftIds: drafts.map((draft) => draft.id),
          allOwnedUsersDisabled: true,
          disposition:
            'owned synthetic users disabled; drafts and audits retained; no deletion',
        })}\n`,
      );
      process.stdout.write(
        `PARTNER_CAMPAIGN_PAGE_HTTP ${JSON.stringify({ runTag, calls })}\n`,
      );
    } finally {
      await app?.close();
      if (origin) {
        expect((app.getHttpServer() as { listening: boolean }).listening).toBe(
          false,
        );
        process.stdout.write(
          `PARTNER_CAMPAIGN_PAGE_CLOSED ${JSON.stringify({
            runTag,
            port: Number(new URL(origin).port),
          })}\n`,
        );
      }
    }
  });

  it('saves, lists and reopens Unicode boundary fields using the actual frontend parser', async () => {
    const page = await open();
    expect(transport.calls).toHaveLength(0);
    edit(page, 'title', ` ${'😀'.repeat(40)} `);
    edit(page, 'shareDescription', '合成'.repeat(500));
    edit(page, 'contactPhone', '0'.repeat(30));
    page.onTypeChange({ detail: { value: 'FREE_REGISTRATION' } });
    await page.onSave();
    const id = page.data.draftId;
    expect(await stored(id)).toMatchObject({
      title: '😀'.repeat(40),
      shareDescription: '合成'.repeat(500),
      contactPhone: '0'.repeat(30),
      campaignType: 'FREE_REGISTRATION',
      version: 1,
      createdByUserId: owner.id,
    });
    const list = captureCampaignPage<DraftList>('group-campaigns');
    pages.push(list);
    list.onLoad();
    list.onShow();
    await list.pendingRequest;
    list.onPhaseTap({ currentTarget: { dataset: { phase: 'DRAFT' } } });
    await list.pendingRequest;
    expect(list.data).toMatchObject({ viewState: 'ready', campaigns: [] });
    expect(list.data.drafts).toContainEqual(
      expect.objectContaining({ draftId: id, typeLabel: '免费报名' }),
    );
    const reopened = await open(id);
    expect(reopened.data.form).toEqual(page.data.form);
    expect(reopened.data.version).toBe(1);
    expect(reopened.data.dirty).toBe(false);
  });

  it('applies a committed save after hide/show without a second HTTP write', async () => {
    const page = await create();
    edit(page, 'title', '隐藏期间保存');
    transport.deliverNext('held');
    const saving = page.onSave();
    await transport.idle();
    expect((await stored(page.data.draftId)).version).toBe(2);
    page.onHide();
    transport.release();
    await saving;
    expect(page.data.version).toBe(1);
    page.onShow();
    expect(page.data).toMatchObject({
      version: 2,
      saving: false,
      dirty: false,
    });
    expect(
      transport.calls.filter((call) => call.method === 'PUT'),
    ).toHaveLength(1);
  });

  it('replays a committed creation with the same key after its real response is lost', async () => {
    const page = await open();
    edit(page, 'title', '未知创建结果');
    transport.deliverNext('lost');
    await page.onSave();
    expect(page.data.createUncertain).toBe(true);
    expect(page.data.draftId).toBe('');
    const first = transport.calls.find((call) => call.method === 'POST')!;
    expect(first.status).toBe(200);
    edit(page, 'title', '重试不应替换');
    await page.onSave();
    const writes = transport.calls.filter((call) => call.method === 'POST');
    expect(writes).toHaveLength(2);
    expect(writes[1].key).toBe(first.key);
    expect(writes[1].body).toEqual(first.body);
    expect(page.data.form.title).toBe('未知创建结果');
    expect(page.data.createUncertain).toBe(false);
    expect(await auditCount(page.data.draftId)).toBe(1);
    expect(
      await prisma.partnerCampaignDraft.count({
        where: { campusId, createdByUserId: owner.id },
      }),
    ).toBe(1);
  });

  it('retries a committed PUT naturally without incrementing its version or audit twice', async () => {
    const page = await create();
    edit(page, 'contactPhone', '0000');
    transport.deliverNext('lost');
    await page.onSave();
    expect(page.data).toMatchObject({ version: 1, dirty: true, saving: false });
    expect((await stored(page.data.draftId)).version).toBe(2);
    await page.onSave();
    expect(page.data).toMatchObject({ version: 2, dirty: false });
    expect(await auditCount(page.data.draftId)).toBe(2);
  });

  it('preserves local input through a same-campus edit conflict and explicit reread', async () => {
    const page = await create();
    const id = page.data.draftId;
    runtime.accessToken = colleague.token;
    const other = await open(id);
    edit(other, 'title', '同校区修改');
    await other.onSave();
    runtime.accessToken = owner.token;
    edit(page, 'title', '本人未保存修改');
    await page.onSave();
    expect(page.data.needsVersionRefresh).toBe(true);
    expect(page.data.form.title).toBe('本人未保存修改');
    await page.onReload();
    expect(page.data).toMatchObject({
      version: 2,
      dirty: true,
      needsVersionRefresh: false,
    });
    expect(page.data.form.title).toBe('本人未保存修改');
    await page.onSave();
    expect(await stored(id)).toMatchObject({
      title: '本人未保存修改',
      version: 3,
      createdByUserId: owner.id,
    });
  });

  it('clears a foreign-campus editor after the actual HTTP 404', async () => {
    const source = await create('不能跨校区读取');
    runtime.accessToken = outsider.token;
    const foreign = await open(source.data.draftId);
    expect(foreign.data).toMatchObject({
      viewState: 'forbidden',
      draftId: '',
      version: 0,
      form: {
        title: '',
        campaignType: '',
        shareDescription: '',
        contactPhone: '',
      },
    });
    expect(transport.calls[transport.calls.length - 1].status).toBe(404);
  });

  it('clears private edits when the backend revokes the actual role before PUT', async () => {
    const page = await create();
    const id = page.data.draftId;
    edit(page, 'contactPhone', '000000');
    await prisma.userRole.updateMany({
      where: { userId: owner.id, campusId, roleCode: 'PARTNER' },
      data: { roleCode: 'PARENT' },
    });
    await page.onSave();
    expect(page.data).toMatchObject({
      viewState: 'forbidden',
      draftId: '',
      dirty: false,
      form: { contactPhone: '' },
    });
    expect(await stored(id)).toMatchObject({ version: 1, contactPhone: null });
    expect(transport.calls[transport.calls.length - 1].status).toBe(403);
  });

  it('does not restore a completed old GET after the frontend credential changes', async () => {
    const source = await create('旧身份私有内容');
    transport.deliverNext('held');
    const page = captureCampaignPage<Editor>('campaign-editor');
    pages.push(page);
    page.onLoad({ id: source.data.draftId });
    page.onShow();
    const reading = page.pendingLoad;
    await transport.idle();
    expect(transport.calls[transport.calls.length - 1].status).toBe(200);
    runtime.accessToken = outsider.token;
    page.onHide();
    page.onShow();
    transport.release();
    await reading;
    expect(page.data).toMatchObject({
      viewState: 'forbidden',
      draftId: '',
      form: { title: '', contactPhone: '' },
    });
  });

  it.each(['token', 'address', 'driver'])(
    'does not send an initial queued old-page GET after a %s change',
    async (change) => {
      const source = await create('排队读取身份边界');
      const id = source.data.draftId;
      const count = transport.calls.length;
      const page = captureCampaignPage<Editor>('campaign-editor');
      pages.push(page);
      page.onLoad({ id });
      page.onShow();
      const reading = page.pendingLoad;
      if (change === 'token') runtime.accessToken = colleague.token;
      if (change === 'address') runtime.apiBaseUrl = `${origin}/changed`;
      if (change === 'driver') runtime.dataDriver = 'mock';
      await reading;
      await transport.idle();
      expect(transport.calls).toHaveLength(count);
      expect(page.data).toMatchObject({
        viewState: 'forbidden',
        draftId: '',
        version: 0,
        form: { title: '', contactPhone: '' },
      });
      expect(await stored(id)).toMatchObject({
        version: 1,
        title: '排队读取身份边界',
      });
      expect(await auditCount(id)).toBe(1);
    },
  );

  it.each(['token', 'address', 'driver'])(
    'clears loaded private fields without sending a queued reread after a %s change',
    async (change) => {
      const source = await create('已读取身份边界');
      const id = source.data.draftId;
      const page = await open(id);
      const count = transport.calls.length;
      const reading = page.onReload();
      if (change === 'token') runtime.accessToken = colleague.token;
      if (change === 'address') runtime.apiBaseUrl = `${origin}/changed`;
      if (change === 'driver') runtime.dataDriver = 'mock';
      await reading;
      await transport.idle();
      expect(transport.calls).toHaveLength(count);
      expect(page.data).toMatchObject({
        viewState: 'forbidden',
        draftId: '',
        version: 0,
        form: { title: '', contactPhone: '' },
      });
      expect(await stored(id)).toMatchObject({
        version: 1,
        title: '已读取身份边界',
      });
      expect(await auditCount(id)).toBe(1);
    },
  );

  it.each(['create', 'save'])(
    'cancels an unsent basic %s on rapid hide/show without a database write',
    async (operation) => {
      const page =
        operation === 'save' ? await create('已保存基础') : await open();
      const id = page.data.draftId;
      edit(page, 'title', '离页前的排队输入');
      const count = transport.calls.length;
      const saving = page.onSave();
      page.onHide();
      page.onShow();
      await saving;
      await transport.idle();
      const reads = id ? 2 : 0;
      expect(transport.calls).toHaveLength(count + reads);
      expect(
        transport.calls.slice(count).every((call) => call.method === 'GET'),
      ).toBe(true);
      expect(page.data).toMatchObject({
        saving: false,
        dirty: true,
        form: { title: '离页前的排队输入' },
      });
      if (id) {
        expect(await stored(id)).toMatchObject({
          version: 1,
          title: '已保存基础',
        });
        expect(await auditCount(id)).toBe(1);
      } else {
        expect(
          await prisma.partnerCampaignDraft.count({
            where: { campusId, createdByUserId: owner.id },
          }),
        ).toBe(0);
      }
      edit(page, 'title', '返回后主动保存');
      await page.onSave();
      expect(transport.calls).toHaveLength(count + reads + 1);
      expect(await stored(page.data.draftId)).toMatchObject({
        title: '返回后主动保存',
        version: operation === 'save' ? 2 : 1,
      });
      expect(await auditCount(page.data.draftId)).toBe(
        operation === 'save' ? 2 : 1,
      );
    },
  );

  it('preserves a committed unknown creation key across a cancelled queued retry on rapid hide/show', async () => {
    const page = await open();
    edit(page, 'title', '已提交未知创建');
    transport.deliverNext('lost');
    await page.onSave();
    const first = transport.calls.at(-1)!;
    expect(first.status).toBe(200);
    const count = transport.calls.length;
    const saving = page.onSave();
    page.onHide();
    page.onShow();
    await saving;
    await transport.idle();
    expect(transport.calls).toHaveLength(count);
    expect(page.data).toMatchObject({
      saving: false,
      createUncertain: true,
      draftId: '',
    });
    await page.onSave();
    const replay = transport.calls.at(-1)!;
    expect(replay.key).toBe(first.key);
    expect(replay.body).toEqual(first.body);
    expect(page.data.createUncertain).toBe(false);
    expect(await auditCount(page.data.draftId)).toBe(1);
    expect(
      await prisma.partnerCampaignDraft.count({
        where: { campusId, createdByUserId: owner.id },
      }),
    ).toBe(1);
  });

  it('keeps the form after an actual transaction rollback and retries the original create', async () => {
    const page = await open();
    edit(page, 'title', '事务回滚后重试');
    const failure = jest
      .spyOn(app.get(IdempotencyService), 'complete')
      .mockRejectedValueOnce(new Error('synthetic campaign Page rollback'));
    try {
      await page.onSave();
    } finally {
      failure.mockRestore();
    }
    expect(page.data).toMatchObject({
      draftId: '',
      dirty: true,
      createUncertain: true,
      form: { title: '事务回滚后重试' },
    });
    expect(
      await prisma.partnerCampaignDraft.count({
        where: { campusId, createdByUserId: owner.id },
      }),
    ).toBe(0);
    await page.onSave();
    expect(page.data.createUncertain).toBe(false);
    expect(await auditCount(page.data.draftId)).toBe(1);
  });
});

describe('campaign Page transport teardown', () => {
  it('drains held responses that finish after teardown has already started', async () => {
    let accepted!: () => void;
    const connected = new Promise<void>((resolve) => {
      accepted = resolve;
    });
    let finishResponse!: () => void;
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.write('{"ok":');
      finishResponse = () => response.end('true}');
      accepted();
    });
    let transport: CampaignPageTransport | undefined;
    try {
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const address = server.address() as AddressInfo;
      const origin = `http://127.0.0.1:${address.port}`;
      const fixtureToken = 'synthetic-page-transport';
      transport = new CampaignPageTransport(origin, new Set([fixtureToken]));
      const success = jest.fn();
      const fail = jest.fn();
      transport.deliverNext('held');
      transport.request({
        url: `${origin}/partners/me/campaign-drafts`,
        method: 'GET',
        header: { Authorization: `Bearer ${fixtureToken}` },
        success,
        fail,
      });
      await connected;
      const draining = transport.drain();
      finishResponse();
      await draining;
      expect(fail).not.toHaveBeenCalled();
      expect(success).toHaveBeenCalledWith({
        statusCode: 200,
        data: { ok: true },
      });
    } finally {
      finishResponse?.();
      await transport?.idle();
      transport?.release();
      await transport?.idle();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
