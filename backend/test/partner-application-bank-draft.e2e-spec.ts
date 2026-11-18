import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);

const route = '/partner-applicants/me/application/bank-information';
const syntheticBank = {
  bankName: '合成测试开户行',
  accountHolder: '合成测试机构',
  accountNumber: '00000000000000000001',
};
interface Actor {
  token: string;
  applicantId: string;
  userId: string;
}
interface BankView {
  applicationId: string | null;
  status: string | null;
  version: number;
  bankInformation: typeof syntheticBank | null;
  readonly: boolean;
}
interface Receipt {
  applicationId: string;
  version: number;
  bankRecordId: string;
}
interface CipherRow {
  id: string;
  applicationId: string;
  ownerUserId: string;
  applicationVersion: number;
  keyId: string;
  nonce: string;
  authenticationTag: string;
  ciphertext: string;
}
const value = <T>(response: { body: unknown }) =>
  (response.body as { data: T }).data;

describe('encrypted own bank draft in the dedicated local database', () => {
  const runTag = `pbank-${randomUUID().slice(0, 8)}`;
  const keys = new Map([[runTag, randomBytes(32)]]);
  const ring = {
    current: jest.fn(() => ({ id: runTag, key: keys.get(runTag)! })),
    get: jest.fn((id: string) => keys.get(id)),
  };
  const actorIds: string[] = [];
  const formalIds: string[] = [];
  const formalTokens: string[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let campusId: string;
  let sequence = 0;

  const login = async (): Promise<Actor> => {
    const response = await request(server)
      .post('/partner-applicants/auth/wechat')
      .send({ code: `mock-wechat-login:${runTag}-${++sequence}` })
      .expect(200);
    const session = value<{ token: string; me: { applicantId: string } }>(
      response,
    );
    const applicant = await prisma.partnerApplicant.findUniqueOrThrow({
      where: { id: session.me.applicantId },
      select: { userId: true },
    });
    actorIds.push(applicant.userId);
    return {
      token: session.token,
      applicantId: session.me.applicantId,
      userId: applicant.userId,
    };
  };
  const read = (actor: Actor) =>
    request(server).get(route).auth(actor.token, { type: 'bearer' });
  const write = (
    actor: Actor,
    expectedVersion = 0,
    bankInformation: unknown = syntheticBank,
  ) =>
    request(server)
      .put(route)
      .auth(actor.token, { type: 'bearer' })
      .send({ expectedVersion, bankInformation });
  const save = async (
    actor: Actor,
    expectedVersion = 0,
    bankInformation: unknown = syntheticBank,
  ) =>
    value<Receipt>(
      await write(actor, expectedVersion, bankInformation).expect(200),
    );
  const rows = (applicationId: string) => prisma.$queryRaw<CipherRow[]>`
    SELECT * FROM "PartnerApplicationBankRecord"
    WHERE "applicationId" = ${applicationId}::uuid ORDER BY "applicationVersion"
  `;
  const audits = (id: string, action: string) =>
    prisma.auditLog.findMany({
      where: { resourceId: id, action },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp((builder) =>
      builder
        .overrideProvider('PARTNER_APPLICANT_RATE_LIMIT')
        .useValue({ check: () => Promise.resolve() })
        .overrideProvider('PARTNER_APPLICATION_PRIVATE_KEY_RING')
        .useValue(ring),
    ));
    server = app.getHttpServer() as Server;
    const campus = await prisma.campus.create({
      data: { code: runTag, name: `${runTag}合成校区` },
    });
    campusId = campus.id;
    for (const roleCode of [
      'PARTNER',
      'SUPER_ADMIN',
      'HR',
      'PARENT',
    ] as const) {
      const user = await prisma.user.create({
        data: {
          displayName: `${runTag}-${roleCode}`,
          roles: {
            create: {
              roleCode,
              campusId: ['PARTNER', 'PARENT'].includes(roleCode)
                ? campusId
                : null,
            },
          },
        },
      });
      formalIds.push(user.id);
      formalTokens.push(
        (await app.get(AuthService).issueSessionForUser(user.id)).accessToken,
      );
    }
  });
  afterEach(() => {
    ring.current.mockImplementation(() => ({
      id: runTag,
      key: keys.get(runTag)!,
    }));
    ring.get.mockImplementation((id: string) => keys.get(id));
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
          ...new Set([
            ...actorIds,
            ...formalIds,
            ...identities.map((item) => item.userId),
          ]),
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
          `PARTNER_APPLICATION_BANK_FIXTURE_OWNERSHIP ${JSON.stringify({
            runTag,
            userIds: ids,
            campusId,
            disposition:
              'retained; owned users disabled; no deletion; test keys not persisted',
          })}\n`,
        );
      }
    } finally {
      await app?.close();
    }
  });

  it('reads an empty partition without creating an application or read audit', async () => {
    const actor = await login();
    expect(value<BankView>(await read(actor).expect(200))).toEqual({
      applicationId: null,
      status: null,
      version: 0,
      bankInformation: null,
      readonly: false,
    });
    expect(
      await prisma.partnerApplication.count({
        where: { applicantId: actor.applicantId },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: {
          actorUserId: actor.userId,
          action: 'PARTNER_APPLICATION_BANK_READ',
        },
      }),
    ).toBe(0);
  });
  it('keeps the default private provider closed without generating a key', async () => {
    const actor = await login();
    const { app: closed } = await createPartnerPdfTestApp((builder) =>
      builder
        .overrideProvider('PARTNER_APPLICANT_RATE_LIMIT')
        .useValue({ check: () => Promise.resolve() }),
    );
    try {
      const response = await request(closed.getHttpServer() as Server)
        .put(route)
        .auth(actor.token, { type: 'bearer' })
        .send({ expectedVersion: 0, bankInformation: syntheticBank })
        .expect(503);
      expect(response.body).toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        details: {},
      });
      expect(JSON.stringify(response.body)).not.toContain(
        syntheticBank.accountNumber,
      );
      expect(
        await prisma.partnerApplication.count({
          where: { applicantId: actor.applicantId },
        }),
      ).toBe(0);
    } finally {
      await closed.close();
    }
  });
  it('saves and rereads text with leading zeros while storing only authenticated ciphertext', async () => {
    const actor = await login();
    const receipt = await save(actor, 0, {
      bankName: ` ${syntheticBank.bankName} `,
      accountHolder: ` ${syntheticBank.accountHolder} `,
      accountNumber: ` ${syntheticBank.accountNumber} `,
    });
    expect(Object.keys(receipt).sort()).toEqual([
      'applicationId',
      'bankRecordId',
      'version',
    ]);
    expect(receipt.version).toBe(1);
    const records = await rows(receipt.applicationId);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: receipt.bankRecordId,
      ownerUserId: actor.userId,
      applicationVersion: 1,
      keyId: runTag,
    });
    expect(records[0].nonce).toMatch(/^[a-f0-9]{24}$/);
    expect(records[0].authenticationTag).toMatch(/^[a-f0-9]{32}$/);
    const serialized = JSON.stringify(records);
    for (const field of Object.values(syntheticBank))
      expect(serialized).not.toContain(field);
    const response = await read(actor).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(value<BankView>(response)).toMatchObject({
      applicationId: receipt.applicationId,
      version: 1,
      bankInformation: syntheticBank,
      readonly: false,
    });
    const audit = await audits(
      receipt.applicationId,
      'PARTNER_APPLICATION_BANK_READ',
    );
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(syntheticBank.accountNumber);
    expect(
      JSON.stringify(
        await audits(receipt.applicationId, 'PARTNER_APPLICATION_BANK_SAVE'),
      ),
    ).not.toContain(syntheticBank.accountHolder);
  });
  it('clears with a new immutable record and retains earlier ciphertext', async () => {
    const actor = await login();
    const first = await save(actor);
    const original = (await rows(first.applicationId))[0];
    const cleared = await save(actor, 1, {
      bankName: ' ',
      accountHolder: null,
      accountNumber: null,
    });
    expect(cleared.version).toBe(2);
    expect((await rows(first.applicationId))[0]).toEqual(original);
    expect(await rows(first.applicationId)).toHaveLength(2);
    expect(
      value<BankView>(await read(actor).expect(200)).bankInformation,
    ).toEqual({
      bankName: null,
      accountHolder: null,
      accountNumber: null,
    });
  });
  it('replays identical saves without another record or save audit and rejects stale differing saves', async () => {
    const actor = await login();
    const first = await save(actor);
    expect(await save(actor)).toEqual(first);
    expect(await save(actor, 1)).toEqual(first);
    await write(actor, 0, { accountNumber: '00000000000000000002' }).expect(
      409,
    );
    expect(await rows(first.applicationId)).toHaveLength(1);
    expect(
      await audits(first.applicationId, 'PARTNER_APPLICATION_BANK_SAVE'),
    ).toHaveLength(1);
  });
  it('serializes different concurrent first saves without overwriting the winner', async () => {
    const actor = await login();
    const results = await Promise.all([
      write(actor, 0, syntheticBank),
      write(actor, 0, {
        ...syntheticBank,
        accountNumber: '00000000000000000002',
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const receipt = value<Receipt>(
      results.find((result) => result.status === 200)!,
    );
    expect(await rows(receipt.applicationId)).toHaveLength(1);
    const winner = value<BankView>(await read(actor).expect(200));
    expect(winner.bankInformation?.accountNumber).toBe(
      results[0].status === 200
        ? syntheticBank.accountNumber
        : '00000000000000000002',
    );
  });
  it('coalesces concurrent identical first saves and respects the exhausted global version', async () => {
    const actor = await login();
    const results = await Promise.all([write(actor), write(actor)]);
    expect(results.map((item) => item.status)).toEqual([200, 200]);
    const first = value<Receipt>(results[0]);
    expect(value<Receipt>(results[1])).toEqual(first);
    expect(await rows(first.applicationId)).toHaveLength(1);
    expect(
      await audits(first.applicationId, 'PARTNER_APPLICATION_BANK_SAVE'),
    ).toHaveLength(1);
    await prisma.partnerApplication.update({
      where: { id: first.applicationId },
      data: { version: 2_147_483_647 },
    });
    await write(actor, 2_147_483_647, {}).expect(409);
    expect(await rows(first.applicationId)).toHaveLength(1);
  });
  it('decrypts a retained record after a basic save and after selecting a new current key', async () => {
    const actor = await login();
    const first = await save(actor);
    await request(server)
      .put('/partner-applicants/me/application/basic-information')
      .auth(actor.token, { type: 'bearer' })
      .send({
        expectedVersion: 1,
        basicInformation: { institutionName: '合成新基础' },
      })
      .expect(200);
    const nextKey = `${runTag}-rotation`;
    keys.set(nextKey, randomBytes(32));
    ring.current.mockImplementation(() => ({
      id: nextKey,
      key: keys.get(nextKey)!,
    }));
    expect(value<BankView>(await read(actor).expect(200))).toMatchObject({
      version: 2,
      bankInformation: syntheticBank,
    });
    const next = await save(actor, 2, {
      ...syntheticBank,
      accountNumber: '00000000000000000002',
    });
    expect(next.version).toBe(3);
    expect((await rows(first.applicationId)).map((item) => item.keyId)).toEqual(
      [runTag, nextKey],
    );
    expect(
      value<BankView>(await read(actor).expect(200)).bankInformation
        ?.accountNumber,
    ).toBe('00000000000000000002');
  });
  it.each(['GET', 'PUT'])(
    'rechecks a revoked session while %s waits for the User lock',
    async (method) => {
      const actor = await login();
      const first = await save(actor);
      const original = prisma.$transaction.bind(prisma);
      let locked!: () => void;
      let unlock!: () => void;
      let entered!: () => void;
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const release = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      const accepted = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const holder = original(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.userId}::uuid FOR UPDATE`;
          locked();
          await release;
        },
        { timeout: 15_000 },
      );
      await ready;
      const transaction = jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce((callback: (tx: unknown) => Promise<unknown>) =>
          original((tx) => {
            entered();
            return callback(tx);
          }),
        );
      const pending = (
        method === 'GET' ? read(actor) : write(actor, 1, {})
      ).then((response) => response);
      try {
        await accepted;
        await request(server)
          .post('/partner-applicants/auth/logout')
          .auth(actor.token, { type: 'bearer' })
          .expect(200);
      } finally {
        unlock();
        await holder;
      }
      try {
        const response = await pending;
        expect(response.status).toBe(401);
        expect(JSON.stringify(response.body)).not.toContain(
          syntheticBank.accountNumber,
        );
        expect(await rows(first.applicationId)).toHaveLength(1);
        expect(
          await audits(first.applicationId, 'PARTNER_APPLICATION_BANK_READ'),
        ).toHaveLength(0);
        expect(
          (
            await prisma.partnerApplication.findUniqueOrThrow({
              where: { id: first.applicationId },
            })
          ).version,
        ).toBe(1);
      } finally {
        transaction.mockRestore();
      }
    },
  );
  it.each(['GET', 'PUT'])(
    'rechecks an account disabled after its %s guard succeeds',
    async (method) => {
      const actor = await login();
      const first = await save(actor);
      const original = prisma.$transaction.bind(prisma);
      let entered!: () => void;
      let release!: () => void;
      const accepted = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const transaction = jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce((async (
          callback: (tx: unknown) => Promise<unknown>,
        ) => {
          entered();
          await gate;
          return original(callback as never);
        }) as typeof prisma.$transaction);
      const pending = (
        method === 'GET' ? read(actor) : write(actor, 1, {})
      ).then((response) => response);
      try {
        await accepted;
        await prisma.user.update({
          where: { id: actor.userId },
          data: { status: 'DISABLED' },
        });
      } finally {
        release();
      }
      try {
        expect((await pending).status).toBe(401);
        expect(await rows(first.applicationId)).toHaveLength(1);
        expect(
          await audits(first.applicationId, 'PARTNER_APPLICATION_BANK_READ'),
        ).toHaveLength(0);
      } finally {
        transaction.mockRestore();
      }
    },
  );
  it('preserves basics and shares their optimistic version rather than overwriting that partition', async () => {
    const actor = await login();
    await request(server)
      .put('/partner-applicants/me/application/basic-information')
      .auth(actor.token, { type: 'bearer' })
      .send({
        expectedVersion: 0,
        basicInformation: {
          institutionName: '合成基础机构',
          contactPhone: '0000-00000000',
        },
      })
      .expect(200);
    const receipt = await save(actor, 1);
    expect(receipt.version).toBe(2);
    const basics = value<{
      version: number;
      basicInformation: { institutionName: string; contactPhone: string };
    }>(
      await request(server)
        .get('/partner-applicants/me/application')
        .auth(actor.token, { type: 'bearer' })
        .expect(200),
    );
    expect(basics).toMatchObject({
      version: 2,
      basicInformation: {
        institutionName: '合成基础机构',
        contactPhone: '0000-00000000',
      },
    });
    expect(JSON.stringify(basics)).not.toContain(syntheticBank.accountNumber);
  });
  it.each([
    { expectedVersion: 0, bankInformation: { accountNumber: 123 } },
    { expectedVersion: 0, bankInformation: { accountNumber: '0'.repeat(81) } },
    { expectedVersion: -1, bankInformation: {} },
    { expectedVersion: 2147483648, bankInformation: {} },
    { expectedVersion: 0, bankInformation: { ownerUserId: randomUUID() } },
    { expectedVersion: 0, bankInformation: {}, applicantId: randomUUID() },
    { expectedVersion: 0, bankInformation: null },
  ])(
    'rejects malformed, overlong or client-selected identities %#',
    async (body) => {
      const actor = await login();
      await request(server)
        .put(route)
        .auth(actor.token, { type: 'bearer' })
        .send(body)
        .expect(400);
      expect(
        await prisma.partnerApplication.count({
          where: { applicantId: actor.applicantId },
        }),
      ).toBe(0);
    },
  );
  it('accepts the exact account limit as text and never populates staffPhone', async () => {
    const actor = await login();
    await save(actor, 0, { accountNumber: '0'.repeat(80) });
    expect(
      value<BankView>(await read(actor).expect(200)).bankInformation
        ?.accountNumber,
    ).toBe('0'.repeat(80));
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } }))
        .staffPhone,
    ).toBeNull();
  });
  it('cannot read another applicant through query IDs and rejects all formal bearer tokens', async () => {
    const owner = await login();
    const first = await save(owner);
    const other = await login();
    const response = await read(other)
      .query({
        applicantId: owner.applicantId,
        applicationId: first.applicationId,
      })
      .expect(200);
    expect(value<BankView>(response).bankInformation).toBeNull();
    for (const token of formalTokens) {
      await request(server)
        .get(route)
        .auth(token, { type: 'bearer' })
        .expect(401);
      await request(server)
        .put(route)
        .auth(token, { type: 'bearer' })
        .send({ expectedVersion: 0, bankInformation: syntheticBank })
        .expect(401);
    }
  });
  it.each(['SUBMITTED', 'REJECTED', 'APPROVED'])(
    'allows an owned read but blocks writes in %s',
    async (status) => {
      const actor = await login();
      const first = await save(actor);
      await prisma.$executeRaw`UPDATE "PartnerApplication" SET "status" = ${status}::"PartnerApplicationStatus" WHERE "id" = ${first.applicationId}::uuid`;
      expect(value<BankView>(await read(actor).expect(200)).readonly).toBe(
        true,
      );
      await write(actor, 1, { accountNumber: null }).expect(409);
      expect(await rows(first.applicationId)).toHaveLength(1);
    },
  );
  it('blocks an applicant write after a formal role is added while preserving own read-only access', async () => {
    const actor = await login();
    const first = await save(actor);
    await prisma.userRole.create({
      data: { userId: actor.userId, roleCode: 'PARTNER', campusId },
    });
    expect(value<BankView>(await read(actor).expect(200)).readonly).toBe(true);
    await write(actor, 1, {}).expect(409);
    expect(await rows(first.applicationId)).toHaveLength(1);
  });
  it('rolls back a failed save audit and refuses bank plaintext when the read audit fails', async () => {
    const actor = await login();
    const first = await save(actor);
    const extension = prisma.$extends({
      query: {
        auditLog: {
          create: () => {
            throw new Error('synthetic audit failure');
          },
        },
      },
    });
    const audit = jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce(((callback: (tx: unknown) => unknown) =>
        extension.$transaction(
          callback as never,
        )) as typeof prisma.$transaction);
    await write(actor, 1, { accountNumber: '00000000000000000002' }).expect(
      500,
    );
    audit.mockRestore();
    expect(await rows(first.applicationId)).toHaveLength(1);
    expect(value<BankView>(await read(actor).expect(200)).version).toBe(1);
    const readAudit = jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce(((callback: (tx: unknown) => unknown) =>
        extension.$transaction(
          callback as never,
        )) as typeof prisma.$transaction);
    const denied = await read(actor).expect(500);
    readAudit.mockRestore();
    expect(JSON.stringify(denied.body)).not.toContain(
      syntheticBank.accountNumber,
    );
    expect(JSON.stringify(denied.body)).not.toContain(
      syntheticBank.accountHolder,
    );
  });
  it('fails closed on missing, malformed or wrong historical keys without changing the draft', async () => {
    const actor = await login();
    const first = await save(actor);
    ring.get.mockReturnValueOnce(randomBytes(32));
    expect(JSON.stringify((await read(actor).expect(503)).body)).not.toContain(
      syntheticBank.accountNumber,
    );
    ring.get.mockReturnValueOnce(undefined);
    await read(actor).expect(503);
    ring.current.mockReturnValueOnce({ id: runTag, key: randomBytes(31) });
    await write(actor, 1, {}).expect(503);
    expect(await rows(first.applicationId)).toHaveLength(1);
  });
  it('rejects swapping an entire authenticated bank envelope from another applicant', async () => {
    const owner = await login();
    const other = await login();
    const first = await save(owner);
    const second = await save(other, 0, {
      ...syntheticBank,
      accountNumber: '00000000000000000002',
    });
    const foreign = (await rows(second.applicationId))[0];
    await prisma.$executeRaw`UPDATE "PartnerApplicationBankRecord"
      SET "ciphertext" = ${foreign.ciphertext}, "nonce" = ${foreign.nonce},
          "authenticationTag" = ${foreign.authenticationTag}, "keyId" = ${foreign.keyId}
      WHERE "id" = ${first.bankRecordId}::uuid`;
    const response = await read(owner).expect(503);
    expect(JSON.stringify(response.body)).not.toContain('00000000000000000002');
  });
  it('refuses a revoked or disabled applicant without returning old data', async () => {
    const actor = await login();
    await save(actor);
    await request(server)
      .post('/partner-applicants/auth/logout')
      .auth(actor.token, { type: 'bearer' })
      .expect(200);
    await read(actor).expect(401);
    await write(actor, 1, {}).expect(401);
    const disabled = await login();
    await save(disabled);
    await prisma.user.update({
      where: { id: disabled.userId },
      data: { status: 'DISABLED' },
    });
    await read(disabled).expect(401);
  });
});
