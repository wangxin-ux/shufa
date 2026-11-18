import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { PartnerScopeService } from '../src/common/auth/partner-scope.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { StoredFileService } from '../src/modules/file/stored-file.service';
import { PartnerReadService } from '../src/modules/partner/partner-read.service';
import { resolvePartnerPeriodRange } from '../src/modules/partner/partner-period';
import { PartnerStudentQueryService } from '../src/modules/partner/partner-student-query.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);

interface TeacherView {
  id: string;
  displayName: string;
  classNames: string[];
  activeStudentCount: number;
  monthCompletedLessonCount: number;
}
interface TeacherPage {
  data: TeacherView[];
  meta: { page: number; total: number; totalPages: number };
}

describe('partner teacher read scope and snapshot', () => {
  const runTag = `ppdf-teacher-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];
  const campusIds: string[] = [];
  const teacherIds: string[] = [];
  const studentIds: string[] = [];
  const classIds: string[] = [];
  const memberIds: string[] = [];
  const lessonIds: string[] = [];
  const tokens: string[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  const get = (query = runTag, token = tokens[0]) =>
    request(server)
      .get('/partners/me/teachers')
      .auth(token, { type: 'bearer' })
      .query({ query, page: 1, pageSize: 20 });
  const createTeacher = async (
    campus: number,
    label: string,
    active = true,
  ) => {
    const user = await prisma.user.create({
      data: {
        displayName: `${runTag}${label}`,
        roles: { create: { roleCode: 'TEACHER', campusId: campusIds[campus] } },
        teacherProfile: {
          create: {
            campusId: campusIds[campus],
            employeeCode: `${runTag}-${randomUUID().slice(0, 8)}`,
            isActive: active,
          },
        },
      },
      include: { teacherProfile: true },
    });
    userIds.push(user.id);
    teacherIds.push(user.teacherProfile!.id);
    return user.teacherProfile!.id;
  };
  const createStudent = async (campus: number, active = true) => {
    const row = await prisma.student.create({
      data: {
        campusId: campusIds[campus],
        displayName: `${runTag}合成学员`,
        isActive: active,
      },
    });
    studentIds.push(row.id);
    return row.id;
  };
  const createClass = async (
    campus: number,
    teacherId: string,
    label: string,
  ) => {
    const row = await prisma.classGroup.create({
      data: {
        campusId: campusIds[campus],
        teacherId,
        name: `${runTag}${label}`,
        courseName: `${runTag}合成课程`,
      },
    });
    classIds.push(row.id);
    return row.id;
  };
  const addMember = async (
    campus: number,
    classGroupId: string,
    studentId: string,
    left = false,
  ) => {
    const row = await prisma.classMember.create({
      data: {
        campusId: campusIds[campus],
        classGroupId,
        studentId,
        ...(left
          ? { joinedAt: new Date(Date.now() - 60_000), leftAt: new Date() }
          : {}),
      },
    });
    memberIds.push(row.id);
  };

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    for (let index = 0; index < 2; index += 1) {
      const campus = await prisma.campus.create({
        data: {
          code: `${runTag}-${index}`,
          name: `${runTag}隔离校区${index}`,
          timezone: 'Asia/Shanghai',
        },
      });
      campusIds.push(campus.id);
      const user = await prisma.user.create({
        data: {
          displayName: `${runTag}合作方${index}`,
          roles: { create: { roleCode: 'PARTNER', campusId: campus.id } },
        },
      });
      userIds.push(user.id);
      tokens.push(
        (await app.get(AuthService).issueSessionForUser(user.id)).accessToken,
      );
    }
  });

  afterAll(async () => {
    let userDisposition = 'not verified; follow-up required';
    try {
      if (prisma && userIds.length) {
        assertPartnerPdfTestTarget(process.env);
        const disabled = await prisma.user.updateMany({
          where: { id: { in: userIds }, displayName: { startsWith: runTag } },
          data: { status: 'DISABLED' },
        });
        expect(disabled.count).toBe(userIds.length);
        const verified = await prisma.user.count({
          where: {
            id: { in: userIds },
            displayName: { startsWith: runTag },
            status: 'DISABLED',
          },
        });
        expect(verified).toBe(userIds.length);
        userDisposition = 'owned users disabled and verified';
      } else if (!userIds.length) {
        userDisposition = 'no owned users created';
      }
    } finally {
      try {
        await app?.close();
      } finally {
        process.stdout.write(
          'PARTNER_PDF_FIXTURE_OWNERSHIP ' +
            JSON.stringify({
              runTag,
              userIds,
              campusIds,
              teacherIds,
              studentIds,
              classIds,
              memberIds,
              lessonIds,
              disposition: `retained; ${userDisposition}; no deletion`,
            }) +
            '\n',
        );
      }
    }
  });

  it('only lists active teachers from the authenticated campus with search and pagination', async () => {
    const own = await createTeacher(0, '名册甲');
    await createTeacher(0, '名册停用', false);
    const other = await createTeacher(1, '名册乙');
    const result = (await get(`${runTag}名册`).expect(200)).body as TeacherPage;
    expect(result.data.map((row) => row.id)).toEqual([own]);
    expect(result.meta.total).toBe(1);
    const foreign = (await get(`${runTag}名册`, tokens[1]).expect(200))
      .body as TeacherPage;
    expect(foreign.data[0].id).toBe(other);
    const empty = (
      await get(`${runTag}名册`).query({ page: 2, pageSize: 1 }).expect(200)
    ).body as TeacherPage;
    expect(empty.data).toEqual([]);
  });

  it('does not expose a foreign-campus class associated with an own-campus teacher', async () => {
    const teacher = await createTeacher(0, '班级隔离');
    await createClass(0, teacher, '本校区班级');
    await createClass(1, teacher, '禁止泄露班级');
    const result = (await get(`${runTag}班级隔离`).expect(200))
      .body as TeacherPage;
    expect(result.data[0].classNames).toEqual([`${runTag}本校区班级`]);
    expect(JSON.stringify(result)).not.toContain('禁止泄露班级');
  });

  it('counts distinct active local students only when membership and student scopes both match', async () => {
    const teacher = await createTeacher(0, '成员隔离');
    const first = await createClass(0, teacher, '成员班甲');
    const second = await createClass(0, teacher, '成员班乙');
    const local = await createStudent(0);
    await addMember(0, first, local);
    await addMember(0, second, local);
    await addMember(0, first, await createStudent(1));
    await addMember(1, first, await createStudent(0));
    await addMember(0, first, await createStudent(0, false));
    await addMember(0, first, await createStudent(0), true);
    const result = (await get(`${runTag}成员隔离`).expect(200))
      .body as TeacherPage;
    expect(result.data[0].activeStudentCount).toBe(1);
  });

  it('counts monthly completed lessons only when lesson and class scopes both match', async () => {
    const teacher = await createTeacher(0, '课次隔离');
    const localClass = await createClass(0, teacher, '课次本地班');
    const foreignClass = await createClass(1, teacher, '课次外地班');
    const now = new Date();
    const { start, end } = resolvePartnerPeriodRange(
      'MONTH',
      undefined,
      'Asia/Shanghai',
      now,
    );
    const addLesson = async (
      campus: number,
      classGroupId: string,
      status: Prisma.LessonSessionUncheckedCreateInput['status'] = 'COMPLETED',
      completedAt = now,
    ) => {
      const finished = status === 'COMPLETED' || status === 'REVERSED';
      const row = await prisma.lessonSession.create({
        data: {
          campusId: campusIds[campus],
          teacherId: teacher,
          classGroupId,
          status,
          startsAt: new Date(completedAt.getTime() - 3_600_000),
          endsAt: completedAt,
          ...(finished ? { completedAt } : {}),
          ...(status === 'REVERSED'
            ? { reversedAt: now, reversalReason: '合成撤销' }
            : {}),
        },
      });
      lessonIds.push(row.id);
    };
    await addLesson(0, localClass);
    await addLesson(0, localClass);
    await addLesson(1, localClass);
    await addLesson(0, foreignClass);
    await addLesson(0, localClass, 'COMPLETED', new Date(start.getTime() - 1));
    await addLesson(0, localClass, 'COMPLETED', end);
    await addLesson(0, localClass, 'SCHEDULED');
    await addLesson(0, localClass, 'CANCELLED');
    await addLesson(0, localClass, 'REVERSED');
    const result = (await get(`${runTag}课次隔离`).expect(200))
      .body as TeacherPage;
    expect(result.data[0].monthCompletedLessonCount).toBe(2);
  });

  it('keeps total and page rows in the same snapshot during concurrent teacher deactivation', async () => {
    const teacher = await createTeacher(0, '快照隔离');
    let releaseCount!: () => void;
    const counted = new Promise<void>((resolve) => {
      releaseCount = resolve;
    });
    let changed: Promise<unknown> | undefined;
    const instrument = (client: Prisma.TransactionClient) => ({
      campus: client.campus,
      teacherProfile: {
        count: async (args: Prisma.TeacherProfileCountArgs) => {
          const total = await client.teacherProfile.count(args);
          changed = prisma.teacherProfile.update({
            where: { id: teacher },
            data: { isActive: false },
          });
          await changed;
          releaseCount();
          return total;
        },
        findMany: async (args: Prisma.TeacherProfileFindManyArgs) => {
          await counted;
          await changed;
          return client.teacherProfile.findMany(args);
        },
      },
    });
    const service = new PartnerReadService(
      {
        ...instrument(prisma),
        $transaction: (
          read: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: { isolationLevel: Prisma.TransactionIsolationLevel },
        ) =>
          prisma.$transaction(
            (tx) => read(instrument(tx) as unknown as Prisma.TransactionClient),
            options,
          ),
      } as unknown as PrismaService,
      app.get(PartnerScopeService),
      app.get(PartnerStudentQueryService),
      app.get(StoredFileService),
    );
    const result = await service.listTeachers(
      {
        userId: userIds[0],
        roles: [{ code: 'PARTNER', campusId: campusIds[0] }],
      },
      { query: `${runTag}快照隔离`, page: 1, pageSize: 20 },
    );
    expect(result.meta.total).toBe(1);
    expect(result.data.map((row) => row.id)).toEqual([teacher]);
    const after = (await get(`${runTag}快照隔离`).expect(200))
      .body as TeacherPage;
    expect(after.meta.total).toBe(0);
    expect(after.data).toEqual([]);
  });

  it('does not grant a teacher account partner roster access', async () => {
    const teacher = await createTeacher(0, '角色隔离');
    const user = await prisma.teacherProfile.findUniqueOrThrow({
      where: { id: teacher },
    });
    const token = (await app.get(AuthService).issueSessionForUser(user.userId))
      .accessToken;
    await get(runTag, token).expect(403);
  });

  it('requires authentication and rejects client-supplied campus scope', async () => {
    await request(server).get('/partners/me/teachers').expect(401);
    await get().query({ campusId: campusIds[1] }).expect(400);
  });

  it('rejects invalid pagination instead of widening the read', async () => {
    await get().query({ page: 0 }).expect(400);
    await get().query({ pageSize: 101 }).expect(400);
  });

  it('uses stable IDs to paginate teachers with identical names without duplicates', async () => {
    const ids = [
      await createTeacher(0, '同名排序'),
      await createTeacher(0, '同名排序'),
      await createTeacher(0, '同名排序'),
    ].sort();
    const pages: TeacherPage[] = [];
    for (let page = 1; page <= 3; page += 1) {
      pages.push(
        (
          await get(`${runTag}同名排序`)
            .query({ page, pageSize: 2 })
            .expect(200)
        ).body as TeacherPage,
      );
    }
    expect(pages.flatMap((page) => page.data.map((row) => row.id))).toEqual(
      ids,
    );
    expect(pages.map((page) => page.meta.total)).toEqual([3, 3, 3]);
    expect(pages.map((page) => page.meta.totalPages)).toEqual([2, 2, 2]);
    expect(pages[2].data).toEqual([]);
  });

  it('uses the campus timezone with an inclusive month start and exclusive month end', async () => {
    await prisma.campus.update({
      where: { id: campusIds[1] },
      data: { timezone: 'America/Los_Angeles' },
    });
    const start = new Date('2026-10-01T07:00:00.000Z');
    const end = new Date('2026-11-01T07:00:00.000Z');
    const teacherIdsByBoundary: string[] = [];
    const boundaries = [
      new Date(start.getTime() - 1),
      start,
      new Date(end.getTime() - 1),
      end,
    ];
    for (let index = 0; index < boundaries.length; index += 1) {
      const completedAt = boundaries[index];
      const teacher = await createTeacher(1, `时区边界${index}`);
      teacherIdsByBoundary.push(teacher);
      const classGroupId = await createClass(1, teacher, `时区班${index}`);
      const row = await prisma.lessonSession.create({
        data: {
          campusId: campusIds[1],
          teacherId: teacher,
          classGroupId,
          status: 'COMPLETED',
          startsAt: new Date(completedAt.getTime() - 3_600_000),
          endsAt: completedAt,
          completedAt,
        },
      });
      lessonIds.push(row.id);
    }
    // Freeze only Date; database I/O and timeout scheduling must remain real.
    jest.useFakeTimers({
      now: new Date('2026-10-10T12:00:00.000Z'),
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
    try {
      const result = await app.get(PartnerReadService).listTeachers(
        {
          userId: userIds[1],
          roles: [{ code: 'PARTNER', campusId: campusIds[1] }],
        },
        { query: `${runTag}时区边界`, page: 1, pageSize: 20 },
      );
      expect(
        teacherIdsByBoundary.map(
          (id) =>
            result.data.find((row) => row.id === id)?.monthCompletedLessonCount,
        ),
      ).toEqual([0, 1, 1, 0]);
    } finally {
      jest.useRealTimers();
    }
  });
});
