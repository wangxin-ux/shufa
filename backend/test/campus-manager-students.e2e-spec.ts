import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { seedTeacherCore } from '../prisma/seed';
import { configureApplication } from '../src/common/bootstrap/configure-app';

jest.setTimeout(30_000);

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';

const TEST_ENV = {
  NODE_ENV: 'test',
  PORT: '3001',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  FILE_STORAGE_DRIVER: 'local',
  FILE_STORAGE_ROOT: './storage/test',
  AUTH_DRIVER: 'mock',
  PAYMENT_DRIVER: 'mock',
  PAYOUT_DRIVER: 'manual',
  MESSAGE_DRIVER: 'mock',
  TZ: 'Asia/Shanghai',
};

const ids = {
  eastCampus: '10000000-0000-4000-8000-000000000001',
  eastStudent: '40000000-0000-4000-8000-000000000001',
  westStudent: '40000000-0000-4000-8000-000000000003',
  eastClass: '50000000-0000-4000-8000-000000000001',
  eastWorkshop: '50000000-0000-4000-8000-000000000002',
  westClass: '50000000-0000-4000-8000-000000000003',
} as const;

interface Envelope<T> {
  data: T;
  requestId: string;
}

interface AuthSession {
  accessToken: string;
}

interface StudentSummary {
  id: string;
  campusId: string;
  displayName: string;
  birthDate: string | null;
  classNames: string[];
}

const testStudentNames = [
  '陈小满',
  '测试同名学员',
  '测试幂等学员',
  '测试并发学员',
  '测试回滚后学员',
] as const;

describe('campus manager students', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaClient;
  let managerToken: string;
  let parentToken: string;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await seedTeacherCore(prisma);
    await cleanupTestData();

    const { AppModule } =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      );
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    httpServer = app.getHttpServer() as Server;
    managerToken = await login('mock-demo-east-campus-manager');
    parentToken = await login('mock-demo-east-parent');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.classGroup.updateMany({
        where: { id: ids.eastWorkshop },
        data: { status: 'ACTIVE' },
      });
      await cleanupTestData();
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  async function cleanupTestData() {
    const students = await prisma.student.findMany({
      where: {
        campusId: ids.eastCampus,
        displayName: { in: [...testStudentNames] },
      },
      select: { id: true },
    });
    const studentIds = students.map(({ id }) => id);
    if (studentIds.length > 0) {
      await prisma.classMember.deleteMany({
        where: { studentId: { in: studentIds } },
      });
      await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    }
    await prisma.auditLog.deleteMany({
      where: { action: 'CAMPUS_STUDENT_CREATE' },
    });
    await prisma.idempotencyRecord.deleteMany({
      where: {
        route: '/campus-managers/me/students',
        key: { startsWith: 'cm-student-' },
      },
    });
  }

  async function login(code: string): Promise<string> {
    const response = await request(httpServer)
      .post('/auth/login')
      .send({ code })
      .expect(200);
    return (response.body as Envelope<AuthSession>).data.accessToken;
  }

  const getAs = (path: string, token = managerToken) =>
    request(httpServer).get(path).set('Authorization', `Bearer ${token}`);

  const createAs = (
    body: {
      displayName: string;
      birthDate?: string | null;
      classGroupId?: string | null;
    },
    key: string,
    token = managerToken,
  ) =>
    request(httpServer)
      .post('/campus-managers/me/students')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);

  it('paginates and searches active students only in the manager campus', async () => {
    const response = await getAs(
      '/campus-managers/me/students?page=1&pageSize=1&query=陈',
    ).expect(200);

    expect(response.body).toEqual({
      data: [
        expect.objectContaining({
          id: ids.eastStudent,
          campusId: ids.eastCampus,
          displayName: '陈晨',
          classNames: ['创意基础A班', '创意工坊A班'],
        }),
      ],
      meta: { page: 1, pageSize: 1, total: 1, totalPages: 1 },
      requestId: expect.any(String) as unknown,
    });
    expect(JSON.stringify(response.body)).not.toContain(ids.westStudent);
  });

  it('returns detail summaries without exposing a foreign-campus student', async () => {
    const response = await getAs(
      `/campus-managers/me/students/${ids.eastStudent}`,
    ).expect(200);
    const student = (response.body as Envelope<StudentSummary>).data;
    expect(student).toMatchObject({
      id: ids.eastStudent,
      campusId: ids.eastCampus,
      displayName: '陈晨',
      classNames: ['创意基础A班', '创意工坊A班'],
      mainBalanceUnits: expect.any(Number) as unknown,
      giftBalanceUnits: expect.any(Number) as unknown,
      recentAttendanceCount: expect.any(Number) as unknown,
      recentConsumedUnits: expect.any(Number) as unknown,
    });

    await getAs(`/campus-managers/me/students/${ids.westStudent}`)
      .expect(404)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }) as unknown,
        );
      });
  });

  it('creates same-name students with optional birth date and class only', async () => {
    const first = await createAs(
      {
        displayName: '陈小满',
        birthDate: '2018-05-16',
        classGroupId: ids.eastClass,
      },
      'cm-student-create-001',
    ).expect(200);
    const second = await createAs(
      { displayName: '陈小满' },
      'cm-student-create-002',
    ).expect(200);
    const firstStudent = (first.body as Envelope<StudentSummary>).data;
    const secondStudent = (second.body as Envelope<StudentSummary>).data;

    expect(firstStudent).toMatchObject({
      id: expect.any(String) as unknown,
      displayName: '陈小满',
      birthDate: '2018-05-16',
      campusId: ids.eastCampus,
      classNames: ['创意基础A班'],
    });
    expect(secondStudent.id).not.toBe(firstStudent.id);
    expect(secondStudent.classNames).toEqual([]);
    expect(
      await prisma.parentStudentBinding.count({
        where: { studentId: firstStudent.id },
      }),
    ).toBe(0);
    expect(
      await prisma.coursePackage.count({
        where: { studentId: firstStudent.id },
      }),
    ).toBe(0);
  });

  it('rejects foreign and archived classes and rolls the transaction back', async () => {
    await createAs(
      {
        displayName: '测试回滚后学员',
        classGroupId: ids.westClass,
      },
      'cm-student-rollback-001',
    ).expect(404);
    expect(
      await prisma.student.count({
        where: { displayName: '测试回滚后学员' },
      }),
    ).toBe(0);

    await createAs(
      {
        displayName: '测试回滚后学员',
        classGroupId: ids.eastClass,
      },
      'cm-student-rollback-001',
    ).expect(200);

    await prisma.classGroup.update({
      where: { id: ids.eastWorkshop },
      data: { status: 'ARCHIVED' },
    });
    try {
      await createAs(
        {
          displayName: '测试同名学员',
          classGroupId: ids.eastWorkshop,
        },
        'cm-student-archived-001',
      ).expect(404);
    } finally {
      await prisma.classGroup.update({
        where: { id: ids.eastWorkshop },
        data: { status: 'ACTIVE' },
      });
    }
  });

  it('replays one key once and rejects the same key with another payload', async () => {
    const first = await createAs(
      { displayName: '测试幂等学员' },
      'cm-student-idempotent-001',
    ).expect(200);
    const replay = await createAs(
      { displayName: '测试幂等学员' },
      'cm-student-idempotent-001',
    ).expect(200);
    const firstStudent = (first.body as Envelope<StudentSummary>).data;
    const replayedStudent = (replay.body as Envelope<StudentSummary>).data;
    expect(replayedStudent.id).toBe(firstStudent.id);
    expect(
      await prisma.student.count({
        where: { displayName: '测试幂等学员' },
      }),
    ).toBe(1);

    await createAs(
      { displayName: '测试同名学员' },
      'cm-student-idempotent-001',
    ).expect(409);
  });

  it('returns one student for concurrent submissions with the same key', async () => {
    const responses = await Promise.all([
      createAs({ displayName: '测试并发学员' }, 'cm-student-concurrent-001'),
      createAs({ displayName: '测试并发学员' }, 'cm-student-concurrent-001'),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    const responseStudents = responses.map(
      ({ body }) => (body as Envelope<StudentSummary>).data,
    );
    expect(responseStudents[0].id).toBe(responseStudents[1].id);
    expect(
      await prisma.student.count({
        where: { displayName: '测试并发学员' },
      }),
    ).toBe(1);
  });

  it('rejects non-manager reads and writes', async () => {
    await getAs('/campus-managers/me/students', parentToken).expect(403);
    await createAs(
      { displayName: '测试同名学员' },
      'cm-student-forbidden-001',
      parentToken,
    ).expect(403);
  });
});
