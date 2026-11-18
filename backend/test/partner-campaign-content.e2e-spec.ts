import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { RoleCode } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);
type Receipt = { draftId: string; version: number };
type Review = { versionId: string; campaignId: string; version: number };
const data = <T>(response: { body: unknown }): T =>
  (response.body as { data: T }).data;
const base = '/partners/me/campaign-drafts';

describe('independent partner campaign content in the dedicated database', () => {
  const runTag = `cbody-${randomUUID().slice(0, 8)}`;
  const ownedUsers: string[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let campusId: string;
  let partner: string;
  let foreign: string;
  let parent: string;
  let admin: string;
  const actor = async (roleCode: RoleCode, scope: string | null) => {
    const row = await prisma.user.create({
      data: {
        displayName: `${runTag}-${ownedUsers.length}`,
        roles: { create: { roleCode, campusId: scope } },
      },
    });
    ownedUsers.push(row.id);
    return (await app.get(AuthService).issueSessionForUser(row.id)).accessToken;
  };
  const create = async (campaignType = 'FLASH_SALE') =>
    data<Receipt>(
      await request(server)
        .post(base)
        .auth(partner, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({
          title: '合成正文活动',
          campaignType,
          shareDescription: '独立分享短文案',
        })
        .expect(200),
    );
  const content = (
    id: string,
    version: number,
    activityContent: unknown,
    token = partner,
  ) =>
    request(server)
      .put(`${base}/${id}/content`)
      .auth(token, { type: 'bearer' })
      .send({ expectedVersion: version, activityContent });
  const get = (id: string) =>
    request(server).get(`${base}/${id}`).auth(partner, { type: 'bearer' });

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    campusId = (
      await prisma.campus.create({
        data: { code: runTag, name: `${runTag}合成校区` },
      })
    ).id;
    const other = (
      await prisma.campus.create({
        data: { code: `${runTag}-other`, name: '合成其他校区' },
      })
    ).id;
    partner = await actor('PARTNER', campusId);
    foreign = await actor('PARTNER', other);
    parent = await actor('PARENT', campusId);
    admin = await actor('SUPER_ADMIN', null);
  });
  afterAll(async () => {
    try {
      if (prisma) {
        assertPartnerPdfTestTarget(process.env);
        const disabled = await prisma.user.updateMany({
          where: {
            id: { in: ownedUsers },
            displayName: { startsWith: `${runTag}-` },
          },
          data: { status: 'DISABLED' },
        });
        process.stdout.write(
          `PARTNER_CAMPAIGN_CONTENT_OWNERSHIP ${JSON.stringify({
            runTag,
            campusId,
            userIds: ownedUsers,
            disabled: disabled.count,
            disposition:
              'retained; exact synthetic users disabled; no deletion',
          })}\n`,
        );
      }
    } finally {
      await app?.close();
    }
  });
  it.each([
    'REGULAR_GROUP',
    'MULTI_SPEC_GROUP',
    'FLASH_SALE',
    'MULTI_SPEC_REGISTRATION_FEE',
    'FREE_REGISTRATION',
  ])(
    'saves independent %s content without changing basic fields',
    async (type) => {
      const draft = await create(type);
      expect(
        data(
          await content(draft.draftId, 1, ' 第一段\n\n<原样文字> ').expect(200),
        ),
      ).toMatchObject({ version: 2 });
      expect(data(await get(draft.draftId).expect(200))).toMatchObject({
        activityContent: '第一段\n\n<原样文字>',
        basicInformation: {
          title: '合成正文活动',
          shareDescription: '独立分享短文案',
          campaignType: type,
        },
      });
      await request(server)
        .put(`${base}/${draft.draftId}/basic-information`)
        .auth(partner, { type: 'bearer' })
        .send({ expectedVersion: 2, basicInformation: { title: '只改基础' } })
        .expect(200);
      expect(data(await get(draft.draftId).expect(200))).toMatchObject({
        activityContent: '第一段\n\n<原样文字>',
        version: 3,
      });
      const list = await request(server)
        .get(base)
        .auth(partner, { type: 'bearer' })
        .expect(200);
      expect(JSON.stringify(list.body)).not.toContain('原样文字');
      const logs = await prisma.auditLog.findMany({
        where: { resourceId: draft.draftId },
      });
      expect(JSON.stringify(logs)).not.toContain('原样文字');
    },
  );
  it('accepts Unicode code-point limit and supports explicit clearing', async () => {
    const draft = await create();
    await content(draft.draftId, 1, '😀'.repeat(10000)).expect(200);
    await content(draft.draftId, 2, '  ').expect(200);
    expect(data(await get(draft.draftId).expect(200))).toMatchObject({
      activityContent: null,
      version: 3,
    });
  });
  it.each([
    '字'.repeat(10001),
    '😀'.repeat(10001),
    '\u0000',
    '\ud800',
    42,
    {},
    undefined,
  ])('rejects invalid content before a write (%#)', async (value) => {
    const draft = await create();
    await content(draft.draftId, 1, value).expect(400);
    expect(data(await get(draft.draftId).expect(200))).toMatchObject({
      activityContent: null,
      version: 1,
    });
  });
  it('serializes identical retries and rejects competing stale content', async () => {
    const draft = await create();
    const same = await Promise.all([
      content(draft.draftId, 1, '相同正文'),
      content(draft.draftId, 1, '相同正文'),
    ]);
    expect(same.map((r) => r.status)).toEqual([200, 200]);
    expect(data(same[0])).toEqual(data(same[1]));
    const different = await Promise.all([
      content(draft.draftId, 2, '甲正文'),
      content(draft.draftId, 2, '乙正文'),
    ]);
    expect(different.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.auditLog.count({ where: { resourceId: draft.draftId } }),
    ).toBe(3);
  });
  it('uses the existing role and campus boundary before exposing versions', async () => {
    const draft = await create();
    await content(draft.draftId, 999, '越界', foreign).expect(404);
    await content(randomUUID(), 1, '未知').expect(404);
    await content(draft.draftId, 1, '无权', parent).expect(403);
    await content(draft.draftId, 1, '无权', admin).expect(403);
    await request(server)
      .put(`${base}/${draft.draftId}/content`)
      .send({ expectedVersion: 1, activityContent: null })
      .expect(401);
    await request(server)
      .put(`${base}/${draft.draftId}/content`)
      .auth(partner, { type: 'bearer' })
      .send({ expectedVersion: 1, activityContent: '正文', campusId })
      .expect(400);
  });
  it('rolls back content and version if its minimal audit fails', async () => {
    const draft = await create();
    const extension = prisma.$extends({
      query: {
        auditLog: {
          create: () => {
            throw new Error('synthetic content audit fault');
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
      await content(draft.draftId, 1, '应完整回滚').expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(data(await get(draft.draftId).expect(200))).toMatchObject({
      activityContent: null,
      version: 1,
    });
    expect(
      await prisma.auditLog.count({ where: { resourceId: draft.draftId } }),
    ).toBe(1);
  });
  it('freezes content for review and parent reading while later draft changes remain private', async () => {
    const draft = await create('FREE_REGISTRATION');
    await content(draft.draftId, 1, '第一版\n冻结正文').expect(200);
    const configured = data<Receipt>(
      await request(server)
        .put(`${base}/${draft.draftId}/free-registration`)
        .auth(partner, { type: 'bearer' })
        .send({
          expectedVersion: 2,
          freeRegistration: {
            startsAt: new Date(Date.now() - 60_000).toISOString(),
            endsAt: new Date(Date.now() + 3_600_000).toISOString(),
            capacityMode: 'UNLIMITED',
            maxRegistrations: null,
          },
        })
        .expect(200),
    );
    const review = data<Review>(
      await request(server)
        .post(`${base}/${draft.draftId}/submit`)
        .auth(partner, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: configured.version })
        .expect(200),
    );
    await content(draft.draftId, configured.version, '尚未送审的新正文').expect(
      200,
    );
    const detail = await request(server)
      .get(`/management/campaign-reviews/${review.versionId}`)
      .auth(admin, { type: 'bearer' })
      .expect(200);
    expect(
      data<{ configuration: { activityContent: string } }>(detail).configuration
        .activityContent,
    ).toBe('第一版\n冻结正文');
    await request(server)
      .post(`/management/campaign-reviews/${review.versionId}/approve`)
      .auth(admin, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: review.version })
      .expect(200);
    const publicDetail = await request(server)
      .get(`/parents/me/free-campaigns/${review.campaignId}`)
      .auth(parent, { type: 'bearer' })
      .expect(200);
    expect(
      data<{ configuration: { activityContent: string } }>(publicDetail)
        .configuration.activityContent,
    ).toBe('第一版\n冻结正文');
    await expect(
      prisma.campaignVersion.update({
        where: { id: review.versionId },
        data: { activityContent: '绕过审核改正文' } as never,
      }),
    ).rejects.toThrow();
  });
});
