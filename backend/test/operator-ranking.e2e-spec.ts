import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PartnerEarningStatus, Prisma } from '@prisma/client';
import { load } from 'js-yaml';
import request from 'supertest';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import type {
  AuthenticatedUser,
  RoleCode,
} from '../src/common/auth/authenticated-user';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { PartnerRankingService } from '../src/modules/partner/partner-ranking.service';
import { PartnerRankingQueryDto } from '../src/modules/partner/dto/partner-ranking.dto';
import { assertCampusArchiveTestTarget } from './support/campus-archive-test-database';

interface Row {
  campusName: string;
  rank: number;
  rankDelta: number | null;
  isOwnCampus: boolean;
}
interface Ranking {
  metric: string;
  month: string;
  revisionId: string | null;
  availability: string;
  unavailableReason: string | null;
  data: Row[];
  ownCampus: Row | null;
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
type Actor = {
  id: string;
  roles: { roleCode: RoleCode; campusId: string | null }[];
};
const enabled = process.env.OPERATOR_RANKING_TEST_ENABLED === '1';
const execution = process.env.OPERATOR_RANKING_TEST_EXECUTION!;
const directory = process.env.OPERATOR_RANKING_TEST_EVIDENCE!;
const syntheticNow = new Date('2032-03-15T02:00:00.000Z');
const month = '2032-03';

(enabled ? describe : describe.skip)(
  'operator rankings via real HTTP and isolated PostgreSQL',
  () => {
    jest.setTimeout(60_000);
    let app: INestApplication<Server> | undefined;
    let prisma: PrismaService;
    let service: PartnerRankingService;
    let baseUrl: string;
    let owner: Actor;
    const campusIds = Array.from({ length: 28 }, () => randomUUID());
    const actors: Actor[] = [];
    const tokens = new Map<string, string>();
    const observations: object[] = [];
    const cases: string[] = [];
    const prefix = `orank-${execution}`;
    const ownCampusId = campusIds[27];
    const campusName = (index: number) => `${prefix}-${index}`;
    const output = (suffix: string) =>
      resolve(directory, `${execution}-${suffix}.json`);
    let businessBaseline: unknown;
    let fixtureCommitted = false;

    const dependencies = createRequire(
      createRequire(
        createRequire(__filename).resolve('@nestjs/cli/package.json'),
      ).resolve('@angular-devkit/core'),
    );
    type Validate = ((value: unknown) => boolean) & { errors: unknown };
    const { default: Ajv } = dependencies('ajv/dist/2020') as {
      default: new (options: object) => {
        addSchema(schema: unknown, id: string): void;
        getSchema(ref: string): Validate;
      };
    };
    const validator = new Ajv({ strict: false, allErrors: true });
    (dependencies('ajv-formats') as (value: typeof validator) => void)(
      validator,
    );
    const contractId =
      'https://education.invalid/contracts/operator-rankings.openapi.yaml';
    validator.addSchema(
      load(
        readFileSync(
          resolve(__dirname, '../../contracts/operator-rankings.openapi.yaml'),
          'utf8',
        ),
      ),
      contractId,
    );
    const validate = validator.getSchema(`${contractId}#/schemas/RankingPage`);

    async function get(
      query: Record<string, unknown> = {},
      actorId = owner.id,
    ) {
      const response = await request(baseUrl)
        .get('/operators/me/rankings')
        .auth(tokens.get(actorId)!, { type: 'bearer' })
        .query({ month, ...query })
        .timeout({ response: 5000, deadline: 15000 });
      observations.push({
        query,
        actorId,
        status: response.status,
        code: (response.body as { code?: string }).code,
      });
      if (response.status === 200) {
        const data = (response.body as { data: Ranking }).data;
        expect({ valid: validate(data), errors: validate.errors }).toEqual({
          valid: true,
          errors: null,
        });
      }
      return response;
    }

    async function businessFacts() {
      const tables = [
        'CoursePackage',
        'LessonLedgerEntry',
        'AttendanceRecord',
        'TeachingRecord',
        'PartnerEarningBasis',
        'PartnerEarningEntry',
        'TeacherEarningEntry',
        'FinanceReceipt',
        'FinanceRefundRequest',
        'FinanceRefundPayment',
        'AuditLog',
      ];
      const result: Record<string, unknown> = {};
      for (const table of tables)
        result[table] = await prisma.$queryRawUnsafe(
          `SELECT md5(row_to_json(t)::text) AS digest FROM "${table}" t ORDER BY digest`,
        );
      return result;
    }

    beforeAll(async () => {
      const target = assertCampusArchiveTestTarget(process.env);
      if (
        target.username !== 'carchive' ||
        !target.password ||
        process.env.OPERATOR_RANKING_RESOURCE_RUN !== 'archive-4534b1ea9d' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          execution,
        )
      )
        throw new Error(
          'An explicit fresh operator ranking allocation is required',
        );
      const allocation = JSON.parse(
        readFileSync(output('allocation'), 'utf8'),
      ) as {
        execution: string;
        oldUserIds: string[];
        oldCampusIds: string[];
      };
      if (
        allocation.execution !== execution ||
        campusIds.some((id) => allocation.oldCampusIds.includes(id))
      )
        throw new Error('Ranking execution allocation mismatch');
      jest.useFakeTimers({
        now: syntheticNow,
        doNotFake: [
          'hrtime',
          'nextTick',
          'performance',
          'queueMicrotask',
          'setImmediate',
          'clearImmediate',
          'setInterval',
          'clearInterval',
          'setTimeout',
          'clearTimeout',
        ],
      });
      const { AppModule } =
        jest.requireActual<typeof import('../src/app.module')>(
          '../src/app.module',
        );
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleRef.createNestApplication<INestApplication<Server>>({
        logger: false,
      });
      configureApplication(app);
      await app.listen(0, '127.0.0.1');
      baseUrl = await app.getUrl();
      prisma = app.get(PrismaService);
      service = app.get(PartnerRankingService);
      const sets: Actor['roles'][] = [
        [{ roleCode: 'OPERATOR', campusId: ownCampusId }],
        [{ roleCode: 'OPERATOR', campusId: null }],
        [
          { roleCode: 'OPERATOR', campusId: ownCampusId },
          { roleCode: 'TEACHER', campusId: ownCampusId },
        ],
        [{ roleCode: 'PARTNER', campusId: ownCampusId }],
        [{ roleCode: 'TEACHER', campusId: ownCampusId }],
        [{ roleCode: 'CAMPUS_MANAGER', campusId: ownCampusId }],
        ...campusIds
          .slice(0, 4)
          .map((campusId) => [{ roleCode: 'TEACHER' as const, campusId }]),
      ];
      actors.push(...sets.map((roles) => ({ id: randomUUID(), roles })));
      owner = actors[0];
      if (actors.some((actor) => allocation.oldUserIds.includes(actor.id)))
        throw new Error('A ranking actor ID overlaps a pre-existing account');
      await prisma.$transaction(
        async (tx) => {
          for (const [index, id] of campusIds.entries())
            await tx.campus.create({
              data: {
                id,
                code: campusName(index),
                name: campusName(index),
                createdAt: new Date('2030-01-01T00:00:00.000Z'),
              },
            });
          for (const actor of actors)
            await tx.user.create({
              data: {
                id: actor.id,
                displayName: `${prefix}-actor`,
                roles: { create: actor.roles },
              },
            });
          await tx.auditLog.create({
            data: {
              action: 'OPERATOR_RANKING_FIXTURE',
              resourceType: 'OperatorRankingFixture',
              resourceId: execution,
              actorUserId: owner.id,
              campusId: ownCampusId,
              outcome: 'SUCCESS',
              details: { execution, campusIds, actors, syntheticOnly: true },
            },
          });
          for (const [index, count] of [3, 3, 1].entries())
            for (let number = 0; number < count; number++)
              await tx.student.create({
                data: {
                  campusId: campusIds[index],
                  displayName: `${prefix}-student`,
                },
              });
          const teachingSites: Array<{
            teacher: { id: string };
            group: { id: string };
            userId: string;
            ruleId: string;
          }> = [];
          for (const [index, campusId] of campusIds.slice(0, 4).entries()) {
            const teacher = await tx.teacherProfile.create({
              data: {
                userId: actors[index + 6].id,
                campusId,
                employeeCode: `${prefix}-${index}`,
              },
            });
            const group = await tx.classGroup.create({
              data: {
                campusId,
                teacherId: teacher.id,
                name: prefix,
                courseName: 'Synthetic ranking course',
              },
            });
            const rule = await tx.partnerEarningRule.create({
              data: {
                campusId,
                scopeKey: `campus:${campusId}:partner`,
                version: 1,
                status: 'ACTIVE',
                unitPriceFen: 1000,
                shareBasisPoints: 5000,
                eligibleLessonKinds: ['REGULAR'],
                countedAttendanceStatuses: ['PRESENT'],
                effectiveFrom: new Date('2030-01-01T00:00:00.000Z'),
                createdByUserId: owner.id,
              },
            });
            teachingSites.push({
              teacher,
              group,
              userId: actors[index + 6].id,
              ruleId: rule.id,
            });
          }
          const addEntry = async (
            campusIndex: number,
            amountFen: number,
            price: number,
            at: string,
            status: PartnerEarningStatus = 'PENDING_REVIEW',
          ) => {
            const campusId = campusIds[campusIndex];
            const { teacher, group, userId, ruleId } =
              teachingSites[campusIndex];
            const completedAt = new Date('2032-02-15T02:00:00.000Z');
            const lesson = await tx.lessonSession.create({
              data: {
                campusId,
                classGroupId: group.id,
                teacherId: teacher.id,
                status: 'COMPLETED',
                startsAt: new Date('2032-02-15T01:00:00.000Z'),
                endsAt: completedAt,
                completedAt,
              },
            });
            const teaching = await tx.teachingRecord.create({
              data: {
                campusId,
                lessonSessionId: lesson.id,
                teacherId: teacher.id,
                status: 'COMPLETED',
                attendeeCount: 1,
                lessonUnits: 100,
                recordedByUserId: userId,
                completedAt,
              },
            });
            const basis = await tx.partnerEarningBasis.create({
              data: {
                campusId,
                lessonSessionId: lesson.id,
                teachingRecordId: teaching.id,
                lessonKind: 'REGULAR',
                lessonUnits: 100,
                actualAttendeeCount: 1,
                countedAttendeeCount: 1,
                attendanceSnapshot: [],
                completedAt,
                status: 'PRICED',
                selectedRuleId: ruleId,
              },
            });
            return tx.partnerEarningEntry.create({
              data: {
                campusId,
                earningBasisId: basis.id,
                entryType: 'ACCRUAL',
                amountFen,
                status,
                ruleSnapshot: { unitPriceFen: price },
                reviewableAt: new Date(at),
                createdAt: new Date(at),
              },
            });
          };
          const march = '2032-03-02T00:00:00.000Z';
          await addEntry(0, 100, 1000, march);
          await addEntry(1, 200, 400, march, 'AVAILABLE');
          await addEntry(2, 300, 600, march);
          await addEntry(0, 10_000, 20_000, march, 'REJECTED');
          const sameMonthOriginal = await addEntry(
            2,
            70,
            100,
            march,
            'REVERSED',
          );
          await tx.partnerEarningEntry.create({
            data: {
              campusId: campusIds[2],
              earningBasisId: sameMonthOriginal.earningBasisId,
              entryType: 'REVERSAL',
              amountFen: -70,
              status: 'REVERSED',
              ruleSnapshot:
                sameMonthOriginal.ruleSnapshot as Prisma.InputJsonValue,
              reversalOfId: sameMonthOriginal.id,
              reviewableAt: new Date(march),
              createdAt: new Date(march),
            },
          });
          const original = await addEntry(
            3,
            50,
            100,
            '2032-02-29T15:59:59.999Z',
            'REVERSED',
          );
          await tx.partnerEarningEntry.create({
            data: {
              campusId: campusIds[3],
              earningBasisId: original.earningBasisId,
              entryType: 'REVERSAL',
              amountFen: -50,
              status: 'REVERSED',
              ruleSnapshot: original.ruleSnapshot as Prisma.InputJsonValue,
              reversalOfId: original.id,
              reviewableAt: new Date(march),
              createdAt: new Date('2032-02-29T16:00:00.000Z'),
            },
          });
          await addEntry(0, 50_000, 60_000, '2032-03-31T16:00:00.000Z');
          await addEntry(0, 400, 500, '2032-01-15T00:00:00.000Z', 'REJECTED');
          await addEntry(0, 25, -1, '2031-12-15T00:00:00.000Z');
        },
        { timeout: 30000 },
      );
      fixtureCommitted = true;
      writeFileSync(
        output('manifest'),
        JSON.stringify({
          execution,
          campusIds,
          actors,
          syntheticNow,
          fixtureCommitted,
        }),
        { flag: 'wx' },
      );
      for (const actor of actors)
        tokens.set(
          actor.id,
          (await app.get(AuthService).issueSessionForUser(actor.id))
            .accessToken,
        );
      businessBaseline = await businessFacts();
    });

    afterAll(async () => {
      const revoked: object[] = [];
      let factsUnchanged = false;
      try {
        if (prisma) {
          const manifest = await prisma.auditLog.findFirst({
            where: {
              action: 'OPERATOR_RANKING_FIXTURE',
              resourceId: execution,
            },
          });
          const details = manifest?.details as
            | { actors?: Actor[]; campusIds?: string[]; execution?: string }
            | undefined;
          if (manifest) {
            if (
              details?.execution !== execution ||
              !isDeepStrictEqual(details.actors, actors) ||
              !isDeepStrictEqual(details.campusIds, campusIds)
            )
              throw new Error(
                'Ranking fixture ownership mismatch; no account mutation',
              );
            await prisma.user.updateMany({
              where: { id: { in: actors.map((actor) => actor.id) } },
              data: { status: 'DISABLED' },
            });
            for (const actor of actors) {
              const user = await prisma.user.findUniqueOrThrow({
                where: { id: actor.id },
                select: { status: true },
              });
              expect(user.status).toBe('DISABLED');
              const token = tokens.get(actor.id);
              const response = token
                ? await request(baseUrl)
                    .get('/me')
                    .auth(token, { type: 'bearer' })
                    .timeout(10000)
                : undefined;
              if (response) expect(response.status).toBe(401);
              revoked.push({
                id: actor.id,
                status: user.status,
                issuedCredentialStatus: response?.status ?? null,
              });
            }
            if (businessBaseline) {
              expect(await businessFacts()).toEqual(businessBaseline);
              factsUnchanged = true;
            }
          }
        }
      } finally {
        try {
          await app?.close();
        } finally {
          jest.useRealTimers();
          writeFileSync(
            output('result'),
            JSON.stringify(
              {
                execution,
                fixtureCommitted,
                cases,
                observations,
                revoked,
                factsUnchanged,
                hostClosed: app ? !app.getHttpServer().listening : true,
                syntheticNow: syntheticNow.toISOString(),
                nativeAcceptance: false,
              },
              null,
              2,
            ),
            { flag: 'wx' },
          );
        }
      }
    });

    it('reads dense student ties, independent own campus and all fixed-revision pages', async () => {
      const first = await get({ pageSize: 20 });
      expect(first.status).toBe(200);
      const initial = (first.body as { data: Ranking }).data;
      expect(initial.meta.total).toBeGreaterThan(20);
      const rows = [...initial.data];
      for (let page = 2; page <= initial.meta.totalPages; page++) {
        const response = await get({
          page,
          pageSize: 20,
          revisionId: initial.revisionId,
        });
        expect(response.status).toBe(200);
        const data = (response.body as { data: Ranking }).data;
        expect(data.revisionId).toBe(initial.revisionId);
        rows.push(...data.data);
      }
      expect(rows).toHaveLength(initial.meta.total);
      expect(new Set(rows.map((row) => row.campusName)).size).toBe(rows.length);
      const sql = await prisma.$queryRaw<Array<{ name: string; rank: bigint }>>`
      SELECT name, DENSE_RANK() OVER (ORDER BY value DESC) AS rank FROM (
        SELECT c.name, count(s.id) AS value FROM "Campus" c
        LEFT JOIN "Student" s ON s."campusId" = c.id AND s."isActive"
        WHERE c."createdAt" < ${syntheticNow} GROUP BY c.id
      ) source`;
      for (const index of [0, 1, 2, 27])
        expect(
          rows.find((row) => row.campusName === campusName(index))?.rank,
        ).toBe(Number(sql.find((row) => row.name === campusName(index))!.rank));
      expect(rows.find((row) => row.campusName === campusName(0))!.rank).toBe(
        rows.find((row) => row.campusName === campusName(1))!.rank,
      );
      const preview = await get({
        pageSize: 1,
        revisionId: initial.revisionId,
      });
      const previewData = (preview.body as { data: Ranking }).data;
      expect(previewData.data[0].isOwnCampus).toBe(false);
      expect(previewData.ownCampus).toMatchObject({
        campusName: campusName(27),
        isOwnCampus: true,
      });
      cases.push('student-ties-independent-own-fixed-revision-pagination');
    });

    it.each([
      ['PARTNER_EARNINGS', [2, 1, 0]],
      ['HEADQUARTERS_EARNINGS', [0, 2, 1]],
    ])(
      'keeps %s independent, includes pending and excludes rejected, with negative month-boundary reversal',
      async (metric, expected) => {
        const response = await get({ metric, pageSize: 100 });
        expect(response.status).toBe(200);
        const data = (response.body as { data: Ranking }).data;
        const expectedIndices = expected;
        for (const [rank, index] of expectedIndices.entries())
          expect(
            data.data.find((row) => row.campusName === campusName(index))?.rank,
          ).toBe(rank + 1);
        const negative = data.data.find(
          (row) => row.campusName === campusName(3),
        )!;
        expect(negative.rank).toBe(5);
        const previous = await get({ metric, month: '2032-02', pageSize: 100 });
        expect(previous.status).toBe(200);
        expect(
          (previous.body as { data: Ranking }).data.data.find(
            (row) => row.campusName === campusName(3),
          )!.rank,
        ).toBe(1);
        cases.push(
          `${metric}-independent-pending-rejected-negative-month-boundary`,
        );
      },
    );

    it('retains the old revision after a new synthetic student source appears', async () => {
      const first = (await get({ pageSize: 100 })).body as { data: Ranking };
      const before = first.data;
      await prisma.student.create({
        data: { campusId: ownCampusId, displayName: `${prefix}-new-source` },
      });
      const next = (await get({ pageSize: 100 })).body as { data: Ranking };
      expect(next.data.revisionId).not.toBe(before.revisionId);
      const old = (await get({ pageSize: 100, revisionId: before.revisionId }))
        .body as { data: Ranking };
      expect(old.data).toEqual(before);
      cases.push('source-change-new-revision-old-revision-retained');
    });

    it.each([
      { month: '2032-04' },
      { month: '0000-01' },
      { month: '2032-13' },
      { revisionId: '030d5faa-4055-1a7c-9a6e-bf22a5f34099' },
      { metric: 'TOTAL' },
      { page: 0 },
      { pageSize: 101 },
      { campusId: 'client-scope' },
    ])('rejects illegal or client scope query %j', async (query) => {
      expect((await get(query)).status).toBe(400);
      cases.push(`invalid-query:${JSON.stringify(query)}`);
    });

    it('returns 404 for wrong, cross-metric and cross-month revisions', async () => {
      const data = ((await get()).body as { data: Ranking }).data;
      for (const query of [
        { revisionId: randomUUID() },
        { revisionId: data.revisionId, metric: 'PARTNER_EARNINGS' },
        { revisionId: data.revisionId, month: '2032-02' },
      ]) {
        const response = await get(query);
        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
      }
      cases.push('revision-404-unknown-metric-month');
    });

    it('distinguishes unavailable old history from a current reliable zero ranking', async () => {
      const response = await get({ month: '1000-01' });
      expect(response.status).toBe(200);
      expect((response.body as { data: Ranking }).data).toMatchObject({
        availability: 'UNAVAILABLE',
        unavailableReason: 'HISTORY_UNAVAILABLE',
        data: [],
        ownCampus: null,
        revisionId: null,
        meta: { total: 0, totalPages: 0 },
      });
      cases.push('old-history-unavailable');
    });

    it.each(['PARTNER_EARNINGS', 'HEADQUARTERS_EARNINGS'])(
      'returns explicit invalid-source unavailability and a reliable rejected-only zero for %s',
      async (metric) => {
        const invalid = await get({ metric, month: '2031-12' });
        expect(invalid.status).toBe(200);
        expect((invalid.body as { data: Ranking }).data).toMatchObject({
          availability: 'UNAVAILABLE',
          unavailableReason: 'SOURCE_DATA_INVALID',
          revisionId: null,
          data: [],
          ownCampus: null,
        });
        const zero = await get({ metric, month: '2032-01', pageSize: 100 });
        expect(zero.status).toBe(200);
        const page = (zero.body as { data: Ranking }).data;
        expect(page.availability).toBe('SNAPSHOT');
        expect(page.data.length).toBeGreaterThan(0);
        expect(page.data.every((row) => row.rank === 1)).toBe(true);
        cases.push(`${metric}-invalid-source-and-rejected-only-zero`);
      },
    );

    it('rejects unscoped, mixed, partner, teacher and manager accounts on the operator route', async () => {
      for (const actor of actors.slice(1))
        expect((await get({}, actor.id)).status).toBe(403);
      expect(
        (await request(baseUrl).get('/operators/me/rankings').timeout(10000))
          .status,
      ).toBe(401);
      const partner = await request(baseUrl)
        .get('/partners/me/rankings')
        .auth(tokens.get(actors[3].id)!, { type: 'bearer' })
        .query({ month, pageSize: 1 })
        .timeout(10000);
      expect(partner.status).toBe(200);
      const row = (partner.body as { data: { data: object[] } }).data.data[0];
      expect(Object.keys(row).sort()).toEqual([
        'campusId',
        'campusName',
        'isOwnCampus',
        'previousRank',
        'rank',
        'rankDelta',
      ]);
      cases.push('role-isolation-and-partner-compatibility');
    });

    it('rejects in-flight revocation using a fresh post-snapshot database check', async () => {
      const original = prisma.$transaction.bind(prisma);
      const spy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce(
          (
            callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
            options: object,
          ) =>
            original(callback, options).then(async (result) => {
              await prisma.user.update({
                where: { id: owner.id },
                data: { status: 'DISABLED' },
              });
              return result;
            }),
        );
      try {
        const actor: AuthenticatedUser = {
          userId: owner.id,
          roles: [{ code: 'OPERATOR', campusId: ownCampusId }],
        };
        await expect(
          service.listForOperator(
            actor,
            Object.assign(new PartnerRankingQueryDto(), { month }),
            syntheticNow,
          ),
        ).rejects.toMatchObject({ statusCode: 403 });
      } finally {
        spy.mockRestore();
        await prisma.user.update({
          where: { id: owner.id },
          data: { status: 'ACTIVE' },
        });
      }
      cases.push('post-snapshot-real-revocation');
    });
  },
);
