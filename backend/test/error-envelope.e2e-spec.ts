import {
  Body,
  Controller,
  Get,
  HttpException,
  INestApplication,
  Logger,
  Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsInt, IsString } from 'class-validator';
import type { Server } from 'node:http';
import request from 'supertest';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { DomainError } from '../src/common/errors/domain-error';
import { ErrorCode } from '../src/common/errors/error-codes';
import { IdempotencyKey } from '../src/common/idempotency/idempotency-key.decorator';

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

class ValidationBody {
  @IsString()
  name!: string;
}

class TransformBody {
  @Type(() => Number)
  @IsInt()
  count!: number;
}

@Controller('__test')
class ErrorTestController {
  @Get('domain-error')
  throwDomainError() {
    throw new DomainError(
      ErrorCode.CONFLICT,
      'The resource is already in that state',
      409,
      { state: 'confirmed' },
    );
  }

  @Get('unexpected-error')
  throwUnexpectedError() {
    throw new Error('sensitive implementation detail');
  }

  @Get('domain-server-error')
  throwDomainServerError() {
    throw new DomainError(ErrorCode.CONFLICT, 'sensitive domain error', 503, {
      secret: 'domain details',
    });
  }

  @Get('http-server-error')
  throwHttpServerError() {
    throw new HttpException(
      { message: ['sensitive nested message'], error: 'Internal Server Error' },
      500,
    );
  }

  @Get('unmapped-client-error')
  throwUnmappedClientError() {
    throw new HttpException('The entity cannot be processed', 422);
  }

  @Post('validation')
  validateBody(@Body() body: ValidationBody) {
    return body;
  }

  @Post('transform')
  transformBody(@Body() body: TransformBody) {
    return { count: body.count, valueType: typeof body.count };
  }

  @Post('idempotency')
  readIdempotencyKey(@IdempotencyKey() key: string) {
    return { key };
  }
}

describe('error response envelope', () => {
  let app: INestApplication;
  let httpServer: Server;
  let loggerErrorSpy: jest.SpyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    const { AppModule } =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      );
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ErrorTestController],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  it('preserves HTTP 404 and returns the shared error shape', async () => {
    const response = await request(httpServer)
      .get('/resources/that-do-not-exist')
      .expect(404);

    expect(response.body as unknown).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      message: expect.any(String) as unknown,
      requestId: expect.any(String) as unknown,
      details: expect.any(Object) as unknown,
    });
  });

  it('preserves a domain error status and details', async () => {
    const response = await request(httpServer)
      .get('/__test/domain-error')
      .expect(409);

    expect(response.body as unknown).toEqual({
      code: 'CONFLICT',
      message: 'The resource is already in that state',
      requestId: expect.any(String) as unknown,
      details: { state: 'confirmed' },
    });
  });

  it('maps validation errors without accepting unknown fields', async () => {
    const response = await request(httpServer)
      .post('/__test/validation')
      .send({ name: 'student', unexpected: true })
      .expect(400);

    expect(response.body as unknown).toEqual({
      code: 'VALIDATION_FAILED',
      message: expect.any(String) as unknown,
      requestId: expect.any(String) as unknown,
      details: expect.objectContaining({
        errors: expect.any(Array) as unknown,
      }) as unknown,
    });
  });

  it('does not expose stack traces or unexpected exception messages', async () => {
    const response = await request(httpServer)
      .get('/__test/unexpected-error')
      .expect(500);

    expect(response.body as unknown).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      requestId: expect.any(String) as unknown,
      details: {},
    });
    expect(JSON.stringify(response.body)).not.toContain(
      'sensitive implementation detail',
    );
  });

  it('logs an unexpected server error with its request ID', async () => {
    const response = await request(httpServer)
      .get('/__test/unexpected-error')
      .expect(500);
    const responseBody = response.body as { requestId: unknown };

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: String(responseBody.requestId),
        statusCode: 500,
        method: 'GET',
        path: '/__test/unexpected-error',
        exceptionType: 'Error',
      }),
    );
  });

  it('uses a client error code for an otherwise unmapped 4xx response', async () => {
    const response = await request(httpServer)
      .get('/__test/unmapped-client-error')
      .expect(422);

    expect(response.body as unknown).toEqual({
      code: 'BAD_REQUEST',
      message: 'The entity cannot be processed',
      requestId: expect.any(String) as unknown,
      details: {},
    });
  });

  it('sanitizes a DomainError with a server error status', async () => {
    const response = await request(httpServer)
      .get('/__test/domain-server-error')
      .expect(503);

    expect(response.body as unknown).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      requestId: expect.any(String) as unknown,
      details: {},
    });
    expect(JSON.stringify(response.body)).not.toContain('sensitive');
    expect(JSON.stringify(response.body)).not.toContain('domain details');
  });

  it('sanitizes nested details from an HttpException with a server error status', async () => {
    const response = await request(httpServer)
      .get('/__test/http-server-error')
      .expect(500);

    expect(response.body as unknown).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      requestId: expect.any(String) as unknown,
      details: {},
    });
    expect(JSON.stringify(response.body)).not.toContain('sensitive');
  });

  it('transforms DTO fields before invoking the controller', async () => {
    const response = await request(httpServer)
      .post('/__test/transform')
      .send({ count: '2' })
      .expect(201);

    expect(response.body as unknown).toEqual({
      data: { count: 2, valueType: 'number' },
      requestId: expect.any(String) as unknown,
    });
  });

  it('routes an invalid idempotency key through the shared error envelope', async () => {
    const response = await request(httpServer)
      .post('/__test/idempotency')
      .set('Idempotency-Key', 'invalid key')
      .expect(400);

    expect(response.body as unknown).toEqual({
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: expect.any(String) as unknown,
      requestId: expect.any(String) as unknown,
      details: {
        header: 'Idempotency-Key',
        minLength: 8,
        maxLength: 128,
      },
    });
  });

  it('requires an idempotency key on an endpoint that declares it', async () => {
    const response = await request(httpServer)
      .post('/__test/idempotency')
      .expect(400);

    expect(response.body as unknown).toEqual({
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: expect.any(String) as unknown,
      requestId: expect.any(String) as unknown,
      details: {
        header: 'Idempotency-Key',
        minLength: 8,
        maxLength: 128,
      },
    });
  });
});
