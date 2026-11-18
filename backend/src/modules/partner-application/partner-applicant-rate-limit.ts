import { createHash } from 'node:crypto';
import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';

export const PARTNER_APPLICANT_RATE_LIMIT = 'PARTNER_APPLICANT_RATE_LIMIT';
export interface ApplicantAdmission {
  check(ip: string): Promise<void>;
}

type AdmissionRedis = Pick<Redis, 'eval' | 'quit' | 'status'>;
type RedisFactory = (url: string) => AdmissionRedis;
const createRedis: RedisFactory = (url) => {
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: true,
    maxRetriesPerRequest: 0,
    connectTimeout: 1500,
    commandTimeout: 1500,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);
  return client;
};
const COUNT_ADMISSION = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count
`;

@Injectable()
export class PartnerApplicantRateLimit
  implements ApplicantAdmission, OnModuleDestroy
{
  private redis?: AdmissionRedis;

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject('PARTNER_APPLICANT_REDIS_FACTORY')
    private readonly factory: RedisFactory = createRedis,
  ) {}

  async check(ip: string): Promise<void> {
    let count: unknown;
    try {
      if (this.redis?.status === 'end') this.redis = undefined;
      this.redis ??= this.factory(this.config.getOrThrow<string>('REDIS_URL'));
      count = await this.redis.eval(
        COUNT_ADMISSION,
        1,
        `partner-applicant:admission:${createHash('sha256').update(ip).digest('hex')}`,
        60_000,
      );
      if (
        typeof count !== 'number' ||
        !Number.isSafeInteger(count) ||
        count < 1
      )
        throw new Error();
    } catch {
      throw new DomainError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        '登录服务暂不可用，请稍后重试',
        503,
      );
    }
    if (count > 30) {
      throw new DomainError(
        ErrorCode.TOO_MANY_REQUESTS,
        '登录过于频繁，请稍后重试',
        429,
      );
    }
  }

  async onModuleDestroy() {
    if (this.redis) await this.redis.quit().catch(() => undefined);
  }
}
