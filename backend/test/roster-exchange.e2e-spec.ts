import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Workbook } from 'exceljs';
import type { Server } from 'node:http';
import request from 'supertest';
import { seedTeacherCore } from '../prisma/seed';
import { configureApplication } from '../src/common/bootstrap/configure-app';

jest.setTimeout(40_000);

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';
const eastCampusId = '10000000-0000-4000-8000-000000000001';
const suffix = Date.now().toString().slice(-7);
const customerPhone = `1380${suffix}`;
const teacherPhone = `1390${suffix}`;
const globalPhone = `1370${suffix}`;
const names = ['名册学员甲', '名册学员乙', '名册表格学员', '名册总端教师'];

describe('customer and teacher roster exchange', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;
  let superToken: string;
  let managerToken: string;
  let parentToken: string;

  beforeAll(async () => {
    Object.assign(process.env, {
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
    });
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await seedTeacherCore(prisma);
    await cleanup();
    const { AppModule } = jest.requireActual<typeof import('../src/app.module')>(
      '../src/app.module',
    );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Server;
    superToken = await login('mock-demo-super-admin');
    managerToken = await login('mock-demo-east-campus-manager');
    parentToken = await login('mock-demo-east-parent');
  });

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await prisma?.$disconnect();
  });

  it('reuses one parent for another child and skips an exact duplicate', async () => {
    const first = await quickCustomer('名册学员甲', customerPhone, 'customer-quick-1').expect(200);
    const second = await quickCustomer('名册学员乙', customerPhone, 'customer-quick-2').expect(200);
    const duplicate = await quickCustomer('名册学员甲', customerPhone, 'customer-quick-3').expect(200);

    expect(first.body.data.status).toBe('CREATED');
    expect(second.body.data.status).toBe('CREATED');
    expect(duplicate.body.data).toMatchObject({
      status: 'DUPLICATE',
      reason: '该学员已绑定此家长，已跳过',
    });
    const parents = await prisma.user.findMany({
      where: { parentPhone: `+86${customerPhone}` },
      select: { parentStudentBindings: { select: { studentId: true } } },
    });
    expect(parents).toHaveLength(1);
    expect(parents[0].parentStudentBindings).toHaveLength(2);
  });

  it('forces a manager-created staff row to one teacher role in the token campus', async () => {
    const created = await request(server)
      .post('/campus-managers/me/rosters/teachers/entries')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('Idempotency-Key', 'teacher-quick-1')
      .send({ teacherName: '名册导入老师', phone: teacherPhone })
      .expect(200);
    expect(created.body.data.status).toBe('CREATED');

    const teacher = await prisma.user.findFirstOrThrow({
      where: { staffPhone: `+86${teacherPhone}` },
      select: {
        roles: { select: { roleCode: true, campusId: true } },
        teacherProfile: { select: { campusId: true } },
      },
    });
    expect(teacher.roles).toEqual([{ roleCode: 'TEACHER', campusId: eastCampusId }]);
    expect(teacher.teacherProfile?.campusId).toBe(eastCampusId);

    await request(server)
      .post('/campus-managers/me/rosters/teachers/entries')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('Idempotency-Key', 'teacher-quick-overreach')
      .send({
        teacherName: '越权老师',
        phone: `1360${suffix}`,
        campusId: '10000000-0000-4000-8000-000000000002',
      })
      .expect(400);
  });

  it('previews and imports valid, duplicate, and invalid workbook rows independently', async () => {
    const file = await workbook('CUSTOMER_V1', ['学员姓名', '家长手机号'], [
      ['名册学员甲', customerPhone],
      ['名册表格学员', `1361${suffix}`],
      ['错误手机号学员', '12345'],
    ]);
    const preview = await request(server)
      .post('/campus-managers/me/rosters/customers/preview')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('file', file, { filename: '顾客.xlsx' })
      .expect(200);
    expect(preview.body.data).toMatchObject({
      totalRows: 3,
      validCount: 1,
      duplicateCount: 1,
      errorCount: 1,
    });

    const imported = await request(server)
      .post('/campus-managers/me/rosters/customers/import')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('file', file, { filename: '顾客.xlsx' })
      .expect(200);
    expect(imported.body.data).toMatchObject({
      totalRows: 3,
      importedCount: 1,
      duplicateCount: 1,
      errorCount: 1,
      errorReceiptFileName: 'CUSTOMER_V1-错误回执.xlsx',
      errorReceiptBase64: expect.any(String),
    });
    await expect(
      prisma.student.count({ where: { displayName: '名册表格学员' } }),
    ).resolves.toBe(1);
  });

  it('imports a global teacher by campus name and lists it', async () => {
    const file = await workbook('TEACHER_V1', ['教师姓名', '手机号', '校区'], [
      ['名册总端教师', globalPhone, '启明东校区'],
    ]);
    await request(server)
      .post('/management/rosters/teachers/import')
      .set('Authorization', `Bearer ${superToken}`)
      .attach('file', file, { filename: '教师.xlsx' })
      .expect(200)
      .expect(({ body }) => expect(body.data.importedCount).toBe(1));

    const listed = await request(server)
      .get('/management/rosters/teachers?page=1&pageSize=20&query=名册总端教师')
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);
    expect(listed.body.data).toEqual([
      expect.objectContaining({
        teacherName: '名册总端教师',
        campusId: eastCampusId,
        maskedPhone: expect.stringMatching(/\*{4}/),
      }),
    ]);
  });

  it('requires full-phone confirmation, returns xlsx, audits export, and denies parents', async () => {
    await request(server)
      .get('/campus-managers/me/rosters/customers/export?confirmed=false')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(400);
    const exported = await request(server)
      .get('/campus-managers/me/rosters/customers/export?confirmed=true')
      .set('Authorization', `Bearer ${managerToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200)
      .expect('Content-Type', /spreadsheetml/);
    expect(Buffer.isBuffer(exported.body)).toBe(true);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'CUSTOMER_ROSTER_EXPORT',
          campusId: eastCampusId,
        },
      }),
    ).resolves.toBeGreaterThan(0);

    await request(server)
      .get('/campus-managers/me/rosters/teachers?page=1&pageSize=20')
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(403);
  });

  it('keeps the campus column when global exports are filtered to one campus', async () => {
    const customerExport = await request(server)
      .get(
        `/management/rosters/customers/export?confirmed=true&campusId=${eastCampusId}&query=名册学员甲`,
      )
      .set('Authorization', `Bearer ${superToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const customerWorkbook = new Workbook();
    await customerWorkbook.xlsx.load(customerExport.body as Buffer);
    const customerSheet = customerWorkbook.getWorksheet('CUSTOMER_V1');

    expect(customerSheet?.getRow(1).getCell(3).text).toBe('校区');
    expect(customerSheet?.getRow(2).getCell(3).text).toBe('启明东校区');

    const teacherExport = await request(server)
      .get(
        `/management/rosters/teachers/export?confirmed=true&campusId=${eastCampusId}&query=名册总端教师`,
      )
      .set('Authorization', `Bearer ${superToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const teacherWorkbook = new Workbook();
    await teacherWorkbook.xlsx.load(teacherExport.body as Buffer);
    const teacherSheet = teacherWorkbook.getWorksheet('TEACHER_V1');

    expect(teacherSheet?.getRow(1).getCell(3).text).toBe('校区');
    expect(teacherSheet?.getRow(2).getCell(3).text).toBe('启明东校区');
  });

  async function login(code: string) {
    const response = await request(server).post('/auth/login').send({ code }).expect(200);
    return (response.body as { data: { accessToken: string } }).data.accessToken;
  }

  function quickCustomer(studentName: string, parentPhone: string, key: string) {
    return request(server)
      .post('/campus-managers/me/rosters/customers/entries')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('Idempotency-Key', key)
      .send({ studentName, parentPhone });
  }

  async function cleanup() {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { parentPhone: { in: [`+86${customerPhone}`, `+861361${suffix}`] } },
          { staffPhone: { in: [`+86${teacherPhone}`, `+86${globalPhone}`] } },
        ],
      },
      select: { id: true },
    });
    const userIds = users.map(({ id }) => id);
    const students = await prisma.student.findMany({
      where: { displayName: { in: names } },
      select: { id: true },
    });
    const studentIds = students.map(({ id }) => id);
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorUserId: { in: userIds } },
          { resourceId: { in: [...userIds, ...studentIds] } },
          { action: { in: ['CUSTOMER_ROSTER_IMPORT', 'TEACHER_ROSTER_IMPORT', 'CUSTOMER_ROSTER_EXPORT'] } },
        ],
      },
    });
    await prisma.idempotencyRecord.deleteMany({
      where: {
        OR: [
          { key: { startsWith: 'customer-quick-' } },
          { key: { startsWith: 'teacher-quick-' } },
          { key: { startsWith: 'roster-' } },
        ],
      },
    });
    await prisma.parentStudentBinding.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.classMember.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    await prisma.teacherProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.authIdentity.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
});

async function workbook(name: string, headers: string[], rows: string[][]) {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(headers);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
