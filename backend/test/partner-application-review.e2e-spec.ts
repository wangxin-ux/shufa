import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { RoleCode, Prisma } from '@prisma/client';
import request from 'supertest';
import sharp from 'sharp';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { PartnerApplicationReviewService } from '../src/modules/partner-application/partner-application-review.service';
import { PartnerPrivateLocalAdapter } from '../src/modules/file/partner-private-local.adapter';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);
const own = '/partner-applicants/me/application';
const admin = '/management/partner-applications';
const data = <T>(res: { body: unknown }) => (res.body as { data: T }).data;
interface Actor {
  userId: string;
  token: string;
  applicationId: string;
  submissionId: string;
  version: number;
  files: string[];
}
const basics = {
  institutionName: '合成审核机构',
  province: '合成省',
  city: '合成市',
  district: '合成区',
  detailedAddress: '合成路1号',
  contactPhone: '000-00000000',
};
const bank = {
  bankName: '合成开户行',
  accountHolder: '合成对公户',
  accountNumber: '0000123456789',
};

describe('frozen review and rejected application resubmission', () => {
  const runTag = `preview-${randomUUID().slice(0, 8)}`;
  const key = randomBytes(32);
  const users: string[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let token: string;
  let reviewerId: string;
  let png: Buffer;
  let serial = 0;
  const staff = async (roles: RoleCode[] = ['SUPER_ADMIN']) => {
    const user = await prisma.user.create({
      data: {
        displayName: `${runTag}-审核员${++serial}`,
        roles: {
          create: roles.map((roleCode) => ({ roleCode, campusId: null })),
        },
      },
    });
    users.push(user.id);
    return {
      id: user.id,
      token: (await app.get(AuthService).issueSessionForUser(user.id))
        .accessToken,
    };
  };
  const applicant = async (): Promise<Actor> => {
    const session = data<{ token: string; me: { applicantId: string } }>(
      await request(server)
        .post('/partner-applicants/auth/wechat')
        .send({ code: `mock-wechat-login:${runTag}-${++serial}` })
        .expect(200),
    );
    const person = await prisma.partnerApplicant.findUniqueOrThrow({
      where: { id: session.me.applicantId },
    });
    users.push(person.userId);
    const initial = data<{ applicationId: string; version: number }>(
      await request(server)
        .put(`${own}/basic-information`)
        .auth(session.token, { type: 'bearer' })
        .send({ expectedVersion: 0, basicInformation: basics })
        .expect(200),
    );
    let version = data<{ version: number }>(
      await request(server)
        .put(`${own}/bank-information`)
        .auth(session.token, { type: 'bearer' })
        .send({ expectedVersion: initial.version, bankInformation: bank })
        .expect(200),
    ).version;
    const materials: Array<{ kind: string; storedFileId: string }> = [];
    for (const kind of [
      'BUSINESS_LICENSE',
      'INSTITUTION_LOGO',
      'LEGAL_ID_FRONT',
      'LEGAL_ID_BACK',
      'STORE_FRONT',
      'ENVIRONMENT',
    ]) {
      const upload = data<{ uploadId: string; storedFileId: string }>(
        await request(server)
          .post(`${own}/material-uploads`)
          .auth(session.token, { type: 'bearer' })
          .send({ expectedVersion: version, requestKey: randomUUID(), kind })
          .expect(200),
      );
      await request(server)
        .post(`${own}/material-uploads/${upload.uploadId}`)
        .auth(session.token, { type: 'bearer' })
        .attach('file', png, {
          filename: 'synthetic.png',
          contentType: 'image/png',
        })
        .expect(200);
      materials.push({ kind, storedFileId: upload.storedFileId });
      version = data<{ version: number }>(
        await request(server)
          .put(`${own}/materials`)
          .auth(session.token, { type: 'bearer' })
          .send({ expectedVersion: version, materials })
          .expect(200),
      ).version;
    }
    const submitted = data<{ submissionId: string; version: number }>(
      await request(server)
        .post(`${own}/submit`)
        .auth(session.token, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: version })
        .expect(200),
    );
    return {
      ...initial,
      ...submitted,
      userId: person.userId,
      token: session.token,
      files: materials.map((item) => item.storedFileId),
    };
  };
  const url = (a: Actor) =>
    `${admin}/${a.applicationId}/submissions/${a.submissionId}`;
  const reject = (
    a: Actor,
    requestKey = randomUUID(),
    reason = '请补充清晰门头',
    auth = token,
    expectedVersion = a.version,
  ) =>
    request(server)
      .post(`${url(a)}/reject`)
      .auth(auth, { type: 'bearer' })
      .set('Idempotency-Key', requestKey)
      .send({ expectedVersion, reason });
  const reopen = (
    a: Actor,
    requestKey = randomUUID(),
    version = a.version + 1,
  ) =>
    request(server)
      .post(`${own}/reopen`)
      .auth(a.token, { type: 'bearer' })
      .set('Idempotency-Key', requestKey)
      .send({ expectedVersion: version, submissionId: a.submissionId });
  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp((builder) =>
      builder
        .overrideProvider('PARTNER_APPLICANT_RATE_LIMIT')
        .useValue({ check: () => Promise.resolve() })
        .overrideProvider('PARTNER_APPLICATION_PRIVATE_KEY_RING')
        .useValue({
          current: () => ({ id: runTag, key }),
          get: (id: string) => (id === runTag ? key : undefined),
        })
        .overrideProvider('PARTNER_APPLICATION_MATERIAL_RUN_TAG')
        .useValue(runTag)
        .overrideProvider('PARTNER_APPLICATION_REGION_CATALOG')
        .useValue({
          version: 'synthetic-review-v1',
          matches: (p: string, c: string, d: string) =>
            p === basics.province && c === basics.city && d === basics.district,
        }),
    ));
    server = app.getHttpServer() as Server;
    png = await sharp({
      create: { width: 12, height: 8, channels: 3, background: '#f5d671' },
    })
      .png()
      .toBuffer();
    const reviewer = await staff();
    token = reviewer.token;
    reviewerId = reviewer.id;
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    try {
      if (prisma) {
        assertPartnerPdfTestTarget(process.env);
        await prisma.user.updateMany({
          where: {
            id: { in: users },
            OR: [
              { displayName: { startsWith: `${runTag}-` } },
              {
                authIdentities: {
                  some: { subject: { startsWith: `${runTag}-` } },
                },
              },
            ],
          },
          data: { status: 'DISABLED' },
        });
        process.stdout.write(
          `PARTNER_APPLICATION_REVIEW_FIXTURE_OWNERSHIP ${JSON.stringify({ runTag, userIds: users, disposition: 'owned synthetic users disabled; files and history retained' })}\n`,
        );
      }
    } finally {
      await app?.close();
    }
  });
  it('lists only necessary metadata with bounded pagination and frozen institution basics', async () => {
    const a = await applicant();
    const list = (
      await request(server)
        .get(admin)
        .query({
          query: basics.institutionName,
          status: 'SUBMITTED',
          pageSize: 1,
        })
        .auth(token, { type: 'bearer' })
        .expect(200)
    ).body as {
      data: Array<Record<string, unknown>>;
      meta: { pageSize: number };
    };
    expect(list.data).toHaveLength(1);
    expect(list.meta.pageSize).toBe(1);
    expect(JSON.stringify(list)).not.toContain(bank.accountNumber);
    expect(JSON.stringify(list)).not.toContain(basics.contactPhone);
    await request(server)
      .get(admin)
      .query({ pageSize: 101 })
      .auth(token, { type: 'bearer' })
      .expect(400);
    const detail = data<{
      basicInformation: typeof basics;
      materials: Array<{ storedFileId: string }>;
    }>(
      await request(server)
        .get(url(a))
        .auth(token, { type: 'bearer' })
        .expect(200),
    );
    expect(detail.basicInformation).toEqual(basics);
    expect(detail.materials.map((item) => item.storedFileId)).toEqual(a.files);
    expect(JSON.stringify(detail)).not.toContain(bank.accountNumber);
  });
  it('audits bank and image reads and returns no public paths', async () => {
    const a = await applicant();
    expect(
      data<{ bankInformation: typeof bank }>(
        await request(server)
          .get(`${url(a)}/bank-information`)
          .auth(token, { type: 'bearer' })
          .expect(200),
      ).bankInformation,
    ).toEqual(bank);
    const image = await request(server)
      .get(`${url(a)}/materials/${a.files[0]}/content`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(image.headers['cache-control']).toBe('no-store');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.body).toEqual(png);
    expect(
      await prisma.auditLog.count({
        where: {
          actorUserId: reviewerId,
          resourceId: a.applicationId,
          action: {
            in: [
              'PARTNER_APPLICATION_REVIEW_BANK_READ',
              'PARTNER_APPLICATION_REVIEW_MATERIAL_READ',
            ],
          },
        },
      }),
    ).toBe(2);
    await request(server)
      .get(`${url(a)}/materials/${randomUUID()}/content`)
      .auth(token, { type: 'bearer' })
      .expect(404);
  });
  it('rejects once, replays, derives a new draft, and preserves both immutable submissions', async () => {
    const a = await applicant();
    const original =
      await prisma.partnerApplicationSubmission.findUniqueOrThrow({
        where: { id: a.submissionId },
      });
    const rejectKey = randomUUID();
    const reopenKey = randomUUID();
    const rejected = data<Record<string, unknown>>(
      await reject(a, rejectKey).expect(200),
    );
    expect(rejected).toMatchObject({
      status: 'REJECTED',
      version: a.version + 1,
    });
    expect(data(await reject(a, rejectKey).expect(200))).toEqual(rejected);
    await reject(a, rejectKey, '不同原因').expect(409);
    await reject(a).expect(409);
    const history = data<{
      data: Array<{
        review: { reason: string; reviewedAt: string };
        submittedAt: string;
      }>;
    }>(
      await request(server)
        .get(`${own}/history`)
        .auth(a.token, { type: 'bearer' })
        .expect(200),
    );
    expect(history.data[0].review.reason).toBe('请补充清晰门头');
    expect(history.data[0].submittedAt).toBe(
      original.submittedAt.toISOString(),
    );
    const edited = data<{ version: number }>(
      await reopen(a, reopenKey).expect(200),
    );
    expect(edited.version).toBe(a.version + 2);
    expect(data(await reopen(a, reopenKey).expect(200))).toEqual(edited);
    await reopen(a).expect(409);
    const saved = data<{ version: number }>(
      await request(server)
        .put(`${own}/basic-information`)
        .auth(a.token, { type: 'bearer' })
        .send({
          expectedVersion: edited.version,
          basicInformation: { ...basics, institutionName: '补交合成机构' },
        })
        .expect(200),
    );
    await request(server)
      .post(`${own}/submit`)
      .auth(a.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: saved.version })
      .expect(200);
    expect(
      await prisma.partnerApplicationSubmission.findUniqueOrThrow({
        where: { id: a.submissionId },
      }),
    ).toEqual(original);
    const snapshots = await prisma.partnerApplicationSubmission.findMany({
      where: { applicationId: a.applicationId },
      orderBy: { applicationVersion: 'asc' },
    });
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].bankRecordId).toBe(original.bankRecordId);
    expect(snapshots[1].materialRecordId).toBe(original.materialRecordId);
    expect(
      data<{ basicInformation: typeof basics }>(
        await request(server)
          .get(url(a))
          .auth(token, { type: 'bearer' })
          .expect(200),
      ).basicInformation.institutionName,
    ).toBe(basics.institutionName);
    await reject({ ...a, version: saved.version + 1 }).expect(409);
  });
  it.each([
    ['HR'],
    ['FINANCE'],
    ['CAMPUS_MANAGER'],
    ['PARTNER'],
    ['SUPER_ADMIN', 'HR'],
  ] as RoleCode[][])(
    'denies roles %s across all review routes',
    async (...roles: RoleCode[]) => {
      const a = await applicant();
      const other = await staff(roles);
      for (const path of [
        admin,
        url(a),
        `${url(a)}/bank-information`,
        `${url(a)}/materials/${a.files[0]}/content`,
      ])
        await request(server)
          .get(path)
          .auth(other.token, { type: 'bearer' })
          .expect(403);
      await reject(a, randomUUID(), '补交原因', other.token).expect(403);
    },
  );
  it('denies self review, mismatched application/snapshot, and restricted tokens', async () => {
    const a = await applicant();
    const other = await applicant();
    await request(server)
      .get(url({ ...a, submissionId: other.submissionId }))
      .auth(token, { type: 'bearer' })
      .expect(404);
    await request(server)
      .get(admin)
      .auth(a.token, { type: 'bearer' })
      .expect(401);
    await prisma.userRole.create({
      data: { userId: a.userId, roleCode: 'SUPER_ADMIN', campusId: null },
    });
    const ownToken = (await app.get(AuthService).issueSessionForUser(a.userId))
      .accessToken;
    await request(server)
      .get(url(a))
      .auth(ownToken, { type: 'bearer' })
      .expect(403);
    await reject(a, randomUUID(), '自审原因', ownToken).expect(403);
    await reject(a).expect(409);
  });
  it('allows only one concurrent rejection and one concurrent reopening', async () => {
    const a = await applicant();
    const statuses = (await Promise.all([reject(a), reject(a)]))
      .map((res) => res.status)
      .sort();
    expect(statuses).toEqual([200, 409]);
    expect(
      (await Promise.all([reopen(a), reopen(a)]))
        .map((res) => res.status)
        .sort(),
    ).toEqual([200, 409]);
    expect(
      await prisma.auditLog.count({
        where: {
          resourceId: a.applicationId,
          action: 'PARTNER_APPLICATION_REJECT',
        },
      }),
    ).toBe(1);
  });
  it('requires a bounded nonblank reason, valid version, and a business key', async () => {
    const a = await applicant();
    for (const reason of ['', '  ', 'x'.repeat(1001)])
      await reject(a, randomUUID(), reason).expect(400);
    await reject(a, randomUUID(), '原因', token, a.version - 1).expect(409);
    await request(server)
      .post(`${url(a)}/reject`)
      .auth(token, { type: 'bearer' })
      .send({ expectedVersion: a.version, reason: '原因' })
      .expect(400);
    await reopen(a, randomUUID(), a.version).expect(409);
    await request(server)
      .get(`${own}/history`)
      .auth(token, { type: 'bearer' })
      .expect(401);
  });
  it.each(['detail', 'bank', 'image', 'reject', 'reopen'])(
    'fails closed and rolls back %s when access/write audit fails',
    async (operation) => {
      const a = await applicant();
      if (operation === 'reopen') await reject(a).expect(200);
      const requestKey = randomUUID();
      let injected = false;
      const original = prisma.$transaction.bind(prisma);
      const transaction = jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(
          (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
            original(
              async (tx) => {
                tx.auditLog.create = ((args: Prisma.AuditLogCreateArgs) => {
                  injected = true;
                  return Promise.reject(
                    new Error(
                      `synthetic review audit failure: ${String(args.data.action)}`,
                    ),
                  );
                }) as unknown as typeof tx.auditLog.create;
                return await callback(tx);
              },
              { timeout: 30_000 },
            ),
        );
      const response =
        operation === 'reject'
          ? await reject(a, requestKey).expect(500)
          : operation === 'reopen'
            ? await reopen(a, requestKey).expect(500)
            : await request(server)
                .get(
                  operation === 'bank'
                    ? `${url(a)}/bank-information`
                    : operation === 'image'
                      ? `${url(a)}/materials/${a.files[0]}/content`
                      : url(a),
                )
                .auth(token, { type: 'bearer' })
                .expect(500);
      transaction.mockRestore();
      expect(injected).toBe(true);
      expect(JSON.stringify(response.body)).not.toContain(bank.accountNumber);
      expect(
        await prisma.partnerApplication.findUniqueOrThrow({
          where: { id: a.applicationId },
        }),
      ).toMatchObject({
        status: operation === 'reopen' ? 'REJECTED' : 'SUBMITTED',
        version: a.version + (operation === 'reopen' ? 1 : 0),
      });
      expect(
        await prisma.idempotencyRecord.count({ where: { key: requestKey } }),
      ).toBe(0);
      if (operation === 'reject')
        expect(
          await prisma.partnerApplicationReview.count({
            where: { submissionId: a.submissionId },
          }),
        ).toBe(0);
    },
  );
  it.each(['bank', 'detail', 'reject'])(
    'reauthorizes reviewer role after %s audit before delivery/commit',
    async (operation) => {
      const a = await applicant();
      const reviewer = await staff();
      const original = prisma.$transaction.bind(prisma);
      jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce(
          (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
            original(
              async (tx) => {
                const audit = tx.auditLog.create.bind(tx.auditLog);
                tx.auditLog.create = (async (
                  args: Prisma.AuditLogCreateArgs,
                ) => {
                  const result = await audit(args);
                  await tx.userRole.deleteMany({
                    where: { userId: reviewer.id },
                  });
                  return result;
                }) as unknown as typeof tx.auditLog.create;
                return await callback(tx);
              },
              { timeout: 30_000 },
            ),
        );
      const response =
        operation === 'reject'
          ? await reject(a, randomUUID(), '补交原因', reviewer.token).expect(
              403,
            )
          : await request(server)
              .get(operation === 'bank' ? `${url(a)}/bank-information` : url(a))
              .auth(reviewer.token, { type: 'bearer' })
              .expect(403);
      expect(JSON.stringify(response.body)).not.toContain(bank.accountNumber);
      expect(
        await prisma.partnerApplication.findUniqueOrThrow({
          where: { id: a.applicationId },
        }),
      ).toMatchObject({ status: 'SUBMITTED', version: a.version });
    },
  );
  it('denies image delivery after reviewer disable during storage read', async () => {
    const a = await applicant();
    const reviewer = await staff();
    const adapter = app.get(PartnerPrivateLocalAdapter);
    const read = adapter.read.bind(adapter);
    jest.spyOn(adapter, 'read').mockImplementationOnce(async (path) => {
      const bytes = await read(path);
      await prisma.user.update({
        where: { id: reviewer.id },
        data: { status: 'DISABLED' },
      });
      return bytes;
    });
    await request(server)
      .get(`${url(a)}/materials/${a.files[0]}/content`)
      .auth(reviewer.token, { type: 'bearer' })
      .expect(401);
    expect(
      await prisma.auditLog.count({
        where: {
          actorUserId: reviewer.id,
          resourceId: a.applicationId,
          action: 'PARTNER_APPLICATION_REVIEW_MATERIAL_READ',
        },
      }),
    ).toBe(0);
  });
  it('reauthorizes after the HTTP guard and rejects cross-owner reopen', async () => {
    const a = await applicant();
    const reviewer = await staff();
    const service = app.get(PartnerApplicationReviewService);
    const original = service.detail.bind(service);
    jest.spyOn(service, 'detail').mockImplementationOnce(async (...args) => {
      await prisma.user.update({
        where: { id: reviewer.id },
        data: { status: 'DISABLED' },
      });
      return original(...args);
    });
    await request(server)
      .get(url(a))
      .auth(reviewer.token, { type: 'bearer' })
      .expect(401);
    await reject(a).expect(200);
    const other = await applicant();
    await reopen({ ...a, token: other.token }).expect(409);
    await prisma.partnerApplicantSession.updateMany({
      where: { applicant: { userId: a.userId } },
      data: { revokedAt: new Date() },
    });
    await reopen(a).expect(401);
    await request(server)
      .get(`${own}/history`)
      .auth(a.token, { type: 'bearer' })
      .expect(401);
  });
  it('protects review rows from update/delete and records reviewer and version', async () => {
    const a = await applicant();
    await reject(a).expect(200);
    const review = await prisma.partnerApplicationReview.findUniqueOrThrow({
      where: { submissionId: a.submissionId },
    });
    expect(review).toMatchObject({
      reviewerUserId: reviewerId,
      sourceVersion: a.version,
      resultingVersion: a.version + 1,
      reason: '请补充清晰门头',
    });
    await expect(
      prisma.partnerApplicationReview.update({
        where: { id: review.id },
        data: { reason: '覆盖历史' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.partnerApplicationReview.delete({ where: { id: review.id } }),
    ).rejects.toThrow();
  });
  it('keeps old bank and image bytes after replacing them in a resubmitted draft', async () => {
    const a = await applicant();
    await reject(a).expect(200);
    let version = data<{ version: number }>(
      await reopen(a).expect(200),
    ).version;
    const newerBank = { ...bank, accountNumber: '00000987654321' };
    version = data<{ version: number }>(
      await request(server)
        .put(`${own}/bank-information`)
        .auth(a.token, { type: 'bearer' })
        .send({ expectedVersion: version, bankInformation: newerBank })
        .expect(200),
    ).version;
    const replacement = await sharp({
      create: { width: 14, height: 10, channels: 3, background: '#207759' },
    })
      .png()
      .toBuffer();
    const upload = data<{ uploadId: string; storedFileId: string }>(
      await request(server)
        .post(`${own}/material-uploads`)
        .auth(a.token, { type: 'bearer' })
        .send({
          expectedVersion: version,
          requestKey: randomUUID(),
          kind: 'STORE_FRONT',
        })
        .expect(200),
    );
    await request(server)
      .post(`${own}/material-uploads/${upload.uploadId}`)
      .auth(a.token, { type: 'bearer' })
      .attach('file', replacement, {
        filename: 'synthetic.png',
        contentType: 'image/png',
      })
      .expect(200);
    const current = data<{
      materials: Array<{ kind: string; storedFileId: string }>;
    }>(
      await request(server)
        .get(`${own}/materials`)
        .auth(a.token, { type: 'bearer' })
        .expect(200),
    );
    const references = current.materials.map(({ kind, storedFileId }) => ({
      kind,
      storedFileId: kind === 'STORE_FRONT' ? upload.storedFileId : storedFileId,
    }));
    version = data<{ version: number }>(
      await request(server)
        .put(`${own}/materials`)
        .auth(a.token, { type: 'bearer' })
        .send({ expectedVersion: version, materials: references })
        .expect(200),
    ).version;
    const submitted = data<{ submissionId: string; version: number }>(
      await request(server)
        .post(`${own}/submit`)
        .auth(a.token, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: version })
        .expect(200),
    );
    expect(
      data<{ bankInformation: typeof bank }>(
        await request(server)
          .get(`${url(a)}/bank-information`)
          .auth(token, { type: 'bearer' })
          .expect(200),
      ).bankInformation,
    ).toEqual(bank);
    expect(
      data<{ bankInformation: typeof bank }>(
        await request(server)
          .get(`${url({ ...a, ...submitted })}/bank-information`)
          .auth(token, { type: 'bearer' })
          .expect(200),
      ).bankInformation,
    ).toEqual(newerBank);
    expect(
      (
        await request(server)
          .get(`${url(a)}/materials/${a.files[4]}/content`)
          .auth(token, { type: 'bearer' })
          .expect(200)
      ).body,
    ).toEqual(png);
    expect(
      (
        await request(server)
          .get(
            `${url({ ...a, ...submitted })}/materials/${upload.storedFileId}/content`,
          )
          .auth(token, { type: 'bearer' })
          .expect(200)
      ).body,
    ).toEqual(replacement);
    await request(server)
      .get(`${url(a)}/materials/${upload.storedFileId}/content`)
      .auth(token, { type: 'bearer' })
      .expect(404);
    await request(server)
      .get(`${url({ ...a, ...submitted })}/materials/${a.files[4]}/content`)
      .auth(token, { type: 'bearer' })
      .expect(404);
  });
  it('replays same-key concurrent rejection and reopening only once', async () => {
    const a = await applicant();
    const rejectKey = randomUUID();
    const reopenKey = randomUUID();
    const rejected = await Promise.all([
      reject(a, rejectKey),
      reject(a, rejectKey),
    ]);
    expect(rejected.map((res) => res.status)).toEqual([200, 200]);
    expect(data(rejected[0])).toEqual(data(rejected[1]));
    const other = await staff();
    await reject(a, rejectKey, '请补充清晰门头', other.token).expect(409);
    const drafts = await Promise.all([
      reopen(a, reopenKey),
      reopen(a, reopenKey),
    ]);
    expect(drafts.map((res) => res.status)).toEqual([200, 200]);
    expect(data(drafts[0])).toEqual(data(drafts[1]));
    expect(
      await prisma.auditLog.count({
        where: {
          resourceId: a.applicationId,
          action: 'PARTNER_APPLICATION_REOPEN',
        },
      }),
    ).toBe(1);
    await reopen(a, reopenKey, a.version).expect(409);
  });
  it.each(['reject', 'reopen'])(
    'rolls back %s when idempotency completion fails',
    async (operation) => {
      const a = await applicant();
      if (operation === 'reopen') await reject(a).expect(200);
      const requestKey = randomUUID();
      const spy = jest
        .spyOn(app.get(IdempotencyService), 'complete')
        .mockRejectedValueOnce(
          new Error('synthetic idempotency completion failure'),
        );
      if (operation === 'reject') await reject(a, requestKey).expect(500);
      else await reopen(a, requestKey).expect(500);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
      expect(
        await prisma.partnerApplication.findUniqueOrThrow({
          where: { id: a.applicationId },
        }),
      ).toMatchObject({
        status: operation === 'reject' ? 'SUBMITTED' : 'REJECTED',
        version: a.version + (operation === 'reopen' ? 1 : 0),
        editSourceSubmissionId: null,
      });
      expect(
        await prisma.idempotencyRecord.count({ where: { key: requestKey } }),
      ).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: {
            resourceId: a.applicationId,
            action:
              operation === 'reject'
                ? 'PARTNER_APPLICATION_REJECT'
                : 'PARTNER_APPLICATION_REOPEN',
          },
        }),
      ).toBe(0);
      if (operation === 'reject') await reject(a, requestKey).expect(200);
      else await reopen(a, requestKey).expect(200);
    },
  );
  it('rolls back reopening when applicant session expires after its audit', async () => {
    const a = await applicant();
    await reject(a).expect(200);
    const original = prisma.$transaction.bind(prisma);
    let injected = false;
    const transaction = jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce(
        (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          original(
            async (tx) => {
              const audit = tx.auditLog.create.bind(tx.auditLog);
              tx.auditLog.create = (async (args: Prisma.AuditLogCreateArgs) => {
                const result = await audit(args);
                injected = true;
                await tx.partnerApplicantSession.updateMany({
                  where: { applicant: { userId: a.userId } },
                  data: { expiresAt: new Date(Date.now() - 1000) },
                });
                return result;
              }) as unknown as typeof tx.auditLog.create;
              return await callback(tx);
            },
            { timeout: 30_000 },
          ),
      );
    await reopen(a).expect(401);
    transaction.mockRestore();
    expect(injected).toBe(true);
    expect(
      await prisma.partnerApplication.findUniqueOrThrow({
        where: { id: a.applicationId },
      }),
    ).toMatchObject({
      status: 'REJECTED',
      version: a.version + 1,
      editSourceSubmissionId: null,
    });
    await reopen(a).expect(200);
  });
});
