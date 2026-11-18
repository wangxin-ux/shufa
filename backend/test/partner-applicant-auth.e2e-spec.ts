import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { DomainError } from '../src/common/errors/domain-error';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import {
  WECHAT_IDENTITY_GATEWAY,
  type WechatIdentityGateway,
} from '../src/modules/auth/wechat-identity.gateway';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);

type Session = {
  token: string;
  expiresAt: string;
  me: { applicantId: string; displayName: string; formalAccountReady: boolean };
};

function responseData<T>(response: { body: unknown }): T {
  return (response.body as { data: T }).data;
}

describe('restricted partner applicants in the dedicated test database', () => {
  const runTag = `papp-${randomUUID().slice(0, 8)}`;
  const formalUserIds: string[] = [];
  const rateCheck = jest.fn().mockResolvedValue(undefined);
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let formalToken: string;
  let formalUserId: string;
  let campusId: string;
  let sequence = 0;

  const subject = (suffix: string) => `${runTag}-${suffix}`;
  const login = (suffix = `case-${++sequence}`) =>
    request(server)
      .post('/partner-applicants/auth/wechat')
      .send({ code: `mock-wechat-login:${subject(suffix)}` });
  const session = async (suffix?: string): Promise<Session> =>
    responseData<Session>(await login(suffix).expect(200));
  const claims = <T extends object>(token: string): T =>
    app.get(JwtService).decode<T>(token);
  const me = (token: string) =>
    request(server)
      .get('/partner-applicants/me')
      .auth(token, { type: 'bearer' });

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp((builder) =>
      builder
        .overrideProvider('PARTNER_APPLICANT_RATE_LIMIT')
        .useValue({ check: rateCheck }),
    ));
    server = app.getHttpServer() as Server;
    const campus = await prisma.campus.create({
      data: { code: runTag, name: `${runTag}测试校区` },
    });
    campusId = campus.id;
    const user = await prisma.user.create({
      data: {
        displayName: `${runTag}正式合作方`,
        roles: { create: { roleCode: 'PARTNER', campusId } },
        authIdentities: {
          create: { provider: 'WECHAT', subject: subject('formal') },
        },
      },
    });
    formalUserId = user.id;
    formalUserIds.push(user.id);
    formalToken = (await app.get(AuthService).issueSessionForUser(user.id))
      .accessToken;
  });

  afterAll(async () => {
    try {
      if (prisma) {
        assertPartnerPdfTestTarget(process.env);
        const owned = await prisma.authIdentity.findMany({
          where: { provider: 'WECHAT', subject: { startsWith: `${runTag}-` } },
          select: { userId: true },
        });
        const ids = [
          ...new Set([...formalUserIds, ...owned.map((item) => item.userId)]),
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
          `PARTNER_APPLICANT_FIXTURE_OWNERSHIP ${JSON.stringify({
            runTag,
            userIds: ids,
            campusId,
            disposition: 'retained; owned users disabled; no deletion',
          })}\n`,
        );
      }
    } finally {
      await app?.close();
    }
  });

  it('issues only a short-lived scoped session and creates no formal role', async () => {
    const value = await session('new');
    expect(Object.keys(value).sort()).toEqual(['expiresAt', 'me', 'token']);
    expect(value.me).toEqual({
      applicantId: value.me.applicantId,
      displayName: '入驻申请人',
      formalAccountReady: false,
    });
    expect(typeof value.me.applicantId).toBe('string');
    const payload = claims<{
      sub: string;
      kind: string;
      aud: string;
      iat: number;
      exp: number;
      jti: string;
    }>(value.token);
    expect(payload).toMatchObject({
      kind: 'partner_application',
      aud: 'partner_application',
    });
    expect(payload.exp - payload.iat).toBe(900);
    expect(Date.parse(value.expiresAt)).toBeGreaterThan(Date.now());
    expect(
      await prisma.userRole.count({ where: { userId: payload.sub } }),
    ).toBe(0);
    expect(
      responseData<Session['me']>(await me(value.token).expect(200)),
    ).toEqual(value.me);
  });

  it.each([
    '/me',
    '/partners/me/dashboard',
    '/partners/me/students',
    '/parents/me/home',
    '/teachers/me/dashboard',
    '/management/dashboard',
  ])('never upgrades the applicant token at %s', async (url) => {
    const value = await session();
    await request(server)
      .get(url)
      .auth(value.token, { type: 'bearer' })
      .expect(401);
  });

  it('rejects a formal token at the applicant identity endpoint', async () => {
    await me(formalToken).expect(401);
    await request(server)
      .get('/partners/me/profile')
      .auth(formalToken, { type: 'bearer' })
      .expect(200);
  });

  it('rejects an existing formal identity without merging it or creating applicant roles', async () => {
    await login('formal').expect(409);
    const roles = await prisma.userRole.findMany({
      where: { userId: formalUserId },
    });
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({ roleCode: 'PARTNER', campusId });
  });

  it('ignores a client-selected other identity and keeps identity fields minimal', async () => {
    const first = await session();
    const second = await session();
    const response = await me(first.token)
      .query({
        applicantId: second.me.applicantId,
        userId: formalUserId,
        campusId,
      })
      .expect(200);
    expect(responseData<Session['me']>(response)).toEqual(first.me);
    expect(Object.keys(responseData<Session['me']>(response)).sort()).toEqual([
      'applicantId',
      'displayName',
      'formalAccountReady',
    ]);
  });

  it('rejects client-supplied identities, roles and openId', async () => {
    await request(server)
      .post('/partner-applicants/auth/wechat')
      .send({
        code: `mock-wechat-login:${subject('forged')}`,
        openId: subject('formal'),
        userId: formalUserId,
        roles: ['PARTNER'],
        campusId,
      })
      .expect(400);
    expect(
      await prisma.authIdentity.count({
        where: { provider: 'WECHAT', subject: subject('forged') },
      }),
    ).toBe(0);
  });

  it('returns one applicant identity for concurrent first logins', async () => {
    const responses = await Promise.all([
      login('concurrent'),
      login('concurrent'),
    ]);
    expect(responses.map((item) => item.status)).toEqual([200, 200]);
    const sessions = responses.map((item) => responseData<Session>(item));
    expect(sessions[0].me.applicantId).toBe(sessions[1].me.applicantId);
    expect(sessions[0].token).not.toBe(sessions[1].token);
    expect(
      await prisma.authIdentity.count({
        where: { provider: 'WECHAT', subject: subject('concurrent') },
      }),
    ).toBe(1);
  });

  it('revokes only the current session and retains the other applicant session', async () => {
    const first = await session('logout');
    const second = await session('logout');
    const response = await request(server)
      .post('/partner-applicants/auth/logout')
      .auth(first.token, { type: 'bearer' })
      .expect(200);
    const envelope = response.body as {
      data: { revoked: boolean };
      requestId: unknown;
    };
    expect(Object.keys(envelope).sort()).toEqual(['data', 'requestId']);
    expect(envelope.data).toEqual({ revoked: true });
    expect(typeof envelope.requestId).toBe('string');
    await me(first.token).expect(401);
    await me(second.token).expect(200);
    await request(server)
      .post('/partner-applicants/auth/logout')
      .auth(first.token, { type: 'bearer' })
      .expect(401);
  });

  it('rejects an expired persisted session even when the signed token is still valid', async () => {
    const value = await session();
    const payload = claims<{ jti: string }>(value.token);
    await prisma.$executeRaw`
      UPDATE "PartnerApplicantSession" SET "expiresAt" = NOW() - INTERVAL '1 second'
      WHERE "id" = ${payload.jti}::uuid
    `;
    await me(value.token).expect(401);
  });

  it('does not accept a valid signature with the wrong audience', async () => {
    const value = await session();
    const payload = claims<Record<string, unknown>>(value.token);
    const token = await app
      .get(JwtService)
      .signAsync(
        { ...payload, aud: 'formal-access' },
        { secret: process.env.JWT_ACCESS_SECRET },
      );
    await me(token).expect(401);
  });

  it('keeps an old applicant token restricted after a separate PARTNER account is added', async () => {
    const value = await session('formal-handoff');
    const payload = claims<{ sub: string }>(value.token);
    await request(server)
      .post('/auth/wechat/login')
      .send({
        code: `mock-wechat-login:${subject('formal-handoff')}`,
      })
      .expect(401);
    await prisma.userRole.create({
      data: { userId: payload.sub, roleCode: 'PARTNER', campusId },
    });
    expect(
      responseData<Session['me']>(await me(value.token).expect(200))
        .formalAccountReady,
    ).toBe(true);
    await request(server)
      .get('/partners/me/profile')
      .auth(value.token, { type: 'bearer' })
      .expect(401);
    const formal = responseData<{ accessToken: string }>(
      await request(server)
        .post('/auth/wechat/login')
        .send({
          code: `mock-wechat-login:${subject('formal-handoff')}`,
        })
        .expect(200),
    );
    expect(formal.accessToken).not.toBe(value.token);
    expect(claims<{ kind: string }>(formal.accessToken).kind).toBe('access');
    await request(server)
      .get('/partners/me/profile')
      .auth(formal.accessToken, { type: 'bearer' })
      .expect(200);
    await me(formal.accessToken).expect(401);
    await request(server)
      .get('/partners/me/profile')
      .auth(value.token, { type: 'bearer' })
      .expect(401);
  });

  it('rejects disabled identities without retaining a usable applicant session', async () => {
    const value = await session();
    const payload = claims<{ sub: string }>(value.token);
    await prisma.user.update({
      where: { id: payload.sub },
      data: { status: 'DISABLED' },
    });
    await me(value.token).expect(401);
  });

  it('enforces a persisted per-applicant limit under concurrent requests', async () => {
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => login('limited')),
    );
    expect(responses.filter((item) => item.status === 200)).toHaveLength(5);
    expect(responses.filter((item) => item.status === 429)).toHaveLength(1);
  });

  it('rolls back identity and session creation when signing fails', async () => {
    const sign = jest
      .spyOn(app.get(JwtService), 'signAsync')
      .mockRejectedValueOnce(new Error('synthetic signing failure'));
    try {
      await login('signing-failure').expect(500);
      expect(
        await prisma.authIdentity.count({
          where: { provider: 'WECHAT', subject: subject('signing-failure') },
        }),
      ).toBe(0);
      const value = await session('signing-failure');
      expect(
        responseData<Session['me']>(await me(value.token).expect(200)),
      ).toEqual(value.me);
    } finally {
      sign.mockRestore();
    }
  });

  it('fails closed before identity creation when admission is unavailable', async () => {
    rateCheck.mockRejectedValueOnce(
      new DomainError('INTERNAL_SERVER_ERROR', 'synthetic unavailable', 503),
    );
    await login('unavailable').expect(503);
    expect(
      await prisma.authIdentity.count({
        where: { provider: 'WECHAT', subject: subject('unavailable') },
      }),
    ).toBe(0);
  });

  it.each([
    { sub: 'not-a-uuid' },
    { applicantId: 'not-a-uuid' },
    { jti: 'not-a-uuid' },
    { kind: 'access' },
    { exp: 1 },
    { aud: ['partner_application', 'access'] },
  ])(
    'rejects signed malformed, expired or wrong-kind claims %#',
    async (override) => {
      const value = await session();
      const payload = claims<Record<string, unknown>>(value.token);
      const token = await app
        .get(JwtService)
        .signAsync(
          { ...payload, ...override },
          { secret: process.env.JWT_ACCESS_SECRET },
        );
      await me(token).expect(401);
    },
  );

  it('rejects a forged binding between valid identities and sessions', async () => {
    const first = await session();
    const second = await session();
    const payload = claims<Record<string, unknown>>(first.token);
    const token = await app
      .get(JwtService)
      .signAsync(
        { ...payload, applicantId: second.me.applicantId },
        { secret: process.env.JWT_ACCESS_SECRET },
      );
    await me(token).expect(401);
  });

  it('refuses mock identity exchange outside local development and test', async () => {
    const config = app.get(ConfigService);
    const get = jest
      .spyOn(config, 'get')
      .mockReturnValueOnce('mock')
      .mockReturnValueOnce('production');
    try {
      await login('production-mock').expect(401);
      expect(
        await prisma.authIdentity.count({
          where: { provider: 'WECHAT', subject: subject('production-mock') },
        }),
      ).toBe(0);
    } finally {
      get.mockRestore();
    }
  });

  it('does not persist an identity after provider verification fails', async () => {
    const gateway = app.get<WechatIdentityGateway>(WECHAT_IDENTITY_GATEWAY);
    const exchange = jest
      .spyOn(gateway, 'exchangeLoginCode')
      .mockRejectedValueOnce(
        new DomainError(
          'WECHAT_PROVIDER_RESPONSE_INVALID',
          'synthetic provider rejection',
          502,
        ),
      );
    try {
      await login('provider-rejected').expect(502);
      expect(
        await prisma.authIdentity.count({
          where: { provider: 'WECHAT', subject: subject('provider-rejected') },
        }),
      ).toBe(0);
    } finally {
      exchange.mockRestore();
    }
  });
});
