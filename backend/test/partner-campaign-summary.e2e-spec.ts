import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import {
  CampaignPageTransport,
  captureCampaignPage,
} from './support/partner-campaign-page-harness';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);
interface Receipt {
  draftId: string;
  version: number;
}
interface Review {
  versionId: string;
  campaignId: string;
  version: number;
}
interface Summary extends Receipt {
  status: string;
  lifecycle: string | null;
  latestSubmission: {
    sequence: number;
    sourceDraftVersion: number;
    status: string;
    reviewReason: string | null;
  } | null;
}
interface ListPage {
  data: {
    viewState: string;
    drafts: Array<
      Summary & {
        reviewLabel: string;
        revisionLabel: string;
        reviewReason: string;
        closed: boolean;
      }
    >;
  };
  pendingRequest?: Promise<void>;
  onLoad(): void;
  onShow(): void;
  onUnload(): void;
  onPhaseTap(event: { currentTarget: { dataset: { phase: string } } }): void;
  load(reset: boolean): Promise<void>;
}
const data = <T>(response: { body: unknown }) =>
  (response.body as { data: T }).data;
const base = '/partners/me/campaign-drafts';

describe('owned campaign summaries with frozen review state', () => {
  const runTag = `csummary-${randomUUID().slice(0, 8)}`;
  const users: string[] = [];
  let capturedHistoryRows: number[] | null = null;
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const connect = adapter.connect.bind(adapter);
  jest.spyOn(adapter, 'connect').mockImplementation(async () => {
    const driver = await connect();
    const capture = (target: Pick<typeof driver, 'queryRaw'>) => {
      const queryRaw = target.queryRaw.bind(target);
      target.queryRaw = async (query) => {
        const result = await queryRaw(query);
        if (query.sql.includes('"CampaignVersion"'))
          capturedHistoryRows?.push(result.rows.length);
        return result;
      };
    };
    const startTransaction = driver.startTransaction.bind(driver);
    driver.startTransaction = async (isolationLevel) => {
      const tx = await startTransaction(isolationLevel);
      capture(tx);
      return tx;
    };
    capture(driver);
    return driver;
  });
  const client = new PrismaClient({
    adapter,
    log: [{ emit: 'event', level: 'query' }],
  });
  let captured: string[] | null = null;
  client.$on('query', ({ query }) => captured?.push(query));
  let app: INestApplication;
  let server: Server;
  let campusId: string;
  let outsideId: string;
  let token: string;
  let admin: string;
  let outsider: string;
  let draft: Receipt;
  let review: Review;
  let pagePort: number | undefined;
  const call = (
    method: 'get' | 'post' | 'put',
    url: string,
    auth = token,
    body?: object,
  ) => {
    const pending = request(server)[method](url).auth(auth, { type: 'bearer' });
    if (body) pending.send(body);
    if (method === 'post') pending.set('Idempotency-Key', randomUUID());
    return pending;
  };
  const list = (pageSize = 100, auth = token) =>
    call('get', `${base}?pageSize=${pageSize}`, auth);
  const find = async (id = draft.draftId) =>
    data<Summary[]>(await list().expect(200)).find(
      (row) => row.draftId === id,
    )!;
  const create = async () =>
    data<Receipt>(
      await call('post', base, token, {
        title: `${runTag}免费活动`,
        campaignType: 'FREE_REGISTRATION',
        shareDescription: '合成登记内容',
        contactPhone: '0000-00000000',
      }).expect(200),
    );
  const configure = async (row: Receipt) =>
    data<Receipt>(
      await call('put', `${base}/${row.draftId}/free-registration`, token, {
        expectedVersion: row.version,
        freeRegistration: {
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: new Date(Date.now() + 3_600_000).toISOString(),
          capacityMode: 'UNLIMITED',
          maxRegistrations: null,
        },
      }).expect(200),
    );
  const submit = async (row: Receipt) =>
    data<Review>(
      await call('post', `${base}/${row.draftId}/submit`, token, {
        expectedVersion: row.version,
      }).expect(200),
    );
  const approve = async (row: Review) =>
    data<Review>(
      await call(
        'post',
        `/management/campaign-reviews/${row.versionId}/approve`,
        admin,
        {
          expectedVersion: row.version,
        },
      ).expect(200),
    );
  beforeAll(async () => {
    await client.$connect();
    ({ app } = await createPartnerPdfTestApp((builder) =>
      builder.overrideProvider(PrismaService).useValue(client),
    ));
    server = app.getHttpServer() as Server;
    campusId = (
      await client.campus.create({
        data: { code: runTag, name: `${runTag}合成校区` },
      })
    ).id;
    outsideId = (
      await client.campus.create({
        data: { code: `${runTag}-other`, name: `${runTag}其他校区` },
      })
    ).id;
    const actor = async (
      roleCode: 'PARTNER' | 'SUPER_ADMIN',
      campus: string | null,
    ) => {
      const user = await client.user.create({
        data: {
          displayName: `${runTag}-${users.length}`,
          roles: { create: { roleCode, campusId: campus } },
        },
      });
      users.push(user.id);
      return (await app.get(AuthService).issueSessionForUser(user.id))
        .accessToken;
    };
    token = await actor('PARTNER', campusId);
    admin = await actor('SUPER_ADMIN', null);
    outsider = await actor('PARTNER', outsideId);
  });
  afterAll(async () => {
    try {
      assertPartnerPdfTestTarget(process.env);
      await client.user.updateMany({
        where: { id: { in: users }, displayName: { startsWith: runTag } },
        data: { status: 'DISABLED' },
      });
      process.stdout.write(
        `PARTNER_CAMPAIGN_SUMMARY_OWNERSHIP ${JSON.stringify({
          runTag,
          campusIds: [campusId, outsideId],
          userIds: users,
          disposition:
            'synthetic users disabled; all fixtures retained; no deletion',
        })}\n`,
      );
    } finally {
      await app?.close();
      await client.$disconnect();
      if (pagePort) {
        expect(server.listening).toBe(false);
        process.stdout.write(
          `PARTNER_CAMPAIGN_SUMMARY_SERVER_CLOSED ${JSON.stringify({ runTag, port: pagePort, listening: false })}\n`,
        );
      }
    }
  });
  it('returns a minimal unsubmitted summary without creating a campaign on read', async () => {
    draft = await create();
    expect(await find()).toMatchObject({
      status: 'DRAFT',
      latestSubmission: null,
      lifecycle: null,
    });
    expect(await client.campaign.count({ where: { campusId } })).toBe(0);
  });
  it('shows the frozen submitted version while a later private edit remains separate', async () => {
    draft = await configure(draft);
    review = await submit(draft);
    expect(await find()).toMatchObject({
      version: 2,
      lifecycle: 'OPEN',
      latestSubmission: {
        sequence: 1,
        sourceDraftVersion: 2,
        status: 'SUBMITTED',
        reviewReason: null,
      },
    });
    draft = data<Receipt>(
      await call('put', `${base}/${draft.draftId}/basic-information`, token, {
        expectedVersion: draft.version,
        basicInformation: {
          title: '私有后续修改',
          campaignType: 'FREE_REGISTRATION',
          shareDescription: '合成登记内容',
        },
      }).expect(200),
    );
    expect(await find()).toMatchObject({
      version: 3,
      latestSubmission: { sourceDraftVersion: 2, status: 'SUBMITTED' },
    });
    expect(
      (
        await client.campaignVersion.findUniqueOrThrow({
          where: { id: review.versionId },
        })
      ).title,
    ).toBe(`${runTag}免费活动`);
  });
  it('projects a rejection reason and switches to the newest submission by sequence', async () => {
    await call(
      'post',
      `/management/campaign-reviews/${review.versionId}/reject`,
      admin,
      {
        expectedVersion: review.version,
        reason: '请补充活动说明',
      },
    ).expect(200);
    expect(await find()).toMatchObject({
      latestSubmission: { status: 'REJECTED', reviewReason: '请补充活动说明' },
    });
    review = await submit(draft);
    expect(await find()).toMatchObject({
      latestSubmission: {
        sequence: 2,
        sourceDraftVersion: 3,
        status: 'SUBMITTED',
        reviewReason: null,
      },
    });
  });
  it('keeps approval and closure separate from the draft status and version', async () => {
    review = await approve(review);
    expect(await find()).toMatchObject({
      status: 'DRAFT',
      lifecycle: 'OPEN',
      latestSubmission: { status: 'APPROVED' },
    });
    draft = data<Receipt>(
      await call('put', `${base}/${draft.draftId}/basic-information`, token, {
        expectedVersion: draft.version,
        basicInformation: { title: '尚未送审的修改' },
      }).expect(200),
    );
    expect(await find()).toMatchObject({
      version: 4,
      latestSubmission: { sourceDraftVersion: 3, status: 'APPROVED' },
    });
    const campaign = await client.campaign.findUniqueOrThrow({
      where: { id: review.campaignId },
    });
    await call('post', `/management/campaigns/${campaign.id}/close`, admin, {
      expectedVersion: campaign.version,
      reason: '合成活动关闭',
    }).expect(200);
    expect(await find()).toMatchObject({
      lifecycle: 'CLOSED',
      latestSubmission: { status: 'APPROVED' },
    });
  });
  it('does not disclose another campus, phones, review actor or public identifiers', async () => {
    expect(data<Summary[]>(await list(100, outsider).expect(200))).toEqual([]);
    const row = await find();
    expect(Object.keys(row).sort()).toEqual([
      'campaignType',
      'createdAt',
      'draftId',
      'latestSubmission',
      'lifecycle',
      'status',
      'title',
      'updatedAt',
      'version',
    ]);
    expect(Object.keys(row.latestSubmission!).sort()).toEqual([
      'reviewReason',
      'sequence',
      'sourceDraftVersion',
      'status',
    ]);
    await list(100, admin).expect(403);
  });
  it('keeps the review state within the same RepeatableRead list snapshot', async () => {
    const pendingDraft = await configure(await create());
    const pendingReview = await submit(pendingDraft);
    const extension = client.$extends({
      query: {
        partnerCampaignDraft: {
          count: async ({ args, query }) => {
            const count = await query(args);
            await approve(pendingReview);
            return count;
          },
        },
      },
    });
    const spy = jest
      .spyOn(client, '$transaction')
      .mockImplementationOnce(((
        callback: (tx: unknown) => unknown,
        options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
      ) =>
        extension.$transaction(
          callback as never,
          options,
        )) as typeof client.$transaction);
    try {
      const rows = data<Summary[]>(await list().expect(200));
      expect(
        rows.find((row) => row.draftId === pendingDraft.draftId)
          ?.latestSubmission?.status,
      ).toBe('SUBMITTED');
    } finally {
      spy.mockRestore();
    }
    expect((await find(pendingDraft.draftId)).latestSubmission?.status).toBe(
      'APPROVED',
    );
  });
  it('keeps SQL count and history row retrieval bounded for one and twenty activities with 100 versions each', async () => {
    const history: Prisma.CampaignVersionCreateManyInput[] = [];
    for (let index = 0; index < 20; index++) {
      const first = await submit(await configure(await create()));
      await call(
        'post',
        `/management/campaign-reviews/${first.versionId}/reject`,
        admin,
        {
          expectedVersion: first.version,
          reason: '合成历史基准',
        },
      ).expect(200);
      const {
        id: versionId,
        sequence: firstSequence,
        ...template
      } = await client.campaignVersion.findUniqueOrThrow({
        where: { id: first.versionId },
      });
      expect(versionId).toBe(first.versionId);
      expect(firstSequence).toBe(1);
      for (let sequence = 2; sequence <= 100; sequence++)
        history.push({ ...template, sequence });
    }
    await client.campaignVersion.createMany({ data: history });
    const counts: number[] = [];
    const historyRows: number[][] = [];
    for (const pageSize of [1, 20]) {
      captured = [];
      capturedHistoryRows = [];
      const response = await list(pageSize).expect(200);
      expect(
        data<Summary[]>(response).every(
          (row) => row.latestSubmission?.sequence === 100,
        ),
      ).toBe(true);
      counts.push(captured.length);
      historyRows.push(capturedHistoryRows);
      captured = null;
      capturedHistoryRows = null;
    }
    process.stdout.write(
      `PARTNER_CAMPAIGN_SUMMARY_QUERY_BUDGET ${JSON.stringify({
        runTag,
        sizes: [1, 20],
        versionsPerCampaign: 100,
        statements: counts,
        historyRows,
      })}\n`,
    );
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBe(counts[0]);
    expect(counts[1]).toBeLessThanOrEqual(20);
    expect(historyRows).toEqual([[1], [20]]);
  });
  it('delivers frozen statuses and later draft edits through the real frontend Page and TCP parser', async () => {
    const pendingDraft = await configure(await create());
    await submit(pendingDraft);
    await call(
      'put',
      `${base}/${pendingDraft.draftId}/basic-information`,
      token,
      {
        expectedVersion: pendingDraft.version,
        basicInformation: {
          title: '待审后的私有修改',
          campaignType: 'FREE_REGISTRATION',
          shareDescription: '合成登记内容',
        },
      },
    ).expect(200);
    const rejectedDraft = await configure(await create());
    const rejectedReview = await submit(rejectedDraft);
    await call(
      'post',
      `/management/campaign-reviews/${rejectedReview.versionId}/reject`,
      admin,
      {
        expectedVersion: rejectedReview.version,
        reason: '请补充活动说明',
      },
    ).expect(200);
    const closedDraft = await configure(await create());
    const closedReview = await approve(await submit(closedDraft));
    const closed = await client.campaign.findUniqueOrThrow({
      where: { id: closedReview.campaignId },
    });
    await call('post', `/management/campaigns/${closed.id}/close`, admin, {
      expectedVersion: closed.version,
      reason: '合成活动关闭',
    }).expect(200);

    await app.listen(0, '127.0.0.1');
    pagePort = (server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${pagePort}`;
    const transport = new CampaignPageTransport(origin, new Set([token]));
    const host = globalThis as unknown as Record<string, unknown>;
    const previous = new Map(
      ['wx', 'Page', 'getCurrentPages'].map((key) => [
        key,
        Object.getOwnPropertyDescriptor(host, key),
      ]),
    );
    let page: ListPage | undefined;
    try {
      host.wx = {
        getStorageSync: (key: string) =>
          key === 'education.runtime'
            ? { dataDriver: 'api', apiBaseUrl: origin, accessToken: token }
            : undefined,
        request: transport.request,
        stopPullDownRefresh: jest.fn(),
      };
      host.getCurrentPages = () => (page ? [page] : []);
      page = captureCampaignPage<ListPage>('group-campaigns');
      page.onLoad();
      page.onShow();
      await page.pendingRequest;
      await transport.idle();
      page.onPhaseTap({ currentTarget: { dataset: { phase: 'DRAFT' } } });
      await page.pendingRequest;
      await transport.idle();
      expect(page.data.viewState).toBe('ready');
      const row = (id: string) =>
        page!.data.drafts.find((item) => item.draftId === id);
      expect(row(pendingDraft.draftId)).toMatchObject({
        reviewLabel: '第1版 · 待审核',
        revisionLabel: '草稿有后续修改，尚未送审',
      });
      expect(row(rejectedDraft.draftId)).toMatchObject({
        reviewLabel: '第1版 · 已驳回',
        reviewReason: '请补充活动说明',
      });
      expect(row(closedDraft.draftId)).toMatchObject({
        reviewLabel: '第1版 · 已批准',
        closed: true,
      });
      expect(transport.calls.filter((item) => item.path === base)).toHaveLength(
        1,
      );
      expect(transport.calls.every((item) => item.method === 'GET')).toBe(true);
      await client.user.update({
        where: { id: users[0] },
        data: { status: 'DISABLED' },
      });
      await page.load(true);
      await transport.idle();
      expect(page.data).toMatchObject({ viewState: 'forbidden', drafts: [] });
      process.stdout.write(
        `PARTNER_CAMPAIGN_SUMMARY_PAGE_EVIDENCE ${JSON.stringify({
          runTag,
          port: pagePort,
          states: [
            'SUBMITTED_WITH_EDITS',
            'REJECTED',
            'APPROVED_CLOSED',
            'FORBIDDEN',
          ],
          calls: transport.calls.map(({ method, path, status }) => ({
            method,
            path,
            status,
          })),
        })}\n`,
      );
    } finally {
      try {
        page?.onUnload();
        await transport.drain();
        await page?.pendingRequest;
      } finally {
        for (const [key, descriptor] of previous) {
          if (descriptor) Object.defineProperty(host, key, descriptor);
          else Reflect.deleteProperty(host, key);
        }
      }
    }
  });
  it('has no financial or lesson facts and disables only its exact synthetic readers', async () => {
    for (const model of [
      client.groupCampaign,
      client.enrollmentOrder,
      client.coursePackage,
      client.lessonLedgerEntry,
      client.partnerEarningEntry,
      client.teacherEarningEntry,
      client.financeReceipt,
      client.withdrawal,
    ])
      expect(
        await (model.count as (args: object) => Promise<number>)({
          where: { campusId },
        }),
      ).toBe(0);
    await client.user.update({
      where: { id: users[0] },
      data: { status: 'DISABLED' },
    });
    await list().expect(401);
  });
});
