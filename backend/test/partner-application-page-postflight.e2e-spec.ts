import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { Client } from 'pg';
import { assertApplicationPageTestTarget } from './support/partner-application-page-policy';

assertApplicationPageTestTarget(process.env);
jest.setTimeout(30_000);
interface OwnedRun {
  runTag: string;
  userIds: string[];
  applicantIds: string[];
  applicationIds: string[];
  campusIds: string[];
  port: number;
  uploads: Array<{ id: string; storedFileId: string }>;
  approvals: Array<{ userId: string; campusId: string; submissionId: string }>;
}
const evidenceRoot = path.resolve(__dirname, '../../docs/verification');
const storageRoot = path.resolve(__dirname, '../storage/partner-pdf-test');
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sources = readdirSync(evidenceRoot).filter((name) =>
  /^partner-application-tcp-2026-10-15-[a-z0-9-]+\.log$/.test(name),
);
const runs = sources.flatMap((source) => {
  const text = readFileSync(path.join(evidenceRoot, source), 'utf8');
  const markers = [...text.matchAll(/^APPLICATION_PAGE_OWNERSHIP (\{.*\})$/gm)];
  return markers.map((marker) => ({
    source,
    run: JSON.parse(marker[1]) as OwnedRun,
  }));
});
const refused = (port: number) =>
  new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1500);
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error('Recorded listener is still open'));
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('Recorded listener closure unconfirmed'));
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve();
      else reject(error);
    });
  });

describe('independent read-only application Page fixture postflight', () => {
  it('retains only owned disabled users, frozen history and encrypted images, with every recorded listener closed', async () => {
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(runs.map(({ run }) => run.runTag)).size).toBe(runs.length);
    for (const { run } of runs) {
      expect(run.runTag).toMatch(/^apage-[a-f0-9]{8}$/);
      for (const ids of [
        run.userIds,
        run.applicantIds,
        run.applicationIds,
        run.campusIds,
      ]) {
        expect(ids.length).toBeGreaterThan(0);
        expect(ids.every((id) => uuid.test(id))).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
      }
      expect(
        Number.isInteger(run.port) && run.port > 0 && run.port < 65536,
      ).toBe(true);
    }
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 2500,
      query_timeout: 5000,
    });
    const results: object[] = [];
    try {
      await client.connect();
      await client.query('BEGIN READ ONLY');
      expect((await client.query('SHOW transaction_read_only')).rows).toEqual([
        { transaction_read_only: 'on' },
      ]);
      expect(
        (await client.query('SELECT current_database() AS database')).rows,
      ).toEqual([{ database: process.env.PARTNER_PDF_TEST_DB_NAME }]);
      for (const { source, run } of runs) {
        const { rows: users } = await client.query<{
          id: string;
          status: string;
          owned: boolean;
        }>(
          `SELECT id, status, starts_with("displayName", $2 || '-') AS owned
          FROM "User" WHERE id = ANY($1::uuid[])`,
          [run.userIds, run.runTag],
        );
        expect(users).toHaveLength(run.userIds.length);
        expect(
          users.every((user) => user.owned && user.status === 'DISABLED'),
        ).toBe(true);
        const { rows: allOwned } = await client.query<{ id: string }>(
          `SELECT id FROM "User" WHERE starts_with("displayName", $1 || '-') OR
            EXISTS (SELECT 1 FROM "AuthIdentity" i WHERE i."userId" = "User".id
              AND i.provider = 'WECHAT' AND starts_with(i.subject, $1 || '-'))`,
          [run.runTag],
        );
        expect(allOwned.map((row) => row.id).sort()).toEqual(
          [...run.userIds].sort(),
        );
        const { rows: applicants } = await client.query<{ id: string }>(
          `SELECT id FROM "PartnerApplicant" WHERE "userId" = ANY($1::uuid[])`,
          [run.userIds],
        );
        expect(applicants.map((row) => row.id).sort()).toEqual(
          [...run.applicantIds].sort(),
        );
        const { rows: applications } = await client.query<{
          id: string;
          status: string;
        }>(
          `SELECT id, status FROM "PartnerApplication" WHERE "applicantId" = ANY($1::uuid[])`,
          [run.applicantIds],
        );
        expect(applications.map((row) => row.id).sort()).toEqual(
          [...run.applicationIds].sort(),
        );
        expect(
          applications.filter((row) => row.status === 'APPROVED'),
        ).toHaveLength(1);
        const { rows: approvals } = await client.query<{
          userId: string;
          campusId: string;
          submissionId: string;
          private: boolean;
          owned: boolean;
        }>(
          `SELECT a."userId", a."campusId", a."submissionId",
            (NOT c."mapVisible" AND c.latitude IS NULL AND c.longitude IS NULL) AS private,
            (owner."userId" = a."userId" AND p.status = 'APPROVED'
              AND r.decision = 'APPROVED' AND r."reviewerUserId" = ANY($1::uuid[])) AS owned
          FROM "PartnerApplicationApproval" a
          JOIN "PartnerApplicationSubmission" s ON s.id = a."submissionId"
          JOIN "PartnerApplication" p ON p.id = s."applicationId"
          JOIN "PartnerApplicant" owner ON owner.id = p."applicantId"
          JOIN "PartnerApplicationReview" r ON r."submissionId" = s.id
          JOIN "Campus" c ON c.id = a."campusId"
          WHERE a."userId" = ANY($1::uuid[])`,
          [run.userIds],
        );
        expect(
          approvals.map(({ userId, campusId, submissionId }) => ({
            userId,
            campusId,
            submissionId,
          })),
        ).toEqual(run.approvals);
        expect(approvals.every((row) => row.private && row.owned)).toBe(true);
        expect(approvals.map((row) => row.campusId).sort()).toEqual(
          [...run.campusIds].sort(),
        );
        const { rows: roles } = await client.query<{
          userId: string;
          roleCode: string;
          campusId: string | null;
        }>(
          `SELECT "userId", "roleCode", "campusId" FROM "UserRole" WHERE "userId" = ANY($1::uuid[])`,
          [run.userIds],
        );
        expect(roles).toHaveLength(2);
        expect(roles).toEqual(
          expect.arrayContaining([
            { userId: run.userIds[0], roleCode: 'SUPER_ADMIN', campusId: null },
            {
              userId: approvals[0].userId,
              roleCode: 'PARTNER',
              campusId: approvals[0].campusId,
            },
          ]),
        );
        const { rows: history } = await client.query<{
          snapshots: number;
          rejected: number;
          approved: number;
          owned: boolean;
        }>(
          `SELECT count(*)::int AS snapshots,
            count(r.id) FILTER (WHERE r.decision = 'REJECTED')::int AS rejected,
            count(r.id) FILTER (WHERE r.decision = 'APPROVED')::int AS approved,
            bool_and(r."reviewerUserId" = ANY($2::uuid[])) AS owned
          FROM "PartnerApplicationSubmission" s
          LEFT JOIN "PartnerApplicationReview" r ON r."submissionId" = s.id
          WHERE s."applicationId" = ANY($1::uuid[])`,
          [run.applicationIds, run.userIds],
        );
        expect(history).toEqual([
          { snapshots: 2, rejected: 1, approved: 1, owned: true },
        ]);
        const { rows: uploads } = await client.query<{
          id: string;
          storedFileId: string;
          storageKey: string;
          ciphertextDigest: string;
          state: string;
          adopted: boolean;
          owned: boolean;
          objects: number;
          registered: boolean;
        }>(
          `SELECT u.id, u."storedFileId", u."storageKey", u."ciphertextDigest", u.state,
            u."adoptedAt" IS NOT NULL AS adopted,
            (a."userId" = u."ownerUserId" AND u."ownerUserId" = ANY($1::uuid[])) AS owned,
            count(o.id)::int AS objects,
            bool_and(o."storageKey" = u."storageKey" AND o."completedAt" IS NOT NULL) AS registered
          FROM "PartnerApplicationUpload" u
          JOIN "PartnerApplication" p ON p.id = u."applicationId"
          JOIN "PartnerApplicant" a ON a.id = p."applicantId"
          JOIN "StoredFile" f ON f.id = u."storedFileId"
          LEFT JOIN "PartnerApplicationUploadObject" o ON o."uploadId" = u.id
          WHERE u."runTag" = $2 GROUP BY u.id, a."userId" ORDER BY u.id`,
          [run.userIds, run.runTag],
        );
        expect(
          uploads.map(({ id, storedFileId }) => ({ id, storedFileId })),
        ).toEqual(
          run.uploads.map(({ id, storedFileId }) => ({ id, storedFileId })),
        );
        for (const upload of uploads) {
          expect(upload).toMatchObject({
            state: 'COMPLETED',
            adopted: true,
            owned: true,
            objects: 1,
            registered: true,
          });
          expect(upload.storageKey).toBe(
            `partner-application-private/${run.runTag}/${upload.storedFileId}.bin`,
          );
          const target = path.resolve(storageRoot, upload.storageKey);
          const relative = path.relative(storageRoot, target);
          expect(relative.startsWith('..') || path.isAbsolute(relative)).toBe(
            false,
          );
          const ciphertext = readFileSync(target);
          expect(ciphertext.length).toBeGreaterThan(0);
          expect(
            ciphertext
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
          ).toBe(false);
          expect(createHash('sha256').update(ciphertext).digest('hex')).toBe(
            upload.ciphertextDigest,
          );
        }
        const sideEffects: Record<string, number> = {};
        for (const table of [
          'EnrollmentOrder',
          'LessonLedgerEntry',
          'FinanceReceipt',
          'PartnerEarningEntry',
          'Withdrawal',
        ]) {
          const result = await client.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM "${table}" WHERE "campusId" = ANY($1::uuid[])`,
            [run.campusIds],
          );
          sideEffects[table] = result.rows[0].count;
        }
        expect(Object.values(sideEffects).every((count) => count === 0)).toBe(
          true,
        );
        await refused(run.port);
        results.push({
          source,
          runTag: run.runTag,
          users: users.length,
          active: 0,
          applications: applications.length,
          ...history[0],
          approvals: approvals.length,
          encryptedImages: uploads.length,
          sideEffects,
          port: run.port,
          refused: true,
        });
      }
      await client.query('COMMIT');
      process.stdout.write(
        `APPLICATION_PAGE_POSTFLIGHT ${JSON.stringify({ readOnly: true, valid: true, runs: results })}\n`,
      );
    } finally {
      await client.end();
    }
  });
});
