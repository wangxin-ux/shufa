import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { PartnerApplicationStatus, RoleCode } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);

interface Archive {
  applicationId: string;
  status: string;
  version: number;
  basicInformation: { institutionName: string; contactPhone: string | null };
}
const read = (response: { body: unknown }) =>
  (response.body as { data: Archive | null }).data;

describe('formal partner reads only their own application archive', () => {
  const runTag = `parchive-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];
  const applicantIds: string[] = [];
  const applicationIds: string[] = [];
  const campusIds: string[] = [];
  const tokens: Record<string, string> = {};
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let ownedApplication: Archive;
  let otherApplicantId: string;
  let disabledUserId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    for (const suffix of ['a', 'b']) {
      const campus = await prisma.campus.create({
        data: { code: `${runTag}-${suffix}`, name: `${runTag}-${suffix}` },
      });
      campusIds.push(campus.id);
    }
    const actors: Array<{
      key: string;
      roles: Array<{ roleCode: RoleCode; campusId: string | null }>;
      applicant?: boolean;
      status?: PartnerApplicationStatus;
    }> = [
      {
        key: 'own',
        roles: [{ roleCode: 'PARTNER', campusId: campusIds[0] }],
        applicant: true,
        status: 'DRAFT',
      },
      {
        key: 'other',
        roles: [{ roleCode: 'PARTNER', campusId: campusIds[0] }],
        applicant: true,
        status: 'APPROVED',
      },
      {
        key: 'submitted',
        roles: [{ roleCode: 'PARTNER', campusId: campusIds[0] }],
        applicant: true,
        status: 'SUBMITTED',
      },
      {
        key: 'rejected',
        roles: [{ roleCode: 'PARTNER', campusId: campusIds[0] }],
        applicant: true,
        status: 'REJECTED',
      },
      {
        key: 'missing',
        roles: [{ roleCode: 'PARTNER', campusId: campusIds[0] }],
      },
      {
        key: 'emptyApplicant',
        roles: [{ roleCode: 'PARTNER', campusId: campusIds[0] }],
        applicant: true,
      },
      {
        key: 'teacher',
        roles: [{ roleCode: 'TEACHER', campusId: campusIds[0] }],
      },
      {
        key: 'parent',
        roles: [{ roleCode: 'PARENT', campusId: campusIds[0] }],
      },
      { key: 'admin', roles: [{ roleCode: 'SUPER_ADMIN', campusId: null }] },
      { key: 'unscoped', roles: [{ roleCode: 'PARTNER', campusId: null }] },
      {
        key: 'multi',
        roles: [
          { roleCode: 'PARTNER', campusId: campusIds[0] },
          { roleCode: 'PARTNER', campusId: campusIds[1] },
        ],
      },
      {
        key: 'mixed',
        roles: [
          { roleCode: 'PARTNER', campusId: campusIds[0] },
          { roleCode: 'TEACHER', campusId: campusIds[0] },
        ],
      },
      {
        key: 'disabled',
        roles: [{ roleCode: 'PARTNER', campusId: campusIds[0] }],
      },
    ];
    for (const actor of actors) {
      const user = await prisma.user.create({
        data: {
          displayName: `${runTag}-${actor.key}`,
          roles: { create: actor.roles },
        },
      });
      userIds.push(user.id);
      tokens[actor.key] = (
        await app.get(AuthService).issueSessionForUser(user.id)
      ).accessToken;
      if (actor.key === 'disabled') disabledUserId = user.id;
      if (actor.applicant) {
        const applicant = await prisma.partnerApplicant.create({
          data: { userId: user.id },
        });
        applicantIds.push(applicant.id);
        if (actor.key === 'other') otherApplicantId = applicant.id;
        if (actor.status) {
          const application = await prisma.partnerApplication.create({
            data: {
              applicantId: applicant.id,
              status: actor.status,
              institutionName: `${runTag}-${actor.key}-institution`,
              province: '合成省',
              city: '合成市',
              district: '合成区',
              detailedAddress: '合成测试路一号',
              contactPhone:
                actor.key === 'own' ? '0000-00000001' : '0000-00000002',
            },
          });
          applicationIds.push(application.id);
          if (actor.key === 'own') {
            ownedApplication = {
              applicationId: application.id,
              status: 'DRAFT',
              version: 1,
              basicInformation: {
                institutionName: application.institutionName!,
                contactPhone: application.contactPhone,
              },
            };
          }
        }
      }
    }
  });

  afterAll(async () => {
    let disabledVerified = false;
    try {
      if (prisma && userIds.length) {
        assertPartnerPdfTestTarget(process.env);
        await prisma.user.updateMany({
          where: { id: { in: userIds }, displayName: { startsWith: runTag } },
          data: { status: 'DISABLED' },
        });
        expect(
          await prisma.user.count({
            where: { id: { in: userIds }, status: 'DISABLED' },
          }),
        ).toBe(userIds.length);
        disabledVerified = true;
      }
    } finally {
      try {
        await app?.close();
      } finally {
        process.stdout.write(
          `PARTNER_APPLICATION_ARCHIVE_OWNERSHIP ${JSON.stringify({
            runTag,
            userIds,
            campusIds,
            applicantIds,
            applicationIds,
            disposition: 'retained; no deletion',
            ownedUsers: disabledVerified
              ? 'disabled and verified'
              : 'not verified',
          })}\n`,
        );
      }
    }
  });

  const get = (token = tokens.own) =>
    request(server)
      .get('/partners/me/application')
      .auth(token, { type: 'bearer' });

  it('reads owned institution basics with formal credentials and no private identity fields', async () => {
    const archive = read(await get().expect(200));
    expect(archive).toMatchObject(ownedApplication);
    expect(Object.keys(archive!).sort()).toEqual([
      'applicationId',
      'basicInformation',
      'createdAt',
      'status',
      'updatedAt',
      'version',
    ]);
    expect(Object.keys(archive!.basicInformation).sort()).toEqual([
      'city',
      'contactPhone',
      'detailedAddress',
      'district',
      'institutionName',
      'province',
    ]);
  });

  it('ignores client-selected user, applicant, application and campus scope', async () => {
    const response = await get()
      .query({
        userId: userIds[1],
        applicantId: otherApplicantId,
        applicationId: applicationIds[1],
        campusId: campusIds[1],
      })
      .expect(200);
    expect(read(response)).toMatchObject(ownedApplication);
    const other = read(await get(tokens.other).expect(200));
    expect(other?.applicationId).toBe(applicationIds[1]);
    expect(other?.basicInformation.institutionName).toContain(
      '-other-institution',
    );
    expect(read(response)?.basicInformation.contactPhone).toBe('0000-00000001');
    expect(other?.basicInformation.contactPhone).toBe('0000-00000002');
  });

  it.each(['missing', 'emptyApplicant'])(
    'returns null without creating a record for %s',
    async (actor) => {
      const before = await prisma.partnerApplication.count({
        where: { applicant: { userId: { in: userIds } } },
      });
      expect(read(await get(tokens[actor]).expect(200))).toBeNull();
      expect(
        await prisma.partnerApplication.count({
          where: { applicant: { userId: { in: userIds } } },
        }),
      ).toBe(before);
      expect(
        await prisma.partnerApplicant.count({
          where: { user: { displayName: `${runTag}-missing` } },
        }),
      ).toBe(0);
    },
  );

  it.each(['teacher', 'parent', 'admin', 'unscoped', 'multi', 'mixed'])(
    'rejects %s without a valid single partner scope',
    async (actor) => {
      await get(tokens[actor]).expect(403);
    },
  );

  it.each(['submitted', 'rejected'])(
    'reads the owned %s archive without changing its status or version',
    async (actor) => {
      const archive = read(await get(tokens[actor]).expect(200))!;
      expect(archive.status).toBe(actor.toUpperCase());
      expect(archive.basicInformation.institutionName).toBe(
        `${runTag}-${actor}-institution`,
      );
      expect(
        await prisma.partnerApplication.findUnique({
          where: { id: archive.applicationId },
          select: { status: true, version: true },
        }),
      ).toEqual({ status: actor.toUpperCase(), version: archive.version });
    },
  );

  it('rejects missing, refresh and restricted applicant tokens', async () => {
    await request(server).get('/partners/me/application').expect(401);
    const jwt = app.get(JwtService);
    const secret = app
      .get(ConfigService)
      .getOrThrow<string>('JWT_ACCESS_SECRET');
    for (const kind of ['refresh', 'partner_application']) {
      const token = await jwt.signAsync({ sub: userIds[0], kind }, { secret });
      await get(token).expect(401);
    }
  });

  it('rejects a disabled account even with a previously valid access token', async () => {
    await prisma.user.update({
      where: { id: disabledUserId },
      data: { status: 'DISABLED' },
    });
    await get(tokens.disabled).expect(401);
  });

  it('has no formal draft-write route and does not admit formal tokens to applicant saving', async () => {
    await request(server)
      .put('/partners/me/application')
      .auth(tokens.own, { type: 'bearer' })
      .send({ expectedVersion: 1 })
      .expect(404);
    await request(server)
      .put('/partner-applicants/me/application/basic-information')
      .auth(tokens.own, { type: 'bearer' })
      .send({ expectedVersion: 1, basicInformation: {} })
      .expect(401);
    expect(
      await prisma.partnerApplication.findUnique({
        where: { id: ownedApplication.applicationId },
        select: { version: true, institutionName: true },
      }),
    ).toEqual({
      version: 1,
      institutionName: ownedApplication.basicInformation.institutionName,
    });
  });
});
