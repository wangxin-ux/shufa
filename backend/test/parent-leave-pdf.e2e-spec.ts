import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';

const databaseUrl = process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';
const target = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !target.pathname.endsWith('_test')) {
  throw new Error('Parent leave tests require a local *_test database');
}
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: databaseUrl, PORT: '3001', REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_ROOT: './storage/test', AUTH_DRIVER: 'mock',
  PAYMENT_DRIVER: 'mock', PAYOUT_DRIVER: 'manual', MESSAGE_DRIVER: 'mock',
});

describe('PDF parent leave warnings without changing approval', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let token: string;
  let teacherToken: string;
  let managerToken: string;
  let campusId: string;
  let studentId: string;
  let otherStudentId: string;
  let parentId: string;
  let teacherId: string;
  let teacherUserId: string;
  let classGroupId: string;
  let firstId: string;
  let secondId: string;
  const users: string[] = [];

  beforeAll(async () => {
    const { AppModule } = jest.requireActual<typeof import('../src/app.module')>('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    campusId = (await prisma.campus.create({ data: {
      code: `LEAVE-${randomUUID()}`, name: '请假测试校区', contactPhone: '0731-88886666',
    } })).id;
    studentId = (await prisma.student.create({ data: { campusId, displayName: '请假学员' } })).id;
    otherStudentId = (await prisma.student.create({ data: { campusId, displayName: '其他学员' } })).id;
    parentId = (await prisma.user.create({ data: {
      displayName: '请假家长', roles: { create: { roleCode: 'PARENT', campusId } },
    } })).id;
    users.push(parentId);
    await prisma.parentStudentBinding.create({ data: { campusId, parentUserId: parentId, studentId, isPrimary: true } });
    token = (await app.get(AuthService).issueSessionForUser(parentId)).accessToken;
    const teacher = await prisma.teacherProfile.create({ data: {
      campus: { connect: { id: campusId } }, employeeCode: `LEAVE-${randomUUID()}`,
      user: { create: { displayName: '请假教师', roles: { create: { roleCode: 'TEACHER', campusId } } } },
    } });
    teacherId = teacher.id;
    teacherUserId = teacher.userId;
    users.push(teacherUserId);
    teacherToken = (await app.get(AuthService).issueSessionForUser(teacherUserId)).accessToken;
    const manager = await prisma.user.create({ data: {
      displayName: '请假园长', roles: { create: { roleCode: 'CAMPUS_MANAGER', campusId } },
    } });
    users.push(manager.id);
    managerToken = (await app.get(AuthService).issueSessionForUser(manager.id)).accessToken;
    classGroupId = (await prisma.classGroup.create({ data: {
      campusId, teacherId, name: `请假班-${randomUUID()}`, courseName: '创意书写',
      members: { create: { campusId, studentId, joinedAt: new Date('2020-01-01T00:00:00Z') } },
    } })).id;
    firstId = await lesson('2030-10-01T06:00:00Z');
    secondId = await lesson('2030-10-02T06:00:00Z');
  });
  afterAll(async () => {
    if (prisma && users.length) await prisma.user.updateMany({ where: { id: { in: users } }, data: { status: 'DISABLED' } });
    await app?.close();
  });
  async function lesson(startsAt: string) {
    const start = new Date(startsAt);
    return (await prisma.lessonSession.create({ data: {
      campusId, classGroupId, teacherId, startsAt: start, endsAt: new Date(start.getTime() + 3600000),
    } })).id;
  }
  function submit(id: string, key = randomUUID()) {
    return request(server).post('/parents/me/leave-requests').auth(token, { type: 'bearer' })
      .set('Idempotency-Key', key).send({ studentId, lessonSessionId: id, reason: '家庭临时有事' });
  }
  const read = () => request(server).get('/parents/me/leave').auth(token, { type: 'bearer' });

  it('warns on the second consecutive leave and keeps pending approval plus replay unchanged', async () => {
    const first = await submit(firstId).expect(200);
    expect(first.body.data.contactWarning).toBeNull();
    const key = randomUUID();
    const second = await submit(secondId, key).expect(200);
    expect(second.body.data).toMatchObject({ status: 'PENDING', contactWarning: {
      weekStart: '2030-09-30', weekEnd: '2030-10-06', consecutiveCount: 2,
      lessonSessionIds: [firstId, secondId], campusName: '请假测试校区', contactPhone: '0731-88886666',
    } });
    expect((await submit(secondId, key).expect(200)).body.data).toEqual(second.body.data);
    expect((await read().expect(200)).body.data.weeklyWarnings).toHaveLength(1);
    const review = await request(server)
      .post(`/campus-managers/me/leave-requests/${first.body.data.id}/approve`)
      .auth(managerToken, { type: 'bearer' }).set('Idempotency-Key', randomUUID())
      .send({ version: 1, reviewReason: '已电话沟通' }).expect(200);
    expect(review.body.data.status).toBe('APPROVED');
    expect((await read().expect(200)).body.data.weeklyWarnings[0].consecutiveCount).toBe(2);
  });
  it('lets a normal intervening lesson or rejected request break continuity', async () => {
    await lesson('2030-10-01T07:00:00Z');
    await submit(firstId).expect(200);
    const second = await submit(secondId).expect(200);
    expect(second.body.data.contactWarning).toBeNull();
    expect((await read().expect(200)).body.data.weeklyWarnings).toEqual([]);
    await request(server).post(`/campus-managers/me/leave-requests/${second.body.data.id}/reject`)
      .auth(managerToken, { type: 'bearer' }).set('Idempotency-Key', randomUUID())
      .send({ version: 1, reviewReason: '请核对课程' }).expect(200);
    const third = await submit(await lesson('2030-10-03T06:00:00Z')).expect(200);
    expect(third.body.data.contactWarning).toBeNull();
  });
  it('resets at Shanghai Monday and handles absent campus phone without inventing one', async () => {
    await prisma.campus.update({ where: { id: campusId }, data: { contactPhone: null } });
    await prisma.lessonSession.update({ where: { id: firstId }, data: {
      startsAt: new Date('2030-10-06T15:00:00Z'), endsAt: new Date('2030-10-06T15:30:00Z'),
    } });
    await prisma.lessonSession.update({ where: { id: secondId }, data: {
      startsAt: new Date('2030-10-06T16:00:00Z'), endsAt: new Date('2030-10-06T17:00:00Z'),
    } });
    await submit(firstId).expect(200);
    expect((await submit(secondId).expect(200)).body.data.contactWarning).toBeNull();
    const third = await submit(await lesson('2030-10-07T06:00:00Z')).expect(200);
    expect(third.body.data.contactWarning).toMatchObject({
      weekStart: '2030-10-07', weekEnd: '2030-10-13', contactPhone: null, consecutiveCount: 2,
    });
  });
  it('serializes same-student concurrent submissions and never duplicates a session', async () => {
    const responses = await Promise.all([submit(firstId), submit(secondId)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses.filter((response) => response.body.data.contactWarning?.consecutiveCount === 2)).toHaveLength(1);
    expect((await read().expect(200)).body.data.weeklyWarnings[0].consecutiveCount).toBe(2);
    await submit(firstId).expect(409);
    expect(await prisma.parentLeaveRequest.count({ where: { campusId, studentId } })).toBe(2);
  });
  it('keeps actual teacher attendance above leave request hints', async () => {
    await submit(firstId).expect(200);
    await submit(secondId).expect(200);
    await prisma.attendanceRecord.create({ data: {
      campusId, studentId, lessonSessionId: firstId, recordedByUserId: teacherUserId, status: 'PRESENT',
    } });
    expect((await read().expect(200)).body.data.weeklyWarnings).toEqual([]);
  });
  it('does not expose another family or let staff submit parent leave', async () => {
    await request(server).get('/parents/me/leave').auth(token, { type: 'bearer' })
      .query({ studentId: otherStudentId }).expect(403);
    await request(server).get('/parents/me/leave').auth(teacherToken, { type: 'bearer' }).expect(403);
    await request(server).post('/parents/me/leave-requests').auth(token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID()).send({ studentId: otherStudentId, lessonSessionId: firstId, reason: '请假' }).expect(403);
    await request(server).post('/parents/me/leave-requests').auth(token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID()).send({ studentId, lessonSessionId: firstId, reason: ' ' }).expect(400);
    expect(await prisma.parentLeaveRequest.count({ where: { studentId } })).toBe(0);
  });
  it('rolls back leave, audit and idempotency when completion fails', async () => {
    const key = randomUUID();
    const completion = jest.spyOn(app.get(IdempotencyService), 'complete').mockRejectedValueOnce(new Error('injected leave rollback'));
    try { await submit(firstId, key).expect(500); } finally { completion.mockRestore(); }
    expect(await prisma.parentLeaveRequest.count({ where: { studentId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { campusId, action: 'PARENT_LEAVE_SUBMIT' } })).toBe(0);
    expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(0);
    await submit(firstId, key).expect(200);
  });
});
