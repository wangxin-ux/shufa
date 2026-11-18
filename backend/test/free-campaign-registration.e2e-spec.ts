import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { Prisma, RoleCode } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import { PAYMENT_ADAPTER } from '../src/infrastructure/payment/payment.constants';
import type { PaymentAdapter } from '../src/infrastructure/payment/payment.adapter';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);

type DraftReceipt = {
  draftId: string;
  status: 'DRAFT';
  version: number;
  createdAt: string;
  updatedAt: string;
};
type Review = {
  versionId: string;
  campaignId: string;
  draftId: string;
  campusId: string;
  title: string;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  version: number;
  sequence: number;
  submittedAt: string;
  reviewedAt: string | null;
};
type Registration = {
  registrationId: string;
  campaignId: string;
  versionId: string;
  studentId: string;
  status: 'REGISTERED' | 'CANCELLED';
  version: number;
  registeredAt: string;
  cancelledAt: string | null;
};
const data = <T>(response: { body: unknown }): T =>
  (response.body as { data: T }).data;
const meta = (response: { body: unknown }) =>
  (
    response.body as {
      meta: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
      };
    }
  ).meta;

describe('free campaign registration in the dedicated database', () => {
  const runTag = `fcreg-${randomUUID().slice(0, 8)}`;
  const ownedUsers: string[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let campusId: string;
  let partnerToken: string;
  let adminToken: string;
  let parentToken: string;
  let secondParentToken: string;
  let teacherToken: string;
  let foreignPartnerToken: string;
  let parentId: string;
  let studentId: string;
  let secondStudentId: string;
  let otherCampusId: string;
  let payment: jest.SpyInstance;
  let refund: jest.SpyInstance;
  const base = '/partners/me/campaign-drafts';
  const configuration = () => ({
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    capacityMode: 'LIMITED',
    maxRegistrations: 1 as number | null,
  });
  const makeDraft = async () =>
    data<DraftReceipt>(
      await request(server)
        .post(base)
        .auth(partnerToken, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({
          title: `${runTag}免费体验`,
          campaignType: 'FREE_REGISTRATION',
          shareDescription: '合成资料：免费登记，不自动送课',
        })
        .expect(200),
    );
  const api = (
    method: 'get' | 'post' | 'put',
    path: string,
    token: string,
    body?: object,
    key?: string,
  ) => {
    const call = request(server)[method](path).auth(token, { type: 'bearer' });
    if (body !== undefined) call.send(body);
    if (key) call.set('Idempotency-Key', key);
    return call;
  };
  const makeUser = async (
    roleCode: RoleCode,
    scope: string | null = campusId,
  ) => {
    const user = await prisma.user.create({
      data: {
        displayName: `${runTag}-${ownedUsers.length}`,
        roles: { create: { roleCode, campusId: scope } },
      },
    });
    ownedUsers.push(user.id);
    return {
      id: user.id,
      token: (await app.get(AuthService).issueSessionForUser(user.id))
        .accessToken,
    };
  };
  const configuredDraft = async (
    override: Partial<ReturnType<typeof configuration>> = {},
  ) => {
    const draft = await makeDraft();
    const saved = await api(
      'put',
      `${base}/${draft.draftId}/free-registration`,
      partnerToken,
      {
        expectedVersion: draft.version,
        freeRegistration: { ...configuration(), ...override },
      },
    ).expect(200);
    return data<DraftReceipt>(saved);
  };
  const submit = async (draft: DraftReceipt, key = randomUUID()) =>
    data<Review>(
      await api(
        'post',
        `${base}/${draft.draftId}/submit`,
        partnerToken,
        { expectedVersion: draft.version },
        key,
      ).expect(200),
    );
  const approve = async (review: Review, key = randomUUID()) =>
    data<Review>(
      await api(
        'post',
        `/management/campaign-reviews/${review.versionId}/approve`,
        adminToken,
        { expectedVersion: review.version },
        key,
      ).expect(200),
    );
  const published = async (
    override: Partial<ReturnType<typeof configuration>> = {},
  ) => {
    const draft = await configuredDraft(override);
    const submitted = await submit(draft);
    return { draft, review: await approve(submitted) };
  };
  const register = (
    review: Review,
    student = studentId,
    token = parentToken,
    key = randomUUID(),
  ) =>
    api(
      'post',
      `/parents/me/free-campaigns/${review.campaignId}/registrations`,
      token,
      { versionId: review.versionId, studentId: student },
      key,
    );
  const cancel = (row: Registration, token = parentToken, key = randomUUID()) =>
    api(
      'post',
      `/parents/me/campaign-registrations/${row.registrationId}/cancel`,
      token,
      { expectedVersion: row.version },
      key,
    );
  const financialFacts = async () => ({
    groups: await prisma.groupCampaign.count({ where: { campusId } }),
    orders: await prisma.enrollmentOrder.count({ where: { campusId } }),
    packages: await prisma.coursePackage.count({ where: { campusId } }),
    ledger: await prisma.lessonLedgerEntry.count({ where: { campusId } }),
    partnerEarnings: await prisma.partnerEarningEntry.count({
      where: { campusId },
    }),
    teacherEarnings: await prisma.teacherEarningEntry.count({
      where: { campusId },
    }),
    payments: await prisma.paymentTransaction.count({
      where: { enrollmentOrder: { campusId } },
    }),
  });

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    const adapter = app.get<PaymentAdapter>(PAYMENT_ADAPTER);
    payment = jest.spyOn(adapter, 'createJsapiPayment');
    refund = jest.spyOn(adapter, 'requestRefund');
    server = app.getHttpServer() as Server;
    campusId = (
      await prisma.campus.create({
        data: { code: runTag, name: `${runTag}合成校区` },
      })
    ).id;
    otherCampusId = (
      await prisma.campus.create({
        data: { code: `${runTag}-other`, name: `${runTag}其他校区` },
      })
    ).id;
    partnerToken = (await makeUser('PARTNER')).token;
    adminToken = (await makeUser('SUPER_ADMIN', null)).token;
    const parent = await makeUser('PARENT');
    parentId = parent.id;
    parentToken = parent.token;
    const guardian = await makeUser('PARENT');
    secondParentToken = guardian.token;
    teacherToken = (await makeUser('TEACHER')).token;
    foreignPartnerToken = (await makeUser('PARTNER', otherCampusId)).token;
    for (let index = 0; index < 2; index++) {
      const student = await prisma.student.create({
        data: { campusId, displayName: `${runTag}学员${index}` },
      });
      await prisma.parentStudentBinding.create({
        data: { campusId, parentUserId: parentId, studentId: student.id },
      });
      if (index === 0) {
        studentId = student.id;
        await prisma.parentStudentBinding.create({
          data: { campusId, parentUserId: guardian.id, studentId },
        });
      } else secondStudentId = student.id;
    }
  });

  afterAll(async () => {
    try {
      if (prisma) {
        assertPartnerPdfTestTarget(process.env);
        await prisma.user.updateMany({
          where: {
            id: { in: ownedUsers },
            displayName: { startsWith: runTag },
          },
          data: { status: 'DISABLED' },
        });
        process.stdout.write(
          `FREE_CAMPAIGN_FIXTURE_OWNERSHIP ${JSON.stringify({
            runTag,
            campusId,
            userIds: ownedUsers,
            disposition:
              'retained; owned synthetic users disabled; no deletion',
          })}\n`,
        );
      }
    } finally {
      payment?.mockRestore();
      refund?.mockRestore();
      await app?.close();
    }
  });

  it('saves and reads an explicit free-registration configuration', async () => {
    const draft = await makeDraft();
    const freeRegistration = configuration();
    const saved = await request(server)
      .put(`${base}/${draft.draftId}/free-registration`)
      .auth(partnerToken, { type: 'bearer' })
      .send({ expectedVersion: draft.version, freeRegistration });
    expect(saved.status).toBe(200);
    expect(data<DraftReceipt>(saved)).toMatchObject({
      draftId: draft.draftId,
      version: 2,
      status: 'DRAFT',
    });
    const detail = await request(server)
      .get(`${base}/${draft.draftId}/free-registration`)
      .auth(partnerToken, { type: 'bearer' })
      .expect(200);
    expect(data<Record<string, unknown>>(detail)).toMatchObject({
      draftId: draft.draftId,
      version: 2,
      campusTimezone: 'Asia/Shanghai',
      freeRegistration,
      campaignId: null,
      publishedVersionId: null,
    });
  });

  it('freezes, rejects, resubmits and publishes without any financial or lesson facts', async () => {
    const before = await financialFacts();
    const draft = await configuredDraft();
    const first = await submit(draft);
    await api(
      'get',
      `/parents/me/free-campaigns/${first.campaignId}`,
      parentToken,
    ).expect(404);
    const rejected = await api(
      'post',
      `/management/campaign-reviews/${first.versionId}/reject`,
      adminToken,
      { expectedVersion: first.version, reason: '合成资料：补充活动说明' },
      randomUUID(),
    ).expect(200);
    expect(data<Review>(rejected).status).toBe('REJECTED');
    const second = await submit(draft);
    expect(second.sequence).toBe(2);
    const live = await approve(second);
    const detail = await api(
      'get',
      `/parents/me/free-campaigns/${live.campaignId}`,
      parentToken,
    ).expect(200);
    expect(data<Record<string, unknown>>(detail)).toMatchObject({
      versionId: live.versionId,
      availability: 'AVAILABLE',
      configuration: {
        feeFen: 0,
        benefitMode: 'NONE',
        registrationLimit: 'ONCE_PER_STUDENT',
      },
    });
    const row = data<Registration>(await register(live).expect(200));
    expect(row.status).toBe('REGISTERED');
    expect(data<Registration>(await cancel(row).expect(200)).status).toBe(
      'CANCELLED',
    );
    expect(await financialFacts()).toEqual(before);
  });

  it('preserves new settings through old basic saves and naturally replays unchanged configuration', async () => {
    const draft = await configuredDraft();
    const detail = data<{ freeRegistration: ReturnType<typeof configuration> }>(
      await api(
        'get',
        `${base}/${draft.draftId}/free-registration`,
        partnerToken,
      ).expect(200),
    );
    const unchanged = await api(
      'put',
      `${base}/${draft.draftId}/free-registration`,
      partnerToken,
      {
        expectedVersion: draft.version - 1,
        freeRegistration: detail.freeRegistration,
      },
    ).expect(200);
    expect(data<DraftReceipt>(unchanged).version).toBe(draft.version);
    await api(
      'put',
      `${base}/${draft.draftId}/basic-information`,
      partnerToken,
      {
        expectedVersion: draft.version,
        basicInformation: {
          title: `${runTag}修改名称`,
          campaignType: 'FREE_REGISTRATION',
          shareDescription: '修改后说明',
        },
      },
    ).expect(200);
    expect(
      data<Record<string, unknown>>(
        await api(
          'get',
          `${base}/${draft.draftId}/free-registration`,
          partnerToken,
        ).expect(200),
      ).freeRegistration,
    ).toEqual(detail.freeRegistration);
  });

  it.each([
    { capacityMode: 'LIMITED', maxRegistrations: 0 },
    { capacityMode: 'LIMITED', maxRegistrations: 1.5 },
    { capacityMode: 'LIMITED', maxRegistrations: 2147483648 },
    { capacityMode: 'UNKNOWN', maxRegistrations: null },
    { capacityMode: 'UNLIMITED', maxRegistrations: 1 },
    { startsAt: '2026-02-30T00:00:00.000Z' },
    { startsAt: '2026-10-13T12:00:00' },
    { endsAt: '2020-01-01T00:00:00.000Z' },
    { extra: 'rejected' },
  ])(
    'rejects invalid settings and unknown nested fields (%#)',
    async (override) => {
      const draft = await makeDraft();
      await api(
        'put',
        `${base}/${draft.draftId}/free-registration`,
        partnerToken,
        {
          expectedVersion: draft.version,
          freeRegistration: { ...configuration(), ...override },
        },
      ).expect(400);
    },
  );

  it('keeps partial settings private and rejects incomplete submissions', async () => {
    const draft = await makeDraft();
    const saved = data<DraftReceipt>(
      await api(
        'put',
        `${base}/${draft.draftId}/free-registration`,
        partnerToken,
        {
          expectedVersion: draft.version,
          freeRegistration: {
            startsAt: null,
            endsAt: null,
            capacityMode: null,
            maxRegistrations: null,
          },
        },
      ).expect(200),
    );
    await api(
      'post',
      `${base}/${draft.draftId}/submit`,
      partnerToken,
      { expectedVersion: saved.version },
      randomUUID(),
    ).expect(400);
  });

  it('replays submission and approval but rejects changed keys, stale versions and parallel double approvals', async () => {
    const draft = await configuredDraft();
    const key = randomUUID();
    const first = await submit(draft, key);
    expect(await submit(draft, key)).toEqual(first);
    await api(
      'post',
      `${base}/${draft.draftId}/submit`,
      partnerToken,
      { expectedVersion: draft.version + 1 },
      key,
    ).expect(409);
    await api(
      'post',
      `${base}/${draft.draftId}/submit`,
      partnerToken,
      { expectedVersion: draft.version },
      randomUUID(),
    ).expect(409);
    const anotherAdmin = await makeUser('SUPER_ADMIN', null);
    const results = await Promise.all(
      [0, 1].map((index) =>
        api(
          'post',
          `/management/campaign-reviews/${first.versionId}/approve`,
          index === 0 ? adminToken : anotherAdmin.token,
          { expectedVersion: first.version },
          randomUUID(),
        ),
      ),
    );
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    await api(
      'post',
      `/management/campaign-reviews/${first.versionId}/reject`,
      adminToken,
      { expectedVersion: first.version, reason: '不能重复审核' },
      randomUUID(),
    ).expect(409);
  });

  it('deduplicates one student across keys and guardians without exposing another guardian result', async () => {
    const { review } = await published();
    const key = randomUUID();
    const row = data<Registration>(
      await register(review, studentId, parentToken, key).expect(200),
    );
    expect(
      data<Registration>(
        await register(review, studentId, parentToken, key).expect(200),
      ),
    ).toEqual(row);
    await register(review).expect(409);
    await register(review, studentId, secondParentToken).expect(409);
    await api(
      'get',
      `/parents/me/campaign-registrations/${row.registrationId}`,
      secondParentToken,
    ).expect(404);
    await cancel(row, secondParentToken).expect(404);
    const list = await api(
      'get',
      `/parents/me/campaign-registrations`,
      secondParentToken,
    ).expect(200);
    expect((list.body as { data: unknown[] }).data).toEqual([]);
  });

  it('serializes the last place, releases it once on cancellation and keeps lifetime eligibility', async () => {
    const { review } = await published();
    const responses = await Promise.all([
      register(review),
      register(review, secondStudentId),
    ]);
    expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
    const row = data<Registration>(
      responses.find((res) => res.status === 200)!,
    );
    const key = randomUUID();
    const cancelled = data<Registration>(
      await cancel(row, parentToken, key).expect(200),
    );
    expect(
      data<Registration>(await cancel(row, parentToken, key).expect(200)),
    ).toEqual(cancelled);
    await cancel(row).expect(409);
    await register(review, row.studentId).expect(409);
    const another = row.studentId === studentId ? secondStudentId : studentId;
    await register(review, another).expect(200);
  });

  it('keeps frozen content and old results when a new approved version replaces the link', async () => {
    const { draft, review } = await published({ maxRegistrations: 2 });
    const registered = data<Registration>(await register(review).expect(200));
    const changed = data<DraftReceipt>(
      await api(
        'put',
        `${base}/${draft.draftId}/basic-information`,
        partnerToken,
        {
          expectedVersion: draft.version,
          basicInformation: {
            title: '新版活动合成名称',
            campaignType: 'FREE_REGISTRATION',
            shareDescription: '新版活动说明',
          },
        },
      ).expect(200),
    );
    const candidate = await submit(changed);
    const oldBefore = await api(
      'get',
      `/parents/me/free-campaigns/${review.campaignId}?versionId=${review.versionId}`,
      parentToken,
    ).expect(200);
    expect(
      data<{ configuration: { title: string } }>(oldBefore).configuration.title,
    ).toBe(review.title);
    await approve(candidate);
    const oldAfter = await api(
      'get',
      `/parents/me/free-campaigns/${review.campaignId}?versionId=${review.versionId}`,
      parentToken,
    ).expect(200);
    expect(data<Record<string, unknown>>(oldAfter).availability).toBe(
      'REPLACED',
    );
    await register(review, secondStudentId).expect(409);
    await register(candidate).expect(409);
    expect(
      data<Registration>(
        await api(
          'get',
          `/parents/me/campaign-registrations/${registered.registrationId}`,
          parentToken,
        ).expect(200),
      ).versionId,
    ).toBe(review.versionId);
    await cancel(registered).expect(200);
  });

  it('blocks unsupported roles, foreign drafts and forged student or server-controlled fields', async () => {
    const draft = await makeDraft();
    await api(
      'get',
      `${base}/${draft.draftId}/free-registration`,
      foreignPartnerToken,
    ).expect(404);
    for (const token of [teacherToken, adminToken, parentToken]) {
      await api('put', `${base}/${draft.draftId}/free-registration`, token, {
        expectedVersion: draft.version,
        freeRegistration: configuration(),
      }).expect(403);
    }
    const { review } = await published();
    for (const token of [partnerToken, teacherToken, adminToken])
      await register(review, studentId, token).expect(403);
    await register(review, randomUUID()).expect(403);
    await api(
      'post',
      `/parents/me/free-campaigns/${review.campaignId}/registrations`,
      parentToken,
      { versionId: review.versionId, studentId, campusId },
      randomUUID(),
    ).expect(400);
    await api(
      'post',
      `/management/campaign-reviews/${review.versionId}/approve`,
      partnerToken,
      { expectedVersion: review.version },
      randomUUID(),
    ).expect(403);
  });

  it('returns private paginated histories and minimum campus registration fields', async () => {
    const { draft, review } = await published();
    const row = data<Registration>(await register(review).expect(200));
    const history = await api(
      'get',
      `${base}/${draft.draftId}/versions?page=1&pageSize=1`,
      partnerToken,
    ).expect(200);
    expect((history.body as { data: Review[] }).data[0].versionId).toBe(
      review.versionId,
    );
    const names = await api(
      'get',
      `${base}/${draft.draftId}/registrations?page=1&pageSize=1`,
      partnerToken,
    ).expect(200);
    expect(
      (names.body as { data: Array<{ registrationId: string }> }).data[0]
        .registrationId,
    ).toBe(row.registrationId);
    expect(JSON.stringify(names.body)).not.toMatch(
      /parentUserId|parentPhone|openid|homeAddress/,
    );
    await api(
      'get',
      `${base}/${draft.draftId}/registrations`,
      foreignPartnerToken,
    ).expect(404);
  });
  describe('partner registration status filtering', () => {
    let draft: DraftReceipt;
    let active: Registration;
    let cancelled: Registration;
    beforeAll(async () => {
      const fixture = await published({
        capacityMode: 'UNLIMITED',
        maxRegistrations: null,
      });
      draft = fixture.draft;
      active = data<Registration>(await register(fixture.review).expect(200));
      cancelled = data<Registration>(
        await register(fixture.review, secondStudentId).expect(200),
      );
      await cancel(cancelled).expect(200);
    });
    const list = (query: string, token = partnerToken) =>
      api('get', `${base}/${draft.draftId}/registrations?${query}`, token);
    it('keeps omission compatible and paginates all records without private fields', async () => {
      const first = await list('page=1&pageSize=1').expect(200);
      const second = await list('page=2&pageSize=1').expect(200);
      const rows = [
        ...data<Registration[]>(first),
        ...data<Registration[]>(second),
      ];
      expect(new Set(rows.map((row) => row.registrationId))).toEqual(
        new Set([active.registrationId, cancelled.registrationId]),
      );
      expect(meta(first)).toEqual({
        page: 1,
        pageSize: 1,
        total: 2,
        totalPages: 2,
      });
      expect(
        JSON.stringify(first.body) + JSON.stringify(second.body),
      ).not.toMatch(/parentUserId|parentPhone|openid|homeAddress/);
    });
    it.each(['REGISTERED', 'CANCELLED'])(
      'applies %s to the full count and every page',
      async (status) => {
        const response = await list(
          `page=1&pageSize=1&status=${status}`,
        ).expect(200);
        expect(meta(response)).toEqual({
          page: 1,
          pageSize: 1,
          total: 1,
          totalPages: 1,
        });
        expect(data<Registration[]>(response)).toEqual([
          expect.objectContaining({
            registrationId:
              status === 'REGISTERED'
                ? active.registrationId
                : cancelled.registrationId,
            status,
          }),
        ]);
        const end = await list(`page=2&pageSize=1&status=${status}`).expect(
          200,
        );
        expect(data(end)).toEqual([]);
        expect(meta(end).total).toBe(1);
      },
    );
    it.each([
      'status=',
      'status=ALL',
      'status=REJECTED',
      'status=registered',
      'status=REGISTERED&status=CANCELLED',
      'status=REGISTERED&campusId=forged',
    ])('rejects invalid or forged filter %s', async (query) => {
      await list(query).expect(400);
    });
    it.each(['REGISTERED', 'CANCELLED'])(
      'retains campus and role isolation for %s reads',
      async (status) => {
        await list(`status=${status}`, foreignPartnerToken).expect(404);
        for (const token of [parentToken, teacherToken, adminToken])
          await list(`status=${status}`, token).expect(403);
        await api(
          'get',
          `${base}/${randomUUID()}/registrations?status=${status}`,
          partnerToken,
        ).expect(404);
      },
    );
    it('keeps filtered records but hides names when an owned synthetic student is inactive', async () => {
      await prisma.student.update({
        where: { id: secondStudentId },
        data: { isActive: false },
      });
      try {
        const response = await list('status=CANCELLED').expect(200);
        expect(meta(response).total).toBe(1);
        expect(data<Registration[]>(response)[0]).toMatchObject({
          registrationId: cancelled.registrationId,
          studentName: null,
        });
      } finally {
        await prisma.student.update({
          where: { id: secondStudentId },
          data: { isActive: true },
        });
      }
    });
    it('keeps filtered count and rows in one snapshot when cancellation commits between them', async () => {
      let interleaved = false;
      const extension = prisma.$extends({
        query: {
          campaignRegistration: {
            count: async ({ args, query }) => {
              const total = await query(args);
              await cancel(active).expect(200);
              interleaved = true;
              return total;
            },
          },
        },
      });
      const spy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce(
          (
            callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
            options?: object,
          ) =>
            extension.$transaction(
              (tx) => callback(tx as unknown as Prisma.TransactionClient),
              options,
            ),
        );
      try {
        const response = await list('status=REGISTERED').expect(200);
        expect(interleaved).toBe(true);
        expect(meta(response).total).toBe(1);
        expect(data<Registration[]>(response)).toEqual([
          expect.objectContaining({
            registrationId: active.registrationId,
            status: 'REGISTERED',
          }),
        ]);
      } finally {
        spy.mockRestore();
      }
      const latest = await list('status=REGISTERED').expect(200);
      expect(meta(latest).total).toBe(0);
      expect(data(latest)).toEqual([]);
      process.stdout.write(
        `PARTNER_REGISTRATION_FILTER_SNAPSHOT ${JSON.stringify({ runTag, draftId: draft.draftId, interleavedCancellation: true, snapshotTotal: 1, currentTotal: 0 })}\n`,
      );
    });
  });

  it('closes permanently, keeps original cancellation and replays committed receipts after closure', async () => {
    const { draft, review } = await published();
    const key = randomUUID();
    const row = data<Registration>(
      await register(review, studentId, parentToken, key).expect(200),
    );
    const current = data<{ campaignVersion: number }>(
      await api(
        'get',
        `/management/campaign-reviews/${review.versionId}`,
        adminToken,
      ).expect(200),
    );
    const closeKey = randomUUID();
    const closePath = `/management/campaigns/${review.campaignId}/close`;
    const body = {
      expectedVersion: current.campaignVersion,
      reason: '合成关闭原因',
    };
    const closed = await api(
      'post',
      closePath,
      adminToken,
      body,
      closeKey,
    ).expect(200);
    expect(
      data(
        await api('post', closePath, adminToken, body, closeKey).expect(200),
      ),
    ).toEqual(data(closed));
    expect(
      data<Registration>(
        await register(review, studentId, parentToken, key).expect(200),
      ),
    ).toEqual(row);
    await register(review, secondStudentId).expect(409);
    expect(
      data<{ availability: string }>(
        await api(
          'get',
          `/parents/me/free-campaigns/${review.campaignId}`,
          parentToken,
        ).expect(200),
      ).availability,
    ).toBe('CLOSED');
    await cancel(row).expect(200);
    await api(
      'post',
      `${base}/${draft.draftId}/submit`,
      partnerToken,
      { expectedVersion: draft.version },
      randomUUID(),
    ).expect(409);
  });

  it('refuses a replacement capacity below current occupancy and retains the published pointer', async () => {
    const { draft, review } = await published({ maxRegistrations: 2 });
    await register(review).expect(200);
    await register(review, secondStudentId).expect(200);
    const current = data<{
      freeRegistration: ReturnType<typeof configuration>;
    }>(
      await api(
        'get',
        `${base}/${draft.draftId}/free-registration`,
        partnerToken,
      ).expect(200),
    );
    const updated = data<DraftReceipt>(
      await api(
        'put',
        `${base}/${draft.draftId}/free-registration`,
        partnerToken,
        {
          expectedVersion: draft.version,
          freeRegistration: {
            ...current.freeRegistration,
            maxRegistrations: 1,
          },
        },
      ).expect(200),
    );
    const candidate = await submit(updated);
    await api(
      'post',
      `/management/campaign-reviews/${candidate.versionId}/approve`,
      adminToken,
      { expectedVersion: candidate.version },
      randomUUID(),
    ).expect(409);
    expect(
      (
        await prisma.campaign.findUniqueOrThrow({
          where: { id: review.campaignId },
        })
      ).publishedVersionId,
    ).toBe(review.versionId);
    expect(
      (
        await prisma.campaignVersion.findUniqueOrThrow({
          where: { id: candidate.versionId },
        })
      ).status,
    ).toBe('SUBMITTED');
  });

  it.each(['audit', 'receipt'] as const)(
    'rolls registration and cancellation back on a %s failure',
    async (fault) => {
      const { review } = await published();
      const extension =
        fault === 'audit'
          ? prisma.$extends({
              query: {
                auditLog: {
                  create: () => {
                    throw new Error('synthetic free audit failure');
                  },
                },
              },
            })
          : prisma.$extends({
              query: {
                idempotencyRecord: {
                  update: () => {
                    throw new Error('synthetic free receipt failure');
                  },
                },
              },
            });
      const key = randomUUID();
      const route = `/parents/me/free-campaigns/${review.campaignId}/registrations`;
      const beforeAudit = await prisma.auditLog.count({ where: { campusId } });
      const spy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce(((callback: (tx: unknown) => unknown) =>
          extension.$transaction(
            callback as never,
          )) as typeof prisma.$transaction);
      try {
        await register(review, studentId, parentToken, key).expect(500);
      } finally {
        spy.mockRestore();
      }
      expect(
        await prisma.campaignRegistration.count({
          where: { campaignId: review.campaignId },
        }),
      ).toBe(0);
      expect(await prisma.auditLog.count({ where: { campusId } })).toBe(
        beforeAudit,
      );
      expect(
        await prisma.idempotencyRecord.findUnique({
          where: { key_route: { key, route } },
        }),
      ).toBeNull();
      const row = data<Registration>(
        await register(review, studentId, parentToken, key).expect(200),
      );
      const cancelKey = randomUUID();
      const cancelRoute = `/parents/me/campaign-registrations/${row.registrationId}/cancel`;
      const cancelSpy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce(((callback: (tx: unknown) => unknown) =>
          extension.$transaction(
            callback as never,
          )) as typeof prisma.$transaction);
      try {
        await cancel(row, parentToken, cancelKey).expect(500);
      } finally {
        cancelSpy.mockRestore();
      }
      expect(
        (
          await prisma.campaignRegistration.findUniqueOrThrow({
            where: { id: row.registrationId },
          })
        ).status,
      ).toBe('REGISTERED');
      expect(
        await prisma.idempotencyRecord.findUnique({
          where: { key_route: { key: cancelKey, route: cancelRoute } },
        }),
      ).toBeNull();
      expect(
        data<Registration>(
          await cancel(row, parentToken, cancelKey).expect(200),
        ).status,
      ).toBe('CANCELLED');
    },
  );

  it.each(['submit', 'approve'] as const)(
    'rolls a failed %s audit back with no partial publication',
    async (action) => {
      const draft = await configuredDraft();
      const review = action === 'approve' ? await submit(draft) : undefined;
      const extension = prisma.$extends({
        query: {
          auditLog: {
            create: () => {
              throw new Error('synthetic publication fault');
            },
          },
        },
      });
      const key = randomUUID();
      const route = review
        ? `/management/campaign-reviews/${review.versionId}/approve`
        : `${base}/${draft.draftId}/submit`;
      const spy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce(((callback: (tx: unknown) => unknown) =>
          extension.$transaction(
            callback as never,
          )) as typeof prisma.$transaction);
      try {
        await api(
          'post',
          route,
          review ? adminToken : partnerToken,
          { expectedVersion: review?.version ?? draft.version },
          key,
        ).expect(500);
      } finally {
        spy.mockRestore();
      }
      expect(
        await prisma.idempotencyRecord.findUnique({
          where: { key_route: { key, route } },
        }),
      ).toBeNull();
      if (review) {
        expect(
          (
            await prisma.campaign.findUniqueOrThrow({
              where: { id: review.campaignId },
            })
          ).publishedVersionId,
        ).toBeNull();
        expect(
          (
            await prisma.campaignVersion.findUniqueOrThrow({
              where: { id: review.versionId },
            })
          ).status,
        ).toBe('SUBMITTED');
        await approve(review, key);
      } else {
        expect(
          await prisma.campaign.findUnique({
            where: { draftId: draft.draftId },
          }),
        ).toBeNull();
        await submit(draft, key);
      }
    },
  );

  it.each(['user', 'role', 'student', 'binding'] as const)(
    'holds current %s scope through registration and denies old keys after revocation',
    async (target) => {
      const actor = await makeUser('PARENT');
      const student = await prisma.student.create({
        data: { campusId, displayName: `${runTag}锁学员` },
      });
      const binding = await prisma.parentStudentBinding.create({
        data: { campusId, studentId: student.id, parentUserId: actor.id },
      });
      const { review } = await published();
      let entered!: () => void;
      let release!: () => void;
      const created = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const extension = prisma.$extends({
        query: {
          campaignRegistration: {
            create: async ({ args, query }) => {
              const row = await query(args);
              entered();
              await gate;
              return row;
            },
          },
        },
      });
      const original = prisma.$transaction.bind(prisma);
      const spy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce(((callback: (tx: unknown) => unknown) =>
          extension.$transaction(
            callback as never,
          )) as typeof prisma.$transaction);
      const key = randomUUID();
      const pending = register(review, student.id, actor.token, key).then(
        (res) => res,
      );
      let revocation: Promise<unknown> | undefined;
      try {
        await created;
        let identify!: (pid: number) => void;
        const identified = new Promise<number>((resolve) => {
          identify = resolve;
        });
        revocation = original(
          async (tx) => {
            const [row] = await tx.$queryRaw<
              Array<{ pid: number }>
            >`SELECT pg_backend_pid() AS pid`;
            identify(row.pid);
            if (target === 'user')
              await tx.user.update({
                where: { id: actor.id },
                data: { status: 'DISABLED' },
              });
            if (target === 'role')
              await tx.userRole.updateMany({
                where: { userId: actor.id },
                data: { campusId: otherCampusId },
              });
            if (target === 'student')
              await tx.student.update({
                where: { id: student.id },
                data: { campusId: otherCampusId },
              });
            if (target === 'binding')
              await tx.parentStudentBinding.update({
                where: { id: binding.id },
                data: { campusId: otherCampusId },
              });
          },
          { timeout: 15_000 },
        );
        const pid = await identified;
        let waiting = false;
        for (let attempt = 0; attempt < 80; attempt++) {
          const rows = await prisma.$queryRaw<
            Array<{ wait_event_type: string | null }>
          >`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`;
          if (rows[0]?.wait_event_type === 'Lock') {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(waiting).toBe(true);
        process.stdout.write(
          `FREE_CAMPAIGN_LOCK_EVIDENCE ${JSON.stringify({ runTag, target, waitingPid: pid, waitEvent: 'Lock' })}\n`,
        );
        release();
        expect((await pending).status).toBe(200);
        await revocation;
        await register(review, student.id, actor.token, key).expect(
          target === 'user' ? 401 : 403,
        );
      } finally {
        release();
        await pending;
        await revocation;
        spy.mockRestore();
      }
    },
  );

  it.each(['register', 'approve', 'cancel'] as const)(
    'rejects %s after waiting past the original end on the activity lock',
    async (action) => {
      const endsAt = new Date(Date.now() + 2500);
      const review =
        action === 'approve'
          ? await submit(
              await configuredDraft({ endsAt: endsAt.toISOString() }),
            )
          : (await published({ endsAt: endsAt.toISOString() })).review;
      const registration =
        action === 'cancel'
          ? data<Registration>(await register(review).expect(200))
          : undefined;
      let locked!: (pid: number) => void;
      let release!: () => void;
      const identified = new Promise<number>((resolve) => {
        locked = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const blocker = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${review.campaignId}::uuid FOR UPDATE`;
          const [row] = await tx.$queryRaw<
            Array<{ pid: number }>
          >`SELECT pg_backend_pid() AS pid`;
          locked(row.pid);
          await gate;
        },
        { timeout: 15_000 },
      );
      let pending: Promise<request.Response> | undefined;
      try {
        const blockerPid = await identified;
        pending = (
          action === 'register'
            ? register(review)
            : action === 'cancel'
              ? cancel(registration!)
              : api(
                  'post',
                  `/management/campaign-reviews/${review.versionId}/approve`,
                  adminToken,
                  { expectedVersion: review.version },
                  randomUUID(),
                )
        ).then((res) => res);
        let waiting = false;
        for (let attempt = 0; attempt < 80; attempt++) {
          const rows = await prisma.$queryRaw<Array<{ pid: number }>>`
          SELECT pid FROM pg_stat_activity WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))`;
          if (rows.length) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(waiting).toBe(true);
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, endsAt.getTime() - Date.now() + 25)),
        );
        release();
        expect((await pending).status).toBe(409);
        expect(
          await prisma.campaignRegistration.count({
            where: { campaignId: review.campaignId },
          }),
        ).toBe(action === 'cancel' ? 1 : 0);
        process.stdout.write(
          `FREE_CAMPAIGN_EXPIRY_LOCK ${JSON.stringify({ runTag, action, campaignId: review.campaignId, blockerPid, waitEvent: 'Lock', endsAt: endsAt.toISOString() })}\n`,
        );
      } finally {
        release();
        await blocker;
        await pending;
      }
    },
  );

  it('serializes approval and closure using one lifecycle version and activity lock', async () => {
    const { draft, review } = await published({ maxRegistrations: 2 });
    const candidate = await submit(draft);
    const current = data<{ campaignVersion: number }>(
      await api(
        'get',
        `/management/campaign-reviews/${candidate.versionId}`,
        adminToken,
      ).expect(200),
    );
    const closer = await makeUser('SUPER_ADMIN', null);
    const responses = await Promise.all([
      api(
        'post',
        `/management/campaign-reviews/${candidate.versionId}/approve`,
        adminToken,
        { expectedVersion: candidate.version },
        randomUUID(),
      ),
      api(
        'post',
        `/management/campaigns/${review.campaignId}/close`,
        closer.token,
        { expectedVersion: current.campaignVersion, reason: '合成关闭竞争' },
        randomUUID(),
      ),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: review.campaignId },
    });
    expect(campaign.version).toBe(current.campaignVersion + 1);
    expect(campaign.publishedVersionId).toBe(
      responses[0].status === 200 ? candidate.versionId : review.versionId,
    );
  });

  it.each(['parent', 'partner'] as const)(
    'rechecks returned student scope after the %s snapshot',
    async (role) => {
      const { draft, review } = await published();
      await register(review).expect(200);
      const original = prisma.$transaction.bind(prisma);
      const spy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce(
          async (
            callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
            options?: object,
          ) => {
            const result: unknown = await original(callback, options);
            await prisma.student.update({
              where: { id: studentId },
              data: { campusId: otherCampusId },
            });
            return result;
          },
        );
      try {
        const route =
          role === 'parent'
            ? '/parents/me/campaign-registrations'
            : `${base}/${draft.draftId}/registrations`;
        await api(
          'get',
          route,
          role === 'parent' ? parentToken : partnerToken,
        ).expect(403);
      } finally {
        spy.mockRestore();
        await prisma.student.update({
          where: { id: studentId },
          data: { campusId },
        });
      }
    },
  );

  it('retains transferred history but hides student names and the former parent result', async () => {
    const { draft, review } = await published();
    const row = data<Registration>(await register(review).expect(200));
    await prisma.student.update({
      where: { id: studentId },
      data: { campusId: otherCampusId },
    });
    try {
      const results = await api(
        'get',
        `${base}/${draft.draftId}/registrations`,
        partnerToken,
      ).expect(200);
      expect(
        (results.body as { data: Array<{ studentName: string | null }> })
          .data[0].studentName,
      ).toBeNull();
      await api(
        'get',
        `/parents/me/campaign-registrations/${row.registrationId}`,
        parentToken,
      ).expect(403);
      expect(
        (
          await prisma.campaignRegistration.findUniqueOrThrow({
            where: { id: row.registrationId },
          })
        ).campusId,
      ).toBe(campusId);
    } finally {
      await prisma.student.update({
        where: { id: studentId },
        data: { campusId },
      });
    }
  });

  it('enforces immutable frozen content and same-campaign publication constraints in PostgreSQL', async () => {
    const first = await published();
    const second = await published();
    await expect(
      prisma.$executeRaw`UPDATE "CampaignVersion" SET "title" = '不得覆盖' WHERE "id" = ${first.review.versionId}::uuid`,
    ).rejects.toThrow();
    await expect(
      prisma.campaign.update({
        where: { id: first.review.campaignId },
        data: { publishedVersionId: second.review.versionId },
      }),
    ).rejects.toThrow();
    expect(
      (
        await prisma.campaign.findUniqueOrThrow({
          where: { id: first.review.campaignId },
        })
      ).publishedVersionId,
    ).toBe(first.review.versionId);
  });

  it('never invokes payment or refund adapters', () => {
    expect(payment).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
  });

  it('makes distinct parents contend on the same activity for the last place', async () => {
    const actor = await makeUser('PARENT');
    const student = await prisma.student.create({
      data: { campusId, displayName: `${runTag}竞争学员` },
    });
    await prisma.parentStudentBinding.create({
      data: { campusId, studentId: student.id, parentUserId: actor.id },
    });
    const { review } = await published();
    let entered!: () => void;
    let release!: () => void;
    let holderPid = 0;
    const created = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const extension = prisma.$extends({
      query: {
        campaignRegistration: {
          create: async ({ args, query }) => {
            const row = await query(args);
            entered();
            await gate;
            return row;
          },
        },
      },
    });
    const spy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce(
        (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          extension.$transaction(
            async (tx) => {
              const [row] = await tx.$queryRaw<
                Array<{ pid: number }>
              >`SELECT pg_backend_pid() AS pid`;
              holderPid = row.pid;
              return callback(tx as unknown as Prisma.TransactionClient);
            },
            { timeout: 15_000 },
          ),
      );
    const first = register(review).then((res) => res);
    let second: Promise<request.Response> | undefined;
    try {
      await created;
      second = register(review, student.id, actor.token).then((res) => res);
      let contenderPid = 0;
      for (let attempt = 0; attempt < 80; attempt++) {
        const rows = await prisma.$queryRaw<Array<{ pid: number }>>`
          SELECT pid FROM pg_stat_activity WHERE ${holderPid} = ANY(pg_blocking_pids(pid))`;
        if (rows.length) {
          contenderPid = rows[0].pid;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(contenderPid).toBeGreaterThan(0);
      process.stdout.write(
        `FREE_CAMPAIGN_DISTINCT_PARENT_LOCK ${JSON.stringify({ runTag, campaignId: review.campaignId, holderPid, contenderPid, waitEvent: 'Lock' })}\n`,
      );
      release();
      expect((await first).status).toBe(200);
      expect((await second).status).toBe(409);
      expect(
        await prisma.campaignRegistration.count({
          where: { campaignId: review.campaignId, status: 'REGISTERED' },
        }),
      ).toBe(1);
    } finally {
      release();
      await first;
      await second;
      spy.mockRestore();
    }
  });

  it('replays approved and cancelled execution receipts after expiry without another side effect', async () => {
    const endsAt = new Date(Date.now() + 2000);
    const candidate = await submit(
      await configuredDraft({ endsAt: endsAt.toISOString() }),
    );
    const approvalKey = randomUUID();
    const review = await approve(candidate, approvalKey);
    const registrationKey = randomUUID();
    const registered = data<Registration>(
      await register(review, studentId, parentToken, registrationKey).expect(
        200,
      ),
    );
    const cancelKey = randomUUID();
    const cancelled = data<Registration>(
      await cancel(registered, parentToken, cancelKey).expect(200),
    );
    const beforeAudit = await prisma.auditLog.count({ where: { campusId } });
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, endsAt.getTime() - Date.now() + 25)),
    );
    expect(await approve(candidate, approvalKey)).toEqual(review);
    expect(
      data<Registration>(
        await cancel(registered, parentToken, cancelKey).expect(200),
      ),
    ).toEqual(cancelled);
    expect(
      data<Registration>(
        await register(review, studentId, parentToken, registrationKey).expect(
          200,
        ),
      ),
    ).toEqual(registered);
    expect(
      data<Registration>(
        await api(
          'get',
          `/parents/me/campaign-registrations/${registered.registrationId}`,
          parentToken,
        ).expect(200),
      ).status,
    ).toBe('CANCELLED');
    expect(await prisma.auditLog.count({ where: { campusId } })).toBe(
      beforeAudit,
    );
    expect(payment).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
  });

  it.each(['closure', 'cancellation'] as const)(
    'rejects null terminal metadata for %s at the database layer',
    async (target) => {
      const { review } = await published();
      const row = data<Registration>(await register(review).expect(200));
      let accepted = false;
      await expect(
        prisma.$transaction(async (tx) => {
          if (target === 'closure')
            await tx.campaign.update({
              where: { id: review.campaignId },
              data: {
                lifecycle: 'CLOSED',
                closedAt: new Date(),
                closedByUserId: parentId,
                closeReason: null,
              },
            });
          else
            await tx.campaignRegistration.update({
              where: { id: row.registrationId },
              data: {
                status: 'CANCELLED',
                cancelledAt: new Date(),
                cancelledByUserId: null,
              },
            });
          accepted = true;
          throw new Error('rollback isolated constraint probe');
        }),
      ).rejects.toThrow();
      expect(accepted).toBe(false);
      expect(
        (
          await prisma.campaignRegistration.findUniqueOrThrow({
            where: { id: row.registrationId },
          })
        ).status,
      ).toBe('REGISTERED');
    },
  );

  it('preserves legacy parent and staff promotion reads without mixing free versions into paid campaigns', async () => {
    const owner = await makeUser('SUPER_ADMIN', null);
    const teacher = await makeUser('TEACHER');
    await prisma.teacherProfile.create({
      data: { userId: teacher.id, campusId, employeeCode: `${runTag}-compat` },
    });
    const product = await prisma.courseProduct.create({
      data: {
        campusId,
        name: `${runTag}合成拼团课程`,
        summary: '既有简版兼容测试',
        priceFen: 1990,
        mainUnits: 100,
        giftUnits: 0,
        validityDays: 365,
        status: 'ACTIVE',
        createdByUserId: owner.id,
      },
    });
    const legacy = await prisma.groupCampaign.create({
      data: {
        campusId,
        code: `${runTag}-legacy`,
        courseProductId: product.id,
        title: `${runTag}合成简版拼团`,
        description: '旧推广读取兼容，未发起支付',
        priceFen: 1990,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 3_600_000),
        status: 'ACTIVE',
        createdByUserId: owner.id,
      },
    });
    const { review } = await published();
    for (const [role, token] of [
      ['parents', parentToken],
      ['partners', partnerToken],
      ['teachers', teacher.token],
    ]) {
      const list = await api(
        'get',
        `/${role}/me/group-campaigns?page=1&pageSize=20`,
        token,
      ).expect(200);
      expect(data<Array<{ id: string }>>(list)).toEqual([
        expect.objectContaining({ id: legacy.id, priceFen: 1990 }),
      ]);
      const detail = await api(
        'get',
        `/${role}/me/group-campaigns/${legacy.id}`,
        token,
      ).expect(200);
      expect(data<object>(detail)).toMatchObject({
        id: legacy.id,
        priceFen: 1990,
      });
      await api(
        'get',
        `/${role}/me/group-campaigns/${review.campaignId}`,
        token,
      ).expect(404);
    }
    const freeList = await api(
      'get',
      '/parents/me/free-campaigns?page=1&pageSize=100',
      parentToken,
    ).expect(200);
    expect(
      data<Array<{ campaignId: string }>>(freeList).map(
        (row) => row.campaignId,
      ),
    ).not.toContain(legacy.id);
    expect(payment).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
  });
});
