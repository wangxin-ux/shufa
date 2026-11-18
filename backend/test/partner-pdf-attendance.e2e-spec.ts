import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type {
  AttendanceStatus,
  LessonSessionStatus,
  Prisma,
} from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import { PartnerReadService } from '../src/modules/partner/partner-read.service';
import { PartnerStudentQueryService } from '../src/modules/partner/partner-student-query.service';
import { PartnerScopeService } from '../src/common/auth/partner-scope.service';
import { PartnerStudentGrowthService } from '../src/modules/partner/partner-student-growth.service';
import {
  StoredFileService,
  STUDENT_PROFILE_PHOTO_OPTIONS,
  STUDENT_FEEDBACK_IMAGE_OPTIONS,
} from '../src/modules/file/stored-file.service';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);

interface Summary {
  presentCount: number;
  absentCount: number;
  leaveCount: number;
  recordedCount: number;
  attendanceRateBasisPoints: number | null;
}
interface AttendanceView extends Summary {
  items: Array<{ id: string; studentId: string }>;
  meta: { total: number; totalPages: number };
}
const body = <T>(response: { body: unknown }) => response.body as { data: T };

describe('partner completed attendance facts in an isolated database', () => {
  const runTag = `ppdf-${randomUUID().slice(0, 8)}`;
  const ownedUsers: string[] = [];
  const ownedCampuses: string[] = [];
  const ownedStudents: string[] = [];
  const ownedLessons: string[] = [];
  const ownedAttendance: string[] = [];
  const validAttendance: string[] = [];
  const ownedFiles: string[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let token: string;
  let teacherToken: string;
  let studentId: string;
  let emptyStudentId: string;
  let otherStudentId: string;
  let campusId: string;
  let reversibleLessonId: string;
  let reversibleAttendanceId: string;
  let photoId: string;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6gJ8AAAAASUVORK5CYII=',
    'base64',
  );

  const setReversed = async (reversed: boolean) => {
    const state = reversed
      ? {
          status: 'REVERSED' as const,
          reversedAt: new Date(),
          reversalReason: '合成并发测试',
        }
      : {
          status: 'COMPLETED' as const,
          reversedAt: null,
          reversalReason: null,
        };
    await prisma.$transaction(async (tx) => {
      await tx.lessonSession.update({
        where: { id: reversibleLessonId },
        data: state,
      });
      await tx.teachingRecord.update({
        where: { lessonSessionId: reversibleLessonId },
        data: state,
      });
    });
  };

  const get = (url: string, bearer = token) =>
    request(server).get(url).auth(bearer, { type: 'bearer' });

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    for (const suffix of ['a', 'b']) {
      const campus = await prisma.campus.create({
        data: {
          code: `${runTag}-${suffix}`,
          name: `${runTag}测试校区${suffix}`,
        },
      });
      ownedCampuses.push(campus.id);
    }
    campusId = ownedCampuses[0];
    const partner = await prisma.user.create({
      data: {
        displayName: `${runTag}合作方`,
        roles: { create: { roleCode: 'PARTNER', campusId } },
      },
    });
    ownedUsers.push(partner.id);
    token = (await app.get(AuthService).issueSessionForUser(partner.id))
      .accessToken;
    const teacher = await prisma.user.create({
      data: {
        displayName: `${runTag}教师`,
        roles: { create: { roleCode: 'TEACHER', campusId } },
        teacherProfile: { create: { campusId, employeeCode: runTag } },
      },
      include: { teacherProfile: true },
    });
    ownedUsers.push(teacher.id);
    teacherToken = (await app.get(AuthService).issueSessionForUser(teacher.id))
      .accessToken;
    const teacherId = teacher.teacherProfile!.id;
    const classGroup = await prisma.classGroup.create({
      data: {
        campusId,
        teacherId,
        name: `${runTag}班级`,
        courseName: '测试课程',
      },
    });
    for (const [id, name] of [
      [campusId, '主学员'],
      [campusId, '无有效出勤'],
      [ownedCampuses[1], '其他校区学员'],
    ]) {
      const student = await prisma.student.create({
        data: { campusId: id, displayName: `${runTag}${name}` },
      });
      ownedStudents.push(student.id);
    }
    [studentId, emptyStudentId, otherStudentId] = ownedStudents;
    const states: Array<
      [LessonSessionStatus, AttendanceStatus, 'COMPLETED' | 'REVERSED' | null]
    > = [
      ['COMPLETED', 'PRESENT', 'COMPLETED'],
      ['COMPLETED', 'ABSENT', 'COMPLETED'],
      ['COMPLETED', 'LEAVE', 'COMPLETED'],
      ['SCHEDULED', 'PRESENT', null],
      ['IN_PROGRESS', 'PRESENT', null],
      ['CANCELLED', 'PRESENT', null],
      ['REVERSED', 'PRESENT', 'REVERSED'],
      ['COMPLETED', 'PRESENT', 'REVERSED'],
      ['COMPLETED', 'PRESENT', null],
    ];
    for (const [
      index,
      [status, attendanceStatus, teachingStatus],
    ] of states.entries()) {
      const startsAt = new Date(
        `2026-10-${String(index + 1).padStart(2, '0')}T02:00:00Z`,
      );
      const completedAt = new Date(startsAt.getTime() + 3_600_000);
      const lesson = await prisma.lessonSession.create({
        data: {
          campusId,
          teacherId,
          classGroupId: classGroup.id,
          startsAt,
          endsAt: completedAt,
          status,
          completedAt:
            status === 'COMPLETED' || status === 'REVERSED'
              ? completedAt
              : null,
          ...(status === 'REVERSED'
            ? { reversedAt: completedAt, reversalReason: '合成撤销夹具' }
            : {}),
          ...(teachingStatus
            ? {
                teachingRecord: {
                  create: {
                    campusId,
                    teacherId,
                    status: teachingStatus,
                    attendeeCount: attendanceStatus === 'PRESENT' ? 1 : 0,
                    lessonUnits: 100,
                    recordedByUserId: teacher.id,
                    completedAt,
                    ...(teachingStatus === 'REVERSED'
                      ? {
                          reversedAt: completedAt,
                          reversalReason: '合成撤销夹具',
                        }
                      : {}),
                  },
                },
              }
            : {}),
        },
      });
      ownedLessons.push(lesson.id);
      const attendance = await prisma.attendanceRecord.create({
        data: {
          campusId,
          lessonSessionId: lesson.id,
          studentId,
          status: attendanceStatus,
          recordedByUserId: teacher.id,
          recordedAt: completedAt,
        },
      });
      ownedAttendance.push(attendance.id);
      if (index < 3) validAttendance.push(attendance.id);
      if (index === 0) {
        reversibleLessonId = lesson.id;
        reversibleAttendanceId = attendance.id;
      }
      if (index === 3) {
        const draftOnly = await prisma.attendanceRecord.create({
          data: {
            campusId,
            lessonSessionId: lesson.id,
            studentId: emptyStudentId,
            status: 'PRESENT',
            recordedByUserId: teacher.id,
          },
        });
        ownedAttendance.push(draftOnly.id);
      }
    }
    const parent = await prisma.user.create({
      data: {
        displayName: `${runTag}家长`,
        roles: { create: { roleCode: 'PARENT', campusId } },
      },
    });
    ownedUsers.push(parent.id);
    const files = app.get(StoredFileService);
    const actor = {
      userId: parent.id,
      roles: [{ code: 'PARENT' as const, campusId }],
    };
    const photo = await files.store(
      actor,
      {
        originalname: `${runTag}-photo.png`,
        mimetype: 'image/png',
        size: png.length,
        buffer: png,
      },
      STUDENT_PROFILE_PHOTO_OPTIONS,
    );
    photoId = photo.id;
    ownedFiles.push(photo.id);
    await prisma.storedFile.update({
      where: { id: photo.id },
      data: { photoTargetStudentId: studentId },
    });
    await prisma.student.update({
      where: { id: studentId },
      data: { profilePhotoFileId: photo.id },
    });
    const image = await files.store(
      { userId: teacher.id, roles: [{ code: 'TEACHER', campusId }] },
      {
        originalname: `${runTag}-feedback.png`,
        mimetype: 'image/png',
        size: png.length,
        buffer: png,
      },
      STUDENT_FEEDBACK_IMAGE_OPTIONS,
    );
    ownedFiles.push(image.id);
    for (const index of [0, 6]) {
      await prisma.studentFeedback.create({
        data: {
          campusId,
          studentId,
          lessonSessionId: ownedLessons[index],
          teacherId,
          content: '课堂表现进步，继续练习。',
          performanceRating: index === 0 ? 9 : null,
          ...(index === 0
            ? { images: { create: { storedFileId: image.id, sortOrder: 0 } } }
            : {}),
        },
      });
      await prisma.parentLessonReview.create({
        data: {
          campusId,
          studentId,
          lessonSessionId: ownedLessons[index],
          parentUserId: parent.id,
          teaching: 9,
          communication: 8,
          environment: 10,
          overall: 9,
          note: '谢谢老师',
        },
      });
    }
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
      process.stdout.write(
        'PARTNER_PDF_ATTENDANCE_OWNERSHIP ' +
          JSON.stringify({
            runTag,
            campusIds: ownedCampuses,
            userIds: ownedUsers,
            studentIds: ownedStudents,
            lessonIds: ownedLessons,
            attendanceIds: ownedAttendance,
            fileIds: ownedFiles,
            disposition: 'retained; owned users disabled; no deletion',
          }) +
          '\n',
      );
    }
  });

  const expected: Summary = {
    presentCount: 1,
    absentCount: 1,
    leaveCount: 1,
    recordedCount: 3,
    attendanceRateBasisPoints: 3333,
  };

  it('returns only the highlighted student course/teacher pairs and personal completed attendance', async () => {
    const teacher = await prisma.teacherProfile.findFirstOrThrow({
      where: { campusId, userId: { in: ownedUsers } },
    });
    for (const [name, courseName, status, leftAt, relationCampusId] of [
      ['A班', '创意美术', 'ACTIVE', null, campusId],
      ['B班', '硬笔书法', 'ACTIVE', null, campusId],
      ['停用班', '不应显示', 'ARCHIVED', null, campusId],
      ['退班', '不应显示', 'ACTIVE', new Date(), campusId],
      ['外校班', '不应显示', 'ACTIVE', null, ownedCampuses[1]],
    ] as const) {
      const group = await prisma.classGroup.create({
        data: {
          campusId: relationCampusId,
          teacherId: teacher.id,
          name: `${runTag}${name}`,
          courseName,
          status,
        },
      });
      await prisma.classMember.create({
        data: {
          campusId: relationCampusId,
          classGroupId: group.id,
          studentId,
          joinedAt: new Date('2020-01-01T00:00:00Z'),
          leftAt,
        },
      });
    }
    const response = await get('/partners/me/dashboard').expect(200);
    const highlight = body<{
      highlight: { studentId: string; classes: unknown[]; attendance: Summary };
    }>(response).data.highlight;
    expect(highlight.studentId).toBe(studentId);
    expect(highlight.attendance).toEqual(expected);
    expect(highlight.classes).toEqual([
      expect.objectContaining({
        className: `${runTag}A班`,
        courseName: '创意美术',
        teacherName: `${runTag}教师`,
      }),
      expect.objectContaining({
        className: `${runTag}B班`,
        courseName: '硬笔书法',
        teacherName: `${runTag}教师`,
      }),
    ]);
  });

  it('never substitutes campus attendance for a highlighted student with only draft records', async () => {
    const student = await prisma.student.findUniqueOrThrow({
      where: { id: emptyStudentId },
    });
    await prisma.student.update({
      where: { id: emptyStudentId },
      data: { displayName: `${runTag}000优先学员` },
    });
    try {
      const response = await get('/partners/me/dashboard').expect(200);
      expect(
        body<{ highlight: unknown; attendanceRateBasisPoints: number }>(
          response,
        ).data,
      ).toMatchObject({
        attendanceRateBasisPoints: 3333,
        highlight: {
          studentId: emptyStudentId,
          classes: [],
          attendance: {
            presentCount: 0,
            absentCount: 0,
            leaveCount: 0,
            recordedCount: 0,
            attendanceRateBasisPoints: null,
          },
        },
      });
    } finally {
      await prisma.student.update({
        where: { id: emptyStudentId },
        data: { displayName: student.displayName },
      });
    }
  });

  it('does not expose an out-of-campus teacher through a mismatched active class', async () => {
    const foreignTeacher = await prisma.user.create({
      data: {
        displayName: `${runTag}外校教师`,
        teacherProfile: {
          create: {
            campusId: ownedCampuses[1],
            employeeCode: `${runTag}-foreign`,
          },
        },
      },
      include: { teacherProfile: true },
    });
    ownedUsers.push(foreignTeacher.id);
    const group = await prisma.classGroup.create({
      data: {
        campusId,
        teacherId: foreignTeacher.teacherProfile!.id,
        name: `${runTag}异常关联班`,
        courseName: '异常关联课程',
        members: { create: { campusId, studentId } },
      },
    });
    const response = await get('/partners/me/dashboard').expect(200);
    const highlight = body<{ highlight: { classes: Array<{ id: string }> } }>(
      response,
    ).data.highlight;
    expect(highlight.classes.map((item) => item.id)).not.toContain(group.id);
    expect(JSON.stringify(highlight)).not.toContain(foreignTeacher.displayName);
  });

  it.each([
    '/partners/me/operations-summary',
    '/partners/me/earnings/summary',
    '/partners/me/earnings',
  ])('rejects timestamp report dates at HTTP boundary %s', async (url) => {
    await get(url)
      .query({ period: 'MONTH', anchorDate: '2026-10-08T00:00:00Z' })
      .expect(400);
  });

  it('uses the same completed facts for attendance summary, count and paginated rows', async () => {
    const first = await get('/partners/me/attendance')
      .query({ page: 1, pageSize: 2 })
      .expect(200);
    const second = await get('/partners/me/attendance')
      .query({ page: 2, pageSize: 2 })
      .expect(200);
    expect(body<AttendanceView>(first).data).toMatchObject({
      ...expected,
      meta: { total: 3, totalPages: 2 },
    });
    expect(
      [
        ...body<AttendanceView>(first).data.items,
        ...body<AttendanceView>(second).data.items,
      ]
        .map((row) => row.id)
        .sort(),
    ).toEqual([...validAttendance].sort());
    const outOfRange = await get('/partners/me/attendance')
      .query({ page: 99, pageSize: 2 })
      .expect(200);
    expect(body<AttendanceView>(outOfRange).data).toMatchObject({
      ...expected,
      items: [],
      meta: { total: 3, totalPages: 2 },
    });
  });

  it('limits student personal attendance and recent rows to completed teaching facts', async () => {
    const response = await get(`/partners/me/students/${studentId}`).expect(
      200,
    );
    const detail = body<{
      attendance: Summary;
      recentAttendance: Array<{ id: string }>;
    }>(response).data;
    expect(detail.attendance).toEqual(expected);
    expect(detail.recentAttendance.map((row) => row.id).sort()).toEqual(
      [...validAttendance].sort(),
    );
  });

  it('keeps dashboard and period statistics consistent with completed attendance', async () => {
    const dashboard = await get('/partners/me/dashboard').expect(200);
    expect(
      body<{ attendanceRateBasisPoints: number }>(dashboard).data
        .attendanceRateBasisPoints,
    ).toBe(3333);
    const operations = await get('/partners/me/operations-summary')
      .query({ period: 'MONTH', anchorDate: '2026-10-08' })
      .expect(200);
    expect(body<Summary>(operations).data).toMatchObject(expected);
  });

  it('returns null rather than a draft-derived rate when a student has no effective records', async () => {
    const response = await get(
      `/partners/me/students/${emptyStudentId}`,
    ).expect(200);
    expect(
      body<{ attendance: Summary; recentAttendance: unknown[] }>(response).data,
    ).toMatchObject({
      attendance: {
        presentCount: 0,
        absentCount: 0,
        leaveCount: 0,
        recordedCount: 0,
        attendanceRateBasisPoints: null,
      },
      recentAttendance: [],
    });
  });

  it('excludes a reversal from both totals and recent rows without deleting its record', async () => {
    await prisma.$transaction([
      prisma.lessonSession.update({
        where: { id: reversibleLessonId },
        data: {
          status: 'REVERSED',
          reversedAt: new Date(),
          reversalReason: '合成撤销测试',
        },
      }),
      prisma.teachingRecord.update({
        where: { lessonSessionId: reversibleLessonId },
        data: {
          status: 'REVERSED',
          reversedAt: new Date(),
          reversalReason: '合成撤销测试',
        },
      }),
    ]);
    try {
      const response = await get('/partners/me/attendance').expect(200);
      const view = body<AttendanceView>(response).data;
      expect(view).toMatchObject({
        presentCount: 0,
        recordedCount: 2,
        attendanceRateBasisPoints: 0,
        meta: { total: 2 },
      });
      expect(view.items.map((row) => row.id)).not.toContain(
        reversibleAttendanceId,
      );
      expect(
        await prisma.attendanceRecord.count({
          where: { id: reversibleAttendanceId },
        }),
      ).toBe(1);
    } finally {
      await prisma.$transaction([
        prisma.lessonSession.update({
          where: { id: reversibleLessonId },
          data: { status: 'COMPLETED', reversedAt: null, reversalReason: null },
        }),
        prisma.teachingRecord.update({
          where: { lessonSessionId: reversibleLessonId },
          data: { status: 'COMPLETED', reversedAt: null, reversalReason: null },
        }),
      ]);
    }
  });

  it('rejects other roles, anonymous requests and out-of-scope student detail', async () => {
    await get('/partners/me/attendance', teacherToken).expect(403);
    await request(server).get('/partners/me/attendance').expect(401);
    await get(`/partners/me/students/${otherStudentId}`).expect(404);
    await get('/partners/me/attendance')
      .query({ campusId: ownedCampuses[1] })
      .expect(400);
  });

  it('paginates read-only growth with feedback, ratings and invalid reversed reviews', async () => {
    const response = await get(`/partners/me/students/${studentId}/growth`)
      .query({ page: 1, pageSize: 2 })
      .expect(200);
    const view = body<{
      student: { id: string; photo: { accessUrl: string } | null };
      items: Array<{
        lessonSessionId: string;
        lessonStatus: string;
        review: { valid: boolean } | null;
      }>;
      meta: { total: number };
    }>(response).data;
    expect(view.student.id).toBe(studentId);
    expect(view.student.photo?.accessUrl).toContain(
      `/media/student-photos/${photoId}`,
    );
    expect(view.meta.total).toBe(4);
    expect(view.items.map((item) => item.lessonSessionId)).toEqual([
      ownedLessons[6],
      ownedLessons[2],
    ]);
    expect(view.items[0]).toMatchObject({
      lessonStatus: 'REVERSED',
      review: { valid: false },
    });
    const second = await get(`/partners/me/students/${studentId}/growth`)
      .query({ page: 2, pageSize: 2 })
      .expect(200);
    expect(body<{ items: unknown[] }>(second).data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lessonSessionId: ownedLessons[0],
          performanceRating: 9,
          feedback: '课堂表现进步，继续练习。',
          review: expect.objectContaining({ valid: true }) as unknown,
          feedbackImages: [expect.objectContaining({ id: ownedFiles[1] })],
        }),
      ]),
    );
    const text = JSON.stringify(response.body);
    for (const field of [
      'parentUserId',
      'homeAddress',
      'storageKey',
      'originalName',
      'canReview',
    ]) {
      expect(text).not.toContain(field);
    }
  });

  it('issues private photo URLs only for scoped students and rejects tampering or detachment', async () => {
    const response = await get(`/partners/me/students/${studentId}`).expect(
      200,
    );
    const photo = body<{ photo: { accessUrl: string } }>(response).data.photo;
    expect(photo.accessUrl).toContain(`/media/student-photos/${photoId}`);
    const bytes = await request(server).get(photo.accessUrl).expect(200);
    expect(bytes.body).toEqual(png);
    expect(bytes.headers['cache-control']).toBe('private, no-store');
    const tampered = new URL(photo.accessUrl, 'http://127.0.0.1');
    tampered.searchParams.set('signature', '0'.repeat(64));
    await request(server)
      .get(tampered.pathname + tampered.search)
      .expect(404);
    await prisma.student.update({
      where: { id: studentId },
      data: { profilePhotoFileId: null },
    });
    try {
      await request(server).get(photo.accessUrl).expect(404);
    } finally {
      await prisma.student.update({
        where: { id: studentId },
        data: { profilePhotoFileId: photoId },
      });
    }
    await get(`/partners/me/students/${otherStudentId}/growth`).expect(404);
    await get(`/partners/me/students/${studentId}/growth`, teacherToken).expect(
      403,
    );
    await request(server)
      .get(`/partners/me/students/${studentId}/growth`)
      .expect(401);
    await get(`/partners/me/students/${studentId}/growth`)
      .query({ campusId: ownedCampuses[1] })
      .expect(400);
  });

  it('returns student identity with an empty growth page instead of treating no lessons as missing', async () => {
    const response = await get(
      `/partners/me/students/${emptyStudentId}/growth`,
    ).expect(200);
    expect(body<unknown>(response).data).toMatchObject({
      student: { id: emptyStudentId, photo: null },
      items: [],
      meta: { total: 0, totalPages: 0 },
    });
  });

  it('validates growth pagination and keeps totals for an out-of-range page', async () => {
    for (const query of [{ page: 0 }, { pageSize: 101 }, { page: 'bad' }]) {
      await get(`/partners/me/students/${studentId}/growth`)
        .query(query)
        .expect(400);
    }
    const response = await get(`/partners/me/students/${studentId}/growth`)
      .query({ page: 99, pageSize: 2 })
      .expect(200);
    expect(body<unknown>(response).data).toMatchObject({
      items: [],
      meta: { total: 4, totalPages: 2 },
    });
  });

  it('does not sign wrong-purpose or wrong-student photo associations', async () => {
    for (const data of [
      { purpose: 'STUDENT_FEEDBACK_IMAGE' as const },
      { photoTargetStudentId: otherStudentId },
    ]) {
      await prisma.storedFile.update({ where: { id: photoId }, data });
      try {
        const detail = await get(`/partners/me/students/${studentId}`).expect(
          200,
        );
        const growth = await get(
          `/partners/me/students/${studentId}/growth`,
        ).expect(200);
        expect(body<{ photo: unknown }>(detail).data.photo).toBeNull();
        expect(
          body<{ student: { photo: unknown } }>(growth).data.student.photo,
        ).toBeNull();
      } finally {
        await prisma.storedFile.update({
          where: { id: photoId },
          data: {
            purpose: 'STUDENT_PROFILE_PHOTO',
            photoTargetStudentId: studentId,
          },
        });
      }
    }
  });

  it('rejects inactive students for both detail and growth', async () => {
    await prisma.student.update({
      where: { id: studentId },
      data: { isActive: false },
    });
    try {
      await get(`/partners/me/students/${studentId}`).expect(404);
      await get(`/partners/me/students/${studentId}/growth`).expect(404);
    } finally {
      await prisma.student.update({
        where: { id: studentId },
        data: { isActive: true },
      });
    }
  });

  it('keeps growth count, student and rows in one snapshot during a concurrent reversal', async () => {
    let readCount = 0;
    const wrapped = {
      $transaction: (
        read: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: { isolationLevel: Prisma.TransactionIsolationLevel },
      ) =>
        prisma.$transaction(
          async (tx) =>
            read({
              student: tx.student,
              lessonSession: {
                count: async (args: Prisma.LessonSessionCountArgs) => {
                  const total = await tx.lessonSession.count(args);
                  readCount += 1;
                  await setReversed(true);
                  return total;
                },
                findMany: tx.lessonSession.findMany.bind(tx.lessonSession),
              },
            } as unknown as Prisma.TransactionClient),
          options,
        ),
    } as unknown as PrismaService;
    const service = new PartnerStudentGrowthService(
      wrapped,
      app.get(PartnerScopeService),
      app.get(StoredFileService),
    );
    try {
      const result = await service.getGrowth(
        {
          userId: ownedUsers[0],
          roles: [{ code: 'PARTNER', campusId }],
        },
        studentId,
        { page: 1, pageSize: 20 },
      );
      expect(readCount).toBe(1);
      expect(result.meta.total).toBe(4);
      expect(
        result.items.find(
          (item) => item.lessonSessionId === reversibleLessonId,
        ),
      ).toMatchObject({
        lessonStatus: 'COMPLETED',
        review: { valid: true },
      });
      const current = await get(
        `/partners/me/students/${studentId}/growth`,
      ).expect(200);
      expect(
        body<{ items: Array<{ lessonSessionId: string }> }>(
          current,
        ).data.items.find(
          (item) => item.lessonSessionId === reversibleLessonId,
        ),
      ).toMatchObject({ lessonStatus: 'REVERSED', review: { valid: false } });
    } finally {
      await setReversed(false);
    }
  });

  it('excludes cross-campus growth lessons and does not expose mismatched feedback or reviews', async () => {
    await prisma.teachingRecord.update({
      where: { lessonSessionId: ownedLessons[6] },
      data: { campusId: ownedCampuses[1] },
    });
    await prisma.studentFeedback.updateMany({
      where: { lessonSessionId: ownedLessons[0], studentId },
      data: { campusId: ownedCampuses[1] },
    });
    await prisma.parentLessonReview.updateMany({
      where: { lessonSessionId: ownedLessons[0], studentId },
      data: { campusId: ownedCampuses[1] },
    });
    try {
      const response = await get(
        `/partners/me/students/${studentId}/growth`,
      ).expect(200);
      const view = body<{
        items: Array<{ lessonSessionId: string }>;
        meta: { total: number };
      }>(response).data;
      expect(view.meta.total).toBe(3);
      expect(view.items.map((item) => item.lessonSessionId)).not.toContain(
        ownedLessons[6],
      );
      expect(
        view.items.find((item) => item.lessonSessionId === ownedLessons[0]),
      ).toMatchObject({
        feedback: null,
        performanceRating: null,
        review: null,
        feedbackImages: [],
      });
    } finally {
      await prisma.teachingRecord.update({
        where: { lessonSessionId: ownedLessons[6] },
        data: { campusId },
      });
      await prisma.studentFeedback.updateMany({
        where: { lessonSessionId: ownedLessons[0], studentId },
        data: { campusId },
      });
      await prisma.parentLessonReview.updateMany({
        where: { lessonSessionId: ownedLessons[0], studentId },
        data: { campusId },
      });
    }
  });

  it.each(['attendance', 'student'] as const)(
    'keeps %s reads in one snapshot while another connection commits a reversal',
    async (operation) => {
      let barrierCount = 0;
      const barrier = async () => {
        barrierCount += 1;
        await setReversed(true);
      };
      const wrapped = {
        $transaction: (
          read: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: { isolationLevel: Prisma.TransactionIsolationLevel },
        ) =>
          prisma.$transaction(
            async (tx) =>
              read({
                financeReceipt: tx.financeReceipt,
                financeReceiptCorrection: tx.financeReceiptCorrection,
                coursePackage: tx.coursePackage,
                enrollmentOrder: tx.enrollmentOrder,
                groupMember: tx.groupMember,
                student: {
                  findFirst: async (args: Prisma.StudentFindFirstArgs) => {
                    const result = await tx.student.findFirst(args);
                    if (operation === 'student') await barrier();
                    return result;
                  },
                },
                attendanceRecord: {
                  groupBy: async (args: {
                    by: ['status'];
                    where: Prisma.AttendanceRecordWhereInput;
                    _count: { _all: true };
                  }) => {
                    const result = await tx.attendanceRecord.groupBy(args);
                    if (operation === 'attendance') await barrier();
                    return result;
                  },
                  count: tx.attendanceRecord.count.bind(tx.attendanceRecord),
                  findMany: tx.attendanceRecord.findMany.bind(
                    tx.attendanceRecord,
                  ),
                },
              } as unknown as Prisma.TransactionClient),
            options,
          ),
      } as unknown as PrismaService;
      const service = new PartnerReadService(
        wrapped,
        app.get(PartnerScopeService),
        app.get(PartnerStudentQueryService),
        app.get(StoredFileService),
      );
      const user = {
        userId: ownedUsers[0],
        roles: [{ code: 'PARTNER' as const, campusId }],
      };
      try {
        if (operation === 'attendance') {
          const result = await service.getAttendance(user, {
            page: 1,
            pageSize: 20,
          });
          expect(result).toMatchObject({ ...expected, meta: { total: 3 } });
          expect(result.items.map((row) => row.id).sort()).toEqual(
            [...validAttendance].sort(),
          );
        } else {
          const result = await service.getStudent(user, studentId);
          expect(result.attendance).toEqual(expected);
          expect(result.recentAttendance.map((row) => row.id).sort()).toEqual(
            [...validAttendance].sort(),
          );
          expect(result.totalBalanceUnits).toBe(0);
        }
        expect(barrierCount).toBe(1);
        const current = await get('/partners/me/attendance').expect(200);
        expect(body<AttendanceView>(current).data).toMatchObject({
          presentCount: 0,
          recordedCount: 2,
          meta: { total: 2 },
        });
      } finally {
        await setReversed(false);
      }
    },
  );

  it('excludes mismatched campus associations at each attendance scope layer', async () => {
    const target = ownedAttendance[0];
    for (const layer of [
      'attendance',
      'student',
      'session',
      'teaching',
    ] as const) {
      const change = async (id: string) => {
        if (layer === 'attendance')
          await prisma.attendanceRecord.update({
            where: { id: target },
            data: { campusId: id },
          });
        if (layer === 'student')
          await prisma.student.update({
            where: { id: studentId },
            data: { campusId: id },
          });
        if (layer === 'session')
          await prisma.lessonSession.update({
            where: { id: reversibleLessonId },
            data: { campusId: id },
          });
        if (layer === 'teaching')
          await prisma.teachingRecord.update({
            where: { lessonSessionId: reversibleLessonId },
            data: { campusId: id },
          });
      };
      await change(ownedCampuses[1]);
      try {
        const response = await get('/partners/me/attendance').expect(200);
        const view = body<AttendanceView>(response).data;
        expect(view.items.map((row) => row.id)).not.toContain(target);
        expect(view.recordedCount).toBe(layer === 'student' ? 0 : 2);
      } finally {
        await change(campusId);
      }
    }
  });

  it('keeps highlight selection and personal attendance in one snapshot during reversal', async () => {
    let barriers = 0;
    const wrapped = {
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
                  const result = await tx.student.findMany(args);
                  barriers += 1;
                  await setReversed(true);
                  return result;
                },
              },
              classMember: tx.classMember,
              attendanceRecord: tx.attendanceRecord,
              financeReceipt: tx.financeReceipt,
              financeReceiptCorrection: tx.financeReceiptCorrection,
              coursePackage: tx.coursePackage,
              enrollmentOrder: tx.enrollmentOrder,
              groupMember: tx.groupMember,
            } as unknown as Prisma.TransactionClient),
          options,
        ),
    } as unknown as PrismaService;
    const query = new PartnerStudentQueryService(wrapped);
    try {
      const result = await query.highlight(campusId, 500);
      expect(result.students[0].id).toBe(studentId);
      expect(result.attendanceGroups).toEqual(
        expect.arrayContaining([
          { status: 'PRESENT', _count: { _all: 1 } },
          { status: 'ABSENT', _count: { _all: 1 } },
          { status: 'LEAVE', _count: { _all: 1 } },
        ]),
      );
      expect(barriers).toBe(1);
      const current = await get('/partners/me/dashboard').expect(200);
      expect(
        body<{ highlight: { attendance: Summary } }>(current).data.highlight
          .attendance,
      ).toMatchObject({
        recordedCount: 2,
        presentCount: 0,
        attendanceRateBasisPoints: 0,
      });
    } finally {
      await setReversed(false);
    }
  });
});
