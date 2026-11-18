import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/modules/auth/auth.service';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import {
  StoredFileService,
  STUDENT_PROFILE_PHOTO_OPTIONS,
  STUDENT_FEEDBACK_IMAGE_OPTIONS,
} from '../src/modules/file/stored-file.service';
import { assertTeacherPdfTestTarget } from './support/teacher-pdf-test-database';
import { createTeacherPdfTestApp } from './support/teacher-pdf-test-app';
import { createTeacherFixtureUser } from './support/teacher-feedback-integration-app';

assertTeacherPdfTestTarget(process.env);
jest.setTimeout(60_000);
interface ArchiveView {
  archive: {
    age: number | null;
    photo: { accessUrl: string };
    enrollment: Record<string, number | null>;
    balance: Record<string, number | string | boolean>;
  };
  attendance: {
    presentCount: number;
    leaveCount: number;
    absentCount: number;
    recordedCount: number;
  };
  feedbackHistory: {
    data: Array<{
      id: string;
      lessonStatus: string;
      content: string;
      images: Array<{ accessUrl: string }>;
    }>;
    meta: { page: number; total: number; totalPages: number };
  };
}

describe('teacher student archive through isolated PostgreSQL and HTTP', () => {
  const nativeEnabled = process.env.TEACHER_PDF_NATIVE_ENABLED === 'true';
  const nativeHistorical =
    process.env.TEACHER_PDF_NATIVE_HISTORICAL_ONLY === 'true';
  const runTag = `${nativeEnabled ? 'tnstudents-20261026' : 'tarchive-20261025'}-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];
  const nativeStudentIds: string[] = [];
  const lessonIds: string[] = [];
  let app: INestApplication<Server>, prisma: PrismaService;
  let campusId: string,
    studentId: string,
    unknownId: string,
    emptyId: string,
    memberId: string;
  let teacher: { id: string; teacherId: string; token: string },
    colleague: typeof teacher,
    outside: typeof teacher;
  let origin: string, png: Buffer;
  const http = () => request(app.getHttpServer());
  const get = (id = studentId, token = teacher.token) =>
    http().get(`/teachers/me/students/${id}`).auth(token, { type: 'bearer' });
  const read = async (id = studentId, query = {}) =>
    ((await get(id).query(query).expect(200)).body as { data: ArchiveView })
      .data;

  beforeAll(async () => {
    ({ app, prisma } = await createTeacherPdfTestApp());
    campusId = (
      await prisma.campus.create({ data: { code: runTag, name: runTag } })
    ).id;
    const otherCampus = (
      await prisma.campus.create({
        data: { code: `${runTag}-outside`, name: `${runTag}-outside` },
      })
    ).id;
    const actor = async (suffix: string, campus: string) => {
      const user = await createTeacherFixtureUser(prisma, {
        displayName: `${runTag}-${suffix}`,
        roles: { create: { roleCode: 'TEACHER', campusId: campus } },
        teacherProfile: {
          create: { campusId: campus, employeeCode: `${runTag}-${suffix}` },
        },
      });
      userIds.push(user.id);
      return {
        id: user.id,
        teacherId: user.teacherProfile!.id,
        token: (await app.get(AuthService).issueSessionForUser(user.id))
          .accessToken,
      };
    };
    teacher = await actor('owner', campusId);
    colleague = await actor('colleague', campusId);
    outside = await actor('outside', otherCampus);
    const group = await prisma.classGroup.create({
      data: {
        campusId,
        teacherId: teacher.teacherId,
        name: nativeEnabled ? '合成创意绘画班' : runTag,
        courseName: '合成绘画',
      },
    });
    for (const name of ['known', 'unknown', 'empty'] as const) {
      const student = await prisma.student.create({
        data: {
          campusId,
          displayName: nativeEnabled
            ? {
                known: '合成学员00',
                unknown: '报名待核对学员',
                empty: '无记录学员',
              }[name]
            : `${runTag}-${name}`,
          profileAge: name === 'known' ? 8 : null,
          birthDate: name === 'known' ? new Date('2017-01-01') : null,
          classMemberships: { create: { campusId, classGroupId: group.id } },
        },
        include: { classMemberships: true },
      });
      if (name === 'known') {
        studentId = student.id;
        memberId = student.classMemberships[0].id;
        nativeStudentIds.push(student.id);
      } else if (name === 'unknown') unknownId = student.id;
      else emptyId = student.id;
    }
    if (nativeEnabled && !nativeHistorical) {
      for (let index = 1; index <= 20; index++) {
        const student = await prisma.student.create({
          data: {
            campusId,
            displayName: `合成学员${String(index).padStart(2, '0')}`,
            classMemberships: { create: { campusId, classGroupId: group.id } },
          },
        });
        nativeStudentIds.push(student.id);
      }
    }
    png = nativeEnabled
      ? readFileSync(
          path.resolve(
            __dirname,
            '../../frontend/pages/teacher/assets/icon-students.png',
          ),
        )
      : Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jUioAAAAASUVORK5CYII=',
          'base64',
        );
    const files = app.get(StoredFileService);
    const actorView = {
      userId: teacher.id,
      roles: [{ code: 'TEACHER' as const, campusId }],
    };
    const photo = await files.store(
      actorView,
      {
        originalname: 'synthetic-photo.png',
        mimetype: 'image/png',
        size: png.length,
        buffer: png,
      },
      STUDENT_PROFILE_PHOTO_OPTIONS,
    );
    await prisma.student.update({
      where: { id: studentId },
      data: { profilePhotoFileId: photo.id },
    });
    for (const [index, amount, main, gift] of [
      [0, 123456, 1000, 200],
      [1, 50000, 2000, 0],
    ]) {
      const proof = await prisma.storedFile.create({
        data: {
          purpose: 'PAYMENT_PROOF',
          storageKey: `${runTag}/proof-${index}`,
          originalName: 'private-proof.png',
          mimeType: 'image/png',
          sizeBytes: 1,
          sha256: '0'.repeat(64),
          createdByUserId: teacher.id,
        },
      });
      const receipt = await prisma.financeReceipt.create({
        data: {
          campusId,
          studentId,
          amountFen: amount,
          receivedOn: new Date('2026-10-01'),
          channel: 'CASH',
          proofFileId: proof.id,
          createdByUserId: teacher.id,
        },
      });
      const pack = await prisma.coursePackage.create({
        data: {
          campusId,
          studentId,
          name: `${runTag}-${index}`,
          validFrom: new Date('2026-01-01'),
          ...(index === 1 ? { expiresAt: new Date('2026-02-01') } : {}),
          mainBalanceUnits: index === 0 ? 450 : main,
          giftBalanceUnits: index === 0 ? 100 : 0,
          mainReservedUnits: index === 0 ? 75 : 0,
        },
      });
      await prisma.financePackageIssuance.create({
        data: {
          receiptId: receipt.id,
          coursePackageId: pack.id,
          originalAmountFen: amount,
          initialMainUnits: main,
          initialGiftUnits: gift,
          name: runTag,
          validFrom: new Date('2026-01-01'),
          issuedByUserId: teacher.id,
        },
      });
      for (const [bucket, units] of [
        ['MAIN', main],
        ['GIFT', gift],
      ] as const) {
        if (!units) continue;
        await prisma.lessonLedgerEntry.create({
          data: {
            campusId,
            studentId,
            coursePackageId: pack.id,
            entryType: 'GRANT',
            bucket,
            deltaUnits: units,
            balanceBeforeUnits: 0,
            balanceAfterUnits: units,
            idempotencyKey: `${runTag}-${index}-${bucket}`,
            actorUserId: teacher.id,
          },
        });
      }
    }
    await prisma.coursePackage.create({
      data: {
        campusId,
        studentId: unknownId,
        name: runTag,
        mainBalanceUnits: 600,
        validFrom: new Date('2026-01-01'),
      },
    });
    for (let index = 0; index < 13; index++) {
      const foreign = index === 12;
      const lesson = await prisma.lessonSession.create({
        data: {
          campusId,
          teacherId: foreign ? colleague.teacherId : teacher.teacherId,
          classGroupId: group.id,
          startsAt: new Date(Date.now() - (index + 2) * 86_400_000),
          endsAt: new Date(Date.now() - (index + 2) * 86_400_000 + 3_600_000),
          status:
            index === 0 ? 'REVERSED' : index === 11 ? 'SCHEDULED' : 'COMPLETED',
          completedAt: index === 11 ? null : new Date(Date.now() - 3_600_000),
          reversedAt: index === 0 ? new Date(Date.now() - 1_800_000) : null,
          reversalReason: index === 0 ? runTag : null,
          attendanceRecords: {
            create: {
              campusId,
              studentId,
              status:
                index === 9 ? 'LEAVE' : index === 10 ? 'ABSENT' : 'PRESENT',
              recordedByUserId: foreign ? colleague.id : teacher.id,
            },
          },
        },
      });
      const feedback = await prisma.studentFeedback.create({
        data: {
          campusId,
          studentId,
          lessonSessionId: lesson.id,
          teacherId: foreign ? colleague.teacherId : teacher.teacherId,
          content: foreign ? 'COLLEAGUE_PRIVATE' : `合成反馈${index}`,
          performanceRating: 7,
          ...(nativeEnabled && index === 0
            ? {
                teacherRatings: {
                  classroomPerformance: 7,
                  workCompletion: 0,
                  communication: null,
                  overall: 10,
                },
              }
            : {}),
        },
      });
      lessonIds.push(lesson.id);
      if (index === 0) {
        const image = await files.store(
          actorView,
          {
            originalname: 'synthetic-feedback.png',
            mimetype: 'image/png',
            size: png.length,
            buffer: png,
          },
          STUDENT_FEEDBACK_IMAGE_OPTIONS,
        );
        await prisma.studentFeedbackImage.create({
          data: {
            feedbackId: feedback.id,
            storedFileId: image.id,
            sortOrder: 0,
          },
        });
      }
    }
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    try {
      if (prisma && userIds.length) {
        const result = await prisma.user.updateMany({
          where: {
            id: { in: userIds },
            displayName: { startsWith: `${runTag}-` },
          },
          data: { status: 'DISABLED' },
        });
        expect(result.count).toBe(userIds.length);
        console.log(
          'TEACHER_ARCHIVE_FIXTURES',
          JSON.stringify({
            runTag,
            campusId,
            studentId,
            unknownId,
            emptyId,
            userIds,
            disabledUsers: result.count,
          }),
        );
      }
    } finally {
      await app?.close();
    }
  });

  (nativeEnabled ? it : it.skip)(
    'native student archive reads real API, returns and clears revoked private data',
    async () => {
      const before = {
        packages: await prisma.coursePackage.findMany({
          where: { campusId },
          orderBy: { id: 'asc' },
        }),
        lessons: await prisma.lessonSession.findMany({
          where: { campusId },
          orderBy: { id: 'asc' },
        }),
        feedback: await prisma.studentFeedback.findMany({
          where: { campusId },
          orderBy: { id: 'asc' },
        }),
      };
      const calls: Array<{ method: string; path: string; status: number }> = [];
      app.getHttpServer().on('request', (req, res) => {
        res.once('finish', () =>
          calls.push({
            method: req.method ?? '',
            path: req.url ?? '',
            status: res.statusCode,
          }),
        );
      });
      const runNative = jest.requireActual<
        (options: {
          runTag: string;
          origin: string;
          token: string;
          studentId: string;
          unknownId: string;
          emptyId: string;
          studentIds: string[];
          imageBase64: string;
          historicalOnly: boolean;
          lessonSessionId: string;
          revokeStudent(): Promise<unknown>;
          disableOwner(): Promise<unknown>;
        }) => Promise<string>
      >(
        '../../docs/verification/teacher-pdf-increment-a/native-real-students.cjs',
      );
      let evidence: string | undefined;
      try {
        evidence = await runNative({
          runTag,
          origin,
          token: teacher.token,
          studentId,
          unknownId,
          emptyId,
          studentIds: nativeStudentIds,
          imageBase64: png.toString('base64'),
          historicalOnly: nativeHistorical,
          lessonSessionId: lessonIds[1],
          revokeStudent: () =>
            prisma.classMember.update({
              where: { id: memberId },
              data: { leftAt: new Date() },
            }),
          disableOwner: () =>
            prisma.user.update({
              where: { id: teacher.id },
              data: { status: 'DISABLED' },
            }),
        });
      } finally {
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
        expect(
          await prisma.coursePackage.findMany({
            where: { campusId },
            orderBy: { id: 'asc' },
          }),
        ).toEqual(before.packages);
        expect(
          await prisma.lessonSession.findMany({
            where: { campusId },
            orderBy: { id: 'asc' },
          }),
        ).toEqual(before.lessons);
        expect(
          await prisma.studentFeedback.findMany({
            where: { campusId },
            orderBy: { id: 'asc' },
          }),
        ).toEqual(before.feedback);
        expect(
          await prisma.lessonLedgerEntry.count({ where: { campusId } }),
        ).toBe(3);
        expect(
          await prisma.teacherEarningEntry.count({ where: { campusId } }),
        ).toBe(0);
        console.log(
          'TEACHER_NATIVE_STUDENTS_HTTP',
          JSON.stringify({ runTag, calls, evidence, completed: !!evidence }),
        );
      }
      expect(calls.length).toBeGreaterThan(nativeHistorical ? 1 : 10);
      for (const status of nativeHistorical ? [200] : [200, 401, 403])
        expect(calls.some((call) => call.status === status)).toBe(true);
    },
    360_000,
  );

  it.each([
    ['REVERSED', 0],
    ['COMPLETED', 1],
  ] as const)(
    'uses saved attendance for %s historical lesson detail after membership changes',
    async (_status, index) => {
      const route = `/teachers/me/lesson-sessions/${lessonIds[index]}`;
      const readLesson = async () => {
        const result = (
          (
            await http()
              .get(route)
              .auth(teacher.token, { type: 'bearer' })
              .expect(200)
          ).body as {
            data: {
              studentCount: number;
              students: Array<{ id: string; feedback: string | null }>;
            };
          }
        ).data;
        return {
          studentCount: result.studentCount,
          students: result.students.map(({ id, feedback }) => ({
            id,
            feedback,
          })),
        };
      };
      const initial = await readLesson();
      expect(initial.studentCount).toBe(1);
      expect(initial.students.map((student) => student.id)).toEqual([
        studentId,
      ]);
      expect(initial.students[0].feedback).toBe(`合成反馈${index}`);
      try {
        await prisma.classMember.update({
          where: { id: memberId },
          data: { leftAt: new Date() },
        });
        expect(await readLesson()).toEqual(initial);
        await prisma.classMember.update({
          where: { id: memberId },
          data: { leftAt: null },
        });
        await prisma.student.update({
          where: { id: studentId },
          data: { isActive: false },
        });
        expect(await readLesson()).toEqual(initial);
      } finally {
        await prisma.classMember.update({
          where: { id: memberId },
          data: { leftAt: null },
        });
        await prisma.student.update({
          where: { id: studentId },
          data: { isActive: true },
        });
      }
      for (const token of [colleague.token, outside.token])
        await http().get(route).auth(token, { type: 'bearer' }).expect(403);
      expect(
        await prisma.lessonLedgerEntry.count({ where: { campusId } }),
      ).toBe(3);
    },
  );

  it('uses the current active roster for an unfinished lesson detail', async () => {
    const route = `/teachers/me/lesson-sessions/${lessonIds[11]}`;
    const roster = async () =>
      (
        (
          await http()
            .get(route)
            .auth(teacher.token, { type: 'bearer' })
            .expect(200)
        ).body as {
          data: { students: Array<{ id: string }> };
        }
      ).data.students.map((student) => student.id);
    expect(await roster()).toContain(studentId);
    try {
      await prisma.classMember.update({
        where: { id: memberId },
        data: { leftAt: new Date() },
      });
      expect(await roster()).not.toContain(studentId);
      await prisma.classMember.update({
        where: { id: memberId },
        data: { leftAt: null },
      });
      await prisma.student.update({
        where: { id: studentId },
        data: { isActive: false },
      });
      expect(await roster()).not.toContain(studentId);
    } finally {
      await prisma.classMember.update({
        where: { id: memberId },
        data: { leftAt: null },
      });
      await prisma.student.update({
        where: { id: studentId },
        data: { isActive: true },
      });
    }
  });

  it('projects per-student feedback eligibility without permitting writes to departed or inactive historical members', async () => {
    const route = `/teachers/me/lesson-sessions/${lessonIds[1]}`;
    const readEligibility = async () => {
      const result = await http()
        .get(route)
        .auth(teacher.token, { type: 'bearer' })
        .expect(200);
      return (
        result.body as {
          data: { students: Array<{ id: string; canEditFeedback: boolean }> };
        }
      ).data.students;
    };
    expect(await readEligibility()).toEqual([
      expect.objectContaining({ id: studentId, canEditFeedback: true }),
    ]);
    const before = await prisma.studentFeedback.findMany({
      where: { campusId },
      orderBy: { id: 'asc' },
    });
    try {
      for (const state of ['departed', 'inactive'] as const) {
        await prisma.classMember.update({
          where: { id: memberId },
          data: { leftAt: state === 'departed' ? new Date() : null },
        });
        await prisma.student.update({
          where: { id: studentId },
          data: { isActive: state !== 'inactive' },
        });
        expect(await readEligibility()).toEqual([
          expect.objectContaining({ id: studentId, canEditFeedback: false }),
        ]);
        await http()
          .put(`${route}/students/${studentId}/feedback`)
          .auth(teacher.token, { type: 'bearer' })
          .set('Idempotency-Key', `${runTag}-${state}`)
          .send({ content: '不得写入', imageFileIds: [] })
          .expect(403);
      }
    } finally {
      await prisma.classMember.update({
        where: { id: memberId },
        data: { leftAt: null },
      });
      await prisma.student.update({
        where: { id: studentId },
        data: { isActive: true },
      });
    }
    const existing = before.find(
      (feedback) => feedback.lessonSessionId === lessonIds[1],
    )!;
    try {
      await prisma.studentFeedback.update({
        where: { id: existing.id },
        data: { teacherId: colleague.teacherId },
      });
      const result = await http()
        .get(route)
        .auth(teacher.token, { type: 'bearer' })
        .expect(200);
      expect(
        (result.body as { data: { students: object[] } }).data.students,
      ).toEqual([
        expect.objectContaining({
          id: studentId,
          canEditFeedback: false,
          feedback: null,
          feedbackImages: [],
        }),
      ]);
      await http()
        .put(`${route}/students/${studentId}/feedback`)
        .auth(teacher.token, { type: 'bearer' })
        .set('Idempotency-Key', `${runTag}-other-author`)
        .send({ content: '不得代评', imageFileIds: [] })
        .expect(403);
    } finally {
      await prisma.studentFeedback.update({
        where: { id: existing.id },
        data: { teacherId: existing.teacherId, updatedAt: existing.updatedAt },
      });
    }
    for (const index of [0, 11]) {
      const result = await http()
        .get(`/teachers/me/lesson-sessions/${lessonIds[index]}`)
        .auth(teacher.token, { type: 'bearer' })
        .expect(200);
      expect(
        (
          result.body as {
            data: { students: Array<{ canEditFeedback: boolean }> };
          }
        ).data.students.every((student) => student.canEditFeedback === false),
      ).toBe(true);
    }
    expect(
      await prisma.studentFeedback.findMany({
        where: { campusId },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
  });

  it('returns verified originals independently of current available balances and excludes private fields', async () => {
    const before = await prisma.coursePackage.findMany({ where: { campusId } });
    const result = await read();
    expect(result.archive).toMatchObject({
      age: 8,
      enrollment: {
        initialMainUnits: 3000,
        initialGiftUnits: 200,
        receivedAmountFen: 173456,
        pendingIssuanceCount: 0,
      },
      balance: {
        mainAvailableUnits: 375,
        giftAvailableUnits: 100,
        availableTotalUnits: 475,
        thresholdUnits: 500,
        isWarning: true,
      },
    });
    expect(result.attendance).toMatchObject({
      presentCount: 8,
      leaveCount: 1,
      absentCount: 1,
      recordedCount: 10,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /birthDate|profileAge|storageKey|originalName|proofFileId|private-proof|parentUserId|COLLEAGUE_PRIVATE|phone|address/,
    );
    expect(
      await prisma.coursePackage.findMany({ where: { campusId } }),
    ).toEqual(before);
    expect(await prisma.lessonLedgerEntry.count({ where: { campusId } })).toBe(
      3,
    );
  });

  it('lists current warning and available hours for assigned students with minimum disclosure', async () => {
    const result = await http()
      .get('/teachers/me/students')
      .auth(teacher.token, { type: 'bearer' })
      .expect(200);
    const row = (
      result.body as { data: Array<{ id: string; currentBalance: object }> }
    ).data.find((item) => item.id === studentId)!;
    expect(row.currentBalance).toMatchObject({
      availableTotalUnits: 475,
      isWarning: true,
      thresholdUnits: 500,
    });
    expect(JSON.stringify(result.body)).not.toMatch(
      /birthDate|receivedAmountFen|proofFile|parentUserId|COLLEAGUE_PRIVATE/,
    );
  });

  it('keeps unknown original facts null and source-free empty records at zero', async () => {
    expect((await read(unknownId)).archive).toMatchObject({
      age: null,
      enrollment: {
        initialMainUnits: null,
        initialGiftUnits: null,
        receivedAmountFen: null,
      },
      balance: { availableTotalUnits: 600, isWarning: false },
    });
    expect((await read(emptyId)).archive).toMatchObject({
      age: null,
      enrollment: {
        initialMainUnits: 0,
        initialGiftUnits: 0,
        receivedAmountFen: 0,
      },
      balance: { availableTotalUnits: 0, isWarning: true },
    });
  });

  it('paginates by lesson date, preserves reversed feedback and author scope, rejects invalid queries', async () => {
    const first = await read();
    expect(first.feedbackHistory.meta).toMatchObject({
      page: 1,
      total: 11,
      totalPages: 2,
    });
    expect(first.feedbackHistory.data).toHaveLength(10);
    expect(first.feedbackHistory.data[0]).toMatchObject({
      content: '合成反馈0',
      lessonStatus: 'REVERSED',
    });
    const second = await read(studentId, { feedbackPage: 2 });
    expect(second.feedbackHistory.data.map((item) => item.content)).toEqual([
      '合成反馈10',
    ]);
    expect(
      (await read(studentId, { feedbackPage: 3 })).feedbackHistory.data,
    ).toEqual([]);
    for (const query of [
      { feedbackPage: 0 },
      { feedbackPageSize: 51 },
      { teacherId: colleague.teacherId },
    ])
      await get().query(query).expect(400);
  });

  it('serves signed photo and own feedback bytes but rejects unsigned and tampered media', async () => {
    const result = await read();
    for (const url of [
      result.archive.photo.accessUrl,
      result.feedbackHistory.data[0].images[0].accessUrl,
    ]) {
      const response = await http().get(url).expect(200);
      expect(Buffer.compare(response.body as Buffer, png)).toBe(0);
      expect(response.headers['cache-control']).toContain(
        url.includes('student-photos') ? 'no-store' : 'private',
      );
      await http().get(url.split('?')[0]).expect(404);
      await http()
        .get(url.replace(/signature=[^&]+/, 'signature=invalid'))
        .expect(404);
    }
  });

  it('denies other teachers, cross campus, departed members and inactive students', async () => {
    await get(studentId, colleague.token).expect(403);
    await get(studentId, outside.token).expect(403);
    try {
      await prisma.classMember.update({
        where: { id: memberId },
        data: { leftAt: new Date() },
      });
      await get().expect(403);
    } finally {
      await prisma.classMember.update({
        where: { id: memberId },
        data: { leftAt: null },
      });
    }
    try {
      await prisma.student.update({
        where: { id: studentId },
        data: { isActive: false },
      });
      await get().expect(403);
    } finally {
      await prisma.student.update({
        where: { id: studentId },
        data: { isActive: true },
      });
    }
  });

  it('computes birthday ages using campus calendar without returning the birthday', async () => {
    const now = new Date();
    const today = new Date(now.getTime() + 8 * 3_600_000);
    const birthDate = new Date(
      Date.UTC(
        today.getUTCFullYear() - 9,
        today.getUTCMonth(),
        today.getUTCDate(),
      ),
    );
    await prisma.student.update({
      where: { id: emptyId },
      data: { birthDate },
    });
    expect((await read(emptyId)).archive.age).toBe(9);
    birthDate.setUTCDate(birthDate.getUTCDate() + 1);
    await prisma.student.update({
      where: { id: emptyId },
      data: { birthDate },
    });
    expect((await read(emptyId)).archive.age).toBe(8);
  });

  it('loads the actual student Page and its next history page over real HTTP', async () => {
    const { createTeacherHttpPageHost } = jest.requireActual<
      typeof import('../../frontend/tests/teacher-http-page-test-support')
    >('../../frontend/tests/teacher-http-page-test-support');
    const host = createTeacherHttpPageHost({
      origin,
      accessToken: teacher.token,
      routes: ['dashboard', `students/${studentId}`].map((route) => ({
        method: 'GET' as const,
        path: `/teachers/me/${route}`,
      })),
    });
    try {
      const page = host.capture('student-detail') as {
        data: {
          viewState: string;
          detail: { originalMainLabel: string; availableMainLabel: string };
          feedbackHistory: Array<{ id: string }>;
          feedbackHasMore: boolean;
        };
        onLoad(options: { id: string }): void;
        onShow(): void;
        onLoadMoreFeedback(): void;
      };
      page.onLoad({ id: studentId });
      page.onShow();
      await host.idle();
      expect(page.data.viewState).toBe('ready');
      expect(page.data.detail).toMatchObject({
        originalMainLabel: '30课时',
        availableMainLabel: '3.75课时',
      });
      expect(page.data.feedbackHistory).toHaveLength(10);
      page.onLoadMoreFeedback();
      await host.idle();
      expect(page.data.feedbackHistory).toHaveLength(11);
      expect(page.data.feedbackHasMore).toBe(false);
    } finally {
      await host.close();
      expect(host.transport.pendingCount).toBe(0);
    }
  });
});
