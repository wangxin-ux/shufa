import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { PartnerStudentQueryService } from '../src/modules/partner/partner-student-query.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(120_000);

interface Fixture {
  size: number;
  associations: number;
  campusId: string;
  token: string;
  studentIds: string[];
  classNames: string[];
}

interface PageBody {
  data: Array<{
    id: string;
    classNames: string[];
    mainBalanceUnits: number;
    giftBalanceUnits: number;
    mainReservedUnits: number;
    giftReservedUnits: number;
    availableTotalUnits: number;
  }>;
  meta: { total: number; page: number; pageSize: number };
}

interface Measurement {
  statements: number;
  selects: number;
  elapsedMs: number;
}

interface CapturedQuery {
  query: string;
  params: string;
}

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Plan Rows': number;
  'Total Cost': number;
  'Actual Rows'?: number;
  Plans?: PlanNode[];
}

const share = (total: number, index: number, count: number) =>
  Math.floor(total / count) + (index < total % count ? 1 : 0);
const planNodes = (node: PlanNode): PlanNode[] => [
  node,
  ...(node.Plans ?? []).flatMap(planNodes),
];

describe('partner PDF HTTP query budget in a dedicated database', () => {
  const runTag = `ppdf-budget-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];
  const campusIds: string[] = [];
  const studentIds: string[] = [];
  const packageIds: string[] = [];
  const teacherIds: string[] = [];
  const classIds: string[] = [];
  const memberIds: string[] = [];
  const fixtures: Fixture[] = [];
  const metrics: object[] = [];
  const checkpoint = (phase: string, details: object = {}) =>
    process.stdout.write(
      `PARTNER_QUERY_CHECKPOINT ${JSON.stringify({ runTag, phase, ...details })}\n`,
    );
  checkpoint('suite-initializing');
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
    log: [{ emit: 'event', level: 'query' }],
  });
  let app: INestApplication;
  let server: Server;
  let captured: CapturedQuery[] | null = null;
  client.$on('query', ({ query, params }) => captured?.push({ query, params }));

  beforeAll(async () => {
    checkpoint('connect-start');
    await client.$connect();
    ({ app } = await createPartnerPdfTestApp((builder) =>
      builder.overrideProvider(PrismaService).useValue(client),
    ));
    server = app.getHttpServer() as Server;
    for (const { size, associations } of [1, 3].flatMap((associations) =>
      [20, 100].map((size) => ({ size, associations })),
    )) {
      const fixtureTag = `${runTag}-${size}-${associations}`;
      const campus = await client.campus.create({
        data: {
          code: fixtureTag,
          name: fixtureTag,
          lessonWarningThresholdUnits: 500,
        },
      });
      campusIds.push(campus.id);
      const partner = await client.user.create({
        data: {
          displayName: `${runTag}-partner`,
          roles: { create: { roleCode: 'PARTNER', campusId: campus.id } },
        },
      });
      userIds.push(partner.id);
      checkpoint('user-created', { userId: partner.id });
      const teacherUser = await client.user.create({
        data: {
          displayName: `${runTag}-teacher`,
          roles: { create: { roleCode: 'TEACHER', campusId: campus.id } },
        },
      });
      userIds.push(teacherUser.id);
      checkpoint('user-created', { userId: teacherUser.id });
      const teacher = await client.teacherProfile.create({
        data: {
          userId: teacherUser.id,
          campusId: campus.id,
          employeeCode: fixtureTag,
        },
      });
      teacherIds.push(teacher.id);
      const groups: Array<{ id: string; name: string }> = [];
      for (let index = 0; index < associations; index++) {
        const group = await client.classGroup.create({
          data: {
            campusId: campus.id,
            teacherId: teacher.id,
            name: `${fixtureTag}-class-${index}`,
            courseName: `${fixtureTag}-course-${index}`,
          },
        });
        groups.push(group);
        classIds.push(group.id);
      }
      const ids = Array.from({ length: size }, () => randomUUID());
      studentIds.push(...ids);
      await client.student.createMany({
        data: ids.map((id, index) => ({
          id,
          campusId: campus.id,
          displayName: `${runTag}-${String(index).padStart(3, '0')}`,
        })),
      });
      const packages = ids.flatMap((studentId, index) =>
        Array.from({ length: associations }, (_, association) => ({
          id: randomUUID(),
          campusId: campus.id,
          studentId,
          name: `${fixtureTag}-package-${association}`,
          mainBalanceUnits: share(
            [0, 100, 500, 900, 700][index % 5],
            association,
            associations,
          ),
          mainReservedUnits: share(
            index % 5 === 4 ? 200 : 0,
            association,
            associations,
          ),
          giftBalanceUnits: share(100, association, associations),
          giftReservedUnits: share(100, association, associations),
          validFrom: new Date('2020-01-01T00:00:00Z'),
        })),
      );
      packageIds.push(...packages.map(({ id }) => id));
      await client.coursePackage.createMany({ data: packages });
      const members = ids.flatMap((studentId) =>
        groups.map((group) => ({
          id: randomUUID(),
          campusId: campus.id,
          classGroupId: group.id,
          studentId,
        })),
      );
      memberIds.push(...members.map(({ id }) => id));
      await client.classMember.createMany({ data: members });
      const session = await app
        .get(AuthService)
        .issueSessionForUser(partner.id);
      fixtures.push({
        size,
        associations,
        campusId: campus.id,
        token: session.accessToken,
        studentIds: ids,
        classNames: groups.map(({ name }) => name).sort(),
      });
      checkpoint('fixture-ready', { size, associations });
    }
  });

  beforeEach(() =>
    checkpoint('test-start', { name: expect.getState().currentTestName }),
  );
  afterEach(() =>
    checkpoint('test-finished', { name: expect.getState().currentTestName }),
  );

  afterAll(async () => {
    captured = null;
    let disabledVerified = false;
    try {
      if (userIds.length > 0) {
        assertPartnerPdfTestTarget(process.env);
        await client.user.updateMany({
          where: { id: { in: userIds }, displayName: { startsWith: runTag } },
          data: { status: 'DISABLED' },
        });
        expect(
          await client.user.count({
            where: { id: { in: userIds }, status: 'DISABLED' },
          }),
        ).toBe(userIds.length);
        disabledVerified = true;
      }
    } finally {
      try {
        await app?.close();
      } finally {
        try {
          await client.$disconnect();
        } finally {
          process.stdout.write(
            `PARTNER_PDF_QUERY_METRICS ${JSON.stringify({ runTag, metrics })}\n`,
          );
          process.stdout.write(
            `PARTNER_PDF_FIXTURE_OWNERSHIP ${JSON.stringify({
              runTag,
              userIds,
              campusIds,
              studentIds,
              packageIds,
              teacherIds,
              classIds,
              memberIds,
              disposition: 'retained; no deletion',
              ownedUsers:
                userIds.length === 0
                  ? 'none created'
                  : disabledVerified
                    ? 'disabled and read-only verified'
                    : 'disabling not verified; follow-up required',
            })}\n`,
          );
        }
      }
    }
  });

  async function measure(
    fixture: Fixture,
    path: string,
    query: Record<string, string | number> = {},
  ) {
    const statements: CapturedQuery[] = [];
    captured = statements;
    const start = performance.now();
    try {
      const response = await request(server)
        .get(path)
        .query(query)
        .auth(fixture.token, { type: 'bearer' })
        .expect(200);
      const measurement: Measurement = {
        statements: statements.length,
        selects: statements.filter(({ query }) =>
          /^\s*(SELECT|WITH)\b/i.test(query),
        ).length,
        elapsedMs: Math.round((performance.now() - start) * 100) / 100,
      };
      expect(measurement.selects).toBeGreaterThan(0);
      expect(
        statements.some(({ query }) =>
          /\b(INSERT|UPDATE|DELETE)\b/i.test(query),
        ),
      ).toBe(false);
      return { response, measurement, queries: statements };
    } finally {
      captured = null;
    }
  }

  it.each([
    ['ALL', undefined, 1],
    ['ZERO', 'ZERO', 0.2],
    ['LTE_FIVE', 'LTE_FIVE', 0.8],
    ['GT_FIVE', 'GT_FIVE', 0.2],
  ] as const)(
    'keeps %s list SQL constant across 20/100 students and 5/20 rows',
    async (label, balanceBand, fraction) => {
      const samples: Measurement[] = [];
      for (const fixture of fixtures) {
        for (const pageSize of [5, 20]) {
          const { response, measurement } = await measure(
            fixture,
            '/partners/me/students',
            { page: 1, pageSize, ...(balanceBand ? { balanceBand } : {}) },
          );
          const body = response.body as PageBody;
          const expectedTotal = fixture.size * fraction;
          expect(body.meta).toMatchObject({
            total: expectedTotal,
            page: 1,
            pageSize,
          });
          expect(body.data).toHaveLength(Math.min(pageSize, expectedTotal));
          expect(
            body.data.every((row) => fixture.studentIds.includes(row.id)),
          ).toBe(true);
          expect(body.data.every((row) => row.availableTotalUnits >= 0)).toBe(
            true,
          );
          const expectedIds = fixture.studentIds.filter((_, index) => {
            const available = [0, 100, 500, 900, 500][index % 5];
            return (
              !balanceBand ||
              (balanceBand === 'ZERO'
                ? available === 0
                : balanceBand === 'LTE_FIVE'
                  ? available <= 500
                  : available > 500)
            );
          });
          expect(body.data.map(({ id }) => id)).toEqual(
            expectedIds.slice(0, pageSize),
          );
          for (const row of body.data) {
            const index = fixture.studentIds.indexOf(row.id);
            expect(row).toMatchObject({
              classNames: fixture.classNames,
              mainBalanceUnits: [0, 100, 500, 900, 700][index % 5],
              mainReservedUnits: index % 5 === 4 ? 200 : 0,
              giftBalanceUnits: 100,
              giftReservedUnits: 100,
              availableTotalUnits: [0, 100, 500, 900, 500][index % 5],
            });
          }
          samples.push(measurement);
          metrics.push({
            label,
            size: fixture.size,
            associations: fixture.associations,
            pageSize,
            ...measurement,
          });
        }
      }
      expect(new Set(samples.map((sample) => sample.statements)).size).toBe(1);
      expect(new Set(samples.map((sample) => sample.selects)).size).toBe(1);
      expect(samples[0].statements).toBeLessThanOrEqual(8);
    },
  );

  it('keeps warnings SQL constant when both population and page size grow', async () => {
    const counts: number[] = [];
    for (const fixture of fixtures) {
      for (const pageSize of [5, 20]) {
        const { response, measurement } = await measure(
          fixture,
          '/partners/me/warnings',
          { page: 1, pageSize },
        );
        const body = response.body as {
          data: Array<{
            studentId: string;
            classNames: string[];
            availableTotalUnits: number;
          }>;
          meta: PageBody['meta'];
        };
        expect(body.meta.total).toBe(fixture.size * 0.8);
        expect(body.data).toHaveLength(Math.min(pageSize, body.meta.total));
        expect(
          body.data.every((row) => fixture.studentIds.includes(row.studentId)),
        ).toBe(true);
        const expectedIds = fixture.studentIds
          .map((id, index) => ({
            id,
            available: [0, 100, 500, 900, 500][index % 5],
            index,
          }))
          .filter(({ available }) => available <= 500)
          .sort((a, b) => a.available - b.available || a.index - b.index)
          .map(({ id }) => id);
        expect(body.data.map(({ studentId }) => studentId)).toEqual(
          expectedIds.slice(0, pageSize),
        );
        expect(
          body.data.every(
            ({ classNames }) =>
              JSON.stringify(classNames) === JSON.stringify(fixture.classNames),
          ),
        ).toBe(true);
        for (const row of body.data) {
          const index = fixture.studentIds.indexOf(row.studentId);
          expect(row).toMatchObject({
            mainBalanceUnits: [0, 100, 500, 900, 700][index % 5],
            mainReservedUnits: index % 5 === 4 ? 200 : 0,
            giftBalanceUnits: 100,
            giftReservedUnits: 100,
            availableTotalUnits: [0, 100, 500, 900, 500][index % 5],
          });
        }
        counts.push(measurement.statements);
        metrics.push({
          label: 'warnings',
          size: fixture.size,
          associations: fixture.associations,
          pageSize,
          ...measurement,
        });
      }
    }
    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBeLessThanOrEqual(9);
  });

  it('keeps dashboard SQL constant and records first/subsequent HTTP latency without a performance claim', async () => {
    const counts: number[] = [];
    for (const fixture of fixtures) {
      const samples: number[] = [];
      let firstMs = 0;
      for (let index = 0; index < 11; index++) {
        const { response, measurement } = await measure(
          fixture,
          '/partners/me/dashboard',
        );
        const body = response.body as {
          data: {
            activeStudentCount: number;
            activeClassCount: number;
            activeTeacherCount: number;
            highlight: {
              studentId: string;
              availableTotalUnits: number;
              classNames: string[];
              classes: Array<{ className: string; teacherName: string }>;
            };
          };
        };
        expect(body.data).toMatchObject({
          activeStudentCount: fixture.size,
          activeClassCount: fixture.associations,
          activeTeacherCount: 1,
          highlight: { availableTotalUnits: 0, classNames: fixture.classNames },
        });
        expect(fixture.studentIds).toContain(body.data.highlight.studentId);
        expect(body.data.highlight.classes).toHaveLength(fixture.associations);
        expect(
          body.data.highlight.classes.every(
            ({ teacherName }) => teacherName === `${runTag}-teacher`,
          ),
        ).toBe(true);
        counts.push(measurement.statements);
        if (index === 0) firstMs = measurement.elapsedMs;
        else samples.push(measurement.elapsedMs);
      }
      samples.sort((a, b) => a - b);
      metrics.push({
        label: 'dashboard',
        size: fixture.size,
        associations: fixture.associations,
        statements: counts[counts.length - 1],
        firstMs,
        warmSamples: samples.length,
        warmP95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
        warmMinMs: samples[0],
        warmMaxMs: samples[samples.length - 1],
      });
    }
    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBeLessThanOrEqual(21);
  });

  it('records 20-row list first/subsequent latency with correct pagination and no cross-campus rows', async () => {
    for (const fixture of fixtures) {
      const samples: number[] = [];
      let firstMs = 0;
      for (let index = 0; index < 11; index++) {
        const { response, measurement } = await measure(
          fixture,
          '/partners/me/students',
          { page: 1, pageSize: 20 },
        );
        const body = response.body as PageBody;
        expect(body.meta.total).toBe(fixture.size);
        expect(body.data).toHaveLength(20);
        expect(
          body.data.every((row) => fixture.studentIds.includes(row.id)),
        ).toBe(true);
        expect(measurement.statements).toBeLessThanOrEqual(8);
        if (index === 0) firstMs = measurement.elapsedMs;
        else samples.push(measurement.elapsedMs);
      }
      samples.sort((a, b) => a - b);
      metrics.push({
        label: 'list-latency',
        size: fixture.size,
        associations: fixture.associations,
        pageSize: 20,
        firstMs,
        warmSamples: samples.length,
        warmP95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
        warmMinMs: samples[0],
        warmMaxMs: samples[samples.length - 1],
      });
    }
  });

  it('bounds SQL on later, out-of-range and empty pages without duplicate student IDs', async () => {
    const fixture = fixtures[1];
    const seen = new Set<string>();
    for (const page of [1, 2]) {
      const { response, measurement } = await measure(
        fixture,
        '/partners/me/students',
        { page, pageSize: 20 },
      );
      const body = response.body as PageBody;
      expect(body.meta).toMatchObject({ total: 100, page, pageSize: 20 });
      expect(body.data).toHaveLength(20);
      expect(body.data.map((row) => row.id)).toEqual(
        fixture.studentIds.slice((page - 1) * 20, page * 20),
      );
      expect(measurement.statements).toBeLessThanOrEqual(8);
      for (const row of body.data) {
        expect(fixture.studentIds).toContain(row.id);
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
    }
    for (const query of [
      { page: 6, pageSize: 20 },
      { page: 1, pageSize: 20, query: `${runTag}-missing` },
    ] as Record<string, string | number>[]) {
      const { response, measurement } = await measure(
        fixture,
        '/partners/me/students',
        query,
      );
      const body = response.body as PageBody;
      expect(body.meta.total).toBe('query' in query ? 0 : 100);
      expect(body.data).toEqual([]);
      expect(measurement.statements).toBeLessThanOrEqual(8);
      metrics.push({ label: 'empty-page', page: query.page, ...measurement });
    }
  });

  it('detects deliberately injected per-row SELECTs rather than silently missing an N+1', async () => {
    const service = app.get(PartnerStudentQueryService);
    const original = service.list.bind(service);
    const spy = jest
      .spyOn(service, 'list')
      .mockImplementation(async (...args) => {
        const result = await original(...args);
        for (const student of result.students) {
          await client.$queryRaw`SELECT id FROM "Student" WHERE id = ${student.id}::uuid`;
        }
        return result;
      });
    try {
      const small = await measure(fixtures[1], '/partners/me/students', {
        page: 1,
        pageSize: 5,
      });
      const large = await measure(fixtures[1], '/partners/me/students', {
        page: 1,
        pageSize: 20,
      });
      expect(small.measurement.statements).toBe(8 + 5);
      expect(large.measurement.statements).toBe(8 + 20);
      expect(large.measurement.statements - small.measurement.statements).toBe(
        15,
      );
      metrics.push({
        label: 'test-only-counter-sensitivity',
        small: small.measurement,
        large: large.measurement,
      });
    } finally {
      spy.mockRestore();
    }
    const restored = await measure(fixtures[1], '/partners/me/students', {
      page: 1,
      pageSize: 20,
    });
    expect(restored.measurement.statements).toBe(8);
  });

  it.each([undefined, 'ZERO', 'LTE_FIVE', 'GT_FIVE'] as const)(
    'reads every multi-association page for %s exactly once and bounds the empty last page',
    async (balanceBand) => {
      const fixture = fixtures.find(
        ({ size, associations }) => size === 100 && associations === 3,
      )!;
      const expectedIds = fixture.studentIds.filter((_, index) => {
        const available = [0, 100, 500, 900, 500][index % 5];
        return (
          !balanceBand ||
          (balanceBand === 'ZERO'
            ? available === 0
            : balanceBand === 'LTE_FIVE'
              ? available <= 500
              : available > 500)
        );
      });
      const seen: string[] = [];
      const pageSize = 5;
      for (
        let page = 1;
        page <= Math.ceil(expectedIds.length / pageSize) + 1;
        page++
      ) {
        const { response, measurement } = await measure(
          fixture,
          '/partners/me/students',
          {
            page,
            pageSize,
            ...(balanceBand ? { balanceBand } : {}),
          },
        );
        const body = response.body as PageBody;
        expect(body.meta).toMatchObject({
          total: expectedIds.length,
          page,
          pageSize,
        });
        expect(body.data.map(({ id }) => id)).toEqual(
          expectedIds.slice((page - 1) * pageSize, page * pageSize),
        );
        expect(
          body.data.every(
            ({ classNames }) =>
              JSON.stringify(classNames) === JSON.stringify(fixture.classNames),
          ),
        ).toBe(true);
        expect(measurement.statements).toBeLessThanOrEqual(8);
        seen.push(...body.data.map(({ id }) => id));
      }
      expect(seen).toEqual(expectedIds);
      expect(new Set(seen).size).toBe(expectedIds.length);
      metrics.push({
        label: 'multi-association-complete-pagination',
        balanceBand: balanceBand ?? 'ALL',
        pageSize,
        total: seen.length,
        pagesIncludingEmpty: Math.ceil(expectedIds.length / pageSize) + 1,
      });
    },
  );

  it('explains actual parameterized pagination SQL without executing or logging private query parameters', async () => {
    for (const fixture of fixtures) {
      for (const balanceBand of [undefined, 'LTE_FIVE']) {
        const result = await measure(fixture, '/partners/me/students', {
          page: 1,
          pageSize: 20,
          ...(balanceBand ? { balanceBand } : {}),
        });
        const queries = result.queries.filter(({ query }) =>
          /^\s*WITH candidates AS\b/.test(query),
        );
        expect(queries).toHaveLength(1);
        const query = queries[0];
        expect(/\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(query.query)).toBe(
          false,
        );
        const params: unknown = JSON.parse(query.params);
        expect(Array.isArray(params)).toBe(true);
        const explanation = await client.$transaction(async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          return tx.$queryRawUnsafe<
            Array<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>
          >(
            `EXPLAIN (ANALYZE FALSE, FORMAT JSON) ${query.query}`,
            ...(params as unknown[]),
          );
        });
        expect(explanation).toHaveLength(1);
        const plan = explanation[0]['QUERY PLAN'][0].Plan;
        const nodes = planNodes(plan);
        expect(nodes.some((node) => node['Node Type'] === 'Limit')).toBe(true);
        expect(nodes.some((node) => node['Relation Name'] === 'Student')).toBe(
          true,
        );
        expect(nodes.every((node) => node['Actual Rows'] === undefined)).toBe(
          true,
        );
        if (balanceBand) {
          expect(
            nodes.some((node) => node['Relation Name'] === 'CoursePackage'),
          ).toBe(true);
        }
        metrics.push({
          label: 'pagination-explain-estimate',
          size: fixture.size,
          associations: fixture.associations,
          balanceBand: balanceBand ?? 'ALL',
          estimatedRows: plan['Plan Rows'],
          totalCost: plan['Total Cost'],
          nodeTypes: [
            ...new Set(nodes.map((node) => node['Node Type'])),
          ].sort(),
          relations: [
            ...new Set(
              nodes.flatMap((node) =>
                node['Relation Name'] ? [node['Relation Name']] : [],
              ),
            ),
          ].sort(),
          indexes: [
            ...new Set(
              nodes.flatMap((node) =>
                node['Index Name'] ? [node['Index Name']] : [],
              ),
            ),
          ].sort(),
        });
      }
    }
  });
});
