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
const base = '/partners/me/campaign-drafts';
const data = (response: { body: unknown }): Record<string, unknown> =>
  (response.body as { data: Record<string, unknown> }).data;
const question = (changes = {}) => ({
  id: 'q1',
  kind: 'TEXT',
  label: '姓名',
  hint: '',
  required: true,
  options: [],
  ...changes,
});

describe('private campaign form in the dedicated local database', () => {
  const runTag = `cform-${randomUUID().slice(0, 8)}`;
  const users: string[] = [];
  let app: INestApplication,
    prisma: PrismaService,
    server: Server,
    campusId: string;
  let partner: string, foreign: string, parent: string, admin: string;
  let setup: Promise<void> | undefined;
  let setupDeadline = 0;
  const checkSetupDeadline = () => {
    if (Date.now() > setupDeadline)
      throw new Error(
        'Synthetic form setup deadline reached; stop creating fixtures',
      );
  };
  const actor = async (roleCode: RoleCode, scope: string | null) => {
    if (setupDeadline) checkSetupDeadline();
    const row = await prisma.user.create({
      data: {
        displayName: `${runTag}-${users.length}`,
        roles: { create: { roleCode, campusId: scope } },
      },
    });
    users.push(row.id);
    if (setupDeadline) checkSetupDeadline();
    return (await app.get(AuthService).issueSessionForUser(row.id)).accessToken;
  };
  const create = async (campaignType = 'FLASH_SALE') =>
    String(
      data(
        await request(server)
          .post(base)
          .auth(partner, { type: 'bearer' })
          .set('Idempotency-Key', randomUUID())
          .send({ title: '合成表单活动', campaignType })
          .expect(200),
      ).draftId,
    );
  const save = (
    id: string,
    version: number,
    registrationForm: unknown,
    token = partner,
  ) =>
    request(server)
      .put(`${base}/${id}/registration-form`)
      .auth(token, { type: 'bearer' })
      .send({ expectedVersion: version, registrationForm });
  const get = (id: string) =>
    request(server).get(`${base}/${id}`).auth(partner, { type: 'bearer' });
  beforeAll(() => {
    setup = (async () => {
      const started = Date.now();
      setupDeadline = started + 45_000;
      const stage = (value: string) =>
        process.stdout.write(
          `CAMPAIGN_FORM_SETUP ${JSON.stringify({ runTag, stage: value, elapsedMs: Date.now() - started })}\n`,
        );
      stage('start');
      ({ app, prisma } = await createPartnerPdfTestApp());
      stage('app-ready');
      checkSetupDeadline();
      server = app.getHttpServer() as Server;
      campusId = (
        await prisma.campus.create({
          data: { code: runTag, name: '合成表单校区' },
        })
      ).id;
      stage('campus-ready');
      checkSetupDeadline();
      const other = (
        await prisma.campus.create({
          data: { code: `${runTag}-other`, name: '合成其他校区' },
        })
      ).id;
      checkSetupDeadline();
      partner = await actor('PARTNER', campusId);
      foreign = await actor('PARTNER', other);
      parent = await actor('PARENT', campusId);
      admin = await actor('SUPER_ADMIN', null);
      stage('actors-ready');
      setupDeadline = 0;
    })();
    return setup;
  });
  afterAll(async () => {
    try {
      await setup?.catch(() => undefined);
      if (prisma) {
        assertPartnerPdfTestTarget(process.env);
        const disabled = await prisma.user.updateMany({
          where: {
            id: { in: users },
            displayName: { startsWith: `${runTag}-` },
          },
          data: { status: 'DISABLED' },
        });
        process.stdout.write(
          `PARTNER_CAMPAIGN_FORM_OWNERSHIP ${JSON.stringify({
            runTag,
            campusId,
            users: users.length,
            disabled: disabled.count,
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
    'saves and clears %s form without publishing or replacing another partition',
    async (type) => {
      const id = await create(type);
      expect(data(await get(id).expect(200)).registrationForm).toEqual([]);
      const form = [
        question({ label: ' 姓名 ', hint: ' 合成备注 ' }),
        question({
          id: 'q2',
          kind: 'SINGLE_CHOICE',
          label: '班次',
          options: ['上午', '下午'],
        }),
      ];
      await save(id, 1, form).expect(200);
      await request(server)
        .put(`${base}/${id}/basic-information`)
        .auth(partner, { type: 'bearer' })
        .send({
          expectedVersion: 2,
          basicInformation: { title: '只改名称', campaignType: type },
        })
        .expect(200);
      await request(server)
        .put(`${base}/${id}/content`)
        .auth(partner, { type: 'bearer' })
        .send({ expectedVersion: 3, activityContent: '合成正文' })
        .expect(200);
      expect(data(await get(id).expect(200))).toMatchObject({
        version: 4,
        activityContent: '合成正文',
        registrationForm: [question({ hint: '合成备注' }), form[1]],
      });
      const summaries = await request(server)
        .get(base)
        .auth(partner, { type: 'bearer' })
        .expect(200);
      expect(JSON.stringify(summaries.body)).not.toContain('合成备注');
      expect(
        JSON.stringify(
          await prisma.auditLog.findMany({ where: { resourceId: id } }),
        ),
      ).not.toContain('合成备注');
      expect(await prisma.campaign.count({ where: { draftId: id } })).toBe(0);
      await save(id, 4, []).expect(200);
      expect(data(await get(id).expect(200))).toMatchObject({
        registrationForm: [],
        version: 5,
      });
    },
  );
  it.each([
    null,
    {},
    undefined,
    [question({ kind: 'ID_CARD' })],
    [question({ label: '' })],
    [question({ required: 'true' })],
    [question({ options: ['不应有'] })],
    [question({ kind: 'SINGLE_CHOICE', options: ['重复', ' 重复 '] })],
    [question({ label: '😀'.repeat(81) })],
    [question({ label: '\u0000' })],
    [question({ label: '\ud800' })],
    [question({ answer: '不可保存答案' })],
    [question(), question()],
    Array.from({ length: 21 }, (_, i) => question({ id: `q${i}` })),
  ])(
    'rejects malformed template without a version change (%#)',
    async (value) => {
      const id = await create();
      await save(id, 1, value).expect(400);
      expect(data(await get(id).expect(200))).toMatchObject({
        version: 1,
        registrationForm: [],
      });
    },
  );
  it('serializes concurrent retries and rejects competing changes', async () => {
    const id = await create();
    const same = await Promise.all([
      save(id, 1, [question()]),
      save(id, 1, [question()]),
    ]);
    expect(same.map((v) => v.status)).toEqual([200, 200]);
    expect(data(same[0])).toEqual(data(same[1]));
    const different = await Promise.all([
      save(id, 2, []),
      save(id, 2, [question({ label: '年龄', kind: 'AGE' })]),
    ]);
    expect(different.map((v) => v.status).sort()).toEqual([200, 409]);
    expect(await prisma.auditLog.count({ where: { resourceId: id } })).toBe(3);
  });
  it('accepts all seven question kinds and code-point boundaries', async () => {
    const id = await create();
    const form = [
      'TEXT',
      'NUMBER',
      'SINGLE_CHOICE',
      'MULTI_CHOICE',
      'AGE',
      'DATE',
      'MOBILE',
    ].map((kind, i) =>
      question({
        id: `kind-${i}`,
        kind,
        label: '😀'.repeat(80),
        hint: '字'.repeat(200),
        options: kind.endsWith('CHOICE') ? ['选项甲', '选项乙'] : [],
      }),
    );
    await save(id, 1, form).expect(200);
    expect(data(await get(id).expect(200)).registrationForm).toEqual(form);
  });
  it('does not freeze or expose a private template through free review or parent reading', async () => {
    const id = await create('FREE_REGISTRATION');
    await save(id, 1, [question({ label: '私有模板不可公开' })]).expect(200);
    await request(server)
      .put(`${base}/${id}/basic-information`)
      .auth(partner, { type: 'bearer' })
      .send({
        expectedVersion: 2,
        basicInformation: {
          title: '合成免费活动',
          campaignType: 'FREE_REGISTRATION',
          shareDescription: '合成公开说明',
        },
      })
      .expect(200);
    await request(server)
      .put(`${base}/${id}/free-registration`)
      .auth(partner, { type: 'bearer' })
      .send({
        expectedVersion: 3,
        freeRegistration: {
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: new Date(Date.now() + 3_600_000).toISOString(),
          capacityMode: 'UNLIMITED',
          maxRegistrations: null,
        },
      })
      .expect(200);
    const review = data(
      await request(server)
        .post(`${base}/${id}/submit`)
        .auth(partner, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: 4 })
        .expect(200),
    );
    const detail = await request(server)
      .get(`/management/campaign-reviews/${String(review.versionId)}`)
      .auth(admin, { type: 'bearer' })
      .expect(200);
    expect(JSON.stringify(detail.body)).not.toMatch(
      /registrationForm|私有模板不可公开/,
    );
    await save(id, 4, []).expect(200);
    await request(server)
      .post(`/management/campaign-reviews/${String(review.versionId)}/approve`)
      .auth(admin, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: review.version })
      .expect(200);
    const publicDetail = await request(server)
      .get(`/parents/me/free-campaigns/${String(review.campaignId)}`)
      .auth(parent, { type: 'bearer' })
      .expect(200);
    expect(JSON.stringify(publicDetail.body)).not.toMatch(
      /registrationForm|私有模板不可公开/,
    );
  });
  it('checks role, campus and current active identity without exposing foreign versions', async () => {
    const id = await create();
    await save(id, 999, [], foreign).expect(404);
    await save(randomUUID(), 1, []).expect(404);
    await save(id, 1, [], parent).expect(403);
    await request(server)
      .put(`${base}/${id}/registration-form`)
      .send({ expectedVersion: 1, registrationForm: [] })
      .expect(401);
    await request(server)
      .put(`${base}/${id}/registration-form`)
      .auth(partner, { type: 'bearer' })
      .send({ expectedVersion: 1, registrationForm: [], campusId })
      .expect(400);
  });
  it('rejects an old token after its exact synthetic actor is disabled without changing the draft', async () => {
    const id = await create();
    const token = await actor('PARTNER', campusId);
    const actorId = users[users.length - 1];
    await prisma.user.update({
      where: { id: actorId, displayName: `${runTag}-${users.length - 1}` },
      data: { status: 'DISABLED' },
    });
    const audits = await prisma.auditLog.count({ where: { resourceId: id } });
    await save(id, 1, [question()], token).expect(401);
    expect(data(await get(id).expect(200))).toMatchObject({
      registrationForm: [],
      version: 1,
    });
    expect(await prisma.auditLog.count({ where: { resourceId: id } })).toBe(
      audits,
    );
  });
  it('rolls back form and version when the audit fails', async () => {
    const id = await create();
    const extension = prisma.$extends({
      query: {
        auditLog: {
          create: () => {
            throw new Error('synthetic form audit fault');
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
      await save(id, 1, [question()]).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(data(await get(id).expect(200))).toMatchObject({
      registrationForm: [],
      version: 1,
    });
  });
});
