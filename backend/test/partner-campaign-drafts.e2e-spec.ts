import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);

type Receipt = {
  draftId: string;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
type Draft = Receipt & { basicInformation: Record<string, unknown> };
const data = <T>(response: { body: unknown }): T =>
  (response.body as { data: T }).data;
const base = '/partners/me/campaign-drafts';
const types = [
  'REGULAR_GROUP',
  'MULTI_SPEC_GROUP',
  'FLASH_SALE',
  'MULTI_SPEC_REGISTRATION_FEE',
  'FREE_REGISTRATION',
];

describe('private campus activity basic drafts in the dedicated database', () => {
  const runTag = `cdraft-${randomUUID().slice(0, 8)}`;
  const ownedUsers: string[] = [];
  const drafts: string[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let campusId: string;
  let token: string;
  let otherToken: string;
  let colleagueToken: string;
  let userId: string;
  let otherCampusId: string;
  const makeUser = async (
    roles: Array<{
      roleCode: 'PARTNER' | 'PARENT' | 'SUPER_ADMIN';
      campusId?: string;
    }>,
  ) => {
    const user = await prisma.user.create({
      data: {
        displayName: `${runTag}-${ownedUsers.length}`,
        roles: { create: roles },
      },
    });
    ownedUsers.push(user.id);
    return {
      id: user.id,
      token: (await app.get(AuthService).issueSessionForUser(user.id))
        .accessToken,
    };
  };
  const create = (
    value: Record<string, unknown> = {},
    key: string = randomUUID(),
    auth = token,
  ) =>
    request(server)
      .post(base)
      .auth(auth, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(value);
  const read = (id: string, auth = token) =>
    request(server).get(`${base}/${id}`).auth(auth, { type: 'bearer' });
  const save = (
    id: string,
    version: number,
    value: Record<string, unknown>,
    auth = token,
  ) =>
    request(server)
      .put(`${base}/${id}/basic-information`)
      .auth(auth, { type: 'bearer' })
      .send({ expectedVersion: version, basicInformation: value });
  const newDraft = async (value: Record<string, unknown> = {}) => {
    const receipt = data<Receipt>(await create(value).expect(200));
    drafts.push(receipt.draftId);
    return receipt;
  };
  const audits = (id: string) =>
    prisma.auditLog.findMany({ where: { resourceId: id } });

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    campusId = (
      await prisma.campus.create({
        data: { code: runTag, name: `${runTag}合成校区` },
      })
    ).id;
    const otherCampus = await prisma.campus.create({
      data: { code: `${runTag}-other`, name: `${runTag}其他校区` },
    });
    otherCampusId = otherCampus.id;
    const owner = await makeUser([{ roleCode: 'PARTNER', campusId }]);
    userId = owner.id;
    token = owner.token;
    colleagueToken = (await makeUser([{ roleCode: 'PARTNER', campusId }]))
      .token;
    otherToken = (
      await makeUser([{ roleCode: 'PARTNER', campusId: otherCampus.id }])
    ).token;
  });
  afterAll(async () => {
    try {
      if (prisma) {
        assertPartnerPdfTestTarget(process.env);
        const stored = campusId
          ? await prisma.partnerCampaignDraft.findMany({
              where: { campusId, createdByUserId: { in: ownedUsers } },
              select: { id: true },
            })
          : [];
        await prisma.user.updateMany({
          where: {
            id: { in: ownedUsers },
            displayName: { startsWith: runTag },
          },
          data: { status: 'DISABLED' },
        });
        process.stdout.write(
          `PARTNER_CAMPAIGN_DRAFT_FIXTURE_OWNERSHIP ${JSON.stringify({
            runTag,
            campusId,
            userIds: ownedUsers,
            draftIds: stored.map((row) => row.id),
            disposition:
              'retained; owned synthetic users disabled; no deletion',
          })}\n`,
        );
      }
    } finally {
      await app?.close();
    }
  });

  it('reads an empty campus without creating records', async () => {
    const response = await request(server)
      .get(base)
      .auth(token, { type: 'bearer' })
      .expect(200);
    const page = response.body as { data: unknown[]; meta: { total: number } };
    expect(page.data).toEqual([]);
    expect(page.meta.total).toBe(0);
  });
  it('persists partial basics and keeps contact/description out of receipts and audits', async () => {
    const receipt = await newDraft({
      title: ' 合成草稿 ',
      contactPhone: '0000-00000000',
      shareDescription: '私有文案',
    });
    expect(receipt).toMatchObject({ status: 'DRAFT', version: 1 });
    expect(Object.keys(receipt).sort()).toEqual([
      'createdAt',
      'draftId',
      'status',
      'updatedAt',
      'version',
    ]);
    expect(
      data<Draft>(await read(receipt.draftId).expect(200)).basicInformation,
    ).toEqual({
      title: '合成草稿',
      contactPhone: '0000-00000000',
      shareDescription: '私有文案',
      campaignType: null,
    });
    expect(JSON.stringify(await audits(receipt.draftId))).not.toMatch(
      /0000-00000000|私有文案|合成草稿/,
    );
  });
  it.each(types)(
    'stores %s as metadata without creating a published campaign',
    async (campaignType) => {
      const receipt = await newDraft({ campaignType });
      expect(
        data<Draft>(await read(receipt.draftId).expect(200)).basicInformation
          .campaignType,
      ).toBe(campaignType);
      expect(
        await prisma.groupCampaign.findUnique({
          where: { id: receipt.draftId },
        }),
      ).toBeNull();
      await request(server)
        .get(`/partners/me/group-campaigns/${receipt.draftId}`)
        .auth(token, { type: 'bearer' })
        .expect(404);
      await request(server)
        .post(`${base}/${receipt.draftId}/publish`)
        .auth(token, { type: 'bearer' })
        .expect(404);
    },
  );
  it('accepts Unicode code-point limits and trims before counting', async () => {
    const receipt = await newDraft({
      title: ` ${'😀'.repeat(40)} `,
      shareDescription: '字'.repeat(1000),
      contactPhone: '0'.repeat(30),
    });
    expect(
      data<Draft>(await read(receipt.draftId).expect(200)).basicInformation
        .title,
    ).toBe('😀'.repeat(40));
  });
  it.each([
    { title: '😀'.repeat(41) },
    { title: 'a'.repeat(41) },
    { title: 'e\u0301'.repeat(21) },
    { shareDescription: '字'.repeat(1001) },
    { contactPhone: '0'.repeat(31) },
    { campaignType: 'UNKNOWN' },
    { title: 1 },
    { campusId: randomUUID() },
    { createdByUserId: randomUUID() },
    { status: 'ACTIVE' },
    { priceFen: 100 },
    { benefitRules: {} },
  ])(
    'rejects invalid fields or client-controlled server data (%#)',
    async (value) => {
      await create(value).expect(400);
    },
  );
  it('requires a valid creation key and a versioned nested update', async () => {
    await request(server)
      .post(base)
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(400);
    await create({}, 'short').expect(400);
    const draft = await newDraft();
    for (const value of [
      {},
      { expectedVersion: 0, basicInformation: {} },
      { expectedVersion: 1, basicInformation: null },
      { expectedVersion: 1, basicInformation: {}, campusId },
      { expectedVersion: 1, basicInformation: { unexpected: true } },
    ])
      await request(server)
        .put(`${base}/${draft.draftId}/basic-information`)
        .auth(token, { type: 'bearer' })
        .send(value)
        .expect(400);
  });
  it('replays normalized concurrent creation once and rejects key reuse across payloads/actors', async () => {
    const key = randomUUID();
    const responses = await Promise.all([
      create({ title: ' 同一草稿 ' }, key),
      create({ title: '同一草稿' }, key),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const receipt = data<Receipt>(responses[0]);
    drafts.push(receipt.draftId);
    expect(data<Receipt>(responses[1])).toEqual(receipt);
    expect(await audits(receipt.draftId)).toHaveLength(1);
    await create({ title: '不同' }, key).expect(409);
    await create({ title: '同一草稿' }, key, colleagueToken).expect(409);
    await create({ title: '同一草稿' }, key, otherToken).expect(409);
    const stored = await prisma.idempotencyRecord.findUniqueOrThrow({
      where: { key_route: { key, route: base } },
    });
    expect(stored.responseBody).toEqual(receipt);
  });
  it('different creation keys create distinct drafts', async () => {
    const responses = await Promise.all([create({}), create({})]);
    expect(responses.every((r) => r.status === 200)).toBe(true);
    const ids = responses.map((r) => data<Receipt>(r).draftId);
    drafts.push(...ids);
    expect(new Set(ids).size).toBe(2);
  });
  it('replaces fields, clears omissions and accepts only current/immediately previous identical retries', async () => {
    const draft = await newDraft({ title: '初稿', contactPhone: '0000' });
    const response = data<Receipt>(
      await save(draft.draftId, 1, { title: ' 修改 ' }).expect(200),
    );
    expect(response.version).toBe(2);
    expect(
      data<Receipt>(
        await save(draft.draftId, 1, { title: '修改' }).expect(200),
      ),
    ).toEqual(response);
    expect(
      data<Receipt>(
        await save(draft.draftId, 2, { title: '修改' }).expect(200),
      ),
    ).toEqual(response);
    expect(await audits(draft.draftId)).toHaveLength(2);
    const cleared = data<Receipt>(
      await save(draft.draftId, 2, { title: ' ', contactPhone: null }).expect(
        200,
      ),
    );
    expect(cleared.version).toBe(3);
    await save(draft.draftId, 1, {}).expect(409);
    expect(
      data<Draft>(await read(draft.draftId).expect(200)).basicInformation,
    ).toEqual({
      title: null,
      campaignType: null,
      contactPhone: null,
      shareDescription: null,
    });
  });
  it('serializes same/different concurrent writes by target version', async () => {
    const draft = await newDraft();
    const same = await Promise.all([
      save(draft.draftId, 1, { title: '相同' }),
      save(draft.draftId, 1, { title: '相同' }, colleagueToken),
    ]);
    expect(same.map((r) => r.status)).toEqual([200, 200]);
    expect(data<Receipt>(same[0])).toEqual(data<Receipt>(same[1]));
    const different = await Promise.all([
      save(draft.draftId, 2, { title: '甲' }),
      save(draft.draftId, 2, { title: '乙' }, colleagueToken),
    ]);
    expect(different.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await audits(draft.draftId)).toHaveLength(3);
  });
  it('uses campus scope, hides foreign/unknown IDs and rejects missing/wrong/multiple roles', async () => {
    const draft = await newDraft();
    await read(draft.draftId, colleagueToken).expect(200);
    await save(
      draft.draftId,
      1,
      { title: '同校区编辑' },
      colleagueToken,
    ).expect(200);
    await read(draft.draftId, otherToken).expect(404);
    await save(draft.draftId, 999, {}, otherToken).expect(404);
    await read(randomUUID()).expect(404);
    await request(server).get(base).expect(401);
    for (const roles of [
      [{ roleCode: 'PARENT' as const, campusId }],
      [{ roleCode: 'SUPER_ADMIN' as const }],
      [{ roleCode: 'PARTNER' as const }],
      [
        { roleCode: 'PARTNER' as const, campusId },
        { roleCode: 'PARENT' as const, campusId },
      ],
    ]) {
      const actor = await makeUser(roles);
      await request(server)
        .get(base)
        .auth(actor.token, { type: 'bearer' })
        .expect(403);
      await create({}, randomUUID(), actor.token).expect(403);
      await read(draft.draftId, actor.token).expect(403);
      await save(draft.draftId, 2, {}, actor.token).expect(403);
    }
  });
  it('returns minimal, stable paginated summaries and rejects malicious query filters', async () => {
    const http = await request(server)
      .get(`${base}?page=1&pageSize=2`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    const response = http.body as {
      data: Array<Receipt & { title: string | null }>;
      meta: { total: number; pageSize: number };
    };
    expect(response.data).toHaveLength(2);
    expect(response.meta.pageSize).toBe(2);
    expect(response.meta.total).toBe(drafts.length);
    expect(response.data.map((d) => `${d.updatedAt}:${d.draftId}`)).toEqual(
      response.data
        .map((d) => `${d.updatedAt}:${d.draftId}`)
        .sort()
        .reverse(),
    );
    expect(JSON.stringify(response.data)).not.toMatch(
      /contactPhone|shareDescription|campusId|createdBy/,
    );
    for (const query of ['campusId=x', 'page=0', 'pageSize=101', 'owner=x']) {
      await request(server)
        .get(`${base}?${query}`)
        .auth(token, { type: 'bearer' })
        .expect(400);
    }
  });
  it('filters private draft categories before counting and pagination without crossing campus scope', async () => {
    const before = await prisma.partnerCampaignDraft.count({
      where: { campusId, campaignType: 'FLASH_SALE' },
    });
    const added: string[] = [];
    for (let index = 0; index < 3; index++) {
      added.push((await newDraft({ campaignType: 'FLASH_SALE' })).draftId);
    }
    await newDraft({ campaignType: 'FREE_REGISTRATION' });
    const unclassified = await newDraft();
    const foreign = data<Receipt>(
      await create(
        { campaignType: 'FLASH_SALE' },
        randomUUID(),
        otherToken,
      ).expect(200),
    );
    const pages: Receipt[] = [];
    for (const page of [1, 2]) {
      const response = await request(server)
        .get(`${base}?campaignType=FLASH_SALE&page=${page}&pageSize=2`)
        .auth(colleagueToken, { type: 'bearer' })
        .expect(200);
      const body = response.body as {
        data: Array<Receipt & { campaignType: string }>;
        meta: {
          page: number;
          pageSize: number;
          total: number;
          totalPages: number;
        };
      };
      expect(body.meta).toEqual({
        page,
        pageSize: 2,
        total: before + 3,
        totalPages: Math.ceil((before + 3) / 2),
      });
      expect(body.data.every((row) => row.campaignType === 'FLASH_SALE')).toBe(
        true,
      );
      pages.push(...body.data);
    }
    expect(new Set(pages.map((row) => row.draftId)).size).toBe(pages.length);
    expect(pages.map((row) => row.draftId)).toEqual(
      expect.arrayContaining(added),
    );
    expect(pages.map((row) => row.draftId)).not.toContain(foreign.draftId);
    const all = await request(server)
      .get(`${base}?pageSize=100`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(data<Receipt[]>(all).map((row) => row.draftId)).toContain(
      unclassified.draftId,
    );
    for (const campaignType of types) {
      const response = await request(server)
        .get(`${base}?campaignType=${campaignType}`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(
        data<Array<{ campaignType: string }>>(response).every(
          (row) => row.campaignType === campaignType,
        ),
      ).toBe(true);
    }
  });
  it.each([
    '',
    'UNKNOWN',
    'flash_sale',
    'null',
    'FLASH_SALE&campaignType=FREE_REGISTRATION',
  ])('rejects an invalid draft category query (%s)', async (value) => {
    await request(server)
      .get(`${base}?campaignType=${value}`)
      .auth(token, { type: 'bearer' })
      .expect(400);
  });
  it('fully rolls back a failed create audit including its idempotency claim', async () => {
    const key = randomUUID();
    const before = await prisma.partnerCampaignDraft.count({
      where: { campusId },
    });
    const extension = prisma.$extends({
      query: {
        auditLog: {
          create: () => {
            throw new Error('synthetic audit fault');
          },
        },
      },
    });
    const spy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce(((callback: (tx: unknown) => unknown) =>
        extension.$transaction(
          callback as never,
        )) as typeof prisma.$transaction);
    try {
      await create({}, key).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(
      await prisma.partnerCampaignDraft.count({ where: { campusId } }),
    ).toBe(before);
    expect(
      await prisma.idempotencyRecord.findUnique({
        where: { key_route: { key, route: base } },
      }),
    ).toBeNull();
    const receipt = data<Receipt>(await create({}, key).expect(200));
    drafts.push(receipt.draftId);
    expect(await audits(receipt.draftId)).toHaveLength(1);
  });
  it('rechecks the live active actor inside writes', async () => {
    const actor = await makeUser([{ roleCode: 'PARTNER', campusId }]);
    await prisma.user.update({
      where: { id: actor.id },
      data: { status: 'DISABLED' },
    });
    await create({}, randomUUID(), actor.token).expect(401);
    expect(
      await prisma.user.findUnique({ where: { id: userId } }),
    ).not.toBeNull();
  });
  it('keeps the creator attribution after another same-campus actor edits', async () => {
    const receipt = await newDraft();
    await save(
      receipt.draftId,
      1,
      { title: '同校区修改' },
      colleagueToken,
    ).expect(200);
    const [row] = await prisma.$queryRaw<Array<{ createdByUserId: string }>>`
      SELECT "createdByUserId" FROM "PartnerCampaignDraft" WHERE "id" = ${receipt.draftId}::uuid`;
    expect(row.createdByUserId).toBe(userId);
  });
  it('does not change fields, timestamp, version or audit after a failed update audit', async () => {
    const receipt = await newDraft({ title: '回滚前', contactPhone: '0000' });
    const before = data<Draft>(await read(receipt.draftId).expect(200));
    const extension = prisma.$extends({
      query: {
        auditLog: {
          create: () => {
            throw new Error('synthetic update audit fault');
          },
        },
      },
    });
    const spy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce(((callback: (tx: unknown) => unknown) =>
        extension.$transaction(
          callback as never,
        )) as typeof prisma.$transaction);
    try {
      await save(receipt.draftId, 1, { title: '不得残留' }).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(data<Draft>(await read(receipt.draftId).expect(200))).toEqual(
      before,
    );
    expect(await audits(receipt.draftId)).toHaveLength(1);
  });
  it('rolls back draft and audit when completing the creation receipt fails', async () => {
    const key = randomUUID();
    const before = await prisma.auditLog.count({
      where: { campusId, resourceType: 'PartnerCampaignDraft' },
    });
    const extension = prisma.$extends({
      query: {
        idempotencyRecord: {
          update: () => {
            throw new Error('synthetic receipt fault');
          },
        },
      },
    });
    const spy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce(((callback: (tx: unknown) => unknown) =>
        extension.$transaction(
          callback as never,
        )) as typeof prisma.$transaction);
    try {
      await create({ title: '不得残留' }, key).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(
      await prisma.auditLog.count({
        where: { campusId, resourceType: 'PartnerCampaignDraft' },
      }),
    ).toBe(before);
    expect(
      await prisma.idempotencyRecord.findUnique({
        where: { key_route: { key, route: base } },
      }),
    ).toBeNull();
    expect(
      await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "PartnerCampaignDraft" WHERE "campusId" = ${campusId}::uuid AND "title" = '不得残留'`,
    ).toEqual([]);
  });
  it('allows an identical retry at maximum version but rejects changed values without overflow', async () => {
    const receipt = await newDraft({ title: '最大版本' });
    await prisma.$executeRaw`UPDATE "PartnerCampaignDraft" SET "version" = 2147483647 WHERE "id" = ${receipt.draftId}::uuid AND "campusId" = ${campusId}::uuid`;
    const same = data<Receipt>(
      await save(receipt.draftId, 2147483647, { title: '最大版本' }).expect(
        200,
      ),
    );
    expect(same.version).toBe(2147483647);
    await save(receipt.draftId, 2147483647, { title: '改变' }).expect(409);
    expect(await audits(receipt.draftId)).toHaveLength(1);
  });
  it.each(['disabled', 'other-campus', 'wrong-role', 'extra-role'])(
    'rejects a create after the guard accepts an actor whose permissions become %s',
    async (state) => {
      const actor = await makeUser([{ roleCode: 'PARTNER', campusId }]);
      const key = randomUUID();
      let entered!: () => void;
      let release!: () => void;
      const accepted = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = prisma.$transaction.bind(prisma);
      const spy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce((async (callback: (tx: unknown) => unknown) => {
          entered();
          await gate;
          return original(callback as never);
        }) as typeof prisma.$transaction);
      const pending = create({ title: '不应保存' }, key, actor.token).then(
        (response) => response,
      );
      try {
        await accepted;
        if (state === 'disabled')
          await prisma.user.update({
            where: { id: actor.id },
            data: { status: 'DISABLED' },
          });
        else if (state === 'extra-role')
          await prisma.userRole.create({
            data: { userId: actor.id, roleCode: 'PARENT', campusId },
          });
        else
          await prisma.userRole.updateMany({
            where: { userId: actor.id },
            data:
              state === 'wrong-role'
                ? { roleCode: 'PARENT' }
                : { campusId: otherCampusId },
          });
        release();
        expect((await pending).status).toBe(state === 'disabled' ? 401 : 403);
        expect(
          await prisma.idempotencyRecord.findUnique({
            where: { key_route: { key, route: base } },
          }),
        ).toBeNull();
      } finally {
        release();
        await pending;
        spy.mockRestore();
      }
    },
  );
  it('revalidates a replay and same-value update after a current actor loses its role', async () => {
    const actor = await makeUser([{ roleCode: 'PARTNER', campusId }]);
    const key = randomUUID();
    const receipt = data<Receipt>(
      await create({ title: '合成' }, key, actor.token).expect(200),
    );
    drafts.push(receipt.draftId);
    await prisma.userRole.updateMany({
      where: { userId: actor.id },
      data: { roleCode: 'PARENT' },
    });
    await create({ title: '合成' }, key, actor.token).expect(403);
    await save(receipt.draftId, 1, { title: '合成' }, actor.token).expect(403);
    expect(await audits(receipt.draftId)).toHaveLength(1);
  });
  it('holds count and rows in one snapshot while another same-campus actor creates', async () => {
    const before = await prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT count(*) AS total FROM "PartnerCampaignDraft" WHERE "campusId" = ${campusId}::uuid`;
    const extension = prisma.$extends({
      query: {
        partnerCampaignDraft: {
          count: async ({ args, query }) => {
            const count = await query(args);
            const receipt = data<Receipt>(
              await create({}, randomUUID(), colleagueToken).expect(200),
            );
            drafts.push(receipt.draftId);
            return count;
          },
        },
      },
    });
    const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce(((
      callback: (tx: unknown) => unknown,
      options?: {
        isolationLevel?: Prisma.TransactionIsolationLevel;
        maxWait?: number;
        timeout?: number;
      },
    ) =>
      extension.$transaction(
        callback as never,
        options,
      )) as typeof prisma.$transaction);
    try {
      const response = await request(server)
        .get(`${base}?pageSize=100`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      const result = response.body as {
        data: unknown[];
        meta: { total: number };
      };
      expect(result.meta.total).toBe(Number(before[0].total));
      expect(result.data).toHaveLength(Number(before[0].total));
    } finally {
      spy.mockRestore();
    }
  });
  it('does not return a historical list snapshot after its reader changes campus', async () => {
    const actor = await makeUser([{ roleCode: 'PARTNER', campusId }]);
    const extension = prisma.$extends({
      query: {
        partnerCampaignDraft: {
          count: async ({ args, query }) => {
            const count = await query(args);
            await prisma.userRole.updateMany({
              where: { userId: actor.id },
              data: { campusId: otherCampusId },
            });
            return count;
          },
        },
      },
    });
    const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce(((
      callback: (tx: unknown) => unknown,
      options?: {
        isolationLevel?: Prisma.TransactionIsolationLevel;
        maxWait?: number;
        timeout?: number;
      },
    ) =>
      extension.$transaction(
        callback as never,
        options,
      )) as typeof prisma.$transaction);
    try {
      const response = await request(server)
        .get(base)
        .auth(actor.token, { type: 'bearer' })
        .expect(403);
      expect(response.body).not.toHaveProperty('data');
    } finally {
      spy.mockRestore();
    }
  });
  it.each(['\u0000', '\ud800', '\udfff'])(
    'rejects non-storable text without a database write (%#)',
    async (value) => {
      for (const field of ['title', 'shareDescription', 'contactPhone']) {
        const key = randomUUID();
        await create({ [field]: value }, key).expect(400);
        expect(
          await prisma.idempotencyRecord.findUnique({
            where: { key_route: { key, route: base } },
          }),
        ).toBeNull();
      }
    },
  );
  it.each(['user', 'role'])(
    'blocks concurrent %s revocation until a saving transaction finishes',
    async (target) => {
      const actor = await makeUser([{ roleCode: 'PARTNER', campusId }]);
      const receipt = data<Receipt>(
        await create({}, randomUUID(), actor.token).expect(200),
      );
      drafts.push(receipt.draftId);
      let entered!: () => void;
      let release!: () => void;
      const savedInside = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const extension = prisma.$extends({
        query: {
          partnerCampaignDraft: {
            update: async ({ args, query }) => {
              const result = await query(args);
              entered();
              await gate;
              return result;
            },
          },
        },
      });
      const original = prisma.$transaction.bind(prisma);
      const spy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce(((callback: (tx: unknown) => unknown) =>
          extension.$transaction(
            callback as never,
          )) as typeof prisma.$transaction);
      const pendingSave = save(
        receipt.draftId,
        1,
        { title: '事务内保存' },
        actor.token,
      ).then((response) => response);
      let pendingRevocation: Promise<unknown> | undefined;
      try {
        await savedInside;
        let notifyPid!: (pid: number) => void;
        const pidKnown = new Promise<number>((resolve) => {
          notifyPid = resolve;
        });
        pendingRevocation = original(async (tx) => {
          const [row] = await tx.$queryRaw<
            Array<{ pid: number }>
          >`SELECT pg_backend_pid() AS pid`;
          notifyPid(row.pid);
          if (target === 'user')
            await tx.user.update({
              where: { id: actor.id },
              data: { status: 'DISABLED' },
            });
          else
            await tx.userRole.updateMany({
              where: { userId: actor.id },
              data: { roleCode: 'PARENT' },
            });
        });
        const pid = await pidKnown;
        let waiting = false;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const rows = await prisma.$queryRaw<
            Array<{ wait_event_type: string | null }>
          >`
          SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`;
          if (rows[0]?.wait_event_type === 'Lock') {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(waiting).toBe(true);
        process.stdout.write(
          `PARTNER_CAMPAIGN_DRAFT_LOCK_EVIDENCE ${JSON.stringify({ runTag, target, draftId: receipt.draftId, waitingPid: pid, waitEvent: 'Lock' })}\n`,
        );
        release();
        expect((await pendingSave).status).toBe(200);
        await pendingRevocation;
        await save(
          receipt.draftId,
          2,
          { title: '事务内保存' },
          actor.token,
        ).expect(target === 'user' ? 401 : 403);
        expect(await audits(receipt.draftId)).toHaveLength(2);
      } finally {
        release();
        await pendingSave;
        await pendingRevocation;
        spy.mockRestore();
      }
    },
  );
  it.each(['replay', 'same-value'])(
    'rechecks a %s request after its guard accepts an actor who loses the role',
    async (kind) => {
      const actor = await makeUser([{ roleCode: 'PARTNER', campusId }]);
      const key = randomUUID();
      const receipt = data<Receipt>(
        await create({ title: '合成重试' }, key, actor.token).expect(200),
      );
      drafts.push(receipt.draftId);
      let entered!: () => void;
      let release!: () => void;
      const accepted = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = prisma.$transaction.bind(prisma);
      const spy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce((async (callback: (tx: unknown) => unknown) => {
          entered();
          await gate;
          return original(callback as never);
        }) as typeof prisma.$transaction);
      const pending = (
        kind === 'replay'
          ? create({ title: '合成重试' }, key, actor.token)
          : save(receipt.draftId, 1, { title: '合成重试' }, actor.token)
      ).then((response) => response);
      try {
        await accepted;
        await prisma.userRole.updateMany({
          where: { userId: actor.id },
          data: { roleCode: 'PARENT' },
        });
        release();
        expect((await pending).status).toBe(403);
        expect(await audits(receipt.draftId)).toHaveLength(1);
        const replay = await prisma.idempotencyRecord.findUniqueOrThrow({
          where: { key_route: { key, route: base } },
        });
        expect(replay.responseBody).toEqual(receipt);
      } finally {
        release();
        await pending;
        spy.mockRestore();
      }
    },
  );
});
