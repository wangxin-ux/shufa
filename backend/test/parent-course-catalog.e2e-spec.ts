import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';
import { DomainError } from '../src/common/errors/domain-error';
import { ErrorCode } from '../src/common/errors/error-codes';

const databaseUrl = process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';
const target = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    !target.pathname.endsWith('_test')) {
  throw new Error('Catalog tests require a local *_test database');
}
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: databaseUrl, PORT: '3001',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_ROOT: './storage/test',
  AUTH_DRIVER: 'mock', PAYMENT_DRIVER: 'mock', PAYOUT_DRIVER: 'manual', MESSAGE_DRIVER: 'mock',
});

describe('parent PDF catalog and product management', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let adminToken: string;
  let parentToken: string;
  let teacherToken: string;
  let campusId: string;
  let hiddenCampusId: string;
  let productId: string;
  const courseName = `目录书法-${randomUUID()}`;
  const userIds: string[] = [];
  const products: string[] = [];

  beforeAll(async () => {
    const { AppModule } = jest.requireActual<typeof import('../src/app.module')>('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    campusId = (await prisma.campus.create({ data: {
      code: `CAT-${randomUUID()}`, name: '公开目录校区', address: '测试路 1 号',
      mapVisible: true, latitude: 28.2, longitude: 112.9,
    } })).id;
    hiddenCampusId = (await prisma.campus.create({ data: {
      code: `CAT-${randomUUID()}`, name: '未公开目录校区',
    } })).id;
    for (const roleCode of ['SUPER_ADMIN', 'PARENT', 'TEACHER'] as const) {
      const user = await prisma.user.create({ data: {
        displayName: `目录测试${roleCode}`,
        roles: { create: { roleCode, campusId: roleCode === 'SUPER_ADMIN' ? null : campusId } },
      } });
      userIds.push(user.id);
      const token = (await app.get(AuthService).issueSessionForUser(user.id)).accessToken;
      if (roleCode === 'SUPER_ADMIN') adminToken = token;
      else if (roleCode === 'PARENT') parentToken = token;
      else teacherToken = token;
    }
  }, 60000);

  afterAll(async () => {
    if (prisma) {
      await prisma.courseProduct.updateMany({ where: { id: { in: products } }, data: { status: 'RETIRED' } });
      if (campusId) await prisma.campus.update({ where: { id: campusId }, data: { mapVisible: false } });
      await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { status: 'DISABLED' } });
    }
    await app?.close();
  });

  const input = () => ({
    campusId, name: '书法常规课包', courseName, classType: '常规班', summary: '书写基础课程',
    priceFen: 388000, mainUnits: 4800, giftUnits: 1200, validityDays: 365,
  });
  const mutation = (url: string, data: object, key = randomUUID()) =>
    request(server).post(url).auth(adminToken, { type: 'bearer' }).set('Idempotency-Key', key).send(data);
  const catalog = () => request(server).get('/parents/me/course-catalog')
    .query({ page: 1, pageSize: 100, courseName }).auth(parentToken, { type: 'bearer' });

  it('creates a draft idempotently and keeps it out of the public catalog', async () => {
    const key = randomUUID();
    const response = await mutation('/management/course-products', input(), key).expect(200);
    productId = response.body.data.id;
    products.push(productId);
    expect(response.body.data).toMatchObject({ courseName, classType: '常规班', status: 'DRAFT', version: 1 });
    const replay = await mutation('/management/course-products', input(), key).expect(200);
    expect(replay.body.data.id).toBe(productId);
    expect((await catalog().expect(200)).body.data).toEqual([]);
  });

  it('checks stale versions, exposes activated quotes, and never compares distinct lesson bases by price', async () => {
    await mutation(`/management/course-products/${productId}/activate`, { expectedVersion: 9 }).expect(409);
    await mutation(`/management/course-products/${productId}/activate`, { expectedVersion: 1 }).expect(200);
    const other = await mutation('/management/course-products', {
      ...input(), name: '一对一书法', classType: '一对一', priceFen: 15000, mainUnits: 100, giftUnits: 0,
    }).expect(200);
    products.push(other.body.data.id);
    await mutation(`/management/course-products/${other.body.data.id}/activate`, { expectedVersion: 1 }).expect(200);
    const response = await catalog().expect(200);
    expect(response.body.meta.total).toBe(1);
    expect(response.body.data[0]).toMatchObject({
      courseName, primaryQuote: { productId, priceFen: 388000, mainUnits: 4800, classType: '常规班' },
    });
    expect(response.body.data[0].classTypes).toHaveLength(2);
    const quote = response.body.data[0].classTypes[0].quotes[0];
    expect(quote.campus).toMatchObject({ id: campusId, name: '公开目录校区', latitude: 28.2, longitude: 112.9 });
    expect(quote.campus).not.toHaveProperty('code');
    expect(quote).not.toHaveProperty('createdByUserId');
  });

  it('excludes unpublished campuses and enforces role and validation boundaries', async () => {
    const hidden = await mutation('/management/course-products', { ...input(), campusId: hiddenCampusId }).expect(200);
    products.push(hidden.body.data.id);
    await mutation(`/management/course-products/${hidden.body.data.id}/activate`, { expectedVersion: 1 }).expect(200);
    const response = await catalog().expect(200);
    expect(response.body.data[0].classTypes.flatMap((item: { quotes: Array<{ campus: { id: string } }> }) => item.quotes)
      .every((quote: { campus: { id: string } }) => quote.campus.id === campusId)).toBe(true);
    await request(server).get('/parents/me/course-catalog').auth(teacherToken, { type: 'bearer' }).expect(403);
    await request(server).get('/parents/me/course-catalog').expect(401);
    await request(server).post('/management/course-products').auth(parentToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID()).send(input()).expect(403);
    await mutation('/management/course-products', { ...input(), priceFen: 1.5 }).expect(400);
    await mutation('/management/course-products', { ...input(), courseName: '  ' }).expect(400);
    await request(server).get('/parents/me/course-catalog').query({ page: 0 }).auth(parentToken, { type: 'bearer' }).expect(400);
  });

  it('updates only drafts, records audits, retires without touching historical products, and replays transitions', async () => {
    await request(server).patch(`/management/course-products/${productId}`).auth(adminToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID()).send({ ...input(), expectedVersion: 2 }).expect(409);
    const draft = await mutation('/management/course-products', input()).expect(200);
    products.push(draft.body.data.id);
    const updated = await request(server).patch(`/management/course-products/${draft.body.data.id}`)
      .auth(adminToken, { type: 'bearer' }).set('Idempotency-Key', randomUUID())
      .send({ ...input(), classType: '学习班', expectedVersion: 1 }).expect(200);
    expect(updated.body.data.version).toBe(2);
    const key = randomUUID();
    const retired = await mutation(`/management/course-products/${productId}/retire`, { expectedVersion: 2 }, key).expect(200);
    expect(retired.body.data.status).toBe('RETIRED');
    expect((await mutation(`/management/course-products/${productId}/retire`, { expectedVersion: 2 }, key).expect(200)).body.data)
      .toEqual(retired.body.data);
    await mutation(`/management/course-products/${productId}/activate`, { expectedVersion: 3 }).expect(409);
    expect(await prisma.auditLog.count({ where: { resourceType: 'CourseProduct', resourceId: productId } })).toBe(3);
  });

  it('replays a draft update even when its campus changed', async () => {
    const created = await mutation('/management/course-products', input()).expect(200);
    products.push(created.body.data.id);
    const key = randomUUID();
    const update = () => request(server).patch(`/management/course-products/${created.body.data.id}`)
      .auth(adminToken, { type: 'bearer' }).set('Idempotency-Key', key)
      .send({ ...input(), campusId: hiddenCampusId, expectedVersion: 1 });
    const changed = await update().expect(200);
    expect((await update().expect(200)).body.data).toEqual(changed.body.data);
  });

  it('serializes competing lifecycle changes and concurrent same-key creates', async () => {
    const key = randomUUID();
    const sameKey = await Promise.all([
      mutation('/management/course-products', input(), key),
      mutation('/management/course-products', input(), key),
    ]);
    expect(sameKey.map((response) => response.status)).toEqual([200, 200]);
    expect(sameKey[0].body.data.id).toBe(sameKey[1].body.data.id);
    const id = sameKey[0].body.data.id;
    products.push(id);
    const results = await Promise.all([
      mutation(`/management/course-products/${id}/activate`, { expectedVersion: 1 }),
      mutation(`/management/course-products/${id}/retire`, { expectedVersion: 1 }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await prisma.auditLog.count({ where: { resourceType: 'CourseProduct', resourceId: id } })).toBe(2);
  });

  it('rolls back status, audit and idempotency together when completion fails', async () => {
    const created = await mutation('/management/course-products', input()).expect(200);
    const id = created.body.data.id;
    products.push(id);
    const key = randomUUID();
    const complete = jest.spyOn(app.get(IdempotencyService), 'complete')
      .mockRejectedValueOnce(new DomainError(ErrorCode.CONFLICT, '测试事务失败', 409));
    try {
      await mutation(`/management/course-products/${id}/activate`, { expectedVersion: 1 }, key).expect(409);
    } finally {
      complete.mockRestore();
    }
    expect(await prisma.courseProduct.findUnique({ where: { id }, select: { status: true, version: true } }))
      .toEqual({ status: 'DRAFT', version: 1 });
    expect(await prisma.auditLog.count({ where: { resourceType: 'CourseProduct', resourceId: id } })).toBe(1);
    expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(0);
    await mutation(`/management/course-products/${id}/activate`, { expectedVersion: 1 }, key).expect(200);
  });
});
