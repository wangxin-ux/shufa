import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import request from 'supertest';
import { createTeacherPdfTestApp } from './support/teacher-feedback-integration-app';

jest.mock('node:fs', () => ({
  ...jest.requireActual<typeof import('node:fs')>('node:fs'),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));
jest.mock('supertest', () => jest.fn());
jest.mock('./support/teacher-pdf-test-app.ts', () => ({
  createTeacherPdfTestApp: jest.fn(),
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
  TEACHER_FEEDBACK_INTEGRATION_EVIDENCE: '/synthetic-not-written',
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
  jest.resetAllMocks();
});

function fixture() {
  const issueSession = jest
    .fn()
    .mockResolvedValue({ accessToken: 'synthetic-not-real' });
  const auth = { issueSessionForUser: issueSession };
  const close = jest.fn().mockResolvedValue(undefined);
  const server = new EventEmitter();
  const prisma = {
    $queryRaw: jest
      .fn()
      .mockResolvedValue([{ replication: 'origin', schema: 'public' }]),
    auditLog: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest
        .fn()
        .mockResolvedValue([
          { resourceId: userId, actorUserId: userId, campusId },
        ]),
    },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: userId,
        displayName: 'trank-20261025-1234abcd-本人',
        roles: [{ roleCode: 'TEACHER', campusId }],
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: userId, status: 'DISABLED' }]),
    },
  };
  const app = { get: () => auth, getHttpServer: () => server, close };
  const originalFactory = jest.requireMock<{
    createTeacherPdfTestApp: jest.Mock;
  }>('./support/teacher-pdf-test-app.ts').createTeacherPdfTestApp;
  originalFactory.mockResolvedValue({ app, prisma });
  const response = { status: 401 };
  const authenticate = jest.fn().mockResolvedValue(response);
  jest
    .mocked(request)
    .mockReturnValue({ get: () => ({ auth: authenticate }) } as never);
  return { auth, app, prisma, close, issueSession, response, authenticate };
}

function writtenEvidence(): unknown {
  const content = jest.mocked(writeFileSync).mock.calls[0][1];
  if (typeof content !== 'string') throw new Error('Expected JSON evidence');
  return JSON.parse(content) as unknown;
}

it('closes a manifested actor that never received a credential', async () => {
  const value = fixture();
  value.issueSession.mockRejectedValue(new Error('synthetic issuance failure'));
  await createTeacherPdfTestApp();
  await expect(value.auth.issueSessionForUser(userId)).rejects.toThrow(
    'issuance failure',
  );
  await value.app.close();
  expect(value.prisma.user.updateMany).toHaveBeenCalledWith({
    where: { id: { in: [userId] }, status: { not: 'DISABLED' } },
    data: { status: 'DISABLED' },
  });
  expect(request).not.toHaveBeenCalled();
  const evidence = writtenEvidence() as {
    createdAccounts: string[];
    issuedUserIds: string[];
    issuedCredentialCount: number;
  };
  expect(evidence.createdAccounts).toEqual([userId]);
  expect(evidence.issuedUserIds).toEqual([]);
  expect(evidence.issuedCredentialCount).toBe(0);
  expect(value.close).toHaveBeenCalledTimes(1);
});

it('checks every issued credential even when two belong to the same actor', async () => {
  const value = fixture();
  await createTeacherPdfTestApp();
  await value.auth.issueSessionForUser(userId);
  await value.auth.issueSessionForUser(userId);
  await value.app.close();
  expect(value.authenticate).toHaveBeenCalledTimes(2);
  const evidence = writtenEvidence() as {
    denied: Array<{ userId: string; status: number }>;
    issuedCredentialCount: number;
  };
  expect(evidence.issuedCredentialCount).toBe(2);
  expect(evidence.denied).toEqual([
    { userId, status: 401 },
    { userId, status: 401 },
  ]);
});

it('closes the app but writes no success record when an old credential remains usable', async () => {
  const value = fixture();
  value.response.status = 200;
  await createTeacherPdfTestApp();
  await value.auth.issueSessionForUser(userId);
  await expect(value.app.close()).rejects.toThrow('remains usable');
  expect(value.close).toHaveBeenCalledTimes(1);
  expect(writeFileSync).not.toHaveBeenCalled();
});

it('rejects an old account manifest before any disabling mutation', async () => {
  const value = fixture();
  jest.mocked(readFileSync).mockReturnValue(
    JSON.stringify({
      execution,
      purpose: 'teacher-account-rankings',
      oldUserIds: [userId],
      oldCampusIds: [],
    }),
  );
  await createTeacherPdfTestApp();
  await expect(value.app.close()).rejects.toThrow('ownership mismatch');
  expect(value.prisma.user.updateMany).not.toHaveBeenCalled();
  expect(value.close).toHaveBeenCalledTimes(1);
  expect(writeFileSync).not.toHaveBeenCalled();
});

it('closes the original app when session semantics are unsafe', async () => {
  const value = fixture();
  value.prisma.$queryRaw.mockResolvedValue([
    { replication: 'replica', schema: 'public' },
  ]);
  await expect(createTeacherPdfTestApp()).rejects.toThrow('session semantics');
  expect(value.close).toHaveBeenCalledTimes(1);
  expect(value.prisma.user.updateMany).not.toHaveBeenCalled();
});
