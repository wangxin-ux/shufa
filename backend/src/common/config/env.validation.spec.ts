import { validateEnvironment } from './env.validation';

const validEnvironment = () => ({
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
});

describe('validateEnvironment', () => {
  it('returns a typed configuration for an explicit valid test fixture', () => {
    expect(validateEnvironment(validEnvironment())).toMatchObject({
      NODE_ENV: 'test',
      PORT: 3001,
      FILE_STORAGE_DRIVER: 'local',
      AUTH_DRIVER: 'mock',
      PAYMENT_DRIVER: 'mock',
      PAYOUT_DRIVER: 'manual',
      MESSAGE_DRIVER: 'mock',
    });
  });

  it.each([
    ['NODE_ENV', 'preview'],
    ['PORT', '0'],
    ['PORT', '65536'],
    ['DATABASE_URL', 'mysql://localhost/database'],
    ['REDIS_URL', 'http://localhost:6379'],
    ['FILE_STORAGE_DRIVER', 'memory'],
    ['AUTH_DRIVER', 'fake'],
    ['PAYMENT_DRIVER', 'cash'],
    ['PAYOUT_DRIVER', 'mock'],
    ['MESSAGE_DRIVER', 'email'],
    ['TZ', 'Mars/Olympus'],
  ])('rejects an invalid %s', (key, value) => {
    expect(() =>
      validateEnvironment({ ...validEnvironment(), [key]: value }),
    ).toThrow(`Invalid environment configuration: ${key}`);
  });

  it('requires the configured local storage root', () => {
    const environment = validEnvironment();
    delete (environment as Partial<typeof environment>).FILE_STORAGE_ROOT;

    expect(() => validateEnvironment(environment)).toThrow(
      'Invalid environment configuration: FILE_STORAGE_ROOT',
    );
  });

  it.each(['AUTH_DRIVER', 'PAYMENT_DRIVER', 'MESSAGE_DRIVER'])(
    'rejects mock %s in production',
    (key) => {
      expect(() =>
        validateEnvironment({
          ...validEnvironment(),
          NODE_ENV: 'production',
          AUTH_DRIVER: 'wechat',
          PAYMENT_DRIVER: 'wechat',
          MESSAGE_DRIVER: 'wechat',
          [key]: 'mock',
        }),
      ).toThrow(`Invalid environment configuration: ${key}`);
    },
  );

  it.each(['replace_in_local_env', 'change-me', 'secret'])(
    'rejects the placeholder secret %s in production',
    (secret) => {
      expect(() =>
        validateEnvironment({
          ...validEnvironment(),
          NODE_ENV: 'production',
          AUTH_DRIVER: 'wechat',
          PAYMENT_DRIVER: 'wechat',
          MESSAGE_DRIVER: 'wechat',
          JWT_ACCESS_SECRET: secret,
        }),
      ).toThrow('Invalid environment configuration: JWT_ACCESS_SECRET');
    },
  );

  it('requires different access and refresh secrets in production', () => {
    const sharedSecret = 'a-production-secret-with-at-least-32-characters';

    expect(() =>
      validateEnvironment({
        ...validEnvironment(),
        NODE_ENV: 'production',
        AUTH_DRIVER: 'wechat',
        PAYMENT_DRIVER: 'wechat',
        MESSAGE_DRIVER: 'wechat',
        JWT_ACCESS_SECRET: sharedSecret,
        JWT_REFRESH_SECRET: sharedSecret,
      }),
    ).toThrow(
      'Invalid environment configuration: JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET',
    );
  });

  it('requires merchant credentials when WeChat payment is selected', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment(),
        PAYMENT_DRIVER: 'wechat',
      }),
    ).toThrow('Invalid environment configuration: WECHAT_APP_ID');
  });

  it('accepts a complete WeChat payment configuration', () => {
    expect(
      validateEnvironment({
        ...validEnvironment(),
        PAYMENT_DRIVER: 'wechat',
        WECHAT_APP_ID: 'wx-demo-app-id',
        WECHAT_MCH_ID: '1900000001',
        WECHAT_PAY_API_V3_KEY: '0123456789abcdef0123456789abcdef',
        WECHAT_PAY_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----demo',
        WECHAT_PAY_CERT_SERIAL_NO: '7777777777777777777777777777777777777777',
        WECHAT_PAY_PLATFORM_CERT: '-----BEGIN CERTIFICATE-----demo',
        WECHAT_PAY_NOTIFY_URL: 'https://example.test/payments/wechat/notify',
      }),
    ).toMatchObject({
      PAYMENT_DRIVER: 'wechat',
      WECHAT_APP_ID: 'wx-demo-app-id',
      WECHAT_MCH_ID: '1900000001',
      WECHAT_PAY_NOTIFY_URL: 'https://example.test/payments/wechat/notify',
    });
  });

  it('requires AppID and AppSecret when WeChat authentication is selected', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment(),
        AUTH_DRIVER: 'wechat',
      }),
    ).toThrow('Invalid environment configuration: WECHAT_APP_ID');

    expect(() =>
      validateEnvironment({
        ...validEnvironment(),
        AUTH_DRIVER: 'wechat',
        WECHAT_APP_ID: 'wx-demo-app-id',
      }),
    ).toThrow('Invalid environment configuration: WECHAT_APP_SECRET');
  });

  it('accepts server-only WeChat authentication credentials', () => {
    expect(
      validateEnvironment({
        ...validEnvironment(),
        AUTH_DRIVER: 'wechat',
        WECHAT_APP_ID: 'wx-demo-app-id',
        WECHAT_APP_SECRET: 'server-only-app-secret',
      }),
    ).toMatchObject({
      AUTH_DRIVER: 'wechat',
      WECHAT_APP_ID: 'wx-demo-app-id',
      WECHAT_APP_SECRET: 'server-only-app-secret',
    });
  });
});
