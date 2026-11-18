import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { RoleCode } from '@prisma/client';
import sharp from 'sharp';
import request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60000);
const base = '/partners/me/campaign-drafts';
type Receipt = { draftId: string; version: number };
type Image = { id: string; accessUrl: string };
type Images = { images: { cover: Image | null; share: Image | null } };
type Frozen = { configuration: Images };
const data = <T = Receipt>(r: { body: unknown }): T =>
  (r.body as { data: T }).data;
describe('partner campaign images in dedicated PostgreSQL', () => {
  const runTag = `cimg-${randomUUID().slice(0, 8)}`;
  const users: string[] = [];
  let app: INestApplication, prisma: PrismaService, server: Server;
  let partner: string, foreign: string, parent: string, admin: string;
  let cover: Buffer, alternate: Buffer, share: Buffer;
  const actor = async (roleCode: RoleCode, campusId: string | null) => {
    const row = await prisma.user.create({
      data: {
        displayName: `${runTag}-${users.length}`,
        roles: { create: { roleCode, campusId } },
      },
    });
    users.push(row.id);
    return (await app.get(AuthService).issueSessionForUser(row.id)).accessToken;
  };
  const create = async (campaignType = 'FLASH_SALE') =>
    data(
      await request(server)
        .post(base)
        .auth(partner, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({
          campaignType,
          title: '合成图片活动',
          shareDescription: '合成分享说明',
        })
        .expect(200),
    );
  const upload = (
    id: string,
    version: number,
    slot = 'cover',
    bytes = cover,
    key = randomUUID(),
    token = partner,
  ) =>
    request(server)
      .post(`${base}/${id}/images/${slot}`)
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .field('expectedVersion', String(version))
      .attach('file', bytes, {
        filename: 'synthetic.png',
        contentType: 'image/png',
      });
  const images = async (id: string, token = partner) =>
    data<Images>(
      await request(server)
        .get(`${base}/${id}/images`)
        .auth(token, { type: 'bearer' })
        .expect(200),
    );
  const publishedImage = async (id: string, token = partner) =>
    data<{ publishedShareImage: Image | null }>(
      await request(server)
        .get(`${base}/${id}/free-registration`)
        .auth(token, { type: 'bearer' })
        .expect(200),
    );
  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    const campus = await prisma.campus.create({
      data: { code: runTag, name: '合成图片校区' },
    });
    const other = await prisma.campus.create({
      data: { code: `${runTag}-other`, name: '合成其他校区' },
    });
    partner = await actor('PARTNER', campus.id);
    foreign = await actor('PARTNER', other.id);
    parent = await actor('PARENT', campus.id);
    admin = await actor('SUPER_ADMIN', null);
    cover = await sharp({
      create: { width: 750, height: 1125, channels: 3, background: '#27a070' },
    })
      .png()
      .toBuffer();
    alternate = await sharp({
      create: { width: 750, height: 1125, channels: 3, background: '#e26b32' },
    })
      .png()
      .toBuffer();
    share = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#a03467' },
    })
      .png()
      .toBuffer();
  });
  afterAll(async () => {
    try {
      if (prisma) {
        assertPartnerPdfTestTarget(process.env);
        const result = await prisma.user.updateMany({
          where: {
            id: { in: users },
            displayName: { startsWith: `${runTag}-` },
          },
          data: { status: 'DISABLED' },
        });
        process.stdout.write(
          `PARTNER_CAMPAIGN_IMAGES_OWNERSHIP ${JSON.stringify({
            runTag,
            userIds: users,
            disabled: result.count,
            disposition: 'retained; no deletion',
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
    'saves and reopens cover and share for %s without altering basics',
    async (type) => {
      const d = await create(type);
      expect(data(await upload(d.draftId, 1).expect(200))).toMatchObject({
        draftId: d.draftId,
        version: 2,
      });
      await upload(d.draftId, 2, 'share', share).expect(200);
      const view = await images(d.draftId);
      expect(view).toMatchObject({
        draftId: d.draftId,
        version: 3,
        images: {
          cover: { mimeType: 'image/png' },
          share: { mimeType: 'image/png' },
        },
      });
      expect(view.images.cover!.id).not.toBe(view.images.share!.id);
      await request(server)
        .get(view.images.cover!.accessUrl)
        .expect(200)
        .expect('Content-Type', /image\/png/);
      await request(server)
        .get(view.images.cover!.accessUrl.split('?')[0])
        .expect(404);
      await request(server)
        .get(view.images.cover!.accessUrl.replace(/signature=./, 'signature=z'))
        .expect(404);
      const raw = data<{ basicInformation: { title: string } }>(
        await request(server)
          .get(`${base}/${d.draftId}`)
          .auth(partner, { type: 'bearer' })
          .expect(200),
      );
      expect(raw.basicInformation.title).toBe('合成图片活动');
      expect(raw).not.toHaveProperty('images');
    },
  );
  it('replays exact upload without duplicate files/audits and rejects changed payload or stale competitors', async () => {
    const d = await create(),
      key = randomUUID();
    const same = await Promise.all([
      upload(d.draftId, 1, 'cover', cover, key),
      upload(d.draftId, 1, 'cover', cover, key),
    ]);
    expect(same.map((r) => r.status)).toEqual([200, 200]);
    expect(data(same[0])).toEqual(data(same[1]));
    await upload(d.draftId, 1, 'cover', alternate, key).expect(409);
    await upload(d.draftId, 1, 'share', share).expect(409);
    expect(
      await prisma.auditLog.count({ where: { resourceId: d.draftId } }),
    ).toBe(2);
  });
  it('rejects invalid dimensions, undecodable files and oversized bytes without changing the draft', async () => {
    const d = await create();
    await upload(d.draftId, 1, 'cover', share).expect(400);
    await upload(d.draftId, 1, 'share', cover).expect(400);
    await upload(d.draftId, 1, 'cover', Buffer.from('not a png')).expect(400);
    await upload(
      d.draftId,
      1,
      'cover',
      Buffer.alloc(3 * 1024 * 1024 + 1),
    ).expect(413);
    expect(await images(d.draftId)).toMatchObject({
      version: 1,
      images: { cover: null, share: null },
    });
  });
  it('guards role and campus without disclosing versions or accepting client file links', async () => {
    const d = await create();
    await upload(d.draftId, 999, 'cover', cover, randomUUID(), foreign).expect(
      404,
    );
    await upload(d.draftId, 1, 'cover', cover, randomUUID(), parent).expect(
      403,
    );
    await upload(d.draftId, 1, 'cover', cover, randomUUID(), admin).expect(403);
    await request(server).get(`${base}/${d.draftId}/images`).expect(401);
    await request(server)
      .get(`${base}/${d.draftId}/images`)
      .auth(foreign, { type: 'bearer' })
      .expect(404);
    for (const token of [parent, admin]) {
      await request(server)
        .get(`${base}/${d.draftId}/images`)
        .auth(token, { type: 'bearer' })
        .expect(403);
      await request(server)
        .put(`${base}/${d.draftId}/images/cover`)
        .auth(token, { type: 'bearer' })
        .send({ expectedVersion: 1 })
        .expect(403);
    }
    await request(server)
      .put(`${base}/${d.draftId}/images/cover`)
      .auth(foreign, { type: 'bearer' })
      .send({ expectedVersion: 1 })
      .expect(404);
    await request(server)
      .put(`${base}/${d.draftId}/images/cover`)
      .auth(partner, { type: 'bearer' })
      .send({ expectedVersion: 1, storedFileId: randomUUID() })
      .expect(400);
  });
  it('rejects expired signatures and signatures moved to another file or purpose', async () => {
    const d = await create();
    await upload(d.draftId, 1).expect(200);
    await upload(d.draftId, 2, 'share', share).expect(200);
    const view = await images(d.draftId);
    const original = view.images.cover!,
      other = view.images.share!;
    await request(server)
      .get(original.accessUrl.replace(original.id, other.id))
      .expect(404);
    await request(server)
      .get(
        original.accessUrl.replace('partner-campaign-images', 'student-photos'),
      )
      .expect(404);
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 16 * 60 * 1000);
    try {
      await request(server).get(original.accessUrl).expect(404);
    } finally {
      clock.mockRestore();
    }
  });
  it('clears only a reference and preserves immutable files while a retry is harmless', async () => {
    const d = await create();
    await upload(d.draftId, 1).expect(200);
    const image = (await images(d.draftId)).images.cover!;
    for (let i = 0; i < 2; i++)
      await request(server)
        .put(`${base}/${d.draftId}/images/cover`)
        .auth(partner, { type: 'bearer' })
        .send({ expectedVersion: 2 })
        .expect(200);
    expect(await images(d.draftId)).toMatchObject({
      version: 3,
      images: { cover: null },
    });
    expect(
      await prisma.storedFile.findUnique({ where: { id: image.id } }),
    ).not.toBeNull();
  });
  it('rolls back database file/link/version/audit if the minimal audit fails', async () => {
    const d = await create();
    const before = await prisma.storedFile.count();
    const extension = prisma.$extends({
      query: {
        auditLog: {
          create: () => {
            throw new Error('synthetic image audit fault');
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
      await upload(d.draftId, 1).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await images(d.draftId)).toMatchObject({
      version: 1,
      images: { cover: null },
    });
    expect(await prisma.storedFile.count()).toBe(before);
  });
  it('freezes image references for review and parents while later replacements remain private', async () => {
    const d = await create('FREE_REGISTRATION');
    await upload(d.draftId, 1).expect(200);
    const first = (await images(d.draftId)).images.cover!.id;
    await upload(d.draftId, 2, 'share', share).expect(200);
    const originalShare = (await images(d.draftId)).images.share!.id;
    expect((await publishedImage(d.draftId)).publishedShareImage).toBeNull();
    await request(server)
      .put(`${base}/${d.draftId}/free-registration`)
      .auth(partner, { type: 'bearer' })
      .send({
        expectedVersion: 3,
        freeRegistration: {
          startsAt: new Date(Date.now() - 60000).toISOString(),
          endsAt: new Date(Date.now() + 3600000).toISOString(),
          capacityMode: 'UNLIMITED',
          maxRegistrations: null,
        },
      })
      .expect(200);
    const review = data<{
      versionId: string;
      campaignId: string;
      version: number;
    }>(
      await request(server)
        .post(`${base}/${d.draftId}/submit`)
        .auth(partner, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: 4 })
        .expect(200),
    );
    await upload(d.draftId, 4, 'cover', alternate).expect(200);
    await request(server)
      .put(`${base}/${d.draftId}/images/share`)
      .auth(partner, { type: 'bearer' })
      .send({ expectedVersion: 5 })
      .expect(200);
    const row = data<Frozen>(
      await request(server)
        .get(`/management/campaign-reviews/${review.versionId}`)
        .auth(admin, { type: 'bearer' })
        .expect(200),
    );
    expect(row.configuration.images.cover!.id).toBe(first);
    expect(row.configuration.images.share!.id).toBe(originalShare);
    await request(server)
      .post(`/management/campaign-reviews/${review.versionId}/approve`)
      .auth(admin, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: review.version })
      .expect(200);
    const published = data<Frozen>(
      await request(server)
        .get(`/parents/me/free-campaigns/${review.campaignId}`)
        .auth(parent, { type: 'bearer' })
        .expect(200),
    );
    expect(published.configuration.images.cover!.id).toBe(first);
    expect(published.configuration.images.share!.id).toBe(originalShare);
    const partnerPublication = await publishedImage(d.draftId);
    expect(partnerPublication.publishedShareImage?.id).toBe(originalShare);
    await request(server)
      .get(partnerPublication.publishedShareImage!.accessUrl)
      .expect(200)
      .expect('Content-Type', /image\/png/);
    for (const [token, status] of [
      [foreign, 404],
      [parent, 403],
      [admin, 403],
    ] as const)
      await request(server)
        .get(`${base}/${d.draftId}/free-registration`)
        .auth(token, { type: 'bearer' })
        .expect(status);
    await expect(
      prisma.campaignVersion.update({
        where: { id: review.versionId },
        data: { coverImageId: null } as never,
      }),
    ).rejects.toThrow();
  });
});
