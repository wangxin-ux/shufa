import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import sharp from 'sharp';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import { PartnerPrivateImageStore } from '../src/modules/file/partner-private-image-store';
import { PartnerPrivateLocalAdapter } from '../src/modules/file/partner-private-local.adapter';
import { AuthService } from '../src/modules/auth/auth.service';
import { ConfigService } from '@nestjs/config';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);
const route = '/partner-applicants/me/application';
const data = <T>(response: { body: unknown }) =>
  (response.body as { data: T }).data;
interface Actor {
  token: string;
  userId: string;
}
interface Intent {
  uploadId: string;
  storedFileId: string;
  kind: string;
  state: string;
  expectedVersion: number;
  requestKey: string;
}
interface Material {
  storedFileId: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
}
interface View {
  applicationId: string;
  version: number;
  readonly: boolean;
  materials: Material[];
  uploads: Intent[];
}

describe('own private image draft in the dedicated local database', () => {
  const runTag = `pimage-${randomUUID().slice(0, 8)}`;
  const key = randomBytes(32);
  const ring = {
    current: jest.fn(() => ({ id: runTag, key })),
    get: jest.fn((id: string) => (id === runTag ? key : undefined)),
  };
  const users: string[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let sequence = 0;
  let png: Buffer;
  let jpeg: Buffer;
  const login = async (): Promise<Actor> => {
    const response = await request(server)
      .post('/partner-applicants/auth/wechat')
      .send({ code: `mock-wechat-login:${runTag}-${++sequence}` })
      .expect(200);
    const session = data<{ token: string; me: { applicantId: string } }>(
      response,
    );
    const applicant = await prisma.partnerApplicant.findUniqueOrThrow({
      where: { id: session.me.applicantId },
    });
    users.push(applicant.userId);
    await request(server)
      .put(`${route}/basic-information`)
      .auth(session.token, { type: 'bearer' })
      .send({
        expectedVersion: 0,
        basicInformation: { institutionName: `${runTag}合成机构` },
      })
      .expect(200);
    return { token: session.token, userId: applicant.userId };
  };
  const reserve = (
    actor: Actor,
    kind = 'BUSINESS_LICENSE',
    requestKey = randomUUID(),
    expectedVersion = 1,
  ) =>
    request(server)
      .post(`${route}/material-uploads`)
      .auth(actor.token, { type: 'bearer' })
      .send({ expectedVersion, requestKey, kind });
  const list = (actor: Actor) =>
    request(server)
      .get(`${route}/materials`)
      .auth(actor.token, { type: 'bearer' });
  const transfer = (
    actor: Actor,
    id: string,
    bytes = png,
    mime = 'image/png',
  ) =>
    request(server)
      .post(`${route}/material-uploads/${id}`)
      .auth(actor.token, { type: 'bearer' })
      .attach('file', bytes, {
        filename: 'synthetic-private-name.png',
        contentType: mime,
      });
  const save = (
    actor: Actor,
    materials: Array<{ storedFileId: string; kind: string }>,
    expectedVersion = 1,
  ) =>
    request(server)
      .put(`${route}/materials`)
      .auth(actor.token, { type: 'bearer' })
      .send({ expectedVersion, materials });
  const preview = (actor: Actor, id: string) =>
    request(server)
      .get(`${route}/materials/${id}/content`)
      .auth(actor.token, { type: 'bearer' });
  const upload = async (
    actor: Actor,
    kind = 'BUSINESS_LICENSE',
    version = 1,
    bytes = png,
    mime = 'image/png',
  ) => {
    const intent = data<Intent>(
      await reserve(actor, kind, randomUUID(), version).expect(200),
    );
    const material = data<Material>(
      await transfer(actor, intent.uploadId, bytes, mime)
        .expect((response) => {
          if (response.status !== 200)
            throw new Error(
              `Synthetic upload rejected: ${JSON.stringify(response.body)}`,
            );
        })
        .expect(200),
    );
    return { intent, material };
  };
  const savedImage = async (actor: Actor) => {
    const item = await upload(actor);
    await save(actor, [
      { storedFileId: item.material.storedFileId, kind: item.material.kind },
    ]).expect(200);
    return item;
  };

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp((builder) =>
      builder
        .overrideProvider('PARTNER_APPLICANT_RATE_LIMIT')
        .useValue({ check: () => Promise.resolve() })
        .overrideProvider('PARTNER_APPLICATION_PRIVATE_KEY_RING')
        .useValue(ring)
        .overrideProvider('PARTNER_APPLICATION_MATERIAL_RUN_TAG')
        .useValue(runTag),
    ));
    server = app.getHttpServer() as Server;
    png = await sharp({
      create: { width: 12, height: 8, channels: 3, background: '#f5d671' },
    })
      .png()
      .toBuffer();
    jpeg = await sharp({
      create: { width: 12, height: 8, channels: 3, background: '#245139' },
    })
      .jpeg()
      .toBuffer();
  });
  afterEach(() => {
    ring.current.mockImplementation(() => ({ id: runTag, key }));
    ring.get.mockImplementation((id: string) =>
      id === runTag ? key : undefined,
    );
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    try {
      if (prisma) {
        assertPartnerPdfTestTarget(process.env);
        const identities = await prisma.authIdentity.findMany({
          where: { provider: 'WECHAT', subject: { startsWith: `${runTag}-` } },
          select: { userId: true },
        });
        const ids = [
          ...new Set([...users, ...identities.map((item) => item.userId)]),
        ];
        await prisma.user.updateMany({
          where: {
            id: { in: ids },
            authIdentities: { some: { subject: { startsWith: `${runTag}-` } } },
          },
          data: { status: 'DISABLED' },
        });
        process.stdout.write(
          `PARTNER_APPLICATION_IMAGE_FIXTURE_OWNERSHIP ${JSON.stringify({
            runTag,
            userIds: ids,
            disposition:
              'retained; owned users disabled; no deletion; process keys only',
          })}\n`,
        );
      }
    } finally {
      await app?.close();
    }
  });

  it('persists an owned bounded upload intent before any file is received', async () => {
    const actor = await login();
    const key = randomUUID();
    const intent = data<Intent>(
      await reserve(actor, 'BUSINESS_LICENSE', key).expect(200),
    );
    expect(intent).toMatchObject({
      kind: 'BUSINESS_LICENSE',
      state: 'RESERVED',
      requestKey: key,
      expectedVersion: 1,
    });
    const view = data<{
      version: number;
      materials: unknown[];
      uploads: Intent[];
    }>(await list(actor).expect(200));
    expect(view.version).toBe(1);
    expect(view.materials).toEqual([]);
    expect(view.uploads).toEqual([intent]);
    const rows = await prisma.$queryRaw<
      Array<{ ownerUserId: string; state: string; runTag: string }>
    >`
      SELECT "ownerUserId", "state", "runTag" FROM "PartnerApplicationUpload" WHERE "id" = ${intent.uploadId}::uuid`;
    expect(rows).toEqual([
      { ownerUserId: actor.userId, state: 'RESERVED', runTag },
    ]);
  });
  it('deduplicates reservation and refuses same-key mutation and fourth outstanding object', async () => {
    const actor = await login();
    const key = randomUUID();
    const first = data<Intent>(
      await reserve(actor, 'BUSINESS_LICENSE', key).expect(200),
    );
    expect(
      data(await reserve(actor, 'BUSINESS_LICENSE', key).expect(200)),
    ).toEqual(first);
    await reserve(actor, 'INSTITUTION_LOGO', key).expect(409);
    await reserve(actor, 'LEGAL_ID_FRONT').expect(200);
    await reserve(actor, 'LEGAL_ID_BACK').expect(200);
    await reserve(actor, 'ENVIRONMENT').expect(409);
  });
  it('does not accept client identity, invalid kind or stale application version', async () => {
    const actor = await login();
    await reserve(actor, 'BUSINESS_LICENSE', randomUUID(), 2).expect(409);
    await reserve(actor, 'PAYMENT_PROOF').expect(400);
    await request(server)
      .post(`${route}/material-uploads`)
      .auth(actor.token, { type: 'bearer' })
      .send({
        expectedVersion: 1,
        kind: 'BUSINESS_LICENSE',
        requestKey: randomUUID(),
        ownerUserId: actor.userId,
      })
      .expect(400);
  });
  it('refuses revoked credentials and never creates a valid material on reservation', async () => {
    const actor = await login();
    await request(server)
      .post('/partner-applicants/auth/logout')
      .auth(actor.token, { type: 'bearer' })
      .expect(200);
    await reserve(actor).expect(401);
    await list(actor).expect(401);
  });
  it.each([
    ['PNG', 'image/png'],
    ['JPEG', 'image/jpeg'],
  ])(
    'stores %s only as ciphertext and audits authorized saved preview',
    async (_format, mime) => {
      const actor = await login();
      const bytes = mime === 'image/png' ? png : jpeg;
      const { intent, material } = await upload(
        actor,
        'BUSINESS_LICENSE',
        1,
        bytes,
        mime,
      );
      expect(material).toEqual({
        storedFileId: intent.storedFileId,
        kind: 'BUSINESS_LICENSE',
        mimeType: mime,
        sizeBytes: bytes.length,
        width: 12,
        height: 8,
      });
      await preview(actor, material.storedFileId).expect(404);
      const row = await prisma.storedFile.findUniqueOrThrow({
        where: { id: material.storedFileId },
        include: { partnerApplicationCipher: true },
      });
      const disk = await readFile(
        path.resolve('storage/partner-pdf-test', row.storageKey),
      );
      expect(disk.equals(bytes)).toBe(false);
      expect(row.sha256).toBe(createHash('sha256').update(disk).digest('hex'));
      expect(row.sha256).not.toBe(
        createHash('sha256').update(bytes).digest('hex'),
      );
      expect(row.originalName).not.toContain('synthetic-private-name');
      expect(JSON.stringify(row)).not.toContain(key.toString('hex'));
      expect(data<View>(await list(actor).expect(200)).version).toBe(1);
      const receipt = data(
        await save(actor, [
          { storedFileId: material.storedFileId, kind: material.kind },
        ]).expect(200),
      );
      expect(receipt).toMatchObject({ version: 2 });
      const response = await preview(actor, material.storedFileId).expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect((response.body as Buffer).equals(bytes)).toBe(true);
      const audits = await prisma.auditLog.findMany({
        where: {
          actorUserId: actor.userId,
          action: 'PARTNER_APPLICATION_MATERIAL_READ',
        },
      });
      expect(audits).toHaveLength(1);
      expect(JSON.stringify(audits)).not.toContain('synthetic-private-name');
      expect(data<View>(await list(actor).expect(200)).uploads).toEqual([]);
    },
  );
  it('retains old partitions and files on replacement and shares the basic/bank version', async () => {
    const actor = await login();
    const first = await savedImage(actor);
    const next = await upload(actor, 'BUSINESS_LICENSE', 2, jpeg, 'image/jpeg');
    await save(
      actor,
      [{ storedFileId: next.material.storedFileId, kind: 'BUSINESS_LICENSE' }],
      2,
    ).expect(200);
    await preview(actor, first.material.storedFileId).expect(404);
    await preview(actor, next.material.storedFileId).expect(200);
    const view = data<View>(await list(actor).expect(200));
    expect(
      await prisma.partnerApplicationMaterialRecord.count({
        where: { applicationId: view.applicationId },
      }),
    ).toBe(2);
    expect(
      await prisma.storedFile.count({
        where: { createdByUserId: actor.userId },
      }),
    ).toBe(2);
    const basics = data<{
      version: number;
      basicInformation: { institutionName: string };
    }>(
      await request(server)
        .get(route)
        .auth(actor.token, { type: 'bearer' })
        .expect(200),
    );
    expect(basics.version).toBe(3);
    expect(basics.basicInformation.institutionName).toContain(runTag);
    await request(server)
      .put(`${route}/bank-information`)
      .auth(actor.token, { type: 'bearer' })
      .send({
        expectedVersion: 3,
        bankInformation: { accountNumber: '00000000000000000001' },
      })
      .expect(200);
    await preview(actor, next.material.storedFileId).expect(200);
  });
  it('deduplicates transfers and saves and refuses stale changes', async () => {
    const actor = await login();
    const { intent, material } = await upload(actor);
    expect(data(await transfer(actor, intent.uploadId).expect(200))).toEqual(
      material,
    );
    const refs = [{ storedFileId: material.storedFileId, kind: material.kind }];
    const first = data(await save(actor, refs).expect(200));
    expect(data(await save(actor, refs).expect(200))).toEqual(first);
    await save(actor, [], 1).expect(409);
    expect(
      await prisma.auditLog.count({
        where: {
          actorUserId: actor.userId,
          action: 'PARTNER_APPLICATION_MATERIAL_UPLOAD',
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          actorUserId: actor.userId,
          action: 'PARTNER_APPLICATION_MATERIAL_SAVE',
        },
      }),
    ).toBe(1);
  });
  it('serializes identical concurrent uploads and differing concurrent section saves', async () => {
    const actor = await login();
    const intent = data<Intent>(await reserve(actor).expect(200));
    const results = await Promise.all([
      transfer(actor, intent.uploadId),
      transfer(actor, intent.uploadId),
    ]);
    expect(results.map((item) => item.status)).toEqual([200, 200]);
    expect(data(results[0])).toEqual(data(results[1]));
    const material = data<Material>(results[0]);
    const saves = await Promise.all([
      save(actor, [
        { storedFileId: material.storedFileId, kind: material.kind },
      ]),
      save(actor, []),
    ]);
    expect(saves.map((item) => item.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.storedFile.count({
        where: { createdByUserId: actor.userId },
      }),
    ).toBe(1);
  });
  it.each(['header-only', 'truncated', 'wrong-mime', 'svg', 'oversize'])(
    'rejects %s without writing a file or completing an intent',
    async (invalid) => {
      const actor = await login();
      const intent = data<Intent>(await reserve(actor).expect(200));
      const bytes =
        invalid === 'header-only'
          ? png.subarray(0, 33)
          : invalid === 'truncated'
            ? jpeg.subarray(0, 40)
            : invalid === 'svg'
              ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
              : invalid === 'oversize'
                ? Buffer.alloc(3 * 1024 * 1024 + 1)
                : png;
      await transfer(
        actor,
        intent.uploadId,
        bytes,
        invalid === 'wrong-mime' ? 'image/jpeg' : 'image/png',
      ).expect(invalid === 'oversize' ? 413 : 400);
      expect(
        (
          await prisma.partnerApplicationUpload.findUniqueOrThrow({
            where: { id: intent.uploadId },
          })
        ).state,
      ).toBe('RESERVED');
      expect(
        await prisma.storedFile.count({
          where: { createdByUserId: actor.userId },
        }),
      ).toBe(0);
    },
  );
  it('rejects a fully valid image whose dimensions exceed the decoder resource limit', async () => {
    const actor = await login();
    const intent = data<Intent>(await reserve(actor).expect(200));
    const tooWide = await sharp({
      create: { width: 8193, height: 1, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    await transfer(actor, intent.uploadId, tooWide).expect(400);
  });
  it('rejects duplicate IDs, wrong kinds and multiple single-purpose files', async () => {
    const actor = await login();
    const first = await upload(actor);
    const second = await upload(actor);
    const ref = {
      storedFileId: first.material.storedFileId,
      kind: 'BUSINESS_LICENSE',
    };
    await save(actor, [ref, ref]).expect(400);
    await save(actor, [{ ...ref, kind: 'STORE_FRONT' }]).expect(404);
    await save(actor, [
      ref,
      { storedFileId: second.material.storedFileId, kind: 'BUSINESS_LICENSE' },
    ]).expect(400);
  });
  it('allows nine ordered environment photos, caps the tenth and preserves explicit storefront kind', async () => {
    const actor = await login();
    const refs: Array<{ storedFileId: string; kind: string }> = [];
    let version = 1;
    for (let index = 0; index < 9; index++) {
      const { material } = await upload(actor, 'ENVIRONMENT', version);
      refs.push({ storedFileId: material.storedFileId, kind: material.kind });
      await save(actor, refs, version++).expect(200);
    }
    const extra = await upload(actor, 'ENVIRONMENT', version);
    await save(
      actor,
      [
        ...refs,
        { storedFileId: extra.material.storedFileId, kind: 'ENVIRONMENT' },
      ],
      version,
    ).expect(400);
    const front = await upload(actor, 'STORE_FRONT', version);
    refs.push({
      storedFileId: front.material.storedFileId,
      kind: 'STORE_FRONT',
    });
    await save(actor, refs, version).expect(200);
    const view = data<View>(await list(actor).expect(200));
    expect(
      view.materials.map(({ storedFileId, kind }) => ({ storedFileId, kind })),
    ).toEqual(refs);
    expect(view.uploads.map((item) => item.storedFileId)).toEqual([
      extra.material.storedFileId,
    ]);
  });
  it('does not waive the outstanding quota when transfers have completed but remain unsaved', async () => {
    const actor = await login();
    await upload(actor);
    await upload(actor, 'INSTITUTION_LOGO');
    await upload(actor, 'LEGAL_ID_FRONT');
    await reserve(actor, 'STORE_FRONT').expect(409);
    expect(data<View>(await list(actor).expect(200)).uploads).toHaveLength(3);
  });
  it('rejects extra multipart fields without creating a new file', async () => {
    const actor = await login();
    const intent = data<Intent>(await reserve(actor).expect(200));
    await request(server)
      .post(`${route}/material-uploads/${intent.uploadId}`)
      .auth(actor.token, { type: 'bearer' })
      .field('ownerUserId', actor.userId)
      .attach('file', png, {
        filename: 'synthetic.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(
      await prisma.storedFile.count({
        where: { createdByUserId: actor.userId },
      }),
    ).toBe(0);
  });
  it('prevents cross-applicant transfer, save and preview even with a valid file UUID', async () => {
    const owner = await login();
    const other = await login();
    const { intent, material } = await savedImage(owner);
    await transfer(other, intent.uploadId).expect(404);
    await save(other, [
      { storedFileId: material.storedFileId, kind: material.kind },
    ]).expect(404);
    await preview(other, material.storedFileId).expect(404);
  });
  it('does not admit formal bearer credentials or writes by a formal-ready applicant', async () => {
    const actor = await login();
    const { material } = await savedImage(actor);
    await prisma.userRole.create({
      data: { userId: actor.userId, roleCode: 'SUPER_ADMIN', campusId: null },
    });
    const formal = (
      await app.get(AuthService).issueSessionForUser(actor.userId)
    ).accessToken;
    await request(server)
      .get(`${route}/materials`)
      .auth(formal, { type: 'bearer' })
      .expect(401);
    expect(data<View>(await list(actor).expect(200)).readonly).toBe(true);
    await reserve(actor, 'STORE_FRONT', randomUUID(), 2).expect(409);
    await save(actor, [], 2).expect(409);
    await preview(actor, material.storedFileId).expect(200);
  });
  it.each(['SUBMITTED', 'REJECTED', 'APPROVED'] as const)(
    'permits owned reads only in %s',
    async (status) => {
      const actor = await login();
      const { material } = await savedImage(actor);
      const view = data<View>(await list(actor).expect(200));
      await prisma.partnerApplication.update({
        where: { id: view.applicationId },
        data: { status },
      });
      expect(data<View>(await list(actor).expect(200)).readonly).toBe(true);
      await preview(actor, material.storedFileId).expect(200);
      await reserve(actor, 'STORE_FRONT', randomUUID(), 2).expect(409);
    },
  );
  it('retains owned ciphertext after completion audit failure and resumes exactly once', async () => {
    const actor = await login();
    const intent = data<Intent>(await reserve(actor).expect(200));
    const extension = prisma.$extends({
      query: {
        auditLog: {
          create: ({ args, query }) => {
            if (args.data.action === 'PARTNER_APPLICATION_MATERIAL_UPLOAD')
              throw new Error('synthetic upload audit failure');
            return query(args);
          },
        },
      },
    });
    const original = prisma.$transaction.bind(prisma);
    const transaction = jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce(original)
      .mockImplementationOnce(original)
      .mockImplementationOnce(original)
      .mockImplementationOnce(((callback: (tx: unknown) => unknown) =>
        extension.$transaction(
          callback as never,
        )) as typeof prisma.$transaction);
    await transfer(actor, intent.uploadId).expect(500);
    transaction.mockRestore();
    const retained = await prisma.partnerApplicationUpload.findUniqueOrThrow({
      where: { id: intent.uploadId },
    });
    expect(retained.state).toBe('WRITING');
    const ciphertext = await readFile(
      path.resolve('storage/partner-pdf-test', retained.storageKey),
    );
    expect(
      await prisma.storedFile.count({ where: { id: intent.storedFileId } }),
    ).toBe(0);
    await transfer(actor, intent.uploadId, jpeg, 'image/jpeg').expect(409);
    await transfer(actor, intent.uploadId).expect(200);
    expect(
      (
        await readFile(
          path.resolve('storage/partner-pdf-test', retained.storageKey),
        )
      ).equals(ciphertext),
    ).toBe(true);
    expect(
      await prisma.auditLog.count({
        where: {
          actorUserId: actor.userId,
          action: 'PARTNER_APPLICATION_MATERIAL_UPLOAD',
        },
      }),
    ).toBe(1);
  });
  it('recovers the same persisted envelope after a storage failure before creation', async () => {
    const actor = await login();
    const intent = data<Intent>(await reserve(actor).expect(200));
    const storage = app.get(PartnerPrivateLocalAdapter);
    jest
      .spyOn(storage, 'writeOnce')
      .mockRejectedValueOnce(new Error('synthetic disk failure'));
    await transfer(actor, intent.uploadId).expect(503);
    const retained = await prisma.partnerApplicationUpload.findUniqueOrThrow({
      where: { id: intent.uploadId },
    });
    expect(retained.state).toBe('WRITING');
    await transfer(actor, intent.uploadId).expect(200);
    const completed = await prisma.partnerApplicationUpload.findUniqueOrThrow({
      where: { id: intent.uploadId },
    });
    expect(completed.nonce).toBe(retained.nonce);
  });
  it('recovers a partial failed object through a bounded owned successor without overwriting it', async () => {
    const actor = await login();
    const intent = data<Intent>(await reserve(actor).expect(200));
    const storage = app.get(PartnerPrivateLocalAdapter);
    const original = storage.writeOnce.bind(storage);
    jest
      .spyOn(storage, 'writeOnce')
      .mockImplementationOnce(async (storageKey, ciphertext) => {
        await original(storageKey, ciphertext.subarray(0, 5));
        throw new Error('synthetic interrupted partial write');
      });
    await transfer(actor, intent.uploadId).expect(503);
    const retained = await prisma.partnerApplicationUpload.findUniqueOrThrow({
      where: { id: intent.uploadId },
    });
    await transfer(actor, intent.uploadId).expect(200);
    expect(
      await readFile(
        path.resolve('storage/partner-pdf-test', retained.storageKey),
      ),
    ).toHaveLength(5);
    const completed = await prisma.partnerApplicationUpload.findUniqueOrThrow({
      where: { id: intent.uploadId },
    });
    expect(completed.state).toBe('COMPLETED');
    expect(completed.storageKey).not.toBe(retained.storageKey);
    expect(completed.storedFileId).toBe(retained.storedFileId);
    expect(completed.nonce).toBe(retained.nonce);
    const objects = await prisma.$queryRaw<
      Array<{ storageKey: string; attempt: number }>
    >`
      SELECT "storageKey", "attempt" FROM "PartnerApplicationUploadObject" WHERE "uploadId" = ${intent.uploadId}::uuid ORDER BY "attempt"`;
    expect(objects).toEqual([
      { storageKey: retained.storageKey, attempt: 1 },
      { storageKey: completed.storageKey, attempt: 2 },
    ]);
  });
  it('concurrent recovery of a partial file registers one successor and completes once', async () => {
    const actor = await login();
    const intent = data<Intent>(await reserve(actor).expect(200));
    const storage = app.get(PartnerPrivateLocalAdapter);
    const original = storage.writeOnce.bind(storage);
    jest
      .spyOn(storage, 'writeOnce')
      .mockImplementationOnce(async (storageKey, ciphertext) => {
        await original(storageKey, ciphertext.subarray(0, 5));
        throw new Error('synthetic interrupted partial write');
      });
    await transfer(actor, intent.uploadId).expect(503);
    const retained = await prisma.partnerApplicationUpload.findUniqueOrThrow({
      where: { id: intent.uploadId },
    });
    const retainedBytes = await readFile(
      path.resolve('storage/partner-pdf-test', retained.storageKey),
    );
    const results = await Promise.all([
      transfer(actor, intent.uploadId).expect(200),
      transfer(actor, intent.uploadId).expect(200),
    ]);
    expect(data<Material>(results[0])).toEqual(data<Material>(results[1]));
    expect(
      await prisma.partnerApplicationUploadObject.count({
        where: { uploadId: intent.uploadId },
      }),
    ).toBe(2);
    expect(
      await prisma.storedFile.count({ where: { id: intent.storedFileId } }),
    ).toBe(1);
    for (const action of [
      'PARTNER_APPLICATION_MATERIAL_RECOVER',
      'PARTNER_APPLICATION_MATERIAL_UPLOAD',
    ])
      expect(
        await prisma.auditLog.count({
          where: { actorUserId: actor.userId, action },
        }),
      ).toBe(1);
    expect(
      await readFile(
        path.resolve('storage/partner-pdf-test', retained.storageKey),
      ),
    ).toEqual(retainedBytes);
  });
  it('rolls back successor ownership on recovery audit failure before any new file is written', async () => {
    const actor = await login();
    const intent = data<Intent>(await reserve(actor).expect(200));
    const storage = app.get(PartnerPrivateLocalAdapter);
    const write = storage.writeOnce.bind(storage);
    const writing = jest
      .spyOn(storage, 'writeOnce')
      .mockImplementationOnce(async (storageKey, ciphertext) => {
        await write(storageKey, ciphertext.subarray(0, 5));
        throw new Error('synthetic interrupted partial write');
      });
    await transfer(actor, intent.uploadId).expect(503);
    const retained = await prisma.partnerApplicationUpload.findUniqueOrThrow({
      where: { id: intent.uploadId },
    });
    const extension = prisma.$extends({
      query: {
        auditLog: {
          create: ({ args, query }) => {
            if (args.data.action === 'PARTNER_APPLICATION_MATERIAL_RECOVER')
              throw new Error('synthetic recovery audit failure');
            return query(args);
          },
        },
      },
    });
    const transaction = prisma.$transaction.bind(prisma);
    const transactions = jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce(transaction)
      .mockImplementationOnce(transaction)
      .mockImplementationOnce(((callback: (tx: unknown) => unknown) =>
        extension.$transaction(
          callback as never,
        )) as typeof prisma.$transaction);
    await transfer(actor, intent.uploadId).expect(500);
    transactions.mockRestore();
    expect(writing).toHaveBeenCalledTimes(1);
    expect(
      await prisma.partnerApplicationUpload.findUniqueOrThrow({
        where: { id: intent.uploadId },
      }),
    ).toEqual(retained);
    const objects = await prisma.partnerApplicationUploadObject.findMany({
      where: { uploadId: intent.uploadId },
    });
    expect(objects).toHaveLength(1);
    expect(objects[0].retainedAt).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: {
          actorUserId: actor.userId,
          action: 'PARTNER_APPLICATION_MATERIAL_RECOVER',
        },
      }),
    ).toBe(0);
    await transfer(actor, intent.uploadId).expect(200);
    expect(
      await prisma.partnerApplicationUploadObject.count({
        where: { uploadId: intent.uploadId },
      }),
    ).toBe(2);
  });
  it('fails closed at three owned physical objects without creating a fourth or resetting quota', async () => {
    const actor = await login();
    const intent = data<Intent>(await reserve(actor).expect(200));
    const storage = app.get(PartnerPrivateLocalAdapter);
    const original = storage.writeOnce.bind(storage);
    jest
      .spyOn(storage, 'writeOnce')
      .mockImplementationOnce(async (storageKey, ciphertext) => {
        await original(storageKey, ciphertext.subarray(0, 5));
        throw new Error('synthetic partial fixture');
      });
    await transfer(actor, intent.uploadId).expect(503);
    const first = await prisma.partnerApplicationUploadObject.findFirstOrThrow({
      where: { uploadId: intent.uploadId },
    });
    await prisma.partnerApplicationUploadObject.update({
      where: { id: first.id },
      data: { retainedAt: new Date() },
    });
    let currentKey = first.storageKey;
    for (const attempt of [2, 3]) {
      const id = randomUUID();
      currentKey = `partner-application-private/${runTag}/${id}.bin`;
      await prisma.partnerApplicationUploadObject.create({
        data: {
          id,
          uploadId: intent.uploadId,
          attempt,
          storageKey: currentKey,
          retainedAt: attempt === 2 ? new Date() : null,
        },
      });
      await original(currentKey, Buffer.alloc(5));
    }
    await prisma.partnerApplicationUpload.update({
      where: { id: intent.uploadId },
      data: { storageKey: currentKey },
    });
    await transfer(actor, intent.uploadId).expect(503);
    expect(
      await prisma.partnerApplicationUploadObject.count({
        where: { uploadId: intent.uploadId },
      }),
    ).toBe(3);
    expect(
      (
        await prisma.partnerApplicationUpload.findUniqueOrThrow({
          where: { id: intent.uploadId },
        })
      ).storageKey,
    ).toBe(currentKey);
    expect(data<View>(await list(actor).expect(200)).uploads).toHaveLength(1);
  });
  it.each([
    'PARTNER_APPLICATION_MATERIAL_SAVE',
    'PARTNER_APPLICATION_MATERIAL_READ',
  ])('rolls back and withholds bytes on %s audit failure', async (action) => {
    const actor = await login();
    const { material } = await savedImage(actor);
    const before = data<View>(await list(actor).expect(200));
    const extension = prisma.$extends({
      query: {
        auditLog: {
          create: ({ args, query }) => {
            if (args.data.action === action)
              throw new Error('synthetic audit failure');
            return query(args);
          },
        },
      },
    });
    const original = prisma.$transaction.bind(prisma);
    const transaction = jest.spyOn(prisma, '$transaction');
    if (action.endsWith('READ')) transaction.mockImplementationOnce(original);
    transaction.mockImplementationOnce(((callback: (tx: unknown) => unknown) =>
      extension.$transaction(callback as never)) as typeof prisma.$transaction);
    const response = await (
      action.endsWith('SAVE')
        ? save(actor, [], 2)
        : preview(actor, material.storedFileId)
    ).expect(500);
    transaction.mockRestore();
    expect(response.headers['content-type']).toContain('json');
    expect(data<View>(await list(actor).expect(200))).toEqual(before);
  });
  it('refuses content when logout occurs during decrypt and storage read', async () => {
    const actor = await login();
    const { material } = await savedImage(actor);
    const files = app.get(PartnerPrivateImageStore);
    const original = files.read.bind(files);
    jest.spyOn(files, 'read').mockImplementationOnce(async (...args) => {
      const bytes = await original(...args);
      await request(server)
        .post('/partner-applicants/auth/logout')
        .auth(actor.token, { type: 'bearer' })
        .expect(200);
      return bytes;
    });
    await preview(actor, material.storedFileId).expect(401);
    expect(
      await prisma.auditLog.count({
        where: {
          actorUserId: actor.userId,
          action: 'PARTNER_APPLICATION_MATERIAL_READ',
        },
      }),
    ).toBe(0);
  });
  it('refuses content when its owner is disabled during decrypt', async () => {
    const actor = await login();
    const { material } = await savedImage(actor);
    const files = app.get(PartnerPrivateImageStore);
    const original = files.read.bind(files);
    jest.spyOn(files, 'read').mockImplementationOnce(async (...args) => {
      const bytes = await original(...args);
      await prisma.user.update({
        where: { id: actor.userId },
        data: { status: 'DISABLED' },
      });
      return bytes;
    });
    await preview(actor, material.storedFileId).expect(401);
    expect(
      await prisma.auditLog.count({
        where: {
          actorUserId: actor.userId,
          action: 'PARTNER_APPLICATION_MATERIAL_READ',
        },
      }),
    ).toBe(0);
  });
  it('refuses an old file when the current partition changes during read', async () => {
    const actor = await login();
    const { material } = await savedImage(actor);
    const files = app.get(PartnerPrivateImageStore);
    const original = files.read.bind(files);
    jest.spyOn(files, 'read').mockImplementationOnce(async (...args) => {
      const bytes = await original(...args);
      await save(actor, [], 2).expect(200);
      return bytes;
    });
    await preview(actor, material.storedFileId).expect(409);
  });
  it('fails closed on unknown historical key, wrong key and non-test runtime', async () => {
    const actor = await login();
    const { material } = await savedImage(actor);
    ring.get.mockReturnValueOnce(undefined);
    await preview(actor, material.storedFileId).expect(503);
    ring.get.mockReturnValueOnce(randomBytes(32));
    await preview(actor, material.storedFileId).expect(503);
    const config = app.get(ConfigService);
    const original: (name: string) => unknown = config.get.bind(config);
    const spy = jest
      .spyOn(config, 'get')
      .mockImplementation((name: string) =>
        name === 'NODE_ENV' ? 'production' : original(name),
      );
    await list(actor).expect(503);
    spy.mockRestore();
  });
});
