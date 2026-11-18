import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import { AuthService } from '../src/modules/auth/auth.service';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(20 * 60_000);

it('serves the owned local teacher fixture for official WeChat API verification and then retires it', async () => {
  const runTag = `pteach-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [],
    campusIds: string[] = [],
    teacherIds: string[] = [];
  let stop!: () => void;
  let accessToken = '';
  const done = new Promise<void>((resolveDone) => {
    stop = resolveDone;
  });
  const { app, prisma } = await createPartnerPdfTestApp(
    undefined,
    (configured) => {
      const http = configured.getHttpAdapter().getInstance() as {
        get(
          path: string,
          callback: (
            request: unknown,
            response: { json(data: unknown): void },
          ) => void,
        ): void;
      };
      http.get(`/__teacher_native/${runTag}/bootstrap`, (_request, response) =>
        response.json({ accessToken, teacherId: teacherIds[0], runTag }),
      );
      http.get(`/__teacher_native/${runTag}/stop`, (_request, response) => {
        response.json({ stopping: true });
        stop();
      });
    },
  );
  let port = 0;
  try {
    const campus = await prisma.campus.create({
      data: { code: runTag, name: '合成教师测试校区' },
    });
    campusIds.push(campus.id);
    const owner = await prisma.user.create({
      data: {
        displayName: `${runTag}-评价人`,
        roles: { create: { roleCode: 'PARTNER', campusId: campus.id } },
      },
    });
    userIds.push(owner.id);
    const teacher = await prisma.user.create({
      data: {
        displayName: `${runTag}-林老师`,
        teacherProfile: {
          create: {
            employeeCode: runTag,
            campusId: campus.id,
            specialties: ['合成书法课程'],
          },
        },
      },
      include: { teacherProfile: true },
    });
    userIds.push(teacher.id);
    teacherIds.push(teacher.teacherProfile!.id);
    const group = await prisma.classGroup.create({
      data: {
        campusId: campus.id,
        teacherId: teacherIds[0],
        name: '合成书法班',
        courseName: '合成书法课程',
      },
    });
    for (let i = 0; i < 3; i++) {
      const startsAt = new Date(`2026-10-0${i + 1}T02:00:00.000Z`);
      const endsAt = new Date(startsAt.getTime() + 3600000);
      const lesson = await prisma.lessonSession.create({
        data: {
          campusId: campus.id,
          teacherId: teacherIds[0],
          classGroupId: group.id,
          startsAt,
          endsAt,
          status: i < 2 ? 'COMPLETED' : 'SCHEDULED',
          completedAt: i < 2 ? endsAt : null,
        },
      });
      if (i < 2)
        await prisma.teachingRecord.create({
          data: {
            campusId: campus.id,
            teacherId: teacherIds[0],
            lessonSessionId: lesson.id,
            attendeeCount: 0,
            lessonUnits: 100,
            recordedByUserId: owner.id,
            completedAt: endsAt,
          },
        });
    }
    accessToken = (await app.get(AuthService).issueSessionForUser(owner.id))
      .accessToken;
    let timedOut = false;
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
    const directory = resolve(
      __dirname,
      '../../.tools-automation/partner-teacher-native-20261016',
    );
    mkdirSync(directory, { recursive: true });
    const readyFile = resolve(directory, `${runTag}.json`);
    if (existsSync(readyFile))
      throw Error(
        'Prior native fixture manifest must be explicitly inspected before reuse',
      );
    writeFileSync(
      readyFile,
      JSON.stringify({
        runTag,
        port,
        teacherId: teacherIds[0],
        userIds,
        campusIds,
      }),
      { flag: 'wx' },
    );
    const latestFile = resolve(directory, 'current.json');
    writeFileSync(
      latestFile,
      JSON.stringify({ runTag, port, teacherId: teacherIds[0] }),
    );
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, 18 * 60_000);
    try {
      await done;
    } finally {
      clearTimeout(timeout);
    }
    if (timedOut) throw Error('Native fixture timed out before explicit close');
    const saved = await prisma.partnerTeacherEvaluation.findUniqueOrThrow({
      where: {
        teacherId_periodMonth: {
          teacherId: teacherIds[0],
          periodMonth: '2026-10',
        },
      },
    });
    expect(saved.version).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.partnerTeacherEvaluationRevision.count({
        where: { evaluationId: saved.id },
      }),
    ).toBe(saved.version);
    expect(
      await prisma.auditLog.count({
        where: {
          resourceId: saved.id,
          action: 'PARTNER_TEACHER_EVALUATION_SAVED',
          actorUserId: owner.id,
        },
      }),
    ).toBe(saved.version);
    console.log(
      'PARTNER_TEACHER_NATIVE_DATABASE ' +
        JSON.stringify({
          runTag,
          version: saved.version,
          historyAndAuditMatch: true,
        }),
    );
  } finally {
    const owned = await prisma.user.findMany({
      where: { id: { in: userIds }, displayName: { startsWith: runTag + '-' } },
    });
    if (owned.length !== userIds.length)
      throw Error('Native fixture ownership mismatch');
    await prisma.user.updateMany({
      where: { id: { in: userIds }, displayName: { startsWith: runTag + '-' } },
      data: { status: 'DISABLED' },
    });
    console.log(
      'PARTNER_TEACHER_FIXTURES ' +
        JSON.stringify({ runTag, userIds, campusIds, teacherIds, port }),
    );
    await app.close();
  }
});
