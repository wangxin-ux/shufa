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

describe('partner PDF profile in a dedicated isolated database', () => {
  const runTag = `ppdf-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];
  const campusIds: string[] = [];
  const studentIds: string[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let token: string;
  let emptyToken: string;
  let staffToken: string;
  let activeStudentId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    for (const suffix of ['a', 'b', 'empty']) {
      const campus = await prisma.campus.create({
        data: { code: `${runTag}-${suffix}`, name: `${runTag}测试校区` },
      });
      campusIds.push(campus.id);
    }
    for (const [roleCode, campusId] of [
      ['PARTNER', campusIds[0]],
      ['PARTNER', campusIds[2]],
      ['TEACHER', campusIds[0]],
    ] as const) {
      const user = await prisma.user.create({
        data: {
          displayName: `${runTag}测试账号`,
          roles: { create: { roleCode, campusId } },
        },
      });
      userIds.push(user.id);
      const session = await app.get(AuthService).issueSessionForUser(user.id);
      if (roleCode === 'TEACHER') staffToken = session.accessToken;
      else if (campusId === campusIds[2]) emptyToken = session.accessToken;
      else token = session.accessToken;
    }
    for (const [campusId, isActive] of [
      [campusIds[0], true],
      [campusIds[0], true],
      [campusIds[0], false],
      [campusIds[1], true],
    ] as const) {
      const student = await prisma.student.create({
        data: { campusId, isActive, displayName: `${runTag}学员` },
      });
      studentIds.push(student.id);
    }
    activeStudentId = studentIds[0];
  });

  afterAll(async () => {
    try {
      if (prisma && userIds.length) {
        assertPartnerPdfTestTarget(process.env);
        await prisma.user.updateMany({
          where: { id: { in: userIds }, displayName: { startsWith: runTag } },
          data: { status: 'DISABLED' },
        });
      }
    } finally {
      await app?.close();
      process.stdout.write(
        `PARTNER_PDF_FIXTURE_OWNERSHIP ${JSON.stringify({
          runTag,
          userIds,
          campusIds,
          studentIds,
          disposition: 'retained; owned users disabled; no deletion',
        })}\n`,
      );
    }
  });

  const get = (bearer = token) =>
    request(server)
      .get('/partners/me/profile')
      .auth(bearer, { type: 'bearer' });
  const read = (response: { body: unknown }) =>
    (
      response.body as {
        data: { activeStudentCount: number; campus: { id: string } };
      }
    ).data;

  it('counts active local students even without a package, never inactive or other-campus students', async () => {
    const response = await get().expect(200);
    expect(read(response)).toMatchObject({
      activeStudentCount: 2,
      campus: { id: campusIds[0] },
    });
    expect(Object.keys(read(response)).sort()).toEqual([
      'activeStudentCount',
      'campus',
      'displayName',
      'roleCode',
    ]);
    expect(Object.keys(read(response).campus).sort()).toEqual([
      'address',
      'code',
      'contactPhone',
      'id',
      'lessonWarningThresholdUnits',
      'name',
      'timezone',
    ]);
  });

  it('returns a valid zero count for an empty campus', async () => {
    expect(read(await get(emptyToken).expect(200))).toMatchObject({
      activeStudentCount: 0,
      campus: { id: campusIds[2] },
    });
  });

  it('reflects status changes on the next read, without cached balances or membership counts', async () => {
    await prisma.student.update({
      where: { id: activeStudentId },
      data: { isActive: false },
    });
    expect(read(await get().expect(200)).activeStudentCount).toBe(1);
    await prisma.student.update({
      where: { id: activeStudentId },
      data: { isActive: true },
    });
    expect(read(await get().expect(200)).activeStudentCount).toBe(2);
  });

  it('cannot override the server campus with a query parameter', async () => {
    const response = await get().query({ campusId: campusIds[1] }).expect(200);
    expect(read(response)).toMatchObject({
      activeStudentCount: 2,
      campus: { id: campusIds[0] },
    });
  });

  it('rejects unauthenticated access', async () => {
    await request(server).get('/partners/me/profile').expect(401);
  });

  it('rejects a non-partner role', async () => {
    await get(staffToken).expect(403);
  });
});
