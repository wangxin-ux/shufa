import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';
import { toParentLessonReviewView } from '../src/modules/parent-portal/parent-growth.models';
import { FeedbackImageFileView } from '../src/modules/file/stored-file.service';

type ReviewData = ReturnType<typeof toParentLessonReviewView>;
interface PhotoUploadData {
  id: string;
  accessUrl?: string;
}
interface StudentData {
  id: string;
  profileVersion: number;
  photo: FeedbackImageFileView | null;
}
interface UpdatesData {
  student: StudentData | null;
  records: Array<{
    lessonStatus: string;
    canReview: boolean;
    review: ReviewData | null;
    performanceRating: number | null;
  }>;
}
interface LessonData {
  students: Array<{
    photo: FeedbackImageFileView | null;
    parentReview: ReviewData | null;
    performanceRating: number | null;
  }>;
}
interface FeedbackData {
  performanceRating: number | null;
}
const data = <T>(response: { body: unknown }): T =>
  (response.body as { data: T }).data;

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';
const target = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
) {
  throw new Error('Performance tests require a local *_test database');
}
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  PORT: '3001',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  FILE_STORAGE_DRIVER: 'local',
  FILE_STORAGE_ROOT: './storage/test',
  AUTH_DRIVER: 'mock',
  PAYMENT_DRIVER: 'mock',
  PAYOUT_DRIVER: 'manual',
  MESSAGE_DRIVER: 'mock',
});

describe('P6 teacher-authored classroom performance', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let teacherToken: string;
  let otherTeacherToken: string;
  let parentToken: string;
  let outsideParentToken: string;
  let secondGuardianToken: string;
  let campusId: string;
  let studentId: string;
  let outsideStudentId: string;
  let lessonId: string;
  const users: string[] = [];

  beforeAll(async () => {
    const { AppModule } =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      );
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    campusId = (
      await prisma.campus.create({
        data: {
          code: `PERFORMANCE-${randomUUID()}`,
          name: '课堂表现测试校区',
        },
      })
    ).id;
    studentId = (
      await prisma.student.create({ data: { campusId, displayName: '陈晨' } })
    ).id;
    outsideStudentId = (
      await prisma.student.create({
        data: { campusId, displayName: '其他学员' },
      })
    ).id;
    const teacher = await prisma.user.create({
      data: {
        displayName: '林老师',
        roles: { create: { roleCode: 'TEACHER', campusId } },
        teacherProfile: { create: { campusId, employeeCode: randomUUID() } },
      },
      include: { teacherProfile: true },
    });
    const otherTeacher = await prisma.user.create({
      data: {
        displayName: '其他老师',
        roles: { create: { roleCode: 'TEACHER', campusId } },
        teacherProfile: { create: { campusId, employeeCode: randomUUID() } },
      },
    });
    const parent = await prisma.user.create({
      data: {
        displayName: '陈晨家长',
        roles: { create: { roleCode: 'PARENT', campusId } },
      },
    });
    const outsideParent = await prisma.user.create({
      data: {
        displayName: '其他家长',
        roles: { create: { roleCode: 'PARENT', campusId } },
      },
    });
    users.push(teacher.id, otherTeacher.id, parent.id, outsideParent.id);
    const guardian = await prisma.user.create({
      data: {
        displayName: '陈晨另一位家长',
        roles: { create: { roleCode: 'PARENT', campusId } },
      },
    });
    users.push(guardian.id);
    const classGroup = await prisma.classGroup.create({
      data: {
        campusId,
        teacherId: teacher.teacherProfile!.id,
        name: '专业美术班',
        courseName: '专业美术',
        members: { create: { campusId, studentId } },
      },
    });
    lessonId = (
      await prisma.lessonSession.create({
        data: {
          campusId,
          teacherId: teacher.teacherProfile!.id,
          classGroupId: classGroup.id,
          startsAt: new Date('2026-10-06T01:00:00Z'),
          endsAt: new Date('2026-10-06T02:00:00Z'),
          status: 'COMPLETED',
          completedAt: new Date(),
          attendanceRecords: {
            create: {
              campusId,
              studentId,
              status: 'PRESENT',
              recordedByUserId: teacher.id,
            },
          },
          teachingRecord: {
            create: {
              campusId,
              teacherId: teacher.teacherProfile!.id,
              recordedByUserId: teacher.id,
              attendeeCount: 1,
              lessonUnits: 100,
              completedAt: new Date(),
            },
          },
        },
      })
    ).id;
    await prisma.parentStudentBinding.createMany({
      data: [
        { campusId, studentId, parentUserId: parent.id, isPrimary: true },
        {
          campusId,
          studentId: outsideStudentId,
          parentUserId: outsideParent.id,
          isPrimary: true,
        },
        { campusId, studentId, parentUserId: guardian.id, isPrimary: true },
      ],
    });
    const auth = app.get(AuthService);
    teacherToken = (await auth.issueSessionForUser(teacher.id)).accessToken;
    otherTeacherToken = (await auth.issueSessionForUser(otherTeacher.id))
      .accessToken;
    parentToken = (await auth.issueSessionForUser(parent.id)).accessToken;
    outsideParentToken = (await auth.issueSessionForUser(outsideParent.id))
      .accessToken;
    secondGuardianToken = (await auth.issueSessionForUser(guardian.id))
      .accessToken;
  });
  afterAll(async () => {
    if (prisma && users.length)
      await prisma.user.updateMany({
        where: { id: { in: users } },
        data: { status: 'DISABLED' },
      });
    await app?.close();
  });
  const save = (
    rating: unknown,
    key = randomUUID(),
    token = teacherToken,
    targetStudent = studentId,
  ) =>
    request(server)
      .put(
        `/teachers/me/lesson-sessions/${lessonId}/students/${targetStudent}/feedback`,
      )
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send({
        content: '观察认真，构图完整',
        imageFileIds: [],
        ...(rating === undefined ? {} : { performanceRating: rating }),
      });
  const updates = (token = parentToken) =>
    request(server).get('/parents/me/updates').auth(token, { type: 'bearer' });
  const scores = {
    teaching: 9,
    communication: 8,
    environment: 10,
    overall: 9,
    note: '课堂体验很好',
  };
  const review = (
    body: object = scores,
    key = randomUUID(),
    token = parentToken,
  ) =>
    request(server)
      .post(
        `/parents/me/lesson-sessions/${lessonId}/students/${studentId}/review`,
      )
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(body);
  const reverse = () =>
    request(server)
      .post(`/teachers/me/lesson-sessions/${lessonId}/reverse`)
      .auth(teacherToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ lessonVersion: 1, reason: '测试课次撤销' });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/w7sAAAAASUVORK5CYII=',
    'base64',
  );
  const uploadPhoto = (
    bytes = png,
    token = parentToken,
    id = studentId,
    mime = 'image/png',
  ) =>
    request(server)
      .post(`/parents/me/students/${id}/photo-files`)
      .auth(token, { type: 'bearer' })
      .attach('file', bytes, { filename: 'photo.png', contentType: mime });
  const attachPhoto = (
    fileId: string,
    version = 1,
    key = randomUUID(),
    token = parentToken,
  ) =>
    request(server)
      .put(`/parents/me/students/${studentId}/photo`)
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send({ fileId, expectedVersion: version });

  const completeProfile = (fileId: string, overrides: Record<string, unknown> = {}, key = randomUUID(), token = parentToken, targetId = studentId) =>
    request(server).put(`/parents/me/students/${targetId}/profile-setup`)
      .auth(token, { type: 'bearer' }).set('Idempotency-Key', key)
      .send({ name: '陈晨同学', birthDate: '2017-10-08', fileId, expectedVersion: 1, ...overrides });

  it('completes the bound student profile once and shares the name, birthday and photo across parent pages', async () => {
    const initial = data<{ required: boolean; student: { id: string } }>(
      await request(server).get('/parents/me/profile-setup').auth(parentToken, { type: 'bearer' }).expect(200));
    expect(initial).toMatchObject({ required: true, student: { id: studentId } });
    const fileId = data<PhotoUploadData>(await uploadPhoto().expect(200)).id;
    const key = randomUUID();
    const saved = await completeProfile(fileId, {}, key).expect(200);
    expect(data<unknown>(saved)).toMatchObject({ required: false, student: {
      id: studentId, name: '陈晨同学', birthDate: '2017-10-08', profileVersion: 2, photo: { id: fileId },
    } });
    expect(data<unknown>(await completeProfile(fileId, {}, key).expect(200))).toEqual(data<unknown>(saved));
    await completeProfile(fileId, { name: '变更请求' }, key).expect(409);
    await completeProfile(fileId, { expectedVersion: 2, name: '不能再次改名' }).expect(409);
    const home = await request(server).get('/parents/me/home').auth(parentToken, { type: 'bearer' }).expect(200);
    expect(data<unknown>(home)).toMatchObject({ profileSetupRequired: false, student: { name: '陈晨同学' } });
    expect(data<UpdatesData>(await updates().expect(200)).student).toMatchObject({ name: '陈晨同学', photo: { id: fileId } });
    const stored = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
    expect(stored.profileAge).toBeNull();
    expect(stored.parentProfileCompletedAt).toBeInstanceOf(Date);
    expect(data<unknown>(await request(server).get('/parents/me/profile-setup')
      .auth(secondGuardianToken, { type: 'bearer' }).expect(200))).toMatchObject({ required: false });
    expect(await prisma.auditLog.count({ where: { campusId, action: 'PARENT_PROFILE_SETUP_COMPLETE' } })).toBe(1);
    await request(server).put('/parents/me/profile').auth(parentToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID()).send({ age: 99, homeAddress: '', expectedVersion: 2 }).expect(400);
    await request(server).put('/parents/me/profile').auth(parentToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID()).send({ homeAddress: '测试住址', expectedVersion: 2 }).expect(200);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: studentId } })).profileAge).toBeNull();
  });

  it('rejects unbound students, wrong roles, foreign photos and invalid first-time fields without changing the profile', async () => {
    const ownFile = data<PhotoUploadData>(await uploadPhoto().expect(200)).id;
    const foreignFile = data<PhotoUploadData>(await uploadPhoto(png, outsideParentToken, outsideStudentId).expect(200)).id;
    await completeProfile(ownFile, {}, randomUUID(), outsideParentToken).expect(403);
    await completeProfile(ownFile, {}, randomUUID(), teacherToken).expect(403);
    await completeProfile(ownFile, {}, randomUUID(), parentToken, outsideStudentId).expect(403);
    await completeProfile(foreignFile).expect(400);
    for (const fields of [
      { name: '   ' }, { name: '长'.repeat(101) }, { birthDate: '2017-02-30' },
      { birthDate: '2999-01-01' }, { birthDate: '1800-01-01' }, { fileId: null },
      { campusId }, { profileAge: 99 },
    ]) await completeProfile(ownFile, fields).expect(400);
    expect(await prisma.student.findUniqueOrThrow({ where: { id: studentId } })).toMatchObject({ displayName: '陈晨', profileVersion: 1 });
    expect(await prisma.auditLog.count({ where: { campusId, action: 'PARENT_PROFILE_SETUP_COMPLETE' } })).toBe(0);
  });

  it('serializes simultaneous first-time submissions and rolls back when audit persistence fails', async () => {
    const fileId = data<PhotoUploadData>(await uploadPhoto().expect(200)).id;
    const failedAudit = jest.fn(async () => { throw new Error('synthetic audit failure'); });
    const failedKey = randomUUID();
    const auditFailure = jest.spyOn(prisma, '$transaction').mockImplementationOnce((async (work: (tx: unknown) => Promise<unknown>) =>
      prisma.$transaction(async (tx) => {
        const wrapped = Object.create(tx) as Omit<typeof tx, 'auditLog'> & {
          auditLog: typeof tx.auditLog;
        };
        wrapped.auditLog = { ...tx.auditLog, create: failedAudit } as unknown as typeof tx.auditLog;
        return work(wrapped);
      })) as typeof prisma.$transaction);
    try { await completeProfile(fileId, {}, failedKey).expect(500); } finally { auditFailure.mockRestore(); }
    expect(failedAudit).toHaveBeenCalledTimes(1);
    expect(await prisma.idempotencyRecord.count({ where: { key: failedKey } })).toBe(0);
    expect(await prisma.student.findUniqueOrThrow({ where: { id: studentId } })).toMatchObject({
      displayName: '陈晨', profileVersion: 1, birthDate: null, parentProfileCompletedAt: null, profilePhotoFileId: null,
    });
    const results = await Promise.all([completeProfile(fileId), completeProfile(fileId)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await prisma.auditLog.count({ where: { campusId, action: 'PARENT_PROFILE_SETUP_COMPLETE' } })).toBe(1);
  });

  it('requires a current version and permits a second guardian to keep the already saved student photo', async () => {
    const fileId = data<PhotoUploadData>(await uploadPhoto().expect(200)).id;
    await completeProfile(fileId, {}, randomUUID(), secondGuardianToken).expect(400);
    await attachPhoto(fileId).expect(200);
    await completeProfile(fileId).expect(409);
    await completeProfile(fileId, { expectedVersion: 2 }, randomUUID(), secondGuardianToken).expect(200);
    expect(data<unknown>(await updates(parentToken).expect(200))).toMatchObject({
      student: { name: '陈晨同学', profileVersion: 3, photo: { id: fileId } },
    });
  });

  it('returns an empty setup for no binding and rejects cross-campus targets', async () => {
    const parent = await prisma.user.create({ data: {
      displayName: '无绑定测试家长', roles: { create: { roleCode: 'PARENT', campusId } },
    } });
    users.push(parent.id);
    const token = (await app.get(AuthService).issueSessionForUser(parent.id)).accessToken;
    expect(data<unknown>(await request(server).get('/parents/me/profile-setup')
      .auth(token, { type: 'bearer' }).expect(200))).toEqual({ required: false, student: null });
    expect(data<unknown>(await request(server).get('/parents/me/home')
      .auth(token, { type: 'bearer' }).expect(200))).toMatchObject({ profileSetupRequired: false });
    await request(server).get('/parents/me/profile-setup').expect(401);
    const campus = await prisma.campus.create({ data: { code: `SETUP-OTHER-${randomUUID()}`, name: '其他测试校区' } });
    const student = await prisma.student.create({ data: { campusId: campus.id, displayName: '其他校区学员' } });
    const fileId = data<PhotoUploadData>(await uploadPhoto().expect(200)).id;
    await completeProfile(fileId, {}, randomUUID(), parentToken, student.id).expect(403);
  });

  it('serializes first-time completion against legacy age and address edits without losing the staged photo', async () => {
    const fileId = data<PhotoUploadData>(await uploadPhoto().expect(200)).id;
    const results = await Promise.all([
      completeProfile(fileId),
      request(server).put('/parents/me/profile').auth(secondGuardianToken, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID()).send({ age: 12, homeAddress: '并发测试住址', expectedVersion: 1 }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    if (results[0].status === 409) {
      await completeProfile(fileId, { expectedVersion: 2 }).expect(200);
    }
    const stored = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
    expect(stored).toMatchObject({ displayName: '陈晨同学', profileAge: null, profilePhotoFileId: fileId });
    expect(stored.parentProfileCompletedAt).toBeInstanceOf(Date);
    if (results[1].status === 200) expect(stored.homeAddress).toBe('并发测试住址');
    expect(await prisma.auditLog.count({ where: { campusId, action: 'PARENT_PROFILE_SETUP_COMPLETE' } })).toBe(1);
  });

  it('submits an immutable review once and shares it only with the bound family and assigned teacher', async () => {
    const key = randomUUID();
    const first = await review(scores, key).expect(200);
    expect(data<ReviewData>(first)).toMatchObject({
      ...scores,
      studentId,
      lessonSessionId: lessonId,
      valid: true,
    });
    expect(data<ReviewData>(await review(scores, key).expect(200))).toEqual(
      data<ReviewData>(first),
    );
    await review().expect(409);
    await review(scores, randomUUID(), secondGuardianToken).expect(409);
    expect(
      data<UpdatesData>(await updates(secondGuardianToken).expect(200))
        .records[0],
    ).toMatchObject({ review: data<ReviewData>(first), canReview: false });
    const teacher = await request(server)
      .get(`/teachers/me/lesson-sessions/${lessonId}`)
      .auth(teacherToken, { type: 'bearer' })
      .expect(200);
    expect(data<LessonData>(teacher).students[0].parentReview).toEqual(
      data<ReviewData>(first),
    );
    expect(
      await prisma.auditLog.count({
        where: { campusId, action: 'PARENT_LESSON_REVIEW_CREATE' },
      }),
    ).toBe(1);
  });
  it('allows only one concurrent guardian review', async () => {
    const responses = await Promise.all([
      review(),
      review(scores, randomUUID(), secondGuardianToken),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(
      data<UpdatesData>(await updates().expect(200)).records[0].review,
    ).not.toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { campusId, action: 'PARENT_LESSON_REVIEW_CREATE' },
      }),
    ).toBe(1);
  });
  it('enforces four half-star scores, note limit, role and binding boundaries', async () => {
    for (const body of [
      { ...scores, teaching: 0 },
      { ...scores, overall: 11 },
      { ...scores, environment: 2.5 },
      { ...scores, communication: null },
      { teaching: 9 },
      { ...scores, note: '长'.repeat(501) },
      { ...scores, note: null },
      { ...scores, performanceRating: 10 },
    ])
      await review(body).expect(400);
    await review(scores, randomUUID(), teacherToken).expect(403);
    await review(scores, randomUUID(), outsideParentToken).expect(403);
    await prisma.attendanceRecord.updateMany({
      where: { lessonSessionId: lessonId },
      data: { status: 'LEAVE' },
    });
    await review().expect(409);
    await prisma.attendanceRecord.updateMany({
      where: { lessonSessionId: lessonId },
      data: { status: 'PRESENT' },
    });
    await prisma.lessonSession.update({
      where: { id: lessonId },
      data: { status: 'SCHEDULED', completedAt: null },
    });
    await review().expect(409);
  });
  it('keeps reviews after a real teacher reversal and rejects subsequent submissions', async () => {
    const submitted = await review().expect(200);
    await reverse().expect(200);
    const record = data<UpdatesData>(await updates().expect(200)).records[0];
    expect(record).toMatchObject({
      lessonStatus: 'REVERSED',
      canReview: false,
      review: { ...data<ReviewData>(submitted), valid: false },
    });
    await review().expect(409);
  });
  it('serializes review against a concurrent teacher reversal', async () => {
    const [parent, teacher] = await Promise.all([review(), reverse()]);
    expect(teacher.status).toBe(200);
    expect([200, 409]).toContain(parent.status);
    const record = data<UpdatesData>(await updates().expect(200)).records[0];
    expect(record.lessonStatus).toBe('REVERSED');
    expect(record.canReview).toBe(false);
    if (parent.status === 200) expect(record.review!.valid).toBe(false);
    else expect(record.review).toBeNull();
  });
  it('rolls back a failed review and permits an identical retry', async () => {
    const key = randomUUID();
    const completion = jest
      .spyOn(app.get(IdempotencyService), 'complete')
      .mockRejectedValueOnce(new Error('injected review rollback'));
    try {
      await review(scores, key).expect(500);
    } finally {
      completion.mockRestore();
    }
    expect(
      data<UpdatesData>(await updates().expect(200)).records[0].review,
    ).toBeNull();
    expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { campusId, action: 'PARENT_LESSON_REVIEW_CREATE' },
      }),
    ).toBe(0);
    await review(scores, key).expect(200);
  });
  it('stages a private photo, replaces it with version/idempotency and revokes the previous URL', async () => {
    const staged = data<PhotoUploadData>(await uploadPhoto().expect(200));
    expect(staged.accessUrl).toBeUndefined();
    const key = randomUUID();
    const first = await attachPhoto(staged.id, 1, key).expect(200);
    expect(data<StudentData>(first)).toMatchObject({
      id: studentId,
      profileVersion: 2,
      photo: { id: staged.id },
    });
    await request(server)
      .get(data<StudentData>(first).photo!.accessUrl)
      .expect(200);
    await request(server)
      .get(
        data<StudentData>(first).photo!.accessUrl.replace(
          /signature=.*/,
          'signature=invalid',
        ),
      )
      .expect(404);
    expect(
      data<StudentData>(await attachPhoto(staged.id, 1, key).expect(200)),
    ).toEqual(data<StudentData>(first));
    const next = data<PhotoUploadData>(await uploadPhoto().expect(200));
    await attachPhoto(next.id).expect(409);
    await attachPhoto(next.id, 2).expect(200);
    await request(server)
      .get(data<StudentData>(first).photo!.accessUrl)
      .expect(404);
    const teacher = await request(server)
      .get(`/teachers/me/lesson-sessions/${lessonId}`)
      .auth(teacherToken, { type: 'bearer' })
      .expect(200);
    expect(data<LessonData>(teacher).students[0].photo?.id).toBe(next.id);
    expect(
      data<UpdatesData>(await updates().expect(200)).student?.photo?.id,
    ).toBe(next.id);
    expect(
      await prisma.auditLog.count({
        where: { campusId, action: 'PARENT_STUDENT_PHOTO_REPLACE' },
      }),
    ).toBe(2);
  });
  it('rejects invalid and oversized photos, staff writes, other family files and non-bound targets', async () => {
    await uploadPhoto(Buffer.from('not-an-image')).expect(400);
    await uploadPhoto(png, parentToken, studentId, 'image/jpeg').expect(400);
    await uploadPhoto(Buffer.alloc(3 * 1024 * 1024 + 1)).expect(413);
    await uploadPhoto(png, teacherToken).expect(403);
    await uploadPhoto(png, parentToken, outsideStudentId).expect(403);
    const foreign = data<PhotoUploadData>(
      await uploadPhoto(png, outsideParentToken, outsideStudentId).expect(200),
    );
    await attachPhoto(foreign.id).expect(400);
    const staged = data<PhotoUploadData>(await uploadPhoto().expect(200));
    await attachPhoto(staged.id, 1, randomUUID(), teacherToken).expect(403);
    await attachPhoto(staged.id, 1, randomUUID(), secondGuardianToken).expect(
      400,
    );
  });
  it('allows only one concurrent photo replacement and rolls back failed version updates', async () => {
    const staged = data<PhotoUploadData>(await uploadPhoto().expect(200));
    const key = randomUUID();
    const completion = jest
      .spyOn(app.get(IdempotencyService), 'complete')
      .mockRejectedValueOnce(new Error('injected photo rollback'));
    try {
      await attachPhoto(staged.id, 1, key).expect(500);
    } finally {
      completion.mockRestore();
    }
    expect(
      data<UpdatesData>(await updates().expect(200)).student,
    ).toMatchObject({
      profileVersion: 1,
      photo: null,
    });
    expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(0);
    const responses = await Promise.all([
      attachPhoto(staged.id),
      attachPhoto(staged.id),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(
      data<UpdatesData>(await updates().expect(200)).student?.profileVersion,
    ).toBe(2);
  });

  it('rejects altered idempotent payloads and expired photo signatures', async () => {
    const key = randomUUID();
    await review(scores, key).expect(200);
    await review({ ...scores, teaching: 1 }, key).expect(409);
    const staged = data<PhotoUploadData>(await uploadPhoto().expect(200));
    const photoKey = randomUUID();
    const attached = data<StudentData>(
      await attachPhoto(staged.id, 1, photoKey).expect(200),
    );
    await attachPhoto(staged.id, 2, photoKey).expect(409);
    const url = new URL(attached.photo!.accessUrl, 'http://localhost');
    url.searchParams.set('expires', '1');
    await request(server).get(`${url.pathname}${url.search}`).expect(404);
  });

  it('rejects forged cross-campus bindings for photos and reviews', async () => {
    const otherCampus = await prisma.campus.create({
      data: {
        code: `OTHER-${randomUUID()}`,
        name: '隔离校区',
      },
    });
    await prisma.parentStudentBinding.updateMany({
      where: { studentId },
      data: { campusId: otherCampus.id },
    });
    await review().expect(403);
    await uploadPhoto().expect(403);
    expect(data<UpdatesData>(await updates().expect(200)).records).toEqual([]);
  });

  it('keeps old feedback null, persists half-star rating, replays and reads across authorized clients', async () => {
    expect(
      data<FeedbackData>(await save(undefined).expect(200)).performanceRating,
    ).toBeNull();
    const key = randomUUID();
    const first = await save(9, key).expect(200);
    expect(data<FeedbackData>(first).performanceRating).toBe(9);
    expect(data<FeedbackData>(await save(9, key).expect(200))).toEqual(
      data<FeedbackData>(first),
    );
    await save(undefined).expect(200);
    expect(
      data<UpdatesData>(await updates().expect(200)).records[0]
        .performanceRating,
    ).toBe(9);
    const lesson = await request(server)
      .get(`/teachers/me/lesson-sessions/${lessonId}`)
      .auth(teacherToken, { type: 'bearer' })
      .expect(200);
    expect(data<LessonData>(lesson).students[0].performanceRating).toBe(9);
    await save(null).expect(200);
    expect(
      data<UpdatesData>(await updates().expect(200)).records[0]
        .performanceRating,
    ).toBeNull();
  });
  it('rejects invalid ratings and unauthorized writers/readers without changing feedback', async () => {
    await save(10).expect(200);
    for (const value of [0, 11, 1.5, '9', true]) await save(value).expect(400);
    await save(1, randomUUID(), parentToken).expect(403);
    await save(1, randomUUID(), otherTeacherToken).expect(403);
    await save(1, randomUUID(), teacherToken, outsideStudentId).expect(403);
    await request(server)
      .get(`/teachers/me/lesson-sessions/${lessonId}`)
      .auth(otherTeacherToken, { type: 'bearer' })
      .expect(403);
    expect(
      data<UpdatesData>(await updates(outsideParentToken).expect(200)).records,
    ).toEqual([]);
    expect(
      data<UpdatesData>(await updates().expect(200)).records[0]
        .performanceRating,
    ).toBe(10);
  });
  it('preserves rating on a reversed lesson but rejects further teacher writes', async () => {
    await save(1).expect(200);
    await prisma.lessonSession.update({
      where: { id: lessonId },
      data: {
        status: 'REVERSED',
        reversedAt: new Date(),
        reversalReason: '测试撤销',
      },
    });
    await save(10).expect(409);
    expect(
      data<UpdatesData>(await updates().expect(200)).records[0],
    ).toMatchObject({
      lessonStatus: 'REVERSED',
      performanceRating: 1,
    });
  });
  it('serializes concurrent retries of the same rating without duplicating audit facts', async () => {
    const key = randomUUID();
    const responses = await Promise.all([save(9, key), save(9, key)]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    expect(data<FeedbackData>(responses[0])).toEqual(
      data<FeedbackData>(responses[1]),
    );
    expect(
      await prisma.studentFeedback.count({
        where: { lessonSessionId: lessonId, studentId },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { campusId, action: 'TEACHER_FEEDBACK_UPSERT' },
      }),
    ).toBe(1);
  });
  it('rolls back feedback, rating, audit and idempotency on failure', async () => {
    await save(1).expect(200);
    const key = randomUUID();
    const completion = jest
      .spyOn(app.get(IdempotencyService), 'complete')
      .mockRejectedValueOnce(new Error('injected performance rollback'));
    try {
      await save(10, key).expect(500);
    } finally {
      completion.mockRestore();
    }
    expect(
      data<UpdatesData>(await updates().expect(200)).records[0]
        .performanceRating,
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { campusId, action: 'TEACHER_FEEDBACK_UPSERT' },
      }),
    ).toBe(1);
    expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(0);
    await save(10, key).expect(200);
  });
});
