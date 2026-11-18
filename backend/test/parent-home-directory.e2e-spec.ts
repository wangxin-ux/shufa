import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';

const databaseUrl = process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';
const target = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    !target.pathname.endsWith('_test')) {
  throw new Error('Parent directory tests require a local *_test database');
}
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: databaseUrl, PORT: '3001',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_ROOT: './storage/test',
  AUTH_DRIVER: 'mock', PAYMENT_DRIVER: 'mock', PAYOUT_DRIVER: 'manual',
  MESSAGE_DRIVER: 'mock',
});

describe('parent home public directory scope', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let token: string;
  let teacherToken: string;
  let parentId: string;
  let studentId: string;
  let otherStudentId: string;
  let ownTeacherId: string;
  let futureLessonId: string;
  const users: string[] = [];

  beforeAll(async () => {
    const { AppModule } = jest.requireActual<typeof import('../src/app.module')>('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    const campus = await prisma.campus.create({
      data: { code: `HOME-${randomUUID()}`, name: '首页测试东校区' },
    });
    const otherCampus = await prisma.campus.create({
      data: { code: `HOME-${randomUUID()}`, name: '首页测试西校区' },
    });
    for (const [campusId, name, active] of [
      [campus.id, '公开教师', true],
      [campus.id, '停用教师', false],
      [otherCampus.id, '其他校区教师', true],
    ] as const) {
      const teacher = await prisma.teacherProfile.create({
        data: {
          campus: { connect: { id: campusId } }, employeeCode: `HOME-${randomUUID()}`, isActive: active,
          specialties: ['硬笔书法'],
          user: { create: { displayName: name, roles: { create: { roleCode: 'TEACHER', campusId } } } },
        },
      });
      users.push(teacher.userId);
      if (name === '公开教师') {
        ownTeacherId = teacher.id;
        teacherToken = (await app.get(AuthService).issueSessionForUser(teacher.userId)).accessToken;
      }
    }
    const student = await prisma.student.create({
      data: { campusId: campus.id, displayName: '绑定学员' },
    });
    studentId = student.id;
    otherStudentId = (await prisma.student.create({
      data: { campusId: campus.id, displayName: '其他家庭学员' },
    })).id;
    const parent = await prisma.user.create({
      data: {
        displayName: '首页测试家长',
        roles: { create: { roleCode: 'PARENT', campusId: campus.id } },
      },
    });
    parentId = parent.id;
    users.push(parent.id);
    await prisma.parentStudentBinding.create({
      data: { campusId: campus.id, parentUserId: parent.id, studentId, isPrimary: true },
    });
    token = (await app.get(AuthService).issueSessionForUser(parent.id)).accessToken;
    const group = await prisma.classGroup.create({
      data: {
        campusId: campus.id, teacherId: ownTeacherId, name: '测试班', courseName: '硬笔书法',
        members: { create: { campusId: campus.id, studentId } },
      },
    });
    const now = Date.now();
    for (const offset of [-86400000, 86400000]) {
      const lesson = await prisma.lessonSession.create({
        data: {
          campusId: campus.id, teacherId: ownTeacherId, classGroupId: group.id,
          startsAt: new Date(now + offset), endsAt: new Date(now + offset + 3600000),
        },
      });
      if (offset > 0) futureLessonId = lesson.id;
    }
  }, 60000);

  afterAll(async () => {
    if (prisma && users.length) {
      await prisma.user.updateMany({ where: { id: { in: users } }, data: { status: 'DISABLED' } });
    }
    await app?.close();
  });

  it('shows only own active teachers and excludes stale scheduled lessons', async () => {
    const response = await request(server).get('/parents/me/home').auth(token, { type: 'bearer' }).expect(200);
    const data = response.body.data;
    expect(data.teachers).toEqual([{ id: ownTeacherId, name: '公开教师', specialties: ['硬笔书法'] }]);
    expect(data.reminders).toHaveLength(1);
    expect(data.nextLesson.id).toBe(futureLessonId);
    expect(data.nextLesson).toEqual(data.reminders[0]);
    expect(data.reminders[0].courseName).toBe('硬笔书法');
  });

  it('does not allow another student or staff role to access parent home', async () => {
    await request(server).get('/parents/me/home').query({ studentId: otherStudentId }).auth(token, { type: 'bearer' }).expect(403);
    await request(server).get('/parents/me/home').auth(teacherToken, { type: 'bearer' }).expect(403);
    await request(server).get('/parents/me/home').expect(401);
  });

  it('returns no public directory after the binding is absent', async () => {
    await prisma.student.update({ where: { id: studentId }, data: { isActive: false } });
    const response = await request(server).get('/parents/me/home').auth(token, { type: 'bearer' }).expect(200);
    expect(response.body.data).toMatchObject({ student: null, teachers: [], reminders: [], nextLesson: null });
    expect(parentId).toBeDefined();
  });
});
