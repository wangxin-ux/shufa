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
  westCampus: '10000000-0000-4000-8000-000000000002',
  managerUser: '20000000-0000-4000-8000-000000000005',
  eastStudent: '40000000-0000-4000-8000-000000000001',
  eastOtherStudent: '40000000-0000-4000-8000-000000000002',
  westStudent: '40000000-0000-4000-8000-000000000003',
  eastClass: '50000000-0000-4000-8000-000000000001',
  warningStudent: 'a2000000-0000-4000-8000-000000000001',
  inactiveStudent: 'a2000000-0000-4000-8000-000000000002',
  warningMember: 'a2000000-0000-4000-8000-000000000003',
  expiredPackage: 'a2000000-0000-4000-8000-000000000004',
  inactivePackage: 'a2000000-0000-4000-8000-000000000005',
} as const;

interface Envelope<T> {
  data: T;
  requestId: string;
}

interface Page<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface AuthSession {
  accessToken: string;
}

interface WarningView {
  studentId: string;
  studentName: string;
  classNames: string[];
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  totalBalanceUnits: number;
  thresholdUnits: number;
}

interface CampusView {
  id: string;
  code: string;
  name: string;
  timezone: string;
  contactPhone: string | null;
  address: string | null;
  lessonWarningThresholdUnits: number;
  version: number;
}

describe('campus manager warnings and settings', () => {
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

  beforeEach(async () => resetFixtures());

  afterAll(async () => {
    if (prisma) {
      await cleanupFixtures();
      await seedTeacherCore(prisma);
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  async function login(code: string): Promise<string> {
    const response = await request(httpServer)
      .post('/auth/login')
      .send({ code })
      .expect(200);
    return (response.body as Envelope<AuthSession>).data.accessToken;
  }

  async function cleanupFixtures(): Promise<void> {
    await prisma.idempotencyRecord.deleteMany({
      where: { route: '/campus-managers/me/campus' },
    });
    await prisma.auditLog.deleteMany({
      where: { action: 'CAMPUS_SETTINGS_UPDATE' },
    });
    await prisma.coursePackage.deleteMany({
      where: { id: { in: [ids.expiredPackage, ids.inactivePackage] } },
    });
    await prisma.classMember.deleteMany({ where: { id: ids.warningMember } });
    await prisma.student.deleteMany({
      where: { id: { in: [ids.warningStudent, ids.inactiveStudent] } },
    });
  }

  async function resetFixtures(): Promise<void> {
    await cleanupFixtures();
    await prisma.campus.update({
      where: { id: ids.eastCampus },
      data: {
        name: '启明东校区',
        contactPhone: '0731-88886666',
        address: '长沙市岳麓区启明路 18 号',
        lessonWarningThresholdUnits: 500,
        version: 1,
      },
    });
    await prisma.campus.update({
      where: { id: ids.westCampus },
      data: {
        name: '启明西校区',
        contactPhone: null,
        address: null,
        latitude: null,
        longitude: null,
        mapVisible: false,
        lessonWarningThresholdUnits: 500,
        version: 1,
      },
    });
    await prisma.coursePackage.update({
      where: { id: '80000000-0000-4000-8000-000000000001' },
      data: {
        mainBalanceUnits: 300,
        giftBalanceUnits: 200,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2040-01-01T00:00:00.000Z'),
        isActive: true,
      },
    });
    await prisma.coursePackage.update({
      where: { id: '80000000-0000-4000-8000-000000000002' },
      data: {
        mainBalanceUnits: 700,
        giftBalanceUnits: 100,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2040-01-01T00:00:00.000Z'),
        isActive: true,
      },
    });
    await prisma.student.createMany({
      data: [
        {
          id: ids.warningStudent,
          campusId: ids.eastCampus,
          displayName: '低课时学员',
          isActive: true,
        },
        {
          id: ids.inactiveStudent,
          campusId: ids.eastCampus,
          displayName: '停用学员',
          isActive: false,
        },
      ],
    });
    await prisma.classMember.create({
      data: {
        id: ids.warningMember,
        campusId: ids.eastCampus,
        classGroupId: ids.eastClass,
        studentId: ids.warningStudent,
      },
    });
    await prisma.coursePackage.createMany({
      data: [
        {
          id: ids.expiredPackage,
          campusId: ids.eastCampus,
          studentId: ids.warningStudent,
          name: '已过期课包',
          mainBalanceUnits: 9900,
          giftBalanceUnits: 100,
          paidAmountFen: 0,
          validFrom: new Date('2020-01-01T00:00:00.000Z'),
          expiresAt: new Date('2021-01-01T00:00:00.000Z'),
          isActive: true,
        },
        {
          id: ids.inactivePackage,
          campusId: ids.eastCampus,
          studentId: ids.warningStudent,
          name: '已停用课包',
          mainBalanceUnits: 8800,
          giftBalanceUnits: 200,
          paidAmountFen: 0,
          validFrom: new Date('2020-01-01T00:00:00.000Z'),
          expiresAt: new Date('2040-01-01T00:00:00.000Z'),
          isActive: false,
        },
      ],
    });
  }

  const getAs = (path: string, token = managerToken) =>
    request(httpServer).get(path).set('Authorization', `Bearer ${token}`);

  const updateAs = (
    body: Record<string, unknown>,
    key: string,
    token = managerToken,
  ) =>
    request(httpServer)
      .patch('/campus-managers/me/campus')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);

  const settingsInput = (overrides: Record<string, unknown> = {}) => ({
    version: 1,
    name: '启明东校区新址',
    contactPhone: '13800138000',
    address: '长沙市岳麓区未来路 8 号',
    lessonWarningThresholdUnits: 600,
    ...overrides,
  });

  it('calculates current-campus low balances on the server and includes zero-balance students', async () => {
    const response = await getAs(
      '/campus-managers/me/warnings?page=1&pageSize=10',
    ).expect(200);
    const page = response.body as Page<WarningView>;

    expect(page.meta).toEqual({
      page: 1,
      pageSize: 10,
      total: 2,
      totalPages: 1,
    });
    expect(page.data).toEqual([
      {
        studentId: ids.warningStudent,
        studentName: '低课时学员',
        classNames: ['创意基础A班'],
        mainBalanceUnits: 0,
        giftBalanceUnits: 0,
        totalBalanceUnits: 0,
        thresholdUnits: 500,
      },
      {
        studentId: ids.eastStudent,
        studentName: '陈晨',
        classNames: ['创意基础A班', '创意工坊A班'],
        mainBalanceUnits: 300,
        giftBalanceUnits: 200,
        totalBalanceUnits: 500,
        thresholdUnits: 500,
      },
    ]);
    expect(page.data.map(({ studentId }) => studentId)).not.toEqual(
      expect.arrayContaining([
        ids.eastOtherStudent,
        ids.inactiveStudent,
        ids.westStudent,
      ]),
    );
  });

  it('applies query before warning pagination and returns stable page metadata', async () => {
    const pageTwo = await getAs(
      '/campus-managers/me/warnings?page=2&pageSize=1',
    ).expect(200);
    expect((pageTwo.body as Page<WarningView>).meta).toEqual({
      page: 2,
      pageSize: 1,
      total: 2,
      totalPages: 2,
    });
    expect((pageTwo.body as Page<WarningView>).data).toEqual([
      expect.objectContaining({ studentName: '陈晨' }),
    ]);

    const searched = await getAs(
      '/campus-managers/me/warnings?page=1&pageSize=10&query=%E9%99%88',
    ).expect(200);
    expect((searched.body as Page<WarningView>).data).toEqual([
      expect.objectContaining({ studentName: '陈晨' }),
    ]);
  });

  it('reads only the authenticated campus settings', async () => {
    const response = await getAs('/campus-managers/me/campus').expect(200);

    expect((response.body as Envelope<CampusView>).data).toEqual({
      id: ids.eastCampus,
      code: 'campus-demo-east',
      name: '启明东校区',
      timezone: 'Asia/Shanghai',
      contactPhone: '0731-88886666',
      address: '长沙市岳麓区启明路 18 号',
      lessonWarningThresholdUnits: 500,
      version: 1,
    });
  });

  it('updates allowed fields once, records snapshots, and replays idempotently', async () => {
    const body = settingsInput();
    const first = await updateAs(body, 'cm-settings-update-001').expect(200);
    const replay = await updateAs(body, 'cm-settings-update-001').expect(200);
    const updated = (first.body as Envelope<CampusView>).data;

    expect(updated).toMatchObject({
      id: ids.eastCampus,
      code: 'campus-demo-east',
      timezone: 'Asia/Shanghai',
      name: body.name,
      contactPhone: body.contactPhone,
      address: body.address,
      lessonWarningThresholdUnits: 600,
      version: 2,
    });
    expect((replay.body as Envelope<CampusView>).data).toEqual(updated);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: 'CAMPUS_SETTINGS_UPDATE',
        resourceId: ids.eastCampus,
        actorUserId: ids.managerUser,
      },
      select: { campusId: true, details: true },
    });
    expect(audit).toEqual({
      campusId: ids.eastCampus,
      details: {
        before: {
          name: '启明东校区',
          contactPhone: '0731-88886666',
          address: '长沙市岳麓区启明路 18 号',
          lessonWarningThresholdUnits: 500,
          version: 1,
        },
        after: {
          name: '启明东校区新址',
          contactPhone: '13800138000',
          address: '长沙市岳麓区未来路 8 号',
          lessonWarningThresholdUnits: 600,
          version: 2,
        },
      },
    });
    await expect(
      prisma.auditLog.count({
        where: { action: 'CAMPUS_SETTINGS_UPDATE', resourceId: ids.eastCampus },
      }),
    ).resolves.toBe(1);
  });

  it('validates phone, address, threshold, name, and rejects non-editable fields', async () => {
    await updateAs(
      settingsInput({ contactPhone: '12345' }),
      'cm-settings-invalid-phone-001',
    ).expect(400);
    await updateAs(
      settingsInput({ address: '地'.repeat(301) }),
      'cm-settings-invalid-address-001',
    ).expect(400);
    await updateAs(
      settingsInput({ lessonWarningThresholdUnits: -1 }),
      'cm-settings-invalid-threshold-001',
    ).expect(400);
    await updateAs(
      settingsInput({ name: '   ' }),
      'cm-settings-invalid-name-001',
    ).expect(400);
    await updateAs(
      settingsInput({
        campusId: ids.westCampus,
        code: 'changed-code',
        timezone: 'UTC',
      }),
      'cm-settings-forbidden-fields-001',
    ).expect(400);

    const west = await prisma.campus.findUniqueOrThrow({
      where: { id: ids.westCampus },
      select: { name: true, code: true, timezone: true, version: true },
    });
    expect(west).toEqual({
      name: '启明西校区',
      code: 'campus-demo-west',
      timezone: 'Asia/Shanghai',
      version: 1,
    });
  });

  it('rolls back failed claims and rejects stale versions and payload reuse', async () => {
    await updateAs(
      settingsInput({ version: 99 }),
      'cm-settings-version-retry-001',
    ).expect(409);
    await updateAs(settingsInput(), 'cm-settings-version-retry-001').expect(
      200,
    );
    await updateAs(
      settingsInput({ version: 2, name: '另一个名称' }),
      'cm-settings-version-retry-001',
    ).expect(409);
  });

  it('allows only one concurrent update from the same version', async () => {
    const [first, second] = await Promise.all([
      updateAs(
        settingsInput({ name: '并发更新甲' }),
        'cm-settings-concurrent-001',
      ),
      updateAs(
        settingsInput({ name: '并发更新乙' }),
        'cm-settings-concurrent-002',
      ),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const campus = await prisma.campus.findUniqueOrThrow({
      where: { id: ids.eastCampus },
      select: { name: true, version: true },
    });
    expect(['并发更新甲', '并发更新乙']).toContain(campus.name);
    expect(campus.version).toBe(2);
  });

  it('rejects non-manager warning and settings access', async () => {
    await getAs('/campus-managers/me/warnings', parentToken).expect(403);
    await getAs('/campus-managers/me/campus', parentToken).expect(403);
    await updateAs(
      settingsInput(),
      'cm-settings-role-denial-001',
      parentToken,
    ).expect(403);
  });
});
