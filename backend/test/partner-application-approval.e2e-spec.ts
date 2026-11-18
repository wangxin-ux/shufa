import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { Prisma, RoleCode } from '@prisma/client';
import request from 'supertest';
import sharp from 'sharp';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';
import { PartnerApplicationReviewService } from '../src/modules/partner-application/partner-application-review.service';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);
const own = '/partner-applicants/me/application';
const base = '/management/partner-applications';
const value = <T>(response: { body: unknown }) =>
  (response.body as { data: T }).data;
interface Applicant {
  userId: string;
  token: string;
  code: string;
  applicationId: string;
  submissionId: string;
  version: number;
}
interface Receipt {
  applicationId: string;
  submissionId: string;
  reviewId: string;
  campusId: string;
  userId: string;
  status: string;
  version: number;
  reviewedAt: string;
}
const basics = {
  institutionName: '合成批准机构',
  province: '合成省',
  city: '合成市',
  district: '合成区',
  detailedAddress: '合成路2号',
  contactPhone: '000-00000000',
};

describe('same-identity partner approval and managed account activation', () => {
  const runTag = `papprove-${randomUUID().slice(0, 8)}`;
  const key = randomBytes(32);
  const users: string[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let adminToken: string;
  let png: Buffer;
  let serial = 0;
  const staff = async (
    roleCodes: RoleCode[] = ['SUPER_ADMIN'],
    id?: string,
  ) => {
    const user = await prisma.user.create({
      data: {
        ...(id ? { id } : {}),
        displayName: `${runTag}-总端${++serial}`,
        roles: {
          create: roleCodes.map((roleCode) => ({ roleCode, campusId: null })),
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
  const applicant = async (id?: string): Promise<Applicant> => {
    const code = `mock-wechat-login:${runTag}-${++serial}`;
    if (id) {
      await prisma.user.create({
        data: {
          id,
          displayName: `${runTag}-申请人${serial}`,
          authIdentities: {
            create: {
              provider: 'WECHAT',
              subject: code.slice('mock-wechat-login:'.length),
            },
          },
          partnerApplicant: { create: {} },
        },
      });
      users.push(id);
    }
    const session = value<{ token: string; me: { applicantId: string } }>(
      await request(server)
        .post('/partner-applicants/auth/wechat')
        .send({ code })
        .expect(200),
    );
    const person = await prisma.partnerApplicant.findUniqueOrThrow({
      where: { id: session.me.applicantId },
    });
    if (!id) users.push(person.userId);
    await prisma.user.update({
      where: { id: person.userId },
      data: { displayName: `${runTag}-申请人${serial}` },
    });
    const initial = value<{ applicationId: string; version: number }>(
      await request(server)
        .put(`${own}/basic-information`)
        .auth(session.token, { type: 'bearer' })
        .send({ expectedVersion: 0, basicInformation: basics })
        .expect(200),
    );
    let version = value<{ version: number }>(
      await request(server)
        .put(`${own}/bank-information`)
        .auth(session.token, { type: 'bearer' })
        .send({
          expectedVersion: initial.version,
          bankInformation: {
            bankName: '合成银行',
            accountHolder: '合成账户',
            accountNumber: '0000123456789',
          },
        })
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
      const upload = value<{ uploadId: string; storedFileId: string }>(
        await request(server)
          .post(`${own}/material-uploads`)
          .auth(session.token, { type: 'bearer' })
          .send({ expectedVersion: version, kind, requestKey: randomUUID() })
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
      version = value<{ version: number }>(
        await request(server)
          .put(`${own}/materials`)
          .auth(session.token, { type: 'bearer' })
          .send({ expectedVersion: version, materials })
          .expect(200),
      ).version;
    }
    const submitted = value<{ submissionId: string; version: number }>(
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
      code,
      token: session.token,
    };
  };
  const url = (a: Applicant) =>
    `${base}/${a.applicationId}/submissions/${a.submissionId}`;
  const approve = (
    a: Applicant,
    requestKey = randomUUID(),
    token = adminToken,
    version = a.version,
  ) =>
    request(server)
      .post(`${url(a)}/approve`)
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', requestKey)
      .send({ expectedVersion: version });
  const get = (path: string, token: string) =>
    request(server).get(path).auth(token, { type: 'bearer' });
  const state = (a: Applicant) =>
    prisma.partnerApplication.findUniqueOrThrow({
      where: { id: a.applicationId },
    });
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
          version: 'synthetic-approval-v1',
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
    adminToken = (await staff()).token;
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
          `PARTNER_APPLICATION_APPROVAL_FIXTURE_OWNERSHIP ${JSON.stringify({
            runTag,
            userIds: users,
            disposition:
              'owned synthetic users disabled; campuses, materials and history retained',
          })}\n`,
        );
      }
    } finally {
      await app?.close();
    }
  });
  it('approves the frozen version once using the original User and a new non-public campus', async () => {
    const a = await applicant();
    const requestKey = randomUUID();
    await request(server)
      .post('/auth/wechat/login')
      .send({ code: a.code })
      .expect(401);
    const original =
      await prisma.partnerApplicationSubmission.findUniqueOrThrow({
        where: { id: a.submissionId },
      });
    const receipt = value<Receipt>(await approve(a, requestKey).expect(200));
    expect(receipt).toMatchObject({
      applicationId: a.applicationId,
      submissionId: a.submissionId,
      userId: a.userId,
      status: 'APPROVED',
      version: a.version + 1,
    });
    expect(value<Receipt>(await approve(a, requestKey).expect(200))).toEqual(
      receipt,
    );
    expect(await state(a)).toMatchObject({
      status: 'APPROVED',
      version: a.version + 1,
    });
    expect(
      await prisma.userRole.findMany({ where: { userId: a.userId } }),
    ).toMatchObject([{ roleCode: 'PARTNER', campusId: receipt.campusId }]);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: a.userId } }),
    ).toMatchObject({ staffPhone: null, accountVersion: 2 });
    expect(
      await prisma.campus.findUniqueOrThrow({
        where: { id: receipt.campusId },
      }),
    ).toMatchObject({
      name: basics.institutionName,
      address: basics.detailedAddress,
      contactPhone: basics.contactPhone,
      mapVisible: false,
      latitude: null,
      longitude: null,
    });
    expect(
      await prisma.partnerApplicationSubmission.findUniqueOrThrow({
        where: { id: a.submissionId },
      }),
    ).toEqual(original);
    const approved = await prisma.$queryRaw<
      Array<{ userId: string; campusId: string }>
    >`
      SELECT "userId", "campusId" FROM "PartnerApplicationApproval" WHERE "submissionId" = ${a.submissionId}::uuid`;
    expect(approved).toEqual([
      { userId: a.userId, campusId: receipt.campusId },
    ]);
    expect(
      await prisma.authIdentity.count({
        where: { userId: a.userId, provider: 'WECHAT' },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'PARTNER_APPLICATION_APPROVE',
          resourceId: a.applicationId,
        },
      }),
    ).toBe(1);
    await approve(a).expect(409);
  });
  it('requires active headquarters review authority, forbids self review, and validates the exact snapshot/version', async () => {
    const a = await applicant();
    await approve(a, randomUUID(), a.token).expect(401);
    for (const roles of [
      ['HR'],
      ['FINANCE'],
      ['SUPER_ADMIN', 'HR'],
    ] as RoleCode[][]) {
      await approve(a, randomUUID(), (await staff(roles)).token).expect(403);
    }
    await approve({ ...a, submissionId: randomUUID() }).expect(404);
    await approve(a, randomUUID(), adminToken, a.version - 1).expect(409);
    await prisma.userRole.create({
      data: { userId: a.userId, roleCode: 'SUPER_ADMIN', campusId: null },
    });
    const selfToken = (await app.get(AuthService).issueSessionForUser(a.userId))
      .accessToken;
    await approve(a, randomUUID(), selfToken).expect(403);
    expect(await state(a)).toMatchObject({
      status: 'SUBMITTED',
      version: a.version,
    });
  });
  it('creates only one campus/role under same-key and different-key concurrent approvals', async () => {
    for (const sameKey of [true, false]) {
      const a = await applicant();
      const k = randomUUID();
      const responses = await Promise.all([
        approve(a, k),
        approve(a, sameKey ? k : randomUUID()),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual(
        sameKey ? [200, 200] : [200, 409],
      );
      if (sameKey)
        expect(value<Receipt>(responses[0])).toEqual(
          value<Receipt>(responses[1]),
        );
      expect(await prisma.userRole.count({ where: { userId: a.userId } })).toBe(
        1,
      );
      expect(
        await prisma.partnerApplicationReview.count({
          where: { submissionId: a.submissionId },
        }),
      ).toBe(1);
    }
  });
  it('serializes approval against rejection without partial activation', async () => {
    const a = await applicant();
    const responses = await Promise.all([
      approve(a),
      request(server)
        .post(`${url(a)}/reject`)
        .auth(adminToken, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: a.version, reason: '合成驳回' }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.userRole.count({ where: { userId: a.userId } })).toBe(
      responses[0].status === 200 ? 1 : 0,
    );
    expect(
      await prisma.partnerApplicationReview.count({
        where: { submissionId: a.submissionId },
      }),
    ).toBe(1);
  });
  it.each(['reject', 'status', 'unbind'] as const)(
    'uses one User lock order for approval and %s with a reviewer-first UUID',
    async (operation) => {
      const reviewer = await staff(
        ['SUPER_ADMIN'],
        `00000000-0000-4000-8000-${randomUUID().slice(-12)}`,
      );
      const a = await applicant(
        `ffffffff-ffff-4fff-bfff-${randomUUID().slice(-12)}`,
      );
      const approvalKey = randomUUID();
      if (operation !== 'reject')
        await approve(a, approvalKey, reviewer.token).expect(200);
      let entered!: (pid: number) => void;
      let resume!: () => void;
      const firstPid = new Promise<number>((yes) => {
        entered = yes;
      });
      const paused = new Promise<void>((yes) => {
        resume = yes;
      });
      const service = app.get(IdempotencyService);
      const claim = service.claim.bind(service);
      let fired = false;
      jest.spyOn(service, 'claim').mockImplementationOnce(async (tx, input) => {
        const [pid] = await tx.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid() AS pid`;
        fired = true;
        entered(pid.pid);
        await paused;
        return claim(tx, input);
      });
      const mutationKey = randomUUID();
      const first = (
        operation === 'reject'
          ? request(server)
              .post(`${url(a)}/reject`)
              .send({ expectedVersion: a.version, reason: '合成并发驳回' })
          : operation === 'status'
            ? request(server)
                .patch(`/management/staff-accounts/${a.userId}/status`)
                .send({ expectedVersion: 2, status: 'DISABLED' })
            : request(server)
                .post(`/management/staff-accounts/${a.userId}/unbind-wechat`)
                .send({ expectedVersion: 2 })
      )
        .auth(reviewer.token, { type: 'bearer' })
        .set('Idempotency-Key', mutationKey)
        .then((response) => response);
      const pid = await Promise.race([
        firstPid,
        first.then(() => {
          throw new Error('Mutation did not reach the lock barrier');
        }),
      ]);
      const second = approve(a, approvalKey, reviewer.token).then(
        (response) => response,
      );
      let blocked = false;
      try {
        for (let attempt = 0; attempt < 100; ++attempt) {
          const [waiting] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
            SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity
              WHERE ${pid} = ANY(pg_blocking_pids(pid))
                AND wait_event_type = 'Lock'
            ) AS blocked`;
          if (waiting.blocked) {
            blocked = true;
            break;
          }
          await new Promise<void>((yes) => setTimeout(yes, 10));
        }
      } finally {
        resume();
      }
      const responses = await Promise.all([first, second]);
      expect(fired).toBe(true);
      expect(blocked).toBe(true);
      expect(responses.map((response) => response.status)).toEqual(
        operation === 'unbind' ? [409, 200] : [200, 409],
      );
      expect(await state(a)).toMatchObject({
        status: operation === 'reject' ? 'REJECTED' : 'APPROVED',
        version: a.version + 1,
      });
      expect(
        await prisma.partnerApplicationReview.count({
          where: { submissionId: a.submissionId },
        }),
      ).toBe(1);
      expect(await prisma.userRole.count({ where: { userId: a.userId } })).toBe(
        operation === 'reject' ? 0 : 1,
      );
      expect(
        await prisma.user.findUniqueOrThrow({ where: { id: a.userId } }),
      ).toMatchObject({
        status: operation === 'status' ? 'DISABLED' : 'ACTIVE',
        accountVersion:
          operation === 'reject' ? 1 : operation === 'status' ? 3 : 2,
      });
    },
  );
  it('makes the approved phone-less account searchable and manageable but cannot unbind its sole login identity', async () => {
    const a = await applicant();
    await approve(a).expect(200);
    const list = value<
      Array<{ id: string; maskedPhone: string; version: number }>
    >(
      await get(
        `/management/staff-accounts?query=${encodeURIComponent(basics.institutionName)}&pageSize=100`,
        adminToken,
      ).expect(200),
    );
    const account = list.find((row) => row.id === a.userId);
    expect(account).toMatchObject({
      maskedPhone: '未绑定个人手机号',
      version: 2,
    });
    await request(server)
      .post(`/management/staff-accounts/${a.userId}/unbind-wechat`)
      .auth(adminToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 2 })
      .expect(409);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: a.userId } }),
    ).toMatchObject({ accountVersion: 2 });
    expect(
      await prisma.auditLog.count({
        where: { resourceId: a.userId, action: 'STAFF_ACCOUNT_WECHAT_UNBIND' },
      }),
    ).toBe(0);
    expect(
      await prisma.authIdentity.count({
        where: { userId: a.userId, provider: 'WECHAT' },
      }),
    ).toBe(1);
    const login = value<{
      accessToken: string;
      me: { userId: string; roles: unknown[] };
    }>(
      await request(server)
        .post('/auth/wechat/login')
        .send({ code: a.code })
        .expect(200),
    );
    expect(login.me.userId).toBe(a.userId);
    expect(login.me.roles).toHaveLength(1);
    await get('/partners/me/profile', a.token).expect(401);
    await get('/partners/me/profile', login.accessToken).expect(200);
    await get(`${own}/history`, a.token).expect(200);
    await request(server)
      .put(`${own}/basic-information`)
      .auth(a.token, { type: 'bearer' })
      .send({ expectedVersion: a.version + 1, basicInformation: basics })
      .expect(409);
    await request(server)
      .patch(`/management/staff-accounts/${a.userId}/status`)
      .auth(adminToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 2, status: 'DISABLED' })
      .expect(200);
    await get('/partners/me/profile', login.accessToken).expect(401);
    await get(own, a.token).expect(401);
    await request(server)
      .post('/auth/wechat/login')
      .send({ code: a.code })
      .expect(401);
    const reenableKey = randomUUID();
    const reenable = () =>
      request(server)
        .patch(`/management/staff-accounts/${a.userId}/status`)
        .auth(adminToken, { type: 'bearer' })
        .set('Idempotency-Key', reenableKey)
        .send({ expectedVersion: 3, status: 'ACTIVE' });
    expect(
      value<{ version: number }>(await reenable().expect(200)).version,
    ).toBe(4);
    expect(
      value<{ version: number }>(await reenable().expect(200)).version,
    ).toBe(4);
    await request(server)
      .post('/auth/wechat/login')
      .send({ code: a.code })
      .expect(200);
  });
  it('fails closed for disabled applicants, missing identity, or an existing formal role', async () => {
    for (const scenario of ['disabled', 'identity', 'role']) {
      const a = await applicant();
      if (scenario === 'disabled')
        await prisma.user.update({
          where: { id: a.userId },
          data: { status: 'DISABLED' },
        });
      if (scenario === 'identity')
        await prisma.authIdentity.deleteMany({
          where: { userId: a.userId, provider: 'WECHAT' },
        });
      if (scenario === 'role')
        await prisma.userRole.create({
          data: { userId: a.userId, roleCode: 'HR', campusId: null },
        });
      await approve(a).expect(409);
      expect(await state(a)).toMatchObject({
        status: 'SUBMITTED',
        version: a.version,
      });
      expect(
        await prisma.partnerApplicationReview.count({
          where: { submissionId: a.submissionId },
        }),
      ).toBe(0);
    }
  });
  const unchanged = async (
    a: Applicant,
    requestKey: string,
    campusCount: number,
  ) => {
    expect(await state(a)).toMatchObject({
      status: 'SUBMITTED',
      version: a.version,
    });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: a.userId } }),
    ).toMatchObject({ status: 'ACTIVE', accountVersion: 1 });
    expect(await prisma.userRole.count({ where: { userId: a.userId } })).toBe(
      0,
    );
    expect(
      await prisma.partnerApplicationApproval.count({
        where: { userId: a.userId },
      }),
    ).toBe(0);
    expect(
      await prisma.partnerApplicationReview.count({
        where: { submissionId: a.submissionId },
      }),
    ).toBe(0);
    expect(
      await prisma.campus.count({ where: { code: { startsWith: 'PA-' } } }),
    ).toBe(campusCount);
    expect(
      await prisma.auditLog.count({
        where: {
          resourceId: a.applicationId,
          action: 'PARTNER_APPLICATION_APPROVE',
        },
      }),
    ).toBe(0);
    expect(
      await prisma.idempotencyRecord.count({ where: { key: requestKey } }),
    ).toBe(0);
  };
  it.each([
    ['campus', 'create'],
    ['user', 'updateMany'],
    ['userRole', 'create'],
    ['partnerApplicationReview', 'create'],
    ['partnerApplicationApproval', 'create'],
    ['partnerApplication', 'update'],
    ['auditLog', 'create'],
  ] as const)(
    'fully rolls back after the real %s.%s write fails',
    async (model, method) => {
      const a = await applicant();
      const requestKey = randomUUID();
      const campuses = await prisma.campus.count({
        where: { code: { startsWith: 'PA-' } },
      });
      let fired = false;
      const transact = prisma.$transaction.bind(prisma);
      const hook = jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce(
          (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
            transact(
              async (tx) => {
                const delegate = tx[model] as unknown as Record<
                  string,
                  (...args: unknown[]) => Promise<unknown>
                >;
                const original = delegate[method].bind(delegate);
                delegate[method] = async (...args) => {
                  await original(...args);
                  fired = true;
                  throw new Error('synthetic approval post-write failure');
                };
                return callback(tx);
              },
              { timeout: 30_000 },
            ),
        );
      await approve(a, requestKey).expect(500);
      hook.mockRestore();
      expect(fired).toBe(true);
      await unchanged(a, requestKey, campuses);
      await approve(a, requestKey).expect(200);
    },
  );
  it('rolls back even after idempotency completion has written its successful receipt', async () => {
    const a = await applicant();
    const requestKey = randomUUID();
    const campuses = await prisma.campus.count({
      where: { code: { startsWith: 'PA-' } },
    });
    const idempotency = app.get(IdempotencyService);
    const original = idempotency.complete.bind(idempotency);
    let fired = false;
    const hook = jest
      .spyOn(idempotency, 'complete')
      .mockImplementationOnce(async (...args) => {
        await original(...args);
        fired = true;
        throw new Error('synthetic receipt completion failure');
      });
    await approve(a, requestKey).expect(500);
    hook.mockRestore();
    expect(fired).toBe(true);
    await unchanged(a, requestKey, campuses);
    await approve(a, requestKey).expect(200);
  });
  it.each([
    'reviewer-role',
    'reviewer-status',
    'applicant-status',
    'identity',
  ] as const)(
    'checks %s again after audit and rolls back in-flight mutation',
    async (scenario) => {
      const a = await applicant();
      const reviewer = await staff();
      const requestKey = randomUUID();
      const campuses = await prisma.campus.count({
        where: { code: { startsWith: 'PA-' } },
      });
      let fired = false;
      const transact = prisma.$transaction.bind(prisma);
      const hook = jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce(
          (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
            transact(
              async (tx) => {
                const create = tx.auditLog.create.bind(tx.auditLog);
                tx.auditLog.create = (async (
                  input: Prisma.AuditLogCreateArgs,
                ) => {
                  const result = await create(input);
                  if (scenario === 'reviewer-role')
                    await tx.userRole.deleteMany({
                      where: { userId: reviewer.id },
                    });
                  if (scenario === 'reviewer-status')
                    await tx.user.update({
                      where: { id: reviewer.id },
                      data: { status: 'DISABLED' },
                    });
                  if (scenario === 'applicant-status')
                    await tx.user.update({
                      where: { id: a.userId },
                      data: { status: 'DISABLED' },
                    });
                  if (scenario === 'identity')
                    await tx.authIdentity.updateMany({
                      where: { userId: a.userId, provider: 'WECHAT' },
                      data: { subject: `${runTag}-moved-${randomUUID()}` },
                    });
                  fired = true;
                  return result;
                }) as unknown as typeof tx.auditLog.create;
                return callback(tx);
              },
              { timeout: 30_000 },
            ),
        );
      await approve(a, requestKey, reviewer.token).expect(
        scenario === 'reviewer-role'
          ? 403
          : scenario === 'reviewer-status'
            ? 401
            : 409,
      );
      hook.mockRestore();
      expect(fired).toBe(true);
      await unchanged(a, requestKey, campuses);
    },
  );
  it('rechecks reviewer authority after the HTTP guard', async () => {
    const a = await applicant();
    const reviewer = await staff();
    const service = app.get(PartnerApplicationReviewService);
    const original = service.approve.bind(service);
    let fired = false;
    jest.spyOn(service, 'approve').mockImplementationOnce(async (...args) => {
      await prisma.user.update({
        where: { id: reviewer.id },
        data: { status: 'DISABLED' },
      });
      fired = true;
      return original(...args);
    });
    await approve(a, randomUUID(), reviewer.token).expect(401);
    expect(fired).toBe(true);
    expect(await state(a)).toMatchObject({
      status: 'SUBMITTED',
      version: a.version,
    });
  });
  it('does not merge same-name institutions or allow a replay with another actor or payload', async () => {
    const a = await applicant();
    const b = await applicant();
    const requestKey = randomUUID();
    const first = value<Receipt>(await approve(a, requestKey).expect(200));
    const second = value<Receipt>(await approve(b).expect(200));
    expect(first.campusId).not.toBe(second.campusId);
    expect(first.userId).not.toBe(second.userId);
    const login = value<{ accessToken: string }>(
      await request(server)
        .post('/auth/wechat/login')
        .send({ code: a.code })
        .expect(200),
    );
    const profile = value<{ campus: { id: string } }>(
      await get(
        `/partners/me/profile?campusId=${second.campusId}`,
        login.accessToken,
      ).expect(200),
    );
    expect(profile.campus.id).toBe(first.campusId);
    await get(base, login.accessToken).expect(403);
    await approve(a, requestKey, adminToken, a.version + 1).expect(409);
    await approve(a, requestKey, (await staff()).token).expect(409);
    expect(
      await prisma.partnerApplicationApproval.count({
        where: { userId: a.userId },
      }),
    ).toBe(1);
  });
  it('preserves immutable approval associations, private snapshots, and frozen campus input', async () => {
    const a = await applicant();
    await prisma.partnerApplication.update({
      where: { id: a.applicationId },
      data: {
        institutionName: '不同当前名称',
        contactPhone: '000-11111111',
        detailedAddress: '不同当前地址',
      },
    });
    const approved = value<Receipt>(await approve(a).expect(200));
    expect(
      await prisma.campus.findUniqueOrThrow({
        where: { id: approved.campusId },
      }),
    ).toMatchObject({
      name: basics.institutionName,
      contactPhone: basics.contactPhone,
      address: basics.detailedAddress,
    });
    const association =
      await prisma.partnerApplicationApproval.findUniqueOrThrow({
        where: { userId: a.userId },
      });
    await expect(
      prisma.partnerApplicationApproval.update({
        where: { id: association.id },
        data: { campusId: randomUUID() },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.partnerApplicationApproval.delete({
        where: { id: association.id },
      }),
    ).rejects.toThrow();
    const receipt = await get(`${own}/history`, a.token).expect(200);
    expect(JSON.stringify(receipt.body)).not.toContain(approved.campusId);
    expect(JSON.stringify(receipt.body)).not.toContain('0000123456789');
    await request(server)
      .post(`${own}/reopen`)
      .auth(a.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: a.version + 1, submissionId: a.submissionId })
      .expect(409);
  });
  it('validates required key, closed body, malformed UUID, and version maximum before activation', async () => {
    const a = await applicant();
    await request(server)
      .post(`${url(a)}/approve`)
      .auth(adminToken, { type: 'bearer' })
      .send({ expectedVersion: a.version })
      .expect(400);
    for (const body of [
      { expectedVersion: 0 },
      { expectedVersion: 1.5 },
      { expectedVersion: 2147483648 },
      { expectedVersion: a.version, campusId: randomUUID() },
    ]) {
      await request(server)
        .post(`${url(a)}/approve`)
        .auth(adminToken, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send(body)
        .expect(400);
    }
    await approve({ ...a, applicationId: 'not-a-uuid' }).expect(400);
    expect(await state(a)).toMatchObject({
      status: 'SUBMITTED',
      version: a.version,
    });
  });
  it('keeps phone-backed staff management compatible and refuses unrelated no-phone accounts', async () => {
    const a = await applicant();
    const receipt = value<Receipt>(await approve(a).expect(200));
    const phone = `+86139${randomBytes(4).readUInt32BE().toString().padStart(8, '0').slice(-8)}`;
    const ordinary = await prisma.user.create({
      data: {
        displayName: `${runTag}-原工作人员`,
        staffPhone: phone,
        roles: { create: { roleCode: 'PARTNER', campusId: receipt.campusId } },
        authIdentities: {
          create: {
            provider: 'WECHAT',
            subject: `${runTag}-ordinary-${randomUUID()}`,
          },
        },
      },
    });
    users.push(ordinary.id);
    const unrelated = await prisma.user.create({
      data: {
        displayName: `${runTag}-无来源账号`,
        roles: { create: { roleCode: 'PARTNER', campusId: receipt.campusId } },
      },
    });
    users.push(unrelated.id);
    const rows = value<Array<{ id: string; maskedPhone: string }>>(
      await get(
        `/management/staff-accounts?query=${runTag}&pageSize=100`,
        adminToken,
      ).expect(200),
    );
    expect(rows.some((r) => r.id === a.userId)).toBe(true);
    expect(rows.find((r) => r.id === ordinary.id)?.maskedPhone).toBe(
      `+86****${phone.slice(-4)}`,
    );
    expect(rows.some((r) => r.id === unrelated.id)).toBe(false);
    await request(server)
      .post(`/management/staff-accounts/${ordinary.id}/unbind-wechat`)
      .auth(adminToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 1 })
      .expect(200);
    await request(server)
      .patch(`/management/staff-accounts/${ordinary.id}/status`)
      .auth(adminToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 2, status: 'DISABLED' })
      .expect(200);
    await request(server)
      .patch(`/management/staff-accounts/${unrelated.id}/status`)
      .auth(adminToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 1, status: 'DISABLED' })
      .expect(404);
    await get('/management/staff-accounts', a.token).expect(401);
    await get('/management/staff-accounts', (await staff(['HR'])).token).expect(
      403,
    );
  });
  it('excludes malformed approved roles from paginated management without blocking legitimate accounts', async () => {
    const a = await applicant();
    const b = await applicant();
    const first = value<Receipt>(await approve(a).expect(200));
    const second = value<Receipt>(await approve(b).expect(200));
    await prisma.userRole.updateMany({
      where: { userId: a.userId },
      data: { campusId: second.campusId },
    });
    const response = await get(
      `/management/staff-accounts?query=${runTag}&pageSize=100`,
      adminToken,
    ).expect(200);
    const rows = value<Array<{ id: string }>>(response);
    expect(rows.some((r) => r.id === a.userId)).toBe(false);
    expect(rows.some((r) => r.id === b.userId)).toBe(true);
    expect((response.body as { meta: { total: number } }).meta.total).toBe(
      rows.length,
    );
    await request(server)
      .patch(`/management/staff-accounts/${a.userId}/status`)
      .auth(adminToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 2, status: 'DISABLED' })
      .expect(404);
    await prisma.userRole.updateMany({
      where: { userId: a.userId },
      data: { campusId: first.campusId },
    });
    await prisma.userRole.create({
      data: {
        userId: a.userId,
        roleCode: 'PARTNER',
        campusId: second.campusId,
      },
    });
    const multi = value<Array<{ id: string }>>(
      await get(
        `/management/staff-accounts?query=${runTag}&pageSize=100`,
        adminToken,
      ).expect(200),
    );
    expect(multi.some((r) => r.id === a.userId)).toBe(false);
  });
  it.each([
    'fresh-role',
    'fresh-status',
    'replay-role',
    'replay-status',
  ] as const)(
    'serializes an independent %s revocation through the approval commit',
    async (scenario) => {
      const a = await applicant();
      const reviewer = await staff();
      const requestKey = randomUUID();
      const replay = scenario.startsWith('replay');
      if (replay) await approve(a, requestKey, reviewer.token).expect(200);
      let enter!: () => void;
      let resume!: () => void;
      let publishPid!: (pid: number) => void;
      const entered = new Promise<void>((yes) => {
        enter = yes;
      });
      const paused = new Promise<void>((yes) => {
        resume = yes;
      });
      const externalPid = new Promise<number>((yes) => {
        publishPid = yes;
      });
      let fired = false;
      if (replay) {
        const service = app.get(IdempotencyService);
        const claim = service.claim.bind(service);
        jest.spyOn(service, 'claim').mockImplementationOnce(async (...args) => {
          const result = await claim(...args);
          fired = true;
          enter();
          await paused;
          return result;
        });
      } else {
        const transact = prisma.$transaction.bind(prisma);
        jest
          .spyOn(prisma, '$transaction')
          .mockImplementationOnce(
            (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
              transact(
                async (tx) => {
                  const find = tx.authIdentity.findUnique.bind(tx.authIdentity);
                  tx.authIdentity.findUnique = (async (
                    input: Prisma.AuthIdentityFindUniqueArgs,
                  ) => {
                    const result = await find(input);
                    if (input.where.id) {
                      fired = true;
                      enter();
                      await paused;
                    }
                    return result;
                  }) as unknown as typeof tx.authIdentity.findUnique;
                  return callback(tx);
                },
                { timeout: 30_000 },
              ),
          );
      }
      const pending = approve(a, requestKey, reviewer.token).then(
        (response) => response,
      );
      await entered;
      let settled = false;
      const revocation = prisma
        .$transaction(
          async (tx) => {
            const [pid] = await tx.$queryRaw<
              Array<{ pid: number }>
            >`SELECT pg_backend_pid() AS pid`;
            publishPid(pid.pid);
            if (scenario.endsWith('role'))
              await tx.userRole.updateMany({
                where: { userId: reviewer.id },
                data: { roleCode: 'HR' },
              });
            else
              await tx.user.update({
                where: { id: reviewer.id },
                data: { status: 'DISABLED' },
              });
          },
          { timeout: 30_000 },
        )
        .then(() => {
          settled = true;
        });
      const pid = await externalPid;
      let blocked = false;
      try {
        for (let attempt = 0; attempt < 100 && !settled; ++attempt) {
          const [state] = await prisma.$queryRaw<
            Array<{ waiting: string | null }>
          >`
            SELECT wait_event_type AS waiting FROM pg_stat_activity WHERE pid = ${pid}`;
          if (state?.waiting === 'Lock') {
            blocked = true;
            break;
          }
          await new Promise<void>((yes) => setTimeout(yes, 10));
        }
      } finally {
        resume();
      }
      const response = await pending;
      await revocation;
      expect(fired).toBe(true);
      expect(blocked).toBe(true);
      expect(response.status).toBe(200);
      await approve(a, requestKey, reviewer.token).expect(
        scenario.endsWith('role') ? 403 : 401,
      );
      expect(
        await prisma.partnerApplicationApproval.count({
          where: { userId: a.userId },
        }),
      ).toBe(1);
    },
  );
  it('reauthorizes replay before returning its persisted receipt', async () => {
    const a = await applicant();
    const reviewer = await staff();
    const requestKey = randomUUID();
    await approve(a, requestKey, reviewer.token).expect(200);
    const service = app.get(IdempotencyService);
    const original = service.claim.bind(service);
    let fired = false;
    jest.spyOn(service, 'claim').mockImplementationOnce(async (tx, input) => {
      const result = await original(tx, input);
      await tx.userRole.updateMany({
        where: { userId: reviewer.id },
        data: { roleCode: 'HR' },
      });
      fired = true;
      return result;
    });
    await approve(a, requestKey, reviewer.token).expect(403);
    expect(fired).toBe(true);
    expect(
      await prisma.userRole.findFirst({ where: { userId: reviewer.id } }),
    ).toMatchObject({ roleCode: 'SUPER_ADMIN' });
  });
  it('rolls back a phone-less status update on audit failure and rejects account version overflow', async () => {
    const a = await applicant();
    const approved = value<Receipt>(await approve(a).expect(200));
    const filtered = value<Array<{ id: string }>>(
      await get(
        `/management/staff-accounts?roleCode=PARTNER&status=ACTIVE&campusId=${approved.campusId}&pageSize=1`,
        adminToken,
      ).expect(200),
    );
    expect(filtered).toEqual([expect.objectContaining({ id: a.userId })]);
    const requestKey = randomUUID();
    const transact = prisma.$transaction.bind(prisma);
    let fired = false;
    const hook = jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce(
        (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          transact(
            async (tx) => {
              const audit = tx.auditLog.create.bind(tx.auditLog);
              tx.auditLog.create = (async (
                input: Prisma.AuditLogCreateArgs,
              ) => {
                await audit(input);
                fired = true;
                throw new Error('synthetic staff audit failure');
              }) as unknown as typeof tx.auditLog.create;
              return callback(tx);
            },
            { timeout: 30_000 },
          ),
      );
    await request(server)
      .patch(`/management/staff-accounts/${a.userId}/status`)
      .auth(adminToken, { type: 'bearer' })
      .set('Idempotency-Key', requestKey)
      .send({ expectedVersion: 2, status: 'DISABLED' })
      .expect(500);
    hook.mockRestore();
    expect(fired).toBe(true);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: a.userId } }),
    ).toMatchObject({ status: 'ACTIVE', accountVersion: 2 });
    expect(
      await prisma.idempotencyRecord.count({ where: { key: requestKey } }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { resourceId: a.userId, action: 'STAFF_ACCOUNT_STATUS_UPDATE' },
      }),
    ).toBe(0);
    await prisma.user.update({
      where: { id: a.userId },
      data: { accountVersion: 2147483647 },
    });
    await request(server)
      .patch(`/management/staff-accounts/${a.userId}/status`)
      .auth(adminToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 2147483647, status: 'DISABLED' })
      .expect(409);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: a.userId } }),
    ).toMatchObject({ status: 'ACTIVE', accountVersion: 2147483647 });
  });
});
