import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { configureApplication } from '../src/common/bootstrap/configure-app';

const TEST_ENV = {
  NODE_ENV: 'test',
  PORT: '3001',
  DATABASE_URL:
    'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public',
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

interface HealthResponseBody {
  data: {
    status: string;
  };
  requestId: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('GET /health', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
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
  });

  afterAll(async () => app.close());

  it('returns service status with a matching request ID', async () => {
    const response = await request(httpServer).get('/health').expect(200);
    const body = response.body as HealthResponseBody;

    expect(body.data.status).toBe('ok');
    expect(body.requestId).toMatch(UUID_PATTERN);
    expect(response.get('x-request-id')).toBe(body.requestId);
  });

  it('reuses a caller-provided request ID', async () => {
    const requestId = 'checkpoint-a-request';

    const response = await request(httpServer)
      .get('/health')
      .set('X-Request-Id', requestId)
      .expect(200);
    const body = response.body as HealthResponseBody;

    expect(body.requestId).toBe(requestId);
    expect(response.get('x-request-id')).toBe(requestId);
  });

  it.each([
    ['an invalid value', 'request/id with spaces'],
    ['an overlong value', 'a'.repeat(129)],
  ])('replaces %s with a generated UUID', async (_label, suppliedId) => {
    const response = await request(httpServer)
      .get('/health')
      .set('X-Request-Id', suppliedId)
      .expect(200);
    const body = response.body as HealthResponseBody;

    expect(body.requestId).not.toBe(suppliedId);
    expect(body.requestId).toMatch(UUID_PATTERN);
    expect(response.get('x-request-id')).toBe(body.requestId);
  });
});
