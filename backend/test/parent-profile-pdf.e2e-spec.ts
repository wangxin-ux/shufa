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
  throw new Error('Parent profile tests require a local *_test database');
}
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: databaseUrl, PORT: '3001', REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_ROOT: './storage/test', AUTH_DRIVER: 'mock',
  PAYMENT_DRIVER: 'mock', PAYOUT_DRIVER: 'manual', MESSAGE_DRIVER: 'mock',
});

describe('PDF P5 bound student profile closure', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let token: string;
  let teacherToken: string;
  let campusId: string;
  let studentId: string;
  let otherStudentId: string;
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
      code: `PROFILE-${randomUUID()}`, name: '资料测试校区',
    } })).id;
    studentId = (await prisma.student.create({ data: {
      campusId, displayName: '资料学员', profileAge: 9, homeAddress: '原住址',
    } })).id;
    otherStudentId = (await prisma.student.create({ data: {
      campusId, displayName: '其他学员', profileAge: 8,
    } })).id;
    const parent = await prisma.user.create({ data: {
      displayName: '资料家长', roles: { create: { roleCode: 'PARENT', campusId } },
    } });
    const teacher = await prisma.user.create({ data: {
      displayName: '资料教师', roles: { create: { roleCode: 'TEACHER', campusId } },
    } });
    users.push(parent.id, teacher.id);
    await prisma.parentStudentBinding.create({ data: {
      campusId, parentUserId: parent.id, studentId, isPrimary: true,
    } });
    token = (await app.get(AuthService).issueSessionForUser(parent.id)).accessToken;
    teacherToken = (await app.get(AuthService).issueSessionForUser(teacher.id)).accessToken;
  });
  afterAll(async () => {
    if (prisma && users.length) await prisma.user.updateMany({
      where: { id: { in: users } }, data: { status: 'DISABLED' },
    });
    await app?.close();
  });
  const read = () => request(server).get('/parents/me/profile').auth(token, { type: 'bearer' });
  const save = (age = 10, key = randomUUID()) => request(server).put('/parents/me/profile')
    .auth(token, { type: 'bearer' }).set('Idempotency-Key', key)
    .send({ age, homeAddress: '新住址', expectedVersion: 1 });

  it('updates the bound identity and replays exactly once, rejecting stale versions', async () => {
    expect((await read().expect(200)).body.data.student).toMatchObject({ id: studentId, age: 9, profileVersion: 1 });
    const key = randomUUID();
    const first = await save(10, key).expect(200);
    expect(first.body.data.student).toMatchObject({ id: studentId, age: 10, homeAddress: '新住址', profileVersion: 2 });
    expect((await save(10, key).expect(200)).body.data).toEqual(first.body.data);
    await save(11).expect(409);
    expect((await read().expect(200)).body.data).toEqual(first.body.data);
    expect(await prisma.auditLog.count({ where: { campusId, action: 'PARENT_PROFILE_UPDATE' } })).toBe(1);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: otherStudentId } })).profileAge).toBe(8);
  });
  it('allows only one concurrent versioned write', async () => {
    const responses = await Promise.all([save(10), save(11)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await read().expect(200)).body.data.student.profileVersion).toBe(2);
    expect(await prisma.auditLog.count({ where: { campusId, action: 'PARENT_PROFILE_UPDATE' } })).toBe(1);
  });
  it('rejects staff, unbound targeting and invalid fields without mutating the identity', async () => {
    await request(server).put('/parents/me/profile').auth(teacherToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID()).send({ age: 10, homeAddress: '', expectedVersion: 1 }).expect(403);
    await request(server).put('/parents/me/profile').auth(token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID()).send({
        studentId: otherStudentId, age: 10, homeAddress: '', expectedVersion: 1,
      }).expect(400);
    await save(121).expect(400);
    expect((await read().expect(200)).body.data.student).toMatchObject({ age: 9, homeAddress: '原住址', profileVersion: 1 });
  });
  it('rolls back identity, audit and idempotency if completion fails', async () => {
    const key = randomUUID();
    const completion = jest.spyOn(app.get(IdempotencyService), 'complete')
      .mockRejectedValueOnce(new Error('injected profile rollback'));
    try { await save(10, key).expect(500); } finally { completion.mockRestore(); }
    expect((await read().expect(200)).body.data.student).toMatchObject({ age: 9, profileVersion: 1 });
    expect(await prisma.auditLog.count({ where: { campusId, action: 'PARENT_PROFILE_UPDATE' } })).toBe(0);
    expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(0);
    await save(10, key).expect(200);
  });
});
