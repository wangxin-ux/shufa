import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import { PartnerStudentQueryService } from '../src/modules/partner/partner-student-query.service';

// Fail before AppModule/Prisma construction; never fall back to a shared URL.
assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);

interface StudentPageBody {
  data: Array<{ id: string; availableTotalUnits: number }>;
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

const readPage = (response: { body: unknown }): StudentPageBody =>
  response.body as StudentPageBody;
const readDashboard = (response: { body: unknown }) =>
  response.body as {
    data: {
      activeStudentCount: number;
      remainingMainUnits: number;
      remainingGiftUnits: number;
      highlight: { availableTotalUnits: number } | null;
    };
  };

describe('partner PDF available-balance queries in an isolated database', () => {
  const runTag = `ppdf-${randomUUID().slice(0, 8)}`;
  const ownedUsers: string[] = [];
  const ownedCampuses: string[] = [];
  const ownedPackages: string[] = [];
  const ownedSubjects: string[] = [];
  const students: Record<string, string> = {};
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let token: string;
  let otherToken: string;
  let staffToken: string;
  let campusId: string;
  let otherStudentId: string;

  const get = (url: string, bearer = token) =>
    request(server).get(url).auth(bearer, { type: 'bearer' });

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    const campus = await prisma.campus.create({
      data: {
        code: `${runTag}-a`,
        name: `${runTag}东校区`,
        lessonWarningThresholdUnits: 300,
      },
    });
    const otherCampus = await prisma.campus.create({
      data: {
        code: `${runTag}-b`,
        name: `${runTag}西校区`,
        lessonWarningThresholdUnits: 100,
      },
    });
    campusId = campus.id;
    ownedCampuses.push(campus.id, otherCampus.id);
    for (const [subjectCampus, name, isActive] of [
      [campus.id, `${runTag}书法`, true],
      [campus.id, `${runTag}归档口才`, false],
      [otherCampus.id, `${runTag}其他校区书法`, true],
    ] as const) {
      const subject = await prisma.campusSubject.create({
        data: { campusId: subjectCampus, name, isActive },
      });
      ownedSubjects.push(subject.id);
    }
    for (const [roleCode, id] of [
      ['PARTNER', campus.id],
      ['PARTNER', otherCampus.id],
      ['TEACHER', campus.id],
    ] as const) {
      const user = await prisma.user.create({
        data: {
          displayName: `${runTag}测试账号`,
          roles: { create: { roleCode, campusId: id } },
        },
      });
      ownedUsers.push(user.id);
      const session = await app.get(AuthService).issueSessionForUser(user.id);
      if (roleCode === 'TEACHER') staffToken = session.accessToken;
      else if (id === campus.id) token = session.accessToken;
      else otherToken = session.accessToken;
    }
    const past = new Date('2020-01-01T00:00:00Z');
    const future = new Date('2099-01-01T00:00:00Z');
    for (const [key, balance, reserved, state] of [
      ['zero', 0, 0, 'active'],
      ['five', 500, 0, 'active'],
      ['over', 501, 0, 'active'],
      ['reserved', 700, 200, 'active'],
      ['expired', 900, 0, 'expired'],
      ['future', 900, 0, 'future'],
      ['inactivePackage', 900, 0, 'inactive'],
      ['noPackage', 0, 0, 'none'],
      ['multi', 200, 0, 'active'],
      ['inactiveStudent', 0, 0, 'active'],
      ['wildcard%_', 600, 0, 'active'],
    ] as const) {
      const student = await prisma.student.create({
        data: {
          campusId,
          displayName: `${runTag}-${key}`,
          isActive: key !== 'inactiveStudent',
        },
      });
      students[key] = student.id;
      if (state !== 'none') {
        const coursePackage = await prisma.coursePackage.create({
          data: {
            campusId,
            studentId: student.id,
            name: `${runTag}-课包`,
            subjectId: [
              'zero',
              'five',
              'multi',
              'expired',
              'future',
              'inactivePackage',
              'inactiveStudent',
            ].includes(key)
              ? ownedSubjects[0]
              : key === 'over'
                ? ownedSubjects[1]
                : null,
            mainBalanceUnits: balance,
            mainReservedUnits: reserved,
            validFrom: state === 'future' ? future : past,
            expiresAt:
              state === 'expired' ? new Date('2021-01-01T00:00:00Z') : null,
            isActive: state !== 'inactive',
          },
        });
        ownedPackages.push(coursePackage.id);
      }
    }
    const giftPackage = await prisma.coursePackage.create({
      data: {
        campusId,
        studentId: students.multi,
        name: `${runTag}-赠课包`,
        subjectId: ownedSubjects[1],
        giftBalanceUnits: 400,
        giftReservedUnits: 99,
        validFrom: past,
      },
    });
    ownedPackages.push(giftPackage.id);
    for (const [studentId, subjectId] of [
      [students.five, ownedSubjects[0]],
      [students.multi, null],
    ]) {
      const duplicate = await prisma.coursePackage.create({
        data: {
          campusId,
          studentId: studentId!,
          subjectId,
          name: `${runTag}-空课包`,
          validFrom: past,
        },
      });
      ownedPackages.push(duplicate.id);
    }
    otherStudentId = (
      await prisma.student.create({
        data: { campusId: otherCampus.id, displayName: `${runTag}-其他校区` },
      })
    ).id;
    const otherNormal = await prisma.student.create({
      data: {
        campusId: otherCampus.id,
        displayName: `${runTag}-其他校区正常余额`,
        coursePackages: {
          create: {
            campusId: otherCampus.id,
            name: `${runTag}-课包`,
            subjectId: ownedSubjects[2],
            mainBalanceUnits: 1000,
            validFrom: past,
          },
        },
      },
      include: { coursePackages: { select: { id: true } } },
    });
    ownedPackages.push(...otherNormal.coursePackages.map((item) => item.id));
    students.otherZero = otherStudentId;
    students.otherNormal = otherNormal.id;
  });

  afterAll(async () => {
    try {
      if (prisma && ownedUsers.length > 0) {
        assertPartnerPdfTestTarget(process.env);
        await prisma.user.updateMany({
          where: {
            id: { in: ownedUsers },
            displayName: { startsWith: runTag },
          },
          data: { status: 'DISABLED' },
        });
      }
    } finally {
      await app?.close();
    }
    process.stdout.write(
      'PARTNER_PDF_FIXTURE_OWNERSHIP ' +
        JSON.stringify({
          runTag,
          campusIds: ownedCampuses,
          userIds: ownedUsers,
          studentIds: students,
          packageIds: ownedPackages,
          subjectIds: ownedSubjects,
          disposition: 'retained; owned users disabled; no deletion',
        }) +
        '\n',
    );
    // Synthetic fixtures are retained with runTag ownership; nothing is deleted.
  });

  it('filters by valid explicit subject links once per student, keeping valid zero-balance packages', async () => {
    const found: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const response = await get('/partners/me/students')
        .query({ subjectId: ownedSubjects[0], page, pageSize: 1 })
        .expect(200);
      expect(readPage(response).meta).toMatchObject({
        total: 3,
        totalPages: 3,
        page,
      });
      found.push(...readPage(response).data.map((row) => row.id));
    }
    expect(found.sort()).toEqual(
      ['zero', 'five', 'multi'].map((key) => students[key]).sort(),
    );
    expect(new Set(found).size).toBe(3);
    const outside = await get('/partners/me/students')
      .query({ subjectId: ownedSubjects[0], page: 99, pageSize: 1 })
      .expect(200);
    expect(readPage(outside)).toMatchObject({
      data: [],
      meta: { total: 3, totalPages: 3 },
    });
  });

  it('combines subject, name and whole-student available balance without allocating other subjects away', async () => {
    const match = await get('/partners/me/students')
      .query({
        subjectId: ownedSubjects[0],
        query: `${runTag}-multi`,
        balanceBand: 'GT_FIVE',
      })
      .expect(200);
    expect(readPage(match).data).toHaveLength(1);
    expect(readPage(match).data[0]).toMatchObject({
      id: students.multi,
      availableTotalUnits: 501,
      totalBalanceUnits: 600,
      reservedTotalUnits: 99,
    });
    const low = await get('/partners/me/students')
      .query({
        subjectId: ownedSubjects[0],
        query: `${runTag}-multi`,
        balanceBand: 'LTE_FIVE',
      })
      .expect(200);
    expect(readPage(low)).toMatchObject({ data: [], meta: { total: 0 } });
    const zero = await get('/partners/me/students')
      .query({ subjectId: ownedSubjects[0], balanceBand: 'ZERO' })
      .expect(200);
    expect(readPage(zero).data.map((row) => row.id)).toEqual([students.zero]);
  });

  it('includes unclassified valid packages and students without valid packages without guessing from names', async () => {
    const response = await get('/partners/me/students')
      .query({ subjectId: 'UNCLASSIFIED' })
      .expect(200);
    expect(
      readPage(response)
        .data.map((row) => row.id)
        .sort(),
    ).toEqual(
      [
        'reserved',
        'expired',
        'future',
        'inactivePackage',
        'noPackage',
        'multi',
        'wildcard%_',
      ]
        .map((key) => students[key])
        .sort(),
    );
    const zero = await get('/partners/me/students')
      .query({ subjectId: 'UNCLASSIFIED', balanceBand: 'ZERO' })
      .expect(200);
    expect(
      readPage(zero)
        .data.map((row) => row.id)
        .sort(),
    ).toEqual(
      ['expired', 'future', 'inactivePackage', 'noPackage']
        .map((key) => students[key])
        .sort(),
    );
  });

  it('retains archived subject links but never matches another campus subject', async () => {
    const archived = await get('/partners/me/students')
      .query({ subjectId: ownedSubjects[1] })
      .expect(200);
    expect(
      readPage(archived)
        .data.map((row) => row.id)
        .sort(),
    ).toEqual(['over', 'multi'].map((key) => students[key]).sort());
    const other = await get('/partners/me/students')
      .query({ subjectId: ownedSubjects[2] })
      .expect(200);
    expect(readPage(other)).toMatchObject({ data: [], meta: { total: 0 } });
    const inverse = await get('/partners/me/students', otherToken)
      .query({ subjectId: ownedSubjects[0] })
      .expect(200);
    expect(readPage(inverse)).toMatchObject({ data: [], meta: { total: 0 } });
    await get('/partners/me/students', staffToken)
      .query({ subjectId: ownedSubjects[0] })
      .expect(403);
    await request(server)
      .get('/partners/me/students')
      .query({ subjectId: ownedSubjects[0] })
      .expect(401);
    for (const subjectId of ['bad-id', '', "UNCLASSIFIED' OR TRUE"]) {
      await get('/partners/me/students').query({ subjectId }).expect(400);
    }
  });

  it('treats exact start and expiry instants as valid and keeps subject membership and balances in one snapshot', async () => {
    const boundary = new Date('2098-01-01T00:00:00Z');
    const edge = await prisma.coursePackage.create({
      data: {
        campusId,
        studentId: students['wildcard%_'],
        subjectId: ownedSubjects[0],
        name: `${runTag}-边界空课包`,
        validFrom: boundary,
        expiresAt: new Date(boundary.getTime() + 1000),
      },
    });
    ownedPackages.push(edge.id);
    const service = app.get(PartnerStudentQueryService);
    for (const [offset, expected] of [
      [-1, 0],
      [0, 1],
      [1000, 1],
      [1001, 0],
    ]) {
      const result = await service.list(
        campusId,
        {
          page: 1,
          pageSize: 20,
          query: `${runTag}-wildcard%_`,
          balanceBand: 'ALL',
          ...{ subjectId: ownedSubjects[0] },
        },
        new Date(boundary.getTime() + offset),
      );
      expect(result.total).toBe(expected);
    }
    const coursePackage = await prisma.coursePackage.findFirstOrThrow({
      where: { campusId, studentId: students.zero },
    });
    const snapshotService = new PartnerStudentQueryService({
      $transaction: (
        read: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: { isolationLevel: Prisma.TransactionIsolationLevel },
      ) =>
        prisma.$transaction(
          async (tx) =>
            read({
              $queryRaw: tx.$queryRaw.bind(tx),
              student: {
                findMany: async (args: Prisma.StudentFindManyArgs) => {
                  await prisma.coursePackage.update({
                    where: { id: coursePackage.id },
                    data: { subjectId: null, mainBalanceUnits: 100 },
                  });
                  return tx.student.findMany(args);
                },
              },
            } as unknown as Prisma.TransactionClient),
          options,
        ),
    } as unknown as PrismaService);
    try {
      const result = await snapshotService.list(campusId, {
        page: 1,
        pageSize: 20,
        query: `${runTag}-zero`,
        balanceBand: 'ZERO',
        ...{ subjectId: ownedSubjects[0] },
      });
      expect(result.total).toBe(1);
      expect(result.students[0].coursePackages[0].mainBalanceUnits).toBe(0);
      const current = await get('/partners/me/students')
        .query({ subjectId: ownedSubjects[0], query: `${runTag}-zero` })
        .expect(200);
      expect(readPage(current)).toMatchObject({ data: [], meta: { total: 0 } });
    } finally {
      await prisma.coursePackage.update({
        where: { id: coursePackage.id },
        data: { subjectId: ownedSubjects[0], mainBalanceUnits: 0 },
      });
    }
  });

  it('filters available totals before pagination, including reservations and no active package', async () => {
    const response = await get('/partners/me/students')
      .query({ balanceBand: 'LTE_FIVE' })
      .expect(200);
    expect(
      readPage(response)
        .data.map((row) => row.id)
        .sort(),
    ).toEqual(
      [
        'zero',
        'five',
        'reserved',
        'expired',
        'future',
        'inactivePackage',
        'noPackage',
      ]
        .map((key) => students[key])
        .sort(),
    );
    expect(readPage(response).meta.total).toBe(7);
    expect(
      readPage(response).data.find(
        (row: { id: string }) => row.id === students.reserved,
      ),
    ).toMatchObject({
      totalBalanceUnits: 700,
      reservedTotalUnits: 200,
      availableTotalUnits: 500,
    });
  });

  it('uses exact zero and sums multiple MAIN/GIFT packages for >5 lessons', async () => {
    const zero = await get('/partners/me/students')
      .query({ balanceBand: 'ZERO' })
      .expect(200);
    expect(readPage(zero).meta.total).toBe(5);
    const high = await get('/partners/me/students')
      .query({ balanceBand: 'GT_FIVE' })
      .expect(200);
    expect(
      readPage(high)
        .data.map((row) => row.id)
        .sort(),
    ).toEqual(
      ['over', 'multi', 'wildcard%_'].map((key) => students[key]).sort(),
    );
    expect(
      readPage(high).data.find((row) => row.id === students.multi)
        ?.availableTotalUnits,
    ).toBe(501);
  });

  it('AND-combines literal name search and filters without wildcard expansion', async () => {
    const response = await get('/partners/me/students')
      .query({ query: `${runTag}-reserved`, balanceBand: 'LTE_FIVE' })
      .expect(200);
    expect(readPage(response).data.map((row) => row.id)).toEqual([
      students.reserved,
    ]);
    const literal = await get('/partners/me/students')
      .query({ query: '%_' })
      .expect(200);
    expect(readPage(literal).data.map((row) => row.id)).toEqual([
      students['wildcard%_'],
    ]);
  });

  it('keeps counts on an out-of-range page and stable order without duplicates', async () => {
    const pages: string[] = [];
    for (let page = 1; page <= 4; page += 1) {
      const response = await get('/partners/me/students')
        .query({ balanceBand: 'LTE_FIVE', page, pageSize: 2 })
        .expect(200);
      expect(readPage(response).meta).toMatchObject({
        total: 7,
        totalPages: 4,
        page,
      });
      pages.push(...readPage(response).data.map((row) => row.id));
    }
    expect(new Set(pages).size).toBe(7);
    const empty = await get('/partners/me/students')
      .query({ balanceBand: 'LTE_FIVE', page: 99, pageSize: 2 })
      .expect(200);
    expect(readPage(empty).data).toEqual([]);
    expect(readPage(empty).meta).toMatchObject({ total: 7, totalPages: 4 });
  });

  it('rejects invalid filters, cross-campus parameters, staff roles and anonymous reads', async () => {
    await get('/partners/me/students')
      .query({ balanceBand: 'INVALID' })
      .expect(400);
    await get('/partners/me/students').query({ campusId }).expect(400);
    await get('/partners/me/students', staffToken).expect(403);
    await request(server).get('/partners/me/students').expect(401);
    await get(`/partners/me/students/${otherStudentId}`).expect(404);
    const other = await get('/partners/me/students', otherToken)
      .query({ balanceBand: 'ZERO' })
      .expect(200);
    expect(readPage(other).data.map((row) => row.id)).toEqual([otherStudentId]);
  });

  it('returns null when no student meets the campus-specific warning threshold', async () => {
    // Select a campus with one zero-balance student; temporarily archive only that owned row.
    await prisma.student.update({
      where: { id: otherStudentId },
      data: { isActive: false },
    });
    try {
      const response = await get('/partners/me/dashboard', otherToken).expect(
        200,
      );
      expect(readDashboard(response).data.activeStudentCount).toBe(1);
      expect(readDashboard(response).data.highlight).toBeNull();
    } finally {
      await prisma.student.update({
        where: { id: otherStudentId },
        data: { isActive: true },
      });
    }
  });

  it('uses the campus threshold rather than the fixed five-lesson filter for warnings', async () => {
    const response = await get('/partners/me/warnings').expect(200);
    expect(readPage(response).meta.total).toBe(5);
    expect(
      readPage(response).data.every(
        (row: { availableTotalUnits: number }) =>
          row.availableTotalUnits <= 300,
      ),
    ).toBe(true);
    const dashboard = await get('/partners/me/dashboard').expect(200);
    expect(readDashboard(dashboard).data.highlight?.availableTotalUnits).toBe(
      0,
    );
    expect(readDashboard(dashboard).data).toMatchObject({
      activeStudentCount: 10,
      remainingMainUnits: 2301,
      remainingGiftUnits: 301,
    });
  });

  it('paginates students with identical names by stable unique ID', async () => {
    const name = `${runTag}-同名学员`;
    for (const key of ['sameA', 'sameB']) {
      students[key] = (
        await prisma.student.create({
          data: { campusId, displayName: name },
        })
      ).id;
    }
    const first = await get('/partners/me/students')
      .query({ query: name, balanceBand: 'ZERO', page: 1, pageSize: 1 })
      .expect(200);
    const second = await get('/partners/me/students')
      .query({ query: name, balanceBand: 'ZERO', page: 2, pageSize: 1 })
      .expect(200);
    expect([readPage(first).data[0].id, readPage(second).data[0].id]).toEqual(
      [students.sameA, students.sameB].sort(),
    );
    expect(readPage(first).meta).toMatchObject({ total: 2, totalPages: 2 });
  });

  it('keeps count, filter membership and hydrated balances in one snapshot during a concurrent reservation change', async () => {
    const coursePackage = await prisma.coursePackage.findFirstOrThrow({
      where: { campusId, studentId: students.reserved },
    });
    const service = new PartnerStudentQueryService({
      $transaction: (
        read: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: { isolationLevel: Prisma.TransactionIsolationLevel },
      ) =>
        prisma.$transaction(
          async (tx) =>
            read({
              $queryRaw: tx.$queryRaw.bind(tx),
              student: {
                findMany: async (args: Prisma.StudentFindManyArgs) => {
                  // A separate connection changes the filter result after the first SELECT.
                  await prisma.coursePackage.update({
                    where: { id: coursePackage.id },
                    data: { mainReservedUnits: 0 },
                  });
                  return tx.student.findMany(args);
                },
              },
            } as unknown as Prisma.TransactionClient),
          options,
        ),
    } as unknown as PrismaService);
    try {
      const result = await service.list(campusId, {
        page: 1,
        pageSize: 20,
        query: `${runTag}-reserved`,
        balanceBand: 'LTE_FIVE',
      });
      expect(result.total).toBe(1);
      expect(result.students[0].coursePackages[0]).toMatchObject({
        mainBalanceUnits: 700,
        mainReservedUnits: 200,
      });
      const current = await get('/partners/me/students')
        .query({
          query: `${runTag}-reserved`,
          balanceBand: 'GT_FIVE',
        })
        .expect(200);
      expect(readPage(current).data[0].availableTotalUnits).toBe(700);
    } finally {
      await prisma.coursePackage.update({
        where: { id: coursePackage.id },
        data: { mainReservedUnits: 200 },
      });
    }
  });

  it('keeps ALL/default equivalent, returns a real empty match and includes the exact warning threshold', async () => {
    const all = await get('/partners/me/students')
      .query({ balanceBand: 'ALL' })
      .expect(200);
    const implicit = await get('/partners/me/students').expect(200);
    expect(readPage(all).data).toEqual(readPage(implicit).data);
    expect(readPage(all).meta).toEqual(readPage(implicit).meta);
    const empty = await get('/partners/me/students')
      .query({ query: `${runTag}-not-present`, balanceBand: 'ZERO' })
      .expect(200);
    expect(readPage(empty).data).toEqual([]);
    expect(readPage(empty).meta).toMatchObject({ total: 0, totalPages: 0 });
    const name = `${runTag}-恰好预警阈值`;
    const student = await prisma.student.create({
      data: {
        campusId,
        displayName: name,
        coursePackages: {
          create: {
            campusId,
            name: `${runTag}-阈值课包`,
            mainBalanceUnits: 300,
            validFrom: new Date('2020-01-01'),
          },
        },
      },
      include: { coursePackages: { select: { id: true } } },
    });
    students.exactWarning = student.id;
    ownedPackages.push(...student.coursePackages.map((item) => item.id));
    const warning = await get('/partners/me/warnings')
      .query({ query: name })
      .expect(200);
    expect(readPage(warning).data).toHaveLength(1);
    expect(readPage(warning).data[0]).toMatchObject({
      availableTotalUnits: 300,
      thresholdUnits: 300,
    });
  });
});
