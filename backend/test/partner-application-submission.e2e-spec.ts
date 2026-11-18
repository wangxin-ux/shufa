import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { Prisma } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import { PartnerPrivateLocalAdapter } from '../src/modules/file/partner-private-local.adapter';
import { PartnerApplicationSubmissionService } from '../src/modules/partner-application/partner-application-submission.service';
import { AuthService } from '../src/modules/auth/auth.service';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);
const route = '/partner-applicants/me/application';
const data = <T>(response: { body: unknown }) =>
  (response.body as { data: T }).data;
interface Actor {
  token: string;
  userId: string;
  applicationId: string;
  version: number;
}
interface Receipt {
  applicationId: string;
  submissionId: string;
  version: number;
  status: string;
  submittedAt: string;
}
const basicInformation = {
  institutionName: '合成入驻机构',
  province: '合成省',
  city: '合成市',
  district: '合成区',
  detailedAddress: '合成测试路1号',
  contactPhone: '000-00000000',
};
const bankInformation = {
  bankName: '合成测试开户行',
  accountHolder: '合成测试户名',
  accountNumber: '00000123456789',
};
const kinds = [
  'BUSINESS_LICENSE',
  'INSTITUTION_LOGO',
  'LEGAL_ID_FRONT',
  'LEGAL_ID_BACK',
  'STORE_FRONT',
  'ENVIRONMENT',
];

describe('immutable applicant submission in the dedicated local database', () => {
  const runTag = `psubmit-${randomUUID().slice(0, 8)}`;
  const key = randomBytes(32);
  const ring = {
    current: jest.fn(() => ({ id: runTag, key })),
    get: jest.fn((id: string) => (id === runTag ? key : undefined)),
  };
  const regions = {
    version: 'synthetic-v1',
    matches: jest.fn(
      (p: string, c: string, d: string) =>
        p === basicInformation.province &&
        c === basicInformation.city &&
        d === basicInformation.district,
    ),
  };
  const users: string[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let png: Buffer;
  let sequence = 0;
  const login = async (): Promise<Actor> => {
    const session = data<{ token: string; me: { applicantId: string } }>(
      await request(server)
        .post('/partner-applicants/auth/wechat')
        .send({ code: `mock-wechat-login:${runTag}-${++sequence}` })
        .expect(200),
    );
    const applicant = await prisma.partnerApplicant.findUniqueOrThrow({
      where: { id: session.me.applicantId },
    });
    users.push(applicant.userId);
    const draft = data<{ applicationId: string; version: number }>(
      await request(server)
        .put(`${route}/basic-information`)
        .auth(session.token, { type: 'bearer' })
        .send({ expectedVersion: 0, basicInformation })
        .expect(200),
    );
    return { token: session.token, userId: applicant.userId, ...draft };
  };
  const submit = (
    actor: Actor,
    requestKey = randomUUID(),
    expectedVersion = actor.version,
  ) =>
    request(server)
      .post(`${route}/submit`)
      .auth(actor.token, { type: 'bearer' })
      .set('Idempotency-Key', requestKey)
      .send({ expectedVersion });
  const complete = async (actor: Actor, selected = kinds) => {
    const bank = data<{ version: number }>(
      await request(server)
        .put(`${route}/bank-information`)
        .auth(actor.token, { type: 'bearer' })
        .send({ expectedVersion: actor.version, bankInformation })
        .expect(200),
    );
    actor.version = bank.version;
    const materials: Array<{ storedFileId: string; kind: string }> = [];
    // Adopt each file to stay within the established three-unadopted-intent quota.
    for (const kind of selected) {
      const intent = data<{ uploadId: string; storedFileId: string }>(
        await request(server)
          .post(`${route}/material-uploads`)
          .auth(actor.token, { type: 'bearer' })
          .send({
            expectedVersion: actor.version,
            requestKey: randomUUID(),
            kind,
          })
          .expect(200),
      );
      await request(server)
        .post(`${route}/material-uploads/${intent.uploadId}`)
        .auth(actor.token, { type: 'bearer' })
        .attach('file', png, {
          filename: 'synthetic.png',
          contentType: 'image/png',
        })
        .expect(200);
      materials.push({ storedFileId: intent.storedFileId, kind });
      actor.version = data<{ version: number }>(
        await request(server)
          .put(`${route}/materials`)
          .auth(actor.token, { type: 'bearer' })
          .send({ expectedVersion: actor.version, materials })
          .expect(200),
      ).version;
    }
    return materials;
  };
  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp((builder) =>
      builder
        .overrideProvider('PARTNER_APPLICANT_RATE_LIMIT')
        .useValue({ check: () => Promise.resolve() })
        .overrideProvider('PARTNER_APPLICATION_PRIVATE_KEY_RING')
        .useValue(ring)
        .overrideProvider('PARTNER_APPLICATION_MATERIAL_RUN_TAG')
        .useValue(runTag)
        .overrideProvider('PARTNER_APPLICATION_REGION_CATALOG')
        .useValue(regions),
    ));
    server = app.getHttpServer() as Server;
    png = await sharp({
      create: { width: 12, height: 8, channels: 3, background: '#f5d671' },
    })
      .png()
      .toBuffer();
  });
  afterEach(() => {
    ring.get.mockImplementation((id: string) =>
      id === runTag ? key : undefined,
    );
    regions.version = 'synthetic-v1';
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    try {
      if (prisma) {
        assertPartnerPdfTestTarget(process.env);
        await prisma.user.updateMany({
          where: {
            id: { in: users },
            authIdentities: { some: { subject: { startsWith: `${runTag}-` } } },
          },
          data: { status: 'DISABLED' },
        });
        process.stdout.write(
          `PARTNER_APPLICATION_SUBMISSION_FIXTURE_OWNERSHIP ${JSON.stringify({
            runTag,
            userIds: users,
            disposition:
              'retained; owned users disabled; no deletion; process keys and synthetic regions only',
          })}\n`,
        );
      }
    } finally {
      await app?.close();
    }
  });
  it('rejects an incomplete draft without changing its version', async () => {
    const actor = await login();
    await submit(actor).expect(400);
    expect(
      data<{ version: number }>(
        await request(server)
          .get(route)
          .auth(actor.token, { type: 'bearer' })
          .expect(200),
      ).version,
    ).toBe(1);
  });
  it('freezes one complete snapshot and replays the same minimal receipt', async () => {
    const actor = await login();
    await complete(actor);
    const requestKey = randomUUID();
    const first = data<Receipt>(await submit(actor, requestKey).expect(200));
    expect(first).toMatchObject({
      applicationId: actor.applicationId,
      version: actor.version + 1,
      status: 'SUBMITTED',
    });
    expect(data<Receipt>(await submit(actor, requestKey).expect(200))).toEqual(
      first,
    );
    await submit(actor, requestKey, actor.version - 1).expect(409);
    await submit(actor).expect(409);
    await request(server)
      .put(`${route}/basic-information`)
      .auth(actor.token, { type: 'bearer' })
      .send({ expectedVersion: first.version, basicInformation })
      .expect(409);
    await request(server)
      .put(`${route}/bank-information`)
      .auth(actor.token, { type: 'bearer' })
      .send({ expectedVersion: first.version, bankInformation })
      .expect(409);
    await request(server)
      .put(`${route}/materials`)
      .auth(actor.token, { type: 'bearer' })
      .send({ expectedVersion: first.version, materials: [] })
      .expect(409);
    expect(
      data<{ readonly: boolean }>(
        await request(server)
          .get(`${route}/materials`)
          .auth(actor.token, { type: 'bearer' })
          .expect(200),
      ).readonly,
    ).toBe(true);
    await request(server)
      .post(`${route}/material-uploads`)
      .auth(actor.token, { type: 'bearer' })
      .send({
        expectedVersion: first.version,
        requestKey: randomUUID(),
        kind: 'STORE_FRONT',
      })
      .expect(409);
    const snapshot =
      await prisma.partnerApplicationSubmission.findUniqueOrThrow({
        where: { id: first.submissionId },
      });
    const current = await prisma.partnerApplication.findUniqueOrThrow({
      where: { id: actor.applicationId },
    });
    expect(snapshot).toMatchObject({
      ...basicInformation,
      applicationVersion: first.version,
      sourceVersion: actor.version,
      bankRecordId: current.currentBankRecordId,
      materialRecordId: current.currentMaterialRecordId,
      regionCatalogVersion: 'synthetic-v1',
    });
    const idempotency = await prisma.idempotencyRecord.findFirstOrThrow({
      where: { key: requestKey, actorUserId: actor.userId },
    });
    const audits = await prisma.auditLog.findMany({
      where: { actorUserId: actor.userId },
    });
    for (const value of Object.values(bankInformation)) {
      expect(
        JSON.stringify([first, snapshot, audits, idempotency]),
      ).not.toContain(value);
    }
    expect(JSON.stringify([first, audits, idempotency])).not.toContain(
      basicInformation.contactPhone,
    );
    expect(
      await prisma.partnerApplicationSubmission.count({
        where: { applicationId: actor.applicationId },
      }),
    ).toBe(1);
    await expect(
      prisma.partnerApplicationSubmission.update({
        where: { id: snapshot.id },
        data: { institutionName: '禁止改写' },
      }),
    ).rejects.toThrow();
    expect(
      await prisma.partnerApplicationSubmission.findUniqueOrThrow({
        where: { id: snapshot.id },
      }),
    ).toEqual(snapshot);
  });
  it.each(['STORE_FRONT', 'LEGAL_ID_BACK', 'ENVIRONMENT'])(
    'rejects missing %s without accepting another material as a substitute',
    async (missing) => {
      const actor = await login();
      await complete(
        actor,
        kinds.filter((kind) => kind !== missing),
      );
      await submit(actor).expect(400);
    },
  );
  it('rejects cross-level region names and keeps the draft editable', async () => {
    const actor = await login();
    await complete(actor);
    actor.version = data<{ version: number }>(
      await request(server)
        .put(`${route}/basic-information`)
        .auth(actor.token, { type: 'bearer' })
        .send({
          expectedVersion: actor.version,
          basicInformation: { ...basicInformation, city: '另一个合成市' },
        })
        .expect(200),
    ).version;
    await submit(actor).expect(400);
  });
  it('fails closed when the region catalog or historical bank key is unavailable', async () => {
    const actor = await login();
    await complete(actor);
    regions.version = '';
    await submit(actor).expect(503);
    regions.version = 'synthetic-v1';
    ring.get.mockReturnValueOnce(undefined);
    await submit(actor).expect(503);
  });
  it('serializes concurrent submissions and generates one audit', async () => {
    const actor = await login();
    await complete(actor);
    const requestKey = randomUUID();
    const results = await Promise.all([
      submit(actor, requestKey),
      submit(actor, requestKey),
    ]);
    expect(results.map((item) => item.status)).toEqual([200, 200]);
    expect(data<Receipt>(results[0])).toEqual(data<Receipt>(results[1]));
    await submit(actor).expect(409);
    expect(
      await prisma.auditLog.count({
        where: {
          actorUserId: actor.userId,
          action: 'PARTNER_APPLICATION_SUBMIT',
        },
      }),
    ).toBe(1);
  });
  it('permits only one of two different concurrent keys', async () => {
    const actor = await login();
    await complete(actor);
    const results = await Promise.all([submit(actor), submit(actor)]);
    expect(results.map((item) => item.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.partnerApplicationSubmission.count({
        where: { applicationId: actor.applicationId },
      }),
    ).toBe(1);
  });
  it('serializes submit versus a competing basic edit without mixing snapshot versions', async () => {
    const actor = await login();
    await complete(actor);
    const [submitted, edited] = await Promise.all([
      submit(actor),
      request(server)
        .put(`${route}/basic-information`)
        .auth(actor.token, { type: 'bearer' })
        .send({
          expectedVersion: actor.version,
          basicInformation: {
            ...basicInformation,
            institutionName: '竞争修改',
          },
        }),
    ]);
    expect([submitted.status, edited.status].sort()).toEqual([200, 409]);
    const snapshots = await prisma.partnerApplicationSubmission.findMany({
      where: { applicationId: actor.applicationId },
    });
    expect(snapshots).toHaveLength(submitted.status === 200 ? 1 : 0);
    if (snapshots.length)
      expect(snapshots[0].institutionName).toBe(
        basicInformation.institutionName,
      );
  });
  it.each([
    'institutionName',
    'province',
    'city',
    'district',
    'detailedAddress',
    'contactPhone',
  ])('rejects missing basic field %s', async (field) => {
    const actor = await login();
    actor.version = data<{ version: number }>(
      await request(server)
        .put(`${route}/basic-information`)
        .auth(actor.token, { type: 'bearer' })
        .send({
          expectedVersion: actor.version,
          basicInformation: { ...basicInformation, [field]: null },
        })
        .expect(200),
    ).version;
    await submit(actor).expect(400);
  });
  it.each([
    '123',
    '联系电话',
    '000-00000000转123',
    '++00000000000',
    '(00000000',
    '000)00000000',
  ])('rejects malformed contact %s', async (contactPhone) => {
    const actor = await login();
    actor.version = data<{ version: number }>(
      await request(server)
        .put(`${route}/basic-information`)
        .auth(actor.token, { type: 'bearer' })
        .send({
          expectedVersion: actor.version,
          basicInformation: { ...basicInformation, contactPhone },
        })
        .expect(200),
    ).version;
    const response = await submit(actor).expect(400);
    expect((response.body as { message: string }).message).toBe(
      '请检查联系电话格式并保存',
    );
  });
  it('rejects a saved but incomplete bank partition', async () => {
    const actor = await login();
    await complete(actor);
    actor.version = data<{ version: number }>(
      await request(server)
        .put(`${route}/bank-information`)
        .auth(actor.token, { type: 'bearer' })
        .send({
          expectedVersion: actor.version,
          bankInformation: { ...bankInformation, accountNumber: null },
        })
        .expect(200),
    ).version;
    await submit(actor).expect(400);
  });
  it.each(['bank', 'materials'])(
    'rejects a foreign current %s partition',
    async (section) => {
      const actor = await login();
      await complete(actor);
      const other = await login();
      await complete(other);
      const foreign = await prisma.partnerApplication.findUniqueOrThrow({
        where: { id: other.applicationId },
      });
      // Pointers are unique: move this synthetic pointer without modifying its immutable record.
      const id =
        section === 'bank'
          ? foreign.currentBankRecordId
          : foreign.currentMaterialRecordId;
      await prisma.partnerApplication.update({
        where: { id: other.applicationId },
        data:
          section === 'bank'
            ? { currentBankRecordId: null }
            : { currentMaterialRecordId: null },
      });
      await prisma.partnerApplication.update({
        where: { id: actor.applicationId },
        data:
          section === 'bank'
            ? { currentBankRecordId: id }
            : { currentMaterialRecordId: id },
      });
      await submit(actor).expect(503);
      expect(
        await prisma.partnerApplicationSubmission.count({
          where: { applicationId: actor.applicationId },
        }),
      ).toBe(0);
    },
  );
  it('rejects duplicate single-image kinds in an invalid saved partition', async () => {
    const actor = await login();
    await complete(actor);
    const current = await prisma.partnerApplication.findUniqueOrThrow({
      where: { id: actor.applicationId },
    });
    const item = await prisma.partnerApplicationMaterialItem.findFirstOrThrow({
      where: {
        recordId: current.currentMaterialRecordId!,
        kind: 'INSTITUTION_LOGO',
      },
    });
    await prisma.partnerApplicationMaterialItem.update({
      where: { id: item.id },
      data: { kind: 'BUSINESS_LICENSE' },
    });
    await submit(actor).expect(400);
  });
  it('accepts a formatted fixed telephone without binding a staff phone', async () => {
    const actor = await login();
    await complete(actor);
    actor.version = data<{ version: number }>(
      await request(server)
        .put(`${route}/basic-information`)
        .auth(actor.token, { type: 'bearer' })
        .send({
          expectedVersion: actor.version,
          basicInformation: {
            ...basicInformation,
            contactPhone: '+00 (000) 00000000',
          },
        })
        .expect(200),
    ).version;
    await submit(actor).expect(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } }))
        .staffPhone,
    ).toBeNull();
  });
  it.each(['cross-owner', 'wrong-kind', 'unfinished', 'corrupt-cipher'])(
    'refuses %s saved material references',
    async (corruption) => {
      const actor = await login();
      const files = await complete(actor);
      const current = await prisma.partnerApplication.findUniqueOrThrow({
        where: { id: actor.applicationId },
      });
      const item = await prisma.partnerApplicationMaterialItem.findFirstOrThrow(
        {
          where: {
            recordId: current.currentMaterialRecordId!,
            kind: 'BUSINESS_LICENSE',
          },
        },
      );
      if (corruption === 'cross-owner') {
        const other = await login();
        const foreign = await complete(other, ['BUSINESS_LICENSE']);
        await prisma.partnerApplicationMaterialItem.update({
          where: { id: item.id },
          data: { storedFileId: foreign[0].storedFileId },
        });
      } else if (corruption === 'wrong-kind') {
        await prisma.partnerApplicationUpload.update({
          where: { storedFileId: files[0].storedFileId },
          data: { kind: 'ENVIRONMENT' },
        });
      } else if (corruption === 'unfinished') {
        await prisma.partnerApplicationUpload.update({
          where: { storedFileId: files[0].storedFileId },
          data: { state: 'WRITING', completedAt: null, adoptedAt: null },
        });
      } else {
        jest
          .spyOn(app.get(PartnerPrivateLocalAdapter), 'read')
          .mockRejectedValueOnce(new Error('synthetic cipher failure'));
      }
      await submit(actor).expect(corruption === 'corrupt-cipher' ? 503 : 404);
      expect(
        await prisma.partnerApplicationSubmission.count({
          where: { applicationId: actor.applicationId },
        }),
      ).toBe(0);
    },
  );
  it.each(['audit', 'idempotency'])(
    'rolls back the snapshot and state on %s completion failure',
    async (failurePoint) => {
      const actor = await login();
      await complete(actor);
      const requestKey = randomUUID();
      const extension = prisma.$extends({
        query: {
          auditLog: {
            create: ({ args, query }) => {
              if (
                failurePoint === 'audit' &&
                args.data.action === 'PARTNER_APPLICATION_SUBMIT'
              )
                throw new Error('synthetic submit audit failure');
              return query(args);
            },
          },
          idempotencyRecord: {
            update: ({ args, query }) => {
              if (failurePoint === 'idempotency')
                throw new Error('synthetic idempotency completion failure');
              return query(args);
            },
          },
        },
      });
      const transaction = jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce(((callback: (tx: unknown) => unknown) =>
          extension.$transaction(callback as never, {
            timeout: 30_000,
          })) as typeof prisma.$transaction);
      await submit(actor, requestKey).expect(500);
      transaction.mockRestore();
      expect(
        await prisma.partnerApplication.findUniqueOrThrow({
          where: { id: actor.applicationId },
        }),
      ).toMatchObject({ status: 'DRAFT', version: actor.version });
      expect(
        await prisma.partnerApplicationSubmission.count({
          where: { applicationId: actor.applicationId },
        }),
      ).toBe(0);
      expect(
        await prisma.idempotencyRecord.count({ where: { key: requestKey } }),
      ).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: {
            actorUserId: actor.userId,
            action: 'PARTNER_APPLICATION_SUBMIT',
          },
        }),
      ).toBe(0);
      await submit(actor, requestKey).expect(200);
    },
  );
  it('reauthorizes after the guard and after auditing, including role activation', async () => {
    const actor = await login();
    await complete(actor);
    const service = app.get(PartnerApplicationSubmissionService);
    const original = service.submit.bind(service);
    const sessions = await prisma.partnerApplicantSession.findMany({
      where: { applicant: { userId: actor.userId } },
    });
    jest.spyOn(service, 'submit').mockImplementationOnce(async (...args) => {
      await prisma.partnerApplicantSession.update({
        where: { id: sessions[0].id },
        data: { revokedAt: new Date() },
      });
      return original(...args);
    });
    await submit(actor).expect(401);
    const roleActor = await login();
    await complete(roleActor);
    await prisma.userRole.create({
      data: {
        userId: roleActor.userId,
        roleCode: 'SUPER_ADMIN',
        campusId: null,
      },
    });
    await submit(roleActor).expect(409);
    const disabled = await login();
    await complete(disabled);
    await prisma.user.update({
      where: { id: disabled.userId },
      data: { status: 'DISABLED' },
    });
    await submit(disabled).expect(401);
  });
  it('rejects an expired session after audit and rolls back the entire action', async () => {
    const actor = await login();
    await complete(actor);
    // Session is locked by this transaction; inject expiration through its own client.
    const original = prisma.$transaction.bind(prisma);
    jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce(
        (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          original(
            async (tx) => {
              const audit = tx.auditLog.create.bind(tx.auditLog);
              tx.auditLog.create = (async (args: Prisma.AuditLogCreateArgs) => {
                const result = await audit(args);
                if (args.data.action === 'PARTNER_APPLICATION_SUBMIT')
                  await tx.partnerApplicantSession.updateMany({
                    where: { applicant: { userId: actor.userId } },
                    data: { expiresAt: new Date(Date.now() - 1000) },
                  });
                return result;
              }) as unknown as typeof tx.auditLog.create;
              return await callback(tx);
            },
            { timeout: 30_000 },
          ),
      );
    await submit(actor).expect(401);
    expect(
      await prisma.partnerApplicationSubmission.count({
        where: { applicationId: actor.applicationId },
      }),
    ).toBe(0);
    expect(
      await prisma.partnerApplication.findUniqueOrThrow({
        where: { id: actor.applicationId },
      }),
    ).toMatchObject({ status: 'DRAFT', version: actor.version });
  });
  it('denies formal bearer credentials and a reused key belonging to another applicant', async () => {
    const first = await login();
    await complete(first);
    const requestKey = randomUUID();
    await submit(first, requestKey).expect(200);
    const other = await login();
    await complete(other);
    await submit(other, requestKey).expect(409);
    await prisma.userRole.create({
      data: { userId: other.userId, roleCode: 'SUPER_ADMIN', campusId: null },
    });
    const formal = await app.get(AuthService).issueSessionForUser(other.userId);
    await request(server)
      .post(`${route}/submit`)
      .auth(formal.accessToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: other.version })
      .expect(401);
  });
  it('rejects malformed or identity-selecting requests and requires applicant credentials', async () => {
    const actor = await login();
    await request(server)
      .post(`${route}/submit`)
      .auth(actor.token, { type: 'bearer' })
      .send({ expectedVersion: 1 })
      .expect(400);
    await request(server)
      .post(`${route}/submit`)
      .auth(actor.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 1, applicationId: actor.applicationId })
      .expect(400);
    await request(server)
      .post(`${route}/submit`)
      .send({ expectedVersion: 1 })
      .expect(401);
    await request(server)
      .post('/partner-applicants/auth/logout')
      .auth(actor.token, { type: 'bearer' })
      .expect(200);
    await submit(actor).expect(401);
  });
});
