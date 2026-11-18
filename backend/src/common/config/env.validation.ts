type Environment = Record<string, unknown>;

const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
const FILE_STORAGE_DRIVERS = ['local', 'cos', 'oss'] as const;
const AUTH_DRIVERS = ['mock', 'wechat'] as const;
const PAYMENT_DRIVERS = ['mock', 'wechat'] as const;
const PAYOUT_DRIVERS = ['manual', 'wechat', 'bank'] as const;
const MESSAGE_DRIVERS = ['mock', 'wechat'] as const;
const TIME_ZONES = ['Asia/Shanghai'] as const;

function configurationError(key: string, reason: string): never {
  throw new Error(`Invalid environment configuration: ${key} ${reason}`);
}

function requiredString(environment: Environment, key: string): string {
  const value = environment[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    configurationError(key, 'is required');
  }

  return value.trim();
}

function enumValue<const T extends readonly string[]>(
  environment: Environment,
  key: string,
  values: T,
): T[number] {
  const value = requiredString(environment, key);
  if (!values.includes(value)) {
    configurationError(key, `must be one of: ${values.join(', ')}`);
  }

  return value;
}

function urlValue(
  environment: Environment,
  key: string,
  protocols: readonly string[],
): string {
  const value = requiredString(environment, key);
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    configurationError(key, 'must be a valid URL');
  }

  if (!protocols.includes(parsed.protocol)) {
    configurationError(key, `must use ${protocols.join(' or ')}`);
  }

  return value;
}

function portValue(environment: Environment): number {
  const rawPort = requiredString(environment, 'PORT');
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    configurationError('PORT', 'must be an integer between 1 and 65535');
  }

  return port;
}

function credentialSource(environment: Environment, key: string): Environment {
  const inline = environment[key];
  const file = environment[`${key}_FILE`];
  const hasInline = typeof inline === 'string' && inline.trim().length > 0;
  const hasFile = typeof file === 'string' && file.trim().length > 0;
  if (hasInline === hasFile) {
    configurationError(key, 'requires exactly one inline value or _FILE path');
  }
  return hasInline
    ? { [key]: requiredString(environment, key) }
    : { [`${key}_FILE`]: requiredString(environment, `${key}_FILE`) };
}

function paymentConfiguration(environment: Environment): Environment {
  const configuration: Environment = {
    WECHAT_APP_ID: requiredString(environment, 'WECHAT_APP_ID'),
    WECHAT_MCH_ID: requiredString(environment, 'WECHAT_MCH_ID'),
    ...credentialSource(environment, 'WECHAT_PAY_API_V3_KEY'),
    ...credentialSource(environment, 'WECHAT_PAY_PRIVATE_KEY'),
    WECHAT_PAY_CERT_SERIAL_NO: requiredString(
      environment,
      'WECHAT_PAY_CERT_SERIAL_NO',
    ),
    WECHAT_PAY_NOTIFY_URL: urlValue(environment, 'WECHAT_PAY_NOTIFY_URL', [
      'https:',
    ]),
  };
  if (
    typeof configuration.WECHAT_PAY_API_V3_KEY === 'string' &&
    Buffer.byteLength(configuration.WECHAT_PAY_API_V3_KEY, 'utf8') !== 32
  ) {
    configurationError(
      'WECHAT_PAY_API_V3_KEY',
      'must contain exactly 32 bytes',
    );
  }
  const publicKeyMode = [
    'WECHAT_PAY_PUBLIC_KEY_ID',
    'WECHAT_PAY_PUBLIC_KEY',
    'WECHAT_PAY_PUBLIC_KEY_FILE',
  ].some(
    (key) =>
      typeof environment[key] === 'string' &&
      environment[key].trim().length > 0,
  );
  if (publicKeyMode) {
    configuration.WECHAT_PAY_PUBLIC_KEY_ID = requiredString(
      environment,
      'WECHAT_PAY_PUBLIC_KEY_ID',
    );
    if (
      !/^PUB_KEY_ID_\d+$/.test(configuration.WECHAT_PAY_PUBLIC_KEY_ID as string)
    ) {
      configurationError(
        'WECHAT_PAY_PUBLIC_KEY_ID',
        'must use PUB_KEY_ID_ followed by digits',
      );
    }
    Object.assign(
      configuration,
      credentialSource(environment, 'WECHAT_PAY_PUBLIC_KEY'),
    );
    if (
      typeof environment.WECHAT_PAY_PLATFORM_CERT === 'string' &&
      environment.WECHAT_PAY_PLATFORM_CERT.trim()
    ) {
      configurationError(
        'WECHAT_PAY_PLATFORM_CERT',
        'cannot be combined with public-key mode',
      );
    }
  } else {
    configuration.WECHAT_PAY_PLATFORM_CERT = requiredString(
      environment,
      'WECHAT_PAY_PLATFORM_CERT',
    );
  }
  return configuration;
}

function secretValue(
  environment: Environment,
  key: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET',
  nodeEnvironment: (typeof NODE_ENVIRONMENTS)[number],
): string {
  const value = requiredString(environment, key);
  if (value.length < 16) {
    configurationError(key, 'must contain at least 16 characters');
  }

  if (
    nodeEnvironment === 'production' &&
    (value.length < 32 ||
      /replace.*local.*env|change.?me|placeholder|^secret$/i.test(value))
  ) {
    configurationError(
      key,
      'must be a non-placeholder secret of 32 characters',
    );
  }

  return value;
}

export function validateEnvironment(environment: Environment): Environment {
  const nodeEnvironment = enumValue(environment, 'NODE_ENV', NODE_ENVIRONMENTS);
  const fileStorageDriver = enumValue(
    environment,
    'FILE_STORAGE_DRIVER',
    FILE_STORAGE_DRIVERS,
  );
  const authDriver = enumValue(environment, 'AUTH_DRIVER', AUTH_DRIVERS);
  const paymentDriver = enumValue(
    environment,
    'PAYMENT_DRIVER',
    PAYMENT_DRIVERS,
  );
  const payoutDriver = enumValue(environment, 'PAYOUT_DRIVER', PAYOUT_DRIVERS);
  const messageDriver = enumValue(
    environment,
    'MESSAGE_DRIVER',
    MESSAGE_DRIVERS,
  );
  const timeZone = enumValue(environment, 'TZ', TIME_ZONES);

  if (nodeEnvironment === 'production') {
    for (const [key, value] of [
      ['AUTH_DRIVER', authDriver],
      ['PAYMENT_DRIVER', paymentDriver],
      ['MESSAGE_DRIVER', messageDriver],
    ] as const) {
      if (value === 'mock') {
        configurationError(key, 'cannot use a mock adapter in production');
      }
    }
  }

  const jwtAccessSecret = secretValue(
    environment,
    'JWT_ACCESS_SECRET',
    nodeEnvironment,
  );
  const jwtRefreshSecret = secretValue(
    environment,
    'JWT_REFRESH_SECRET',
    nodeEnvironment,
  );
  if (
    nodeEnvironment === 'production' &&
    jwtAccessSecret === jwtRefreshSecret
  ) {
    configurationError(
      'JWT_REFRESH_SECRET',
      'must differ from JWT_ACCESS_SECRET',
    );
  }

  const wechatAuthConfiguration =
    authDriver === 'wechat'
      ? {
          WECHAT_APP_ID: requiredString(environment, 'WECHAT_APP_ID'),
          WECHAT_APP_SECRET: requiredString(environment, 'WECHAT_APP_SECRET'),
        }
      : {};

  const wechatPaymentConfiguration =
    paymentDriver === 'wechat' ? paymentConfiguration(environment) : {};

  const validated: Environment = {
    ...environment,
    NODE_ENV: nodeEnvironment,
    PORT: portValue(environment),
    DATABASE_URL: urlValue(environment, 'DATABASE_URL', [
      'postgres:',
      'postgresql:',
    ]),
    REDIS_URL: urlValue(environment, 'REDIS_URL', ['redis:', 'rediss:']),
    JWT_ACCESS_SECRET: jwtAccessSecret,
    JWT_REFRESH_SECRET: jwtRefreshSecret,
    FILE_STORAGE_DRIVER: fileStorageDriver,
    AUTH_DRIVER: authDriver,
    PAYMENT_DRIVER: paymentDriver,
    PAYOUT_DRIVER: payoutDriver,
    MESSAGE_DRIVER: messageDriver,
    TZ: timeZone,
    ...wechatAuthConfiguration,
    ...wechatPaymentConfiguration,
  };

  if (fileStorageDriver === 'local') {
    validated.FILE_STORAGE_ROOT = requiredString(
      environment,
      'FILE_STORAGE_ROOT',
    );
  }

  return validated;
}
