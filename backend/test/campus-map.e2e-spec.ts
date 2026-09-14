import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
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
} as const;

interface Envelope<T> {
  data: T;
}

describe('parent nearby campuses and map configuration', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;
  let parentToken: string;
  let teacherToken: string;
  let managerToken: string;
  let superToken: string;

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
    server = app.getHttpServer() as Server;
    [parentToken, teacherToken, managerToken, superToken] = await Promise.all([
      login(server, 'mock-demo-east-parent'),
      login(server, 'mock-demo-east-teacher'),
      login(server, 'mock-demo-east-campus-manager'),
      login(server, 'mock-demo-super-admin'),
    ]);
  });

  beforeEach(async () => {
    await seedTeacherCore(prisma);
    await prisma.idempotencyRecord.deleteMany({
      where: { route: { contains: '/map-location' } },
    });
    await prisma.auditLog.deleteMany({
      where: {
        action: {
          in: ['CAMPUS_MAP_LOCATION_UPDATE', 'CUSTOMER_SERVICE_QR_UPDATE'],
        },
      },
    });
  });

  afterAll(async () => {
    await seedTeacherCore(prisma);
    await app?.close();
    await prisma?.$disconnect();
  });

  it('returns only published campuses, sorted by straight-line distance', async () => {
    const hiddenCampusId = randomUUID();
    await prisma.campus.create({
      data: {
        id: hiddenCampusId,
        code: `hidden-map-${Date.now()}`,
        name: '内部测试校区',
        address: '长沙市测试路 1 号',
        latitude: 28.2,
        longitude: 112.9,
        mapVisible: false,
      },
    });

    try {
      const response = await request(server)
        .get(
          '/parents/me/campuses?page=1&pageSize=20&latitude=28.2282&longitude=112.9388',
        )
        .set('Authorization', `Bearer ${parentToken}`)
        .expect(200);
      const body = response.body as Envelope<
        Array<Record<string, unknown>>
      > & { meta: { total: number } };

      expect(body.data.map(({ name }) => name)).toEqual([
        '启明东校区',
        '启明西校区',
      ]);
      expect(body.meta.total).toBe(2);
      expect(body.data[0]).toEqual(
        expect.objectContaining({
          address: expect.any(String) as unknown,
          latitude: expect.any(Number) as unknown,
          longitude: expect.any(Number) as unknown,
          distanceMeters: expect.any(Number) as unknown,
        }),
      );
      expect(body.data[0]).not.toHaveProperty('warningStudentCount');
      expect(body.data[0]).not.toHaveProperty('mapVisible');
    } finally {
      await prisma.campus.delete({ where: { id: hiddenCampusId } });
    }
  });

  it('requires both parent coordinates and denies non-parent access', async () => {
    await request(server)
      .get('/parents/me/campuses?latitude=28.2')
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(400);
    await request(server)
      .get('/parents/me/campuses')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(403);
  });

  it('updates a campus idempotently with version checks and an audit record', async () => {
    const campus = await prisma.campus.findUniqueOrThrow({
      where: { id: ids.eastCampus },
      select: { version: true },
    });
    const key = `campus-map-${Date.now()}`;
    const body = {
      address: '长沙市岳麓区启明路 20 号',
      latitude: 28.2282,
      longitude: 112.9388,
      mapVisible: true,
      expectedVersion: campus.version,
    };
    const submit = (token: string, requestBody = body, requestKey = key) =>
      request(server)
        .patch(`/management/campuses/${ids.eastCampus}/map-location`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', requestKey)
        .send(requestBody);

    await submit(teacherToken).expect(403);
    const first = await submit(superToken).expect(200);
    const replay = await submit(superToken).expect(200);
    expect((replay.body as Envelope<unknown>).data).toEqual(
      (first.body as Envelope<unknown>).data,
    );
    expect((first.body as Envelope<Record<string, unknown>>).data).toMatchObject({
      id: ids.eastCampus,
      address: body.address,
      latitude: body.latitude,
      longitude: body.longitude,
      mapVisible: true,
      version: campus.version + 1,
    });
    await submit(
      superToken,
      { ...body, expectedVersion: campus.version },
      `${key}-stale`,
    ).expect(409);
    await submit(
      superToken,
      { ...body, latitude: 91, expectedVersion: campus.version + 1 },
      `${key}-invalid`,
    ).expect(400);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'CAMPUS_MAP_LOCATION_UPDATE',
          resourceId: ids.eastCampus,
          outcome: 'SUCCESS',
        },
      }),
    ).resolves.toBe(1);
  });

  it('uploads one campus QR idempotently and exposes it through signed parent media', async () => {
    const campus = await prisma.campus.findUniqueOrThrow({
      where: { id: ids.eastCampus },
      select: { version: true },
    });
    const key = `campus-qr-${Date.now()}`;
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
    ]);
    const upload = (token: string, expectedVersion = campus.version) =>
      request(server)
        .post(`/management/campuses/${ids.eastCampus}/customer-service-qr`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key)
        .field('expectedVersion', String(expectedVersion))
        .attach('file', png, {
          filename: 'customer-service.png',
          contentType: 'image/png',
        });

    await upload(managerToken).expect(403);
    const first = await upload(superToken).expect(200);
    const replay = await upload(superToken).expect(200);
    expect((replay.body as Envelope<unknown>).data).toEqual(
      (first.body as Envelope<unknown>).data,
    );
    const configured = (first.body as Envelope<{
      customerServiceQrCodeUrl: string;
      version: number;
    }>).data;
    expect(configured.version).toBe(campus.version + 1);
    expect(configured.customerServiceQrCodeUrl).toMatch(
      /^\/media\/customer-service-qr\//,
    );

    const campaignResponse = await request(server)
      .get('/parents/me/group-campaigns?page=1&pageSize=20')
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(200);
    const campaigns = (campaignResponse.body as Envelope<Array<{
      customerService: { qrCodeUrl: string | null };
    }>>).data;
    expect(
      new URL(
        campaigns[0]?.customerService.qrCodeUrl ?? '',
        'https://example.test',
      ).pathname,
    ).toBe(
      new URL(configured.customerServiceQrCodeUrl, 'https://example.test')
        .pathname,
    );

    await request(server).get(configured.customerServiceQrCodeUrl).expect(200);
    await request(server)
      .get(
        configured.customerServiceQrCodeUrl.replace(
          /signature=[a-f0-9]+/,
          'signature=bad',
        ),
      )
      .expect(404);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'CUSTOMER_SERVICE_QR_UPDATE',
          resourceId: ids.eastCampus,
          outcome: 'SUCCESS',
        },
      }),
    ).resolves.toBe(1);
  });

  it('rejects stale versions and non-image customer-service files', async () => {
    const campus = await prisma.campus.findUniqueOrThrow({
      where: { id: ids.eastCampus },
      select: { version: true },
    });
    const submit = (
      file: Buffer,
      mime: string,
      version: number,
      suffix: string,
    ) =>
      request(server)
        .post(`/management/campuses/${ids.eastCampus}/customer-service-qr`)
        .set('Authorization', `Bearer ${superToken}`)
        .set('Idempotency-Key', `campus-qr-invalid-${suffix}-${Date.now()}`)
        .field('expectedVersion', String(version))
        .attach('file', file, {
          filename: 'customer-service.png',
          contentType: mime,
        });

    await submit(
      Buffer.from('not-an-image'),
      'image/png',
      campus.version,
      'mime',
    )
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('CUSTOMER_SERVICE_QR_INVALID');
      });
    await submit(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'image/png',
      campus.version + 1,
      'version',
    ).expect(409);
  });

  it('preserves map publication for phone-only edits and clears it after an address change', async () => {
    const current = await prisma.campus.findUniqueOrThrow({
      where: { id: ids.eastCampus },
      select: { version: true },
    });
    const mapResponse = await request(server)
      .patch(`/management/campuses/${ids.eastCampus}/map-location`)
      .set('Authorization', `Bearer ${superToken}`)
      .set('Idempotency-Key', `campus-map-address-${Date.now()}`)
      .send({
        address: '长沙市岳麓区启明路 18 号',
        latitude: 28.2282,
        longitude: 112.9388,
        mapVisible: true,
        expectedVersion: current.version,
      })
      .expect(200);
    const mapVersion = (mapResponse.body as Envelope<{ version: number }>).data
      .version;

    const updateCampus = (body: Record<string, unknown>, key: string) =>
      request(server)
        .patch('/campus-managers/me/campus')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('Idempotency-Key', key)
        .send(body);
    const base = {
      name: '启明东校区',
      address: '长沙市岳麓区启明路 18 号',
      contactPhone: '0731-88880000',
      lessonWarningThresholdUnits: 500,
    };
    const phoneOnly = await updateCampus(
      { ...base, version: mapVersion },
      `campus-map-phone-${Date.now()}`,
    ).expect(200);
    await expect(
      prisma.campus.findUniqueOrThrow({
        where: { id: ids.eastCampus },
        select: { mapVisible: true, latitude: true, longitude: true },
      }),
    ).resolves.toMatchObject({
      mapVisible: true,
      latitude: expect.anything(),
      longitude: expect.anything(),
    });

    const phoneVersion = (phoneOnly.body as Envelope<{ version: number }>).data
      .version;
    await updateCampus(
      {
        ...base,
        address: '长沙市岳麓区新地址 8 号',
        version: phoneVersion,
      },
      `campus-map-address-change-${Date.now()}`,
    ).expect(200);
    await expect(
      prisma.campus.findUniqueOrThrow({
        where: { id: ids.eastCampus },
        select: { mapVisible: true, latitude: true, longitude: true },
      }),
    ).resolves.toEqual({
      mapVisible: false,
      latitude: null,
      longitude: null,
    });
  });
});

async function login(server: Server, code: string): Promise<string> {
  const response = await request(server)
    .post('/auth/login')
    .send({ code })
    .expect(200);
  return (response.body as Envelope<{ accessToken: string }>).data.accessToken;
}
