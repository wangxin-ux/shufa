import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/modules/auth/auth.service';
import { FeedbackService } from '../src/modules/feedback/feedback.service';
import { DomainError } from '../src/common/errors/domain-error';
import { ErrorCode } from '../src/common/errors/error-codes';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { assertTeacherPdfTestTarget } from './support/teacher-pdf-test-database';
import {
  completeTeacherFixtureCleanup,
  createTeacherPdfTestApp,
} from './support/teacher-pdf-test-app';
import type { TeacherLessonDetail } from '../../frontend/types/teacher';
import type { TeacherFeedbackStudentModel } from '../../frontend/services/teacher-feedback.presenter';
import type { createTeacherHttpPageHost } from '../../frontend/tests/teacher-http-page-test-support';
import { createTeacherFixtureUser } from './support/teacher-feedback-integration-app';

assertTeacherPdfTestTarget(process.env);
jest.setTimeout(60_000);

const scores = {
  classroomPerformance: 0,
  workCompletion: 7,
  communication: null,
  overall: 10,
};
type Ratings = typeof scores;
interface FeedbackView {
  version: number;
  content: string;
  performanceRating: number | null;
  teacherRatings: Ratings | null;
  images: Array<{ id: string }>;
}

describe('teacher four ratings through dedicated PostgreSQL and HTTP', () => {
  const nativeEnabled = process.env.TEACHER_PDF_NATIVE_ENABLED === 'true';
  const runTag = `${nativeEnabled ? 'tnfeedback-20261026' : 'tratings-20261025'}-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];
  let app: INestApplication<Server>, prisma: PrismaService;
  let campusId: string, studentId: string, groupId: string;
  let owner: { id: string; teacherId: string; token: string };
  let other: typeof owner,
    outside: typeof owner,
    parent: typeof owner,
    otherParent: typeof owner;
  let origin: string;
  let nativeRuleId: string | undefined;
  const http = () => request(app.getHttpServer());
  const route = (lesson: string) =>
    `/teachers/me/lesson-sessions/${lesson}/students/${studentId}/feedback`;
  const put = (
    lesson: string,
    body: object,
    key = randomUUID(),
    token = owner.token,
  ) =>
    http()
      .put(route(lesson))
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(body);
  const read = (response: { body: unknown }) =>
    (response.body as { data: FeedbackView }).data;
  const body = (expectedVersion = 0, teacherRatings: unknown = scores) => ({
    content: '合成课堂四维反馈',
    imageFileIds: [],
    expectedVersion,
    teacherRatings,
  });
  const saved = (lesson: string) =>
    prisma.studentFeedback.findUniqueOrThrow({
      where: {
        lessonSessionId_studentId: { lessonSessionId: lesson, studentId },
      },
      include: { images: true },
    });
  const revisions = (feedbackId: string) =>
    prisma.studentFeedbackRevision.findMany({
      where: { feedbackId },
      orderBy: { version: 'asc' },
    });

  beforeAll(async () => {
    ({ app, prisma } = await createTeacherPdfTestApp());
    campusId = (
      await prisma.campus.create({ data: { code: runTag, name: runTag } })
    ).id;
    const outsideCampus = (
      await prisma.campus.create({
        data: { code: `${runTag}-outside`, name: `${runTag}-outside` },
      })
    ).id;
    const actor = async (
      suffix: string,
      roleCode: 'TEACHER' | 'PARENT',
      campus = campusId,
    ) => {
      const user = await createTeacherFixtureUser(prisma, {
        displayName: `${runTag}-${suffix}`,
        roles: { create: { roleCode, campusId: campus } },
        ...(roleCode === 'TEACHER'
          ? {
              teacherProfile: {
                create: {
                  campusId: campus,
                  employeeCode: `${runTag}-${suffix}`,
                },
              },
            }
          : {}),
      });
      userIds.push(user.id);
      return {
        id: user.id,
        teacherId: user.teacherProfile?.id ?? '',
        token: (await app.get(AuthService).issueSessionForUser(user.id))
          .accessToken,
      };
    };
    owner = await actor('owner', 'TEACHER');
    other = await actor('other', 'TEACHER');
    outside = await actor('outside', 'TEACHER', outsideCampus);
    parent = await actor('parent', 'PARENT');
    otherParent = await actor('otherparent', 'PARENT');
    studentId = (
      await prisma.student.create({
        data: {
          campusId,
          displayName: `${runTag}-student`,
          parentBindings: {
            create: { campusId, parentUserId: parent.id, isPrimary: true },
          },
        },
      })
    ).id;
    groupId = (
      await prisma.classGroup.create({
        data: {
          campusId,
          teacherId: owner.teacherId,
          name: runTag,
          courseName: '合成四维课程',
          members: { create: { campusId, studentId } },
        },
      })
    ).id;
    await prisma.coursePackage.create({
      data: { campusId, studentId, name: runTag, mainBalanceUnits: 10000 },
    });
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    let ruleRetired = !nativeRuleId;
    try {
      await completeTeacherFixtureCleanup([
        async () => {
          if (prisma && nativeRuleId) {
            expect(
              (
                await prisma.teacherEarningRule.updateMany({
                  where: {
                    id: nativeRuleId,
                    campusId,
                    teacherProfileId: owner.teacherId,
                  },
                  data: { status: 'RETIRED' },
                })
              ).count,
            ).toBe(1);
            ruleRetired = true;
          }
        },
        async () => {
          if (prisma && userIds.length) {
            expect(
              (
                await prisma.user.updateMany({
                  where: {
                    id: { in: userIds },
                    displayName: { startsWith: `${runTag}-` },
                  },
                  data: { status: 'DISABLED' },
                })
              ).count,
            ).toBe(userIds.length);
            console.log(
              'TEACHER_RATINGS_FIXTURES',
              JSON.stringify({
                runTag,
                campusId,
                studentId,
                userIds,
                nativeRuleId,
                ruleRetired,
                disposition: 'accounts disabled; facts retained',
              }),
            );
          }
        },
      ]);
    } finally {
      await app?.close();
    }
  });

  async function lesson(attendance = [{ studentId, status: 'PRESENT' }]) {
    const row = await prisma.lessonSession.create({
      data: {
        campusId,
        teacherId: owner.teacherId,
        classGroupId: groupId,
        startsAt: new Date(Date.now() - 3600000),
        endsAt: new Date(Date.now() - 1000),
      },
    });
    await http()
      .post(`/teachers/me/lesson-sessions/${row.id}/complete`)
      .auth(owner.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ lessonVersion: 1, attendance })
      .expect(200);
    return row.id;
  }

  (nativeEnabled ? it : it.skip)(
    'native feedback saves four scores with real input, retry, version conflict and revoked write clearing',
    async () => {
      await prisma.student.update({
        where: { id: studentId },
        data: { displayName: '合成学员A' },
      });
      await prisma.classGroup.update({
        where: { id: groupId },
        data: { name: '合成四维班' },
      });
      const sibling = await prisma.student.create({
        data: {
          campusId,
          displayName: '合成学员B',
          classMemberships: { create: { campusId, classGroupId: groupId } },
        },
      });
      await prisma.coursePackage.create({
        data: {
          campusId,
          studentId: sibling.id,
          name: runTag,
          mainBalanceUnits: 1000,
        },
      });
      nativeRuleId = (
        await prisma.teacherEarningRule.create({
          data: {
            campusId,
            teacherProfileId: owner.teacherId,
            scopeKey: `teacher:${owner.teacherId}`,
            basisType: 'PER_COMPLETED_SESSION',
            unitAmountFen: 1000,
            eligibleLessonKinds: ['REGULAR'],
            countedAttendanceStatuses: ['PRESENT'],
            version: 1,
            status: 'ACTIVE',
            effectiveFrom: new Date(Date.now() - 86400000),
            createdByUserId: owner.id,
          },
        })
      ).id;
      const id = await lesson([
        { studentId, status: 'PRESENT' },
        { studentId: sibling.id, status: 'PRESENT' },
      ]);
      await http()
        .post(`/parents/me/lesson-sessions/${id}/students/${studentId}/review`)
        .auth(parent.token, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({
          teaching: 9,
          communication: 8,
          environment: 7,
          overall: 9,
          note: '合成家长评价保持',
        })
        .expect(200);
      const facts = async () => ({
        lesson: await prisma.lessonSession.findUniqueOrThrow({ where: { id } }),
        ledger: await prisma.lessonLedgerEntry.findMany({
          where: { campusId, lessonSessionId: id },
          orderBy: { id: 'asc' },
        }),
        attendance: await prisma.attendanceRecord.findMany({
          where: { campusId, lessonSessionId: id },
          orderBy: { id: 'asc' },
        }),
        earnings: await prisma.teacherEarningEntry.findMany({
          where: { campusId },
          orderBy: { id: 'asc' },
        }),
        bases: await prisma.teacherEarningBasis.findMany({
          where: { campusId },
          orderBy: { id: 'asc' },
        }),
        reviews: await prisma.parentLessonReview.findMany({
          where: { campusId, lessonSessionId: id },
          orderBy: { id: 'asc' },
        }),
        packages: await prisma.coursePackage.findMany({
          where: { campusId },
          orderBy: { id: 'asc' },
        }),
      });
      const before = await facts();
      expect(before.ledger.length).toBeGreaterThan(0);
      expect(before.earnings).toHaveLength(1);
      expect(before.reviews).toHaveLength(1);
      const calls: Array<{
        method: string;
        path: string;
        status: number;
        source: string;
        key: string;
        expectedVersion?: number;
      }> = [];
      let externalWrite = false;
      app.getHttpServer().on('request', (req, res) => {
        const source = externalWrite ? 'other-position' : 'native';
        res.once('finish', () => {
          if (!req.url?.startsWith('/teachers/')) return;
          const body = (
            req as typeof req & { body?: { expectedVersion?: number } }
          ).body;
          calls.push({
            method: req.method ?? '',
            path: req.url,
            status: res.statusCode,
            source,
            key: String(req.headers['idempotency-key'] ?? ''),
            expectedVersion: body?.expectedVersion,
          });
        });
      });
      const nativeSaves = () =>
        calls.filter(
          (call) => call.source === 'native' && call.method === 'PUT',
        );
      const runNative = jest.requireActual<
        (options: {
          runTag: string;
          origin: string;
          token: string;
          lessonId: string;
          studentId: string;
          siblingId: string;
          readCalls(): number;
          saveCalls(): number;
          assertSaved(
            version: number,
            content: string,
            ratings: Record<string, number | null>,
          ): Promise<void>;
          failNextSave(): Promise<void>;
          updateElsewhere(): Promise<void>;
          revokeMember(): Promise<unknown>;
        }) => Promise<string>
      >(
        '../../docs/verification/teacher-pdf-increment-a/native-real-feedback.cjs',
      );
      let evidence: string | undefined;
      try {
        evidence = await runNative({
          runTag,
          origin,
          token: owner.token,
          lessonId: id,
          studentId,
          siblingId: sibling.id,
          readCalls: () =>
            calls.filter(
              (call) =>
                call.path === `/teachers/me/lesson-sessions/${id}` &&
                call.method === 'GET' &&
                call.status === 200,
            ).length,
          saveCalls: () => nativeSaves().length,
          assertSaved: async (version, content, teacherRatings) => {
            const row = await saved(id);
            expect(row).toMatchObject({ version, content, teacherRatings });
            expect(
              (await revisions(row.id)).map((entry) => entry.version),
            ).toEqual(Array.from({ length: version }, (_, index) => index + 1));
            expect(
              await prisma.auditLog.count({
                where: {
                  campusId,
                  action: 'TEACHER_FEEDBACK_UPSERT',
                  resourceId: `${id}:${studentId}`,
                },
              }),
            ).toBe(version);
            const updates = (
              await http()
                .get('/parents/me/updates')
                .query({ studentId })
                .auth(parent.token, { type: 'bearer' })
                .expect(200)
            ).body as {
              data: { records: Array<{ lessonSessionId: string }> };
            };
            expect(
              updates.data.records.find(
                (record) => record.lessonSessionId === id,
              ),
            ).toMatchObject({
              feedbackVersion: version,
              feedback: content,
              teacherRatings,
            });
            expect(await facts()).toEqual(before);
          },
          failNextSave: () => {
            jest
              .spyOn(app.get(FeedbackService), 'upsert')
              .mockRejectedValueOnce(
                new DomainError(
                  ErrorCode.INTERNAL_SERVER_ERROR,
                  '合成短暂保存失败',
                  503,
                ),
              );
            return Promise.resolve();
          },
          updateElsewhere: async () => {
            externalWrite = true;
            try {
              await put(id, {
                ...body(2, { ...scores, communication: 8 }),
                content: '合成其他位置修订',
              }).expect(200);
            } finally {
              externalWrite = false;
            }
          },
          revokeMember: () =>
            prisma.classMember.updateMany({
              where: {
                campusId,
                classGroupId: groupId,
                studentId,
                leftAt: null,
              },
              data: { leftAt: new Date() },
            }),
        });
        const saves = nativeSaves();
        expect(saves.map((call) => call.status)).toEqual([
          200, 503, 200, 409, 403,
        ]);
        expect(saves.map((call) => call.expectedVersion)).toEqual([
          0, 1, 1, 2, 3,
        ]);
        expect(saves.every((call) => call.key.length > 0)).toBe(true);
        expect(saves[1].key).toBe(saves[2].key);
        expect(saves[0].key).not.toBe(saves[2].key);
        const feedback = await saved(id);
        expect(
          (await revisions(feedback.id)).map((entry) => entry.snapshot),
        ).toEqual([
          expect.objectContaining({
            content: '合成原生课堂反馈：继续练习。',
            teacherRatings: scores,
          }),
          expect.objectContaining({
            content: '合成反馈待重试',
            teacherRatings: scores,
          }),
          expect.objectContaining({
            content: '合成其他位置修订',
            teacherRatings: { ...scores, communication: 8 },
          }),
        ]);
        expect(
          await prisma.studentFeedback.count({
            where: { lessonSessionId: id, studentId: sibling.id },
          }),
        ).toBe(0);
      } finally {
        jest.restoreAllMocks();
        const keys = [
          ...new Set(calls.map((call) => call.key).filter(Boolean)),
        ];
        console.log(
          'TEACHER_NATIVE_FEEDBACK_HTTP',
          JSON.stringify({
            runTag,
            lessonId: id,
            siblingId: sibling.id,
            evidence,
            completed: !!evidence,
            calls: calls.map(({ key, ...call }) => ({
              ...call,
              keySequence: key ? keys.indexOf(key) + 1 : null,
            })),
            factsUnchanged:
              JSON.stringify(await facts()) === JSON.stringify(before),
          }),
        );
        expect(await facts()).toEqual(before);
      }
    },
    360_000,
  );

  it('saves independent zero, half-star and nullable scores, reads them through teacher archive and bound parent', async () => {
    const id = await lesson();
    const value = read(await put(id, body()).expect(200));
    expect(value).toMatchObject({
      version: 1,
      teacherRatings: scores,
      performanceRating: null,
    });
    const detail = (
      await http()
        .get(`/teachers/me/lesson-sessions/${id}`)
        .auth(owner.token, { type: 'bearer' })
        .expect(200)
    ).body as {
      data: {
        students: Array<{ teacherRatings: Ratings; feedbackVersion: number }>;
      };
    };
    expect(detail.data.students[0]).toMatchObject({
      teacherRatings: scores,
      feedbackVersion: 1,
    });
    const archive = (
      await http()
        .get(`/teachers/me/students/${studentId}`)
        .auth(owner.token, { type: 'bearer' })
        .expect(200)
    ).body as {
      data: {
        feedbackHistory: {
          data: Array<{ lessonSessionId: string; teacherRatings: Ratings }>;
        };
      };
    };
    expect(
      archive.data.feedbackHistory.data.find(
        (item) => item.lessonSessionId === id,
      ),
    ).toMatchObject({ teacherRatings: scores, feedbackVersion: 1 });
    const updates = (
      await http()
        .get('/parents/me/updates')
        .query({ studentId })
        .auth(parent.token, { type: 'bearer' })
        .expect(200)
    ).body as {
      data: { records: Array<{ lessonSessionId: string }> };
    };
    expect(
      updates.data.records.find((item) => item.lessonSessionId === id),
    ).toMatchObject({
      teacherRatings: scores,
      feedbackAuthorName: `${runTag}-owner`,
      feedbackVersion: 1,
    });
    await http()
      .get('/parents/me/updates')
      .query({ studentId })
      .auth(otherParent.token, { type: 'bearer' })
      .expect(403);
  });

  it('preserves legacy single scores, records revisions and rejects stale or missing versions after upgrade', async () => {
    const id = await lesson();
    const legacy = read(
      await put(id, {
        content: '原单项',
        imageFileIds: [],
        performanceRating: 9,
      }).expect(200),
    );
    expect(legacy).toMatchObject({
      performanceRating: 9,
      teacherRatings: null,
      version: 1,
    });
    const current = read(await put(id, body(1)).expect(200));
    expect(current).toMatchObject({
      teacherRatings: scores,
      performanceRating: 9,
      version: 2,
    });
    const row = await saved(id);
    const history = await revisions(row.id);
    expect(history.map(({ version }) => version)).toEqual([1, 2]);
    expect(history[0].snapshot).toMatchObject({
      content: '原单项',
      teacherRatings: null,
      performanceRating: 9,
    });
    expect(history[1].snapshot).toMatchObject({
      teacherRatings: scores,
      performanceRating: 9,
    });
    await put(id, body(1)).expect(409);
    await put(id, { content: '旧客户端覆盖', imageFileIds: [] }).expect(409);
    expect(await saved(id)).toEqual(row);
    const cleared = {
      classroomPerformance: null,
      workCompletion: null,
      communication: null,
      overall: null,
    };
    expect(read(await put(id, body(2, cleared)).expect(200))).toMatchObject({
      version: 3,
      teacherRatings: cleared,
      performanceRating: 9,
    });
    expect((await revisions(row.id)).map(({ version }) => version)).toEqual([
      1, 2, 3,
    ]);
  });

  it('replays the exact request once and resolves concurrent different keys by feedback version', async () => {
    const id = await lesson(),
      key = randomUUID();
    const first = read(await put(id, body(), key).expect(200));
    expect(read(await put(id, body(), key).expect(200))).toEqual(first);
    await put(id, { ...body(), content: '不同请求' }, key).expect(409);
    const outcomes = await Promise.all([
      put(id, { ...body(1), content: '修订A' }),
      put(id, { ...body(1), content: '修订B' }),
    ]);
    expect(outcomes.map(({ status }) => status).sort()).toEqual([200, 409]);
    const row = await saved(id);
    expect(row.version).toBe(2);
    expect(await revisions(row.id)).toHaveLength(2);
    expect(
      await prisma.auditLog.count({
        where: {
          campusId,
          action: 'TEACHER_FEEDBACK_UPSERT',
          resourceId: `${id}:${studentId}`,
        },
      }),
    ).toBe(2);
  });

  it('rejects malformed score objects and non-integer or out-of-range values without writes', async () => {
    const id = await lesson();
    for (const teacherRatings of [
      null,
      {},
      { ...scores, communication: undefined },
      { ...scores, overall: -1 },
      { ...scores, overall: 11 },
      { ...scores, overall: 1.5 },
      { ...scores, overall: '9' },
      { ...scores, overall: true },
      { ...scores, invented: 5 },
    ]) {
      await put(id, body(0, teacherRatings)).expect(400);
    }
    await put(id, {
      content: '缺少版本',
      imageFileIds: [],
      teacherRatings: scores,
    }).expect(409);
    expect(
      await prisma.studentFeedback.count({ where: { lessonSessionId: id } }),
    ).toBe(0);
  });

  it('denies other teachers, campuses, parents, unrecorded students and reassigned authors', async () => {
    const id = await lesson();
    await put(id, body(), randomUUID(), other.token).expect(403);
    await put(id, body(), randomUUID(), outside.token).expect(403);
    await put(id, body(), randomUUID(), parent.token).expect(403);
    await http()
      .put(
        `/teachers/me/lesson-sessions/${id}/students/${randomUUID()}/feedback`,
      )
      .auth(owner.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send(body())
      .expect(403);
    await put(id, body()).expect(200);
    const row = await saved(id);
    await prisma.lessonSession.update({
      where: { id },
      data: { teacherId: other.teacherId },
    });
    await put(id, body(1), randomUUID(), other.token).expect(403);
    expect(await saved(id)).toEqual(row);
    await prisma.lessonSession.update({
      where: { id },
      data: { teacherId: owner.teacherId },
    });
  });

  it('rolls back scores, images, revision, audit and idempotency when the transaction fails', async () => {
    const id = await lesson();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCZkAAAAASUVORK5CYII=',
      'base64',
    );
    const upload = async () =>
      (
        (
          await http()
            .post(`${route(id)}-images`)
            .auth(owner.token, { type: 'bearer' })
            .attach('file', png, {
              filename: 'synthetic-ratings.png',
              contentType: 'image/png',
            })
            .expect(200)
        ).body as { data: { id: string } }
      ).data.id;
    const firstImage = await upload(),
      replacement = await upload();
    await put(id, { ...body(), imageFileIds: [firstImage] }).expect(200);
    const before = await saved(id),
      history = await revisions(before.id);
    const auditCount = await prisma.auditLog.count({ where: { campusId } });
    const key = randomUUID();
    const fail = jest
      .spyOn(app.get(IdempotencyService), 'complete')
      .mockRejectedValueOnce(
        new Error('synthetic feedback transaction failure'),
      );
    const revision = {
      ...body(1),
      content: '必须整体回滚',
      imageFileIds: [replacement],
    };
    try {
      await put(id, revision, key).expect(500);
    } finally {
      fail.mockRestore();
    }
    expect(await saved(id)).toEqual(before);
    expect(await revisions(before.id)).toEqual(history);
    expect(await prisma.auditLog.count({ where: { campusId } })).toBe(
      auditCount,
    );
    expect(
      await prisma.idempotencyRecord.count({
        where: { key, route: route(id) },
      }),
    ).toBe(0);
    expect(read(await put(id, revision, key).expect(200)).version).toBe(2);
    expect(
      (await revisions(before.id)).map(
        (item) => (item.snapshot as { imageFileIds: string[] }).imageFileIds,
      ),
    ).toEqual([[firstImage], [replacement]]);
  });

  it('enforces JSON structure and immutable revisions inside PostgreSQL', async () => {
    const id = await lesson();
    await put(id, body()).expect(200);
    const before = await saved(id);
    for (const invalid of [
      {},
      { ...scores, overall: '9' },
      { ...scores, overall: 11 },
      { ...scores, classroomPerformance: 0.5 },
      { ...scores, extra: null },
    ]) {
      await expect(prisma.$executeRaw`
        UPDATE "StudentFeedback" SET "teacherRatings" = ${JSON.stringify(invalid)}::jsonb
        WHERE "id" = ${before.id}::uuid
      `).rejects.toThrow();
    }
    const history = await revisions(before.id);
    await expect(prisma.$executeRaw`
      UPDATE "StudentFeedbackRevision" SET "snapshot" = '{}'::jsonb
      WHERE "id" = ${history[0].id}::uuid
    `).rejects.toThrow('append-only');
    expect(await saved(id)).toEqual(before);
    expect(await revisions(before.id)).toEqual(history);
  });

  it('saves and reloads all four scores from the actual Page through TCP without changing ledger or family reviews', async () => {
    const id = await lesson();
    const { createTeacherHttpPageHost: createHost } = jest.requireActual<{
      createTeacherHttpPageHost: typeof createTeacherHttpPageHost;
    }>('../../frontend/tests/teacher-http-page-test-support');
    const host = createHost({
      origin,
      accessToken: owner.token,
      routes: [
        { method: 'GET', path: `/teachers/me/lesson-sessions/${id}` },
        { method: 'PUT', path: route(id) },
      ],
    });
    const ledger = await prisma.lessonLedgerEntry.findMany({
      where: { campusId, lessonSessionId: id },
    });
    const reviews = await prisma.parentLessonReview.findMany({
      where: { campusId, lessonSessionId: id },
    });
    type Page = {
      data: {
        viewState: string;
        students: TeacherFeedbackStudentModel[];
        detail: TeacherLessonDetail;
      };
      onLoad(options: { id: string }): void;
      onShow(): void;
      onFeedbackInput(event: object): void;
      onTeacherRatingChange(event: object): void;
      onReloadFeedback(): void;
      onSaveFeedback(event: object): Promise<void>;
    };
    try {
      const page = host.capture('feedback-detail') as Page;
      page.onLoad({ id });
      page.onShow();
      await host.idle();
      expect(page.data.viewState).toBe('ready');
      const event = (field = '', value = '') => ({
        currentTarget: { dataset: { id: studentId, field } },
        detail: { value },
      });
      page.onFeedbackInput(event('', '合成页面四维保存'));
      page.onTeacherRatingChange(event('classroomPerformance', '1'));
      page.onTeacherRatingChange(event('workCompletion', '8'));
      page.onTeacherRatingChange(event('overall', '11'));
      await page.onSaveFeedback(event());
      await host.idle();
      expect(page.data.students[0]).toMatchObject({
        feedbackVersion: 1,
        teacherRatingsDraft: scores,
      });
      expect((await saved(id)).teacherRatings).toEqual(scores);
      page.onTeacherRatingChange(event('communication', '6'));
      await page.onSaveFeedback(event());
      await host.idle();
      expect(page.data.students[0].feedbackVersion).toBe(2);
      page.onReloadFeedback();
      await host.idle();
      expect(page.data.students[0].teacherRatingsDraft).toEqual({
        ...scores,
        communication: 5,
      });
      expect(
        host.transport.calls
          .filter((call) => call.method === 'PUT')
          .map(
            (call) =>
              (call.body as { expectedVersion: number }).expectedVersion,
          ),
      ).toEqual([0, 1]);
      const updates = (
        await http()
          .get('/parents/me/updates')
          .query({ studentId })
          .auth(parent.token, { type: 'bearer' })
          .expect(200)
      ).body as {
        data: { records: Array<{ lessonSessionId: string }> };
      };
      expect(
        updates.data.records.find((record) => record.lessonSessionId === id),
      ).toMatchObject({
        teacherRatings: { ...scores, communication: 5 },
        feedbackVersion: 2,
      });
      expect(
        await prisma.lessonLedgerEntry.findMany({
          where: { campusId, lessonSessionId: id },
        }),
      ).toEqual(ledger);
      expect(
        await prisma.parentLessonReview.findMany({
          where: { campusId, lessonSessionId: id },
        }),
      ).toEqual(reviews);
    } finally {
      await host.close();
    }
  });

  it('keeps reversed scores readable and blocks writes without changing lesson ledger facts', async () => {
    const id = await lesson();
    await put(id, body()).expect(200);
    const before = await saved(id);
    const consume = await prisma.lessonLedgerEntry.count({
      where: { campusId, lessonSessionId: id },
    });
    expect(consume).toBeGreaterThan(0);
    await http()
      .post(`/teachers/me/lesson-sessions/${id}/reverse`)
      .auth(owner.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ lessonVersion: 2, reason: '合成四维撤销核对' })
      .expect(200);
    const ledger = await prisma.lessonLedgerEntry.findMany({
      where: { campusId, lessonSessionId: id },
    });
    await put(id, body(1)).expect(409);
    expect(await saved(id)).toEqual(before);
    expect(
      await prisma.lessonLedgerEntry.findMany({
        where: { campusId, lessonSessionId: id },
      }),
    ).toEqual(ledger);
    const update = (
      await http()
        .get('/parents/me/updates')
        .query({ studentId })
        .auth(parent.token, { type: 'bearer' })
        .expect(200)
    ).body as { data: { records: Array<{ lessonSessionId: string }> } };
    expect(
      update.data.records.find((item) => item.lessonSessionId === id),
    ).toMatchObject({ lessonStatus: 'REVERSED', teacherRatings: scores });
  });
});
