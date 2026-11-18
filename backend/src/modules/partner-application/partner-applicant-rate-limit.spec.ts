import { PartnerApplicantRateLimit } from './partner-applicant-rate-limit';
import Redis from 'ioredis';

jest.mock('ioredis', () =>
  jest.fn(() => ({
    eval: jest.fn().mockResolvedValue(1),
    quit: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
  })),
);

describe('applicant login admission', () => {
  const evalScript = jest.fn();
  const quit = jest.fn().mockResolvedValue('OK');
  const config = {
    getOrThrow: jest.fn().mockReturnValue('redis://127.0.0.1:6379'),
  };
  const createRedis = jest.fn(() => ({
    eval: evalScript,
    quit,
    status: 'wait',
  }));
  let admission: PartnerApplicantRateLimit;

  beforeEach(() => {
    jest.clearAllMocks();
    admission = new PartnerApplicantRateLimit(
      config as never,
      createRedis as never,
    );
  });

  it('atomically counts admission and hashes the network identity', async () => {
    evalScript.mockResolvedValue(1);
    await admission.check('203.0.113.8');
    expect(evalScript).toHaveBeenCalledWith(
      expect.stringContaining('PEXPIRE'),
      1,
      expect.stringMatching(/^partner-applicant:admission:[a-f0-9]{64}$/),
      60_000,
    );
    expect(JSON.stringify(evalScript.mock.calls)).not.toContain('203.0.113.8');
  });

  it('rejects excess admission without retries', async () => {
    evalScript.mockResolvedValue(31);
    await expect(admission.check('203.0.113.8')).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      statusCode: 429,
    });
    expect(evalScript).toHaveBeenCalledTimes(1);
  });

  it('fails closed when Redis is unavailable', async () => {
    evalScript.mockRejectedValue(new Error('connection unavailable'));
    await expect(admission.check('203.0.113.8')).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      statusCode: 503,
    });
    expect(evalScript).toHaveBeenCalledTimes(1);
  });

  it('fails closed on a malformed Redis result', async () => {
    evalScript.mockResolvedValue(null);
    await expect(admission.check('203.0.113.8')).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('does not connect until admission and closes the owned client', async () => {
    expect(createRedis).not.toHaveBeenCalled();
    evalScript.mockResolvedValue(1);
    await admission.check('203.0.113.8');
    await admission.onModuleDestroy();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('lets the first bounded command wait for the lazy connection', async () => {
    const defaultAdmission = new PartnerApplicantRateLimit(config as never);
    await defaultAdmission.check('203.0.113.8');
    expect(Redis).toHaveBeenCalledWith(
      'redis://127.0.0.1:6379',
      expect.objectContaining({
        lazyConnect: true,
        enableOfflineQueue: true,
        maxRetriesPerRequest: 0,
        connectTimeout: 1500,
        commandTimeout: 1500,
      }),
    );
    await defaultAdmission.onModuleDestroy();
  });

  it('recreates an ended client on the next admission after Redis recovers', async () => {
    evalScript.mockRejectedValueOnce(new Error('synthetic disconnect'));
    await expect(admission.check('203.0.113.8')).rejects.toMatchObject({
      statusCode: 503,
    });
    const client = createRedis.mock.results[0].value as ReturnType<
      typeof createRedis
    >;
    client.status = 'end';
    evalScript.mockResolvedValue(1);
    await admission.check('203.0.113.8');
    expect(createRedis).toHaveBeenCalledTimes(2);
  });
});
