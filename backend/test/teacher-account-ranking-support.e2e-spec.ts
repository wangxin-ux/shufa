import { readFileSync } from 'node:fs';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTeacherFixtureUser } from './support/teacher-feedback-integration-app';

jest.mock('node:fs', () => ({
  ...jest.requireActual<typeof import('node:fs')>('node:fs'),
  readFileSync: jest.fn(),
}));

const execution = '64005a1a-eb42-444d-a36e-447bd4c82b5f';
const campusId = '11ce4b05-0065-4548-8b88-a615f46ca439';
const userId = '8431fd78-bd97-457b-b345-922fc110d3c9';
const variables = {
  NODE_ENV: 'test',
  AUTH_DRIVER: 'mock',
  PAYMENT_DRIVER: 'mock',
  MESSAGE_DRIVER: 'mock',
  DATABASE_URL:
    'postgresql://carchive:synthetic@127.0.0.1:55437/education_app_test_campus_archive_20261027_test',
  CAMPUS_ARCHIVE_TEST_DB_NAME:
    'education_app_test_campus_archive_20261027_test',
  TEACHER_FEEDBACK_INTEGRATION_EXECUTION: execution,
  TEACHER_FEEDBACK_INTEGRATION_EVIDENCE: '/synthetic-not-read',
  TEACHER_FEEDBACK_RESOURCE_RUN: 'archive-4534b1ea9d',
  TEACHER_PDF_TEST_RUN_ID: `main${execution.replaceAll('-', '').slice(0, 12)}`,
  TEACHER_PDF_NATIVE_ENABLED: 'false',
  TEACHER_PDF_NATIVE_HISTORICAL_ONLY: 'false',
  TEACHER_ACCOUNT_RANKING_INTEGRATION_ENABLED: '1',
};
let original: Record<string, string | undefined>;

beforeEach(() => {
  original = Object.fromEntries(
    Object.keys(variables).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, variables);
  jest.mocked(readFileSync).mockReturnValue(
    JSON.stringify({
      execution,
      purpose: 'teacher-account-rankings',
      oldUserIds: [],
      oldCampusIds: [],
    }),
  );
});

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  jest.clearAllMocks();
});

function fixture(displayName = 'trank-20261025-1234abcd-本人') {
  const user = {
    id: userId,
    displayName,
    roles: [{ roleCode: 'TEACHER', campusId }],
    teacherProfile: { id: 'synthetic-profile', campusId },
  };
  const audit = jest.fn().mockResolvedValue({});
  const create = jest.fn().mockResolvedValue(user);
  const transaction = jest.fn(
    async (action: (tx: unknown) => Promise<unknown>) =>
      action({ user: { create }, auditLog: { create: audit } }),
  );
  const prisma = { $transaction: transaction } as unknown as PrismaService;
  return { prisma, user, audit, create, transaction };
}

it('creates a ranking identity and its execution manifest in the same transaction', async () => {
  const value = fixture();
  await expect(
    createTeacherFixtureUser(value.prisma, {
      displayName: value.user.displayName,
    }),
  ).resolves.toEqual(value.user);
  expect(value.transaction).toHaveBeenCalledTimes(1);
  expect(value.audit).toHaveBeenCalledWith({
    data: {
      actorUserId: userId,
      resourceId: userId,
      campusId,
      outcome: 'SUCCESS',
      action: 'TEACHER_ACCOUNT_RANKING_INTEGRATION_ACCOUNT',
      resourceType: 'User',
      details: { execution, syntheticOnly: true },
    },
  });
});

it.each([undefined, 'teacher-feedback'])(
  'rejects a ranking batch with purpose %s before creating an identity',
  async (purpose) => {
    jest.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        execution,
        purpose,
        oldUserIds: [],
        oldCampusIds: [],
      }),
    );
    const value = fixture();
    await expect(
      createTeacherFixtureUser(value.prisma, {
        displayName: value.user.displayName,
      }),
    ).rejects.toThrow();
    expect(value.transaction).not.toHaveBeenCalled();
  },
);

it('does not accept a feedback fixture under the ranking allocation', async () => {
  const value = fixture('tfeedback-main123-本人');
  await expect(
    createTeacherFixtureUser(value.prisma, {
      displayName: value.user.displayName,
    }),
  ).rejects.toThrow();
  expect(value.audit).not.toHaveBeenCalled();
});

it('retains the existing feedback manifest behavior without the ranking flag', async () => {
  delete process.env.TEACHER_ACCOUNT_RANKING_INTEGRATION_ENABLED;
  jest
    .mocked(readFileSync)
    .mockReturnValue(
      JSON.stringify({ execution, oldUserIds: [], oldCampusIds: [] }),
    );
  const value = fixture('tfeedback-main123-本人');
  await createTeacherFixtureUser(value.prisma, {
    displayName: value.user.displayName,
  });
  expect(value.audit).toHaveBeenCalledWith({
    data: {
      action: 'TEACHER_FEEDBACK_INTEGRATION_ACCOUNT',
      actorUserId: userId,
      resourceId: userId,
      resourceType: 'User',
      campusId,
      outcome: 'SUCCESS',
      details: { execution, syntheticOnly: true },
    },
  });
});

it('propagates a manifest failure from the transaction instead of reporting an actor', async () => {
  const value = fixture();
  value.audit.mockRejectedValue(new Error('synthetic manifest failure'));
  await expect(
    createTeacherFixtureUser(value.prisma, {
      displayName: value.user.displayName,
    }),
  ).rejects.toThrow('synthetic manifest failure');
});

it.each([
  [
    'DATABASE_URL',
    'postgresql://carchive:synthetic@127.0.0.1:55435/education_app_test_campus_archive_20261027_test',
  ],
  ['TEACHER_PDF_NATIVE_ENABLED', 'true'],
  ['TEACHER_ACCOUNT_RANKING_INTEGRATION_ENABLED', 'true'],
])(
  'rejects incompatible %s before creating an identity',
  async (key, value) => {
    process.env[key] = value;
    const target = fixture();
    await expect(
      createTeacherFixtureUser(target.prisma, {
        displayName: target.user.displayName,
      }),
    ).rejects.toThrow();
    expect(target.transaction).not.toHaveBeenCalled();
  },
);
