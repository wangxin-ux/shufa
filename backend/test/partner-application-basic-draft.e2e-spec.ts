import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);

type BasicInformation = {
  institutionName: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  detailedAddress: string | null;
  contactPhone: string | null;
};
type Draft = {
  applicationId: string;
  status: string;
  version: number;
  basicInformation: BasicInformation;
  createdAt: string;
  updatedAt: string;
};
type ApplicantSession = { token: string; me: { applicantId: string } };
const data = <T>(response: { body: unknown }) =>
  (response.body as { data: T }).data;
const base = '/partner-applicants/me/application';
const basic = `${base}/basic-information`;

describe('own institution basic draft in the dedicated database', () => {
  const runTag = `pdraft-${randomUUID().slice(0, 8)}`;
  const ownedUsers: string[] = [];
  const ownedApplicants: string[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let formalToken: string;
  let campusId: string;
  let sequence = 0;

  const login = async (): Promise<ApplicantSession> => {
    const suffix = `${runTag}-${++sequence}`;
    const response = await request(server)
      .post('/partner-applicants/auth/wechat')
      .send({ code: `mock-wechat-login:${suffix}` })
      .expect(200);
    const value = data<ApplicantSession>(response);
    ownedApplicants.push(value.me.applicantId);
    return value;
  };
  const get = (token: string) =>
    request(server).get(base).auth(token, { type: 'bearer' });
  const save = (
    token: string,
    expectedVersion: number,
    basicInformation: Record<string, unknown>,
  ) =>
    request(server)
      .put(basic)
      .auth(token, { type: 'bearer' })
      .send({ expectedVersion, basicInformation });
  const saved = async (
    token: string,
    expectedVersion: number,
    value: Record<string, unknown>,
  ): Promise<Draft> =>
    data<Draft>(await save(token, expectedVersion, value).expect(200));
  const findOwnDraft = async (applicantId: string) =>
    prisma.$queryRaw<Array<{ id: string; version: number; status: string }>>`
      SELECT "id", "version", "status" FROM "PartnerApplication" WHERE "applicantId" = ${applicantId}::uuid
    `;
  const countAudits = (resourceId: string) =>
    prisma.auditLog.count({
      where: { action: 'PARTNER_APPLICATION_BASIC_SAVE', resourceId },
    });

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp((builder) =>
      builder
        .overrideProvider('PARTNER_APPLICANT_RATE_LIMIT')
        .useValue({ check: () => Promise.resolve() }),
    ));
    server = app.getHttpServer() as Server;
    const campus = await prisma.campus.create({
      data: { code: runTag, name: `${runTag}测试校区` },
    });
    campusId = campus.id;
    const formal = await prisma.user.create({
      data: {
        displayName: `${runTag}正式合作方`,
        roles: { create: { roleCode: 'PARTNER', campusId } },
      },
    });
    ownedUsers.push(formal.id);
    formalToken = (await app.get(AuthService).issueSessionForUser(formal.id))
      .accessToken;
  });

  afterAll(async () => {
    try {
      if (prisma) {
        assertPartnerPdfTestTarget(process.env);
        const users = await prisma.authIdentity.findMany({
          where: { provider: 'WECHAT', subject: { startsWith: `${runTag}-` } },
          select: { userId: true },
        });
        const ids = [
          ...new Set([...ownedUsers, ...users.map((item) => item.userId)]),
        ];
        await prisma.user.updateMany({
          where: {
            id: { in: ids },
            OR: [
              { displayName: { startsWith: runTag } },
              {
                authIdentities: {
                  some: {
                    provider: 'WECHAT',
                    subject: { startsWith: `${runTag}-` },
                  },
                },
              },
            ],
          },
          data: { status: 'DISABLED' },
        });
        process.stdout.write(
          `PARTNER_APPLICATION_BASIC_FIXTURE_OWNERSHIP ${JSON.stringify({
            runTag,
            userIds: ids,
            applicantIds: ownedApplicants,
            campusId,
            disposition: 'retained; owned users disabled; no deletion',
          })}\n`,
        );
      }
    } finally {
      await app?.close();
    }
  });

  it('reads no draft without creating an application as a side effect', async () => {
    const value = await login();
    expect(data<null>(await get(value.token).expect(200))).toBeNull();
    expect(await findOwnDraft(value.me.applicantId)).toHaveLength(0);
  });

  it('persists partial basics and restores the same owned record', async () => {
    const value = await login();
    const draft = await saved(value.token, 0, {
      institutionName: '  合成机构  ',
    });
    expect(draft.status).toBe('DRAFT');
    expect(draft.version).toBe(1);
    expect(draft.basicInformation).toEqual({
      institutionName: '合成机构',
      province: null,
      city: null,
      district: null,
      detailedAddress: null,
      contactPhone: null,
    });
    expect(data<Draft>(await get(value.token).expect(200))).toEqual(draft);
    expect(await findOwnDraft(value.me.applicantId)).toHaveLength(1);
    expect(await countAudits(draft.applicationId)).toBe(1);
  });

  it('treats a repeated save as naturally idempotent without a second version or audit', async () => {
    const value = await login();
    const first = await saved(value.token, 0, { institutionName: '合成机构' });
    expect(
      await saved(value.token, 0, { institutionName: ' 合成机构 ' }),
    ).toEqual(first);
    expect(
      await saved(value.token, 1, { institutionName: '合成机构' }),
    ).toEqual(first);
    expect(await countAudits(first.applicationId)).toBe(1);
  });

  it('persists an owned contact as trimmed text and does not copy it into identity or audit data', async () => {
    const value = await login();
    const phone = '0000-00000000';
    const first = await saved(value.token, 0, { contactPhone: ` ${phone} ` });
    expect(first.basicInformation.contactPhone).toBe(phone);
    expect(data<Draft>(await get(value.token).expect(200))).toEqual(first);
    expect(await saved(value.token, 0, { contactPhone: phone })).toEqual(first);
    const owner = await prisma.partnerApplicant.findUniqueOrThrow({
      where: { id: value.me.applicantId },
      include: { user: true },
    });
    expect(owner.user.staffPhone).toBeNull();
    const audits = await prisma.auditLog.findMany({
      where: { resourceId: first.applicationId },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].details).toHaveProperty(
      'changedFields',
      expect.arrayContaining(['contactPhone']),
    );
    expect(JSON.stringify(audits)).not.toContain(phone);
  });

  it('preserves a contact omitted by an older client and explicitly clears blank or null contacts', async () => {
    const value = await login();
    const first = await saved(value.token, 0, {
      contactPhone: '0000-00000000',
    });
    const next = await saved(value.token, first.version, {
      institutionName: '旧客户端修改',
    });
    expect(next.basicInformation.contactPhone).toBe(
      first.basicInformation.contactPhone,
    );
    const cleared = await saved(value.token, next.version, {
      contactPhone: '   ',
    });
    expect(cleared.basicInformation.contactPhone).toBeNull();
    const restored = await saved(value.token, cleared.version, {
      contactPhone: '0000-00000001',
    });
    expect(
      (await saved(value.token, restored.version, { contactPhone: null }))
        .basicInformation.contactPhone,
    ).toBeNull();
  });

  it('persists and rereads a contact at the exact 30 character boundary', async () => {
    const value = await login();
    const contactPhone = '0000-00000000-0000000000000000';
    expect(contactPhone).toHaveLength(30);
    const first = await saved(value.token, 0, { contactPhone });
    expect(first.basicInformation.contactPhone).toBe(contactPhone);
    expect(data<Draft>(await get(value.token).expect(200))).toEqual(first);
  });

  it('allows one winner for different concurrent contact changes and protects the winning value from a stale save', async () => {
    const value = await login();
    const first = await saved(value.token, 0, {
      contactPhone: '0000-00000000',
    });
    const responses = await Promise.all([
      save(value.token, first.version, { contactPhone: '0000-00000001' }),
      save(value.token, first.version, { contactPhone: '0000-00000002' }),
    ]);
    expect(responses.map((item) => item.status).sort()).toEqual([200, 409]);
    const winner = data<Draft>(responses.find((item) => item.status === 200)!);
    await save(value.token, first.version, {
      contactPhone: '0000-00000003',
    }).expect(409);
    expect(data<Draft>(await get(value.token).expect(200))).toEqual(winner);
    expect(await countAudits(first.applicationId)).toBe(2);
  });

  it('replaces only the basic section and deliberately clears omitted or empty fields', async () => {
    const value = await login();
    const first = await saved(value.token, 0, {
      institutionName: '合成机构',
      province: '合成省',
      city: '合成市',
      district: '合成区',
      detailedAddress: '合成测试路一号',
    });
    const next = await saved(value.token, first.version, {
      institutionName: '',
      city: null,
    });
    expect(next.version).toBe(2);
    expect(next.applicationId).toBe(first.applicationId);
    expect(Object.values(next.basicInformation)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(await countAudits(first.applicationId)).toBe(2);
  });

  it('does not accept client-selected applicant or campus query scope', async () => {
    const first = await login();
    const second = await login();
    const draft = await saved(first.token, 0, {
      institutionName: '本人机构',
      contactPhone: '0000-00000001',
    });
    const otherDraft = await saved(second.token, 0, {
      institutionName: '另一合成机构',
      contactPhone: '0000-00000002',
    });
    const response = await get(first.token)
      .query({ applicantId: second.me.applicantId, campusId })
      .expect(200);
    expect(data<Draft>(response)).toEqual(draft);
    const changed = data<Draft>(
      await save(first.token, 1, { institutionName: '本人修改' })
        .query({ applicantId: second.me.applicantId })
        .expect(200),
    );
    expect(changed.applicationId).toBe(draft.applicationId);
    expect(data<Draft>(await get(second.token).expect(200))).toEqual(
      otherDraft,
    );
  });

  it('rejects formal credentials and missing credentials at both operations', async () => {
    await get(formalToken).expect(401);
    await save(formalToken, 0, {}).expect(401);
    await request(server).get(base).expect(401);
    await request(server)
      .put(basic)
      .send({ expectedVersion: 0, basicInformation: {} })
      .expect(401);
  });

  it.each([
    { bankAccount: '0000000000000000' },
    { contactPhone: '0'.repeat(31) },
    { contactPhone: 123 },
    { contactPhone: {} },
    { identityNumber: 'synthetic-id' },
    { legalPersonName: '合成人员' },
    { businessLicenseFileId: randomUUID() },
    { storedFileId: randomUUID() },
    { institutionName: 'X'.repeat(201) },
    { detailedAddress: 'X'.repeat(301) },
    { province: 'X'.repeat(101) },
    { institutionName: 1 },
    { city: {} },
  ])(
    'rejects sensitive, unsupported or malformed basic fields %#',
    async (body) => {
      const value = await login();
      await save(value.token, 0, body).expect(400);
      expect(await findOwnDraft(value.me.applicantId)).toHaveLength(0);
    },
  );

  it.each([-1, 1.5, '0', null, 2_147_483_648])(
    'rejects malformed expected version %s',
    async (expectedVersion) => {
      const value = await login();
      await request(server)
        .put(basic)
        .auth(value.token, { type: 'bearer' })
        .send({ expectedVersion, basicInformation: {} })
        .expect(400);
    },
  );

  it('rejects other identity, status and material fields on the request envelope', async () => {
    const value = await login();
    await request(server)
      .put(basic)
      .auth(value.token, { type: 'bearer' })
      .send({
        expectedVersion: 0,
        basicInformation: {},
        applicantId: randomUUID(),
        status: 'APPROVED',
        campusId,
        bankAccount: 'synthetic',
      })
      .expect(400);
    expect(await findOwnDraft(value.me.applicantId)).toHaveLength(0);
  });

  it('returns 409 on a stale different save without overwriting the newer draft', async () => {
    const value = await login();
    const first = await saved(value.token, 0, { institutionName: '初稿' });
    const next = await saved(value.token, 1, { institutionName: '新稿' });
    await save(value.token, 0, { institutionName: '过期修改' }).expect(409);
    expect(data<Draft>(await get(value.token).expect(200))).toEqual(next);
    expect(await countAudits(first.applicationId)).toBe(2);
  });

  it('serializes identical first saves without duplicate applications or audits', async () => {
    const value = await login();
    const responses = await Promise.all([
      save(value.token, 0, {}),
      save(value.token, 0, {}),
    ]);
    expect(responses.map((item) => item.status)).toEqual([200, 200]);
    const first = data<Draft>(responses[0]);
    expect(data<Draft>(responses[1])).toEqual(first);
    expect(await findOwnDraft(value.me.applicantId)).toHaveLength(1);
    expect(await countAudits(first.applicationId)).toBe(1);
  });

  it('allows only one of two conflicting concurrent writes', async () => {
    const value = await login();
    const draft = await saved(value.token, 0, { institutionName: '初稿' });
    const responses = await Promise.all([
      save(value.token, 1, { institutionName: '并发甲' }),
      save(value.token, 1, { institutionName: '并发乙' }),
    ]);
    expect(responses.map((item) => item.status).sort()).toEqual([200, 409]);
    expect(data<Draft>(await get(value.token).expect(200)).version).toBe(2);
    expect(await countAudits(draft.applicationId)).toBe(2);
  });

  it.each(['SUBMITTED', 'REJECTED', 'APPROVED'])(
    'does not overwrite a non-draft application %s',
    async (status) => {
      const value = await login();
      const draft = await saved(value.token, 0, {
        institutionName: '冻结合成稿',
      });
      await prisma.$executeRaw`
      UPDATE "PartnerApplication" SET "status" = ${status}::"PartnerApplicationStatus"
      WHERE "id" = ${draft.applicationId}::uuid
    `;
      await save(value.token, 1, { institutionName: '不应写入' }).expect(409);
      expect(
        data<Draft>(await get(value.token).expect(200)).basicInformation,
      ).toEqual(draft.basicInformation);
      expect(await countAudits(draft.applicationId)).toBe(1);
    },
  );

  it('does not let an applicant session reopen onboarding after a formal role appears', async () => {
    const value = await login();
    const identity = await prisma.authIdentity.findFirstOrThrow({
      where: {
        provider: 'WECHAT',
        subject: { startsWith: `${runTag}-` },
        user: { partnerApplicant: { id: value.me.applicantId } },
      },
      select: { userId: true },
    });
    await prisma.userRole.create({
      data: { userId: identity.userId, roleCode: 'PARTNER', campusId },
    });
    await save(value.token, 0, {}).expect(409);
    expect(data<null>(await get(value.token).expect(200))).toBeNull();
  });

  it('rolls back draft creation when the atomic audit write fails', async () => {
    const value = await login();
    const extension = prisma.$extends({
      query: {
        auditLog: {
          create: () => {
            throw new Error('synthetic audit failure');
          },
        },
      },
    });
    const transaction = jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce(((callback: (tx: unknown) => unknown) =>
        extension.$transaction(
          callback as never,
        )) as typeof prisma.$transaction);
    try {
      await save(value.token, 0, { institutionName: '回滚合成稿' }).expect(500);
      expect(await findOwnDraft(value.me.applicantId)).toHaveLength(0);
    } finally {
      transaction.mockRestore();
    }
  });

  it('rolls back existing fields, version, timestamp and audit count when update audit fails', async () => {
    const value = await login();
    const first = await saved(value.token, 0, {
      institutionName: '原合成机构',
      detailedAddress: '原合成地址',
      contactPhone: '0000-00000000',
    });
    const extension = prisma.$extends({
      query: {
        auditLog: {
          create: () => {
            throw new Error('synthetic update audit failure');
          },
        },
      },
    });
    const transaction = jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce(((callback: (tx: unknown) => unknown) =>
        extension.$transaction(
          callback as never,
        )) as typeof prisma.$transaction);
    try {
      await save(value.token, first.version, {
        institutionName: '不应留下的更新',
        contactPhone: '0000-00000001',
      }).expect(500);
      expect(data<Draft>(await get(value.token).expect(200))).toEqual(first);
      expect(await countAudits(first.applicationId)).toBe(1);
    } finally {
      transaction.mockRestore();
    }
  });

  it.each(['revoked', 'expired'])(
    'rejects a save if its session becomes %s after the guard accepts it',
    async (state) => {
      const value = await login();
      const first = await saved(value.token, 0, {
        institutionName: '保留原稿',
      });
      let entered!: () => void;
      let release!: () => void;
      const accepted = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = prisma.$transaction.bind(prisma);
      const transaction = jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce((async (callback: (tx: unknown) => unknown) => {
          entered();
          await gate;
          return original(callback as never);
        }) as typeof prisma.$transaction);
      const pending = save(value.token, first.version, {
        institutionName: '不应保存',
      }).then((response) => response);
      try {
        await accepted;
        await prisma.partnerApplicantSession.updateMany({
          where: { applicantId: value.me.applicantId, revokedAt: null },
          data:
            state === 'revoked'
              ? { revokedAt: new Date() }
              : { expiresAt: new Date(Date.now() - 1000) },
        });
      } finally {
        release();
      }
      try {
        expect((await pending).status).toBe(401);
        const retained = await prisma.partnerApplication.findUniqueOrThrow({
          where: { id: first.applicationId },
        });
        expect(retained.institutionName).toBe(
          first.basicInformation.institutionName,
        );
        expect(retained.version).toBe(first.version);
        expect(retained.updatedAt.toISOString()).toBe(first.updatedAt);
        expect(await countAudits(first.applicationId)).toBe(1);
      } finally {
        transaction.mockRestore();
      }
    },
  );

  it('audits version and changed field names without copying address contents', async () => {
    const value = await login();
    const first = await saved(value.token, 0, {
      institutionName: '合成机构',
      detailedAddress: '仅草稿持有的合成地址',
    });
    await saved(value.token, 1, { institutionName: '合成机构' });
    const audits = await prisma.auditLog.findMany({
      where: {
        action: 'PARTNER_APPLICATION_BASIC_SAVE',
        resourceId: first.applicationId,
      },
      orderBy: { createdAt: 'asc' },
      select: { details: true },
    });
    expect(audits[1].details).toEqual({
      previousVersion: 1,
      version: 2,
      changedFields: ['detailedAddress'],
    });
    expect(JSON.stringify(audits)).not.toContain('仅草稿持有的合成地址');
    expect(JSON.stringify(audits)).not.toContain('合成机构');
  });

  it('does not save after logout completes while the user write lock is held', async () => {
    const value = await login();
    const first = await saved(value.token, 0, { institutionName: '锁前原稿' });
    const applicant = await prisma.partnerApplicant.findUniqueOrThrow({
      where: { id: value.me.applicantId },
      select: { userId: true },
    });
    let locked!: () => void;
    let unlock!: () => void;
    let entered!: () => void;
    const lockReady = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const saveEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const original = prisma.$transaction.bind(prisma);
    const holder = original(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${applicant.userId}::uuid FOR UPDATE`;
        locked();
        await gate;
      },
      { timeout: 15_000 },
    );
    await lockReady;
    const transaction = jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce((callback: (tx: unknown) => Promise<unknown>) =>
        original((tx) => {
          entered();
          return callback(tx);
        }),
      );
    const pending = save(value.token, first.version, {
      institutionName: '退出后不应写入',
    }).then((response) => response);
    try {
      await saveEntered;
      await request(server)
        .post('/partner-applicants/auth/logout')
        .auth(value.token, { type: 'bearer' })
        .expect(200);
    } finally {
      unlock();
      await holder;
    }
    try {
      expect((await pending).status).toBe(401);
      const retained = await prisma.partnerApplication.findUniqueOrThrow({
        where: { id: first.applicationId },
      });
      expect(retained.institutionName).toBe('锁前原稿');
      expect(retained.version).toBe(first.version);
      expect(retained.updatedAt.toISOString()).toBe(first.updatedAt);
      expect(await countAudits(first.applicationId)).toBe(1);
    } finally {
      transaction.mockRestore();
    }
  });
});
