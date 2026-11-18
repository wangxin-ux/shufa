const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { load } = require('../../node_modules/js-yaml');
const { Client } = require('../../node_modules/pg');

const root = path.resolve(__dirname, '../../..');
const evidence = path.join(root, 'docs/verification');
const database = 'education_app_test_partner_pdf_20261012contact_test';
async function main() {
  const name = process.argv[2];
  assert.match(
    name ?? '',
    /^partner-withdrawal-2026-10-16-native-pwnative-[a-f0-9]{8}\.log$/,
  );
  const records = fs
    .readFileSync(path.join(evidence, name), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map(JSON.parse);
  const ready = records.find((r) => r.kind === 'ready');
  const final = records.find((r) => r.kind === 'facts');
  const disabled = records.find((r) => r.kind === 'disabled');
  assert.ok(
    ready && final && disabled && records.some((r) => r.kind === 'closed'),
  );
  assert.equal(disabled.count, 3);
  assert.ok(records.every((r) => r.runTag === ready.runTag));
  assert.ok(!records.some((r) => r.kind === 'failure'));
  const http = records.filter((r) => r.kind === 'http');
  assert.ok(http.length > 0 && http.every((r) => r.status === 200));
  const config = load(
    fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8'),
  ).services.postgres_test;
  assert.ok(config.ports.includes('5433:5432'));
  const target = new URL(`postgresql://127.0.0.1:5433/${database}`);
  target.username = config.environment.POSTGRES_USER;
  target.password = config.environment.POSTGRES_PASSWORD;
  const client = new Client({
    connectionString: target.href,
    connectionTimeoutMillis: 3000,
    query_timeout: 5000,
  });
  await client.connect();
  let report;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(
      (await client.query('SELECT current_database() AS name')).rows[0].name,
      database,
    );
    const users = (
      await client.query(
        'SELECT id,status,"displayName" FROM "User" WHERE id=ANY($1::uuid[])',
        [ready.userIds],
      )
    ).rows;
    assert.equal(users.length, 3);
    assert.ok(
      users.every(
        (u) =>
          u.status === 'DISABLED' &&
          u.displayName.startsWith(`${ready.runTag}-`),
      ),
    );
    const campus = (
      await client.query('SELECT code FROM "Campus" WHERE id=$1::uuid', [
        ready.campusId,
      ])
    ).rows;
    assert.equal(campus[0].code, ready.runTag);
    const earnings = (
      await client.query(
        'SELECT id,status,"amountFen",version FROM "PartnerEarningEntry" WHERE "campusId"=$1::uuid',
        [ready.campusId],
      )
    ).rows;
    assert.deepEqual(earnings, [
      {
        id: ready.earningId,
        status: 'AVAILABLE',
        amountFen: 100000,
        version: 1,
      },
    ]);
    const sources = (
      await client.query(
        'SELECT id,"amountFen" FROM "PartnerSettlementSource" WHERE "campusId"=$1::uuid',
        [ready.campusId],
      )
    ).rows;
    assert.equal(sources.length, 1);
    assert.equal(sources[0].amountFen, 100000);
    const withdrawals = (
      await client.query(
        `SELECT id,status,"amountFen",version,"requestedByUserId","reviewedByUserId","paidByUserId","payoutReference"
       FROM "PartnerWithdrawal" WHERE "campusId"=$1::uuid ORDER BY "createdAt"`,
        [ready.campusId],
      )
    ).rows;
    assert.equal(withdrawals.length, 2);
    assert.deepEqual(
      withdrawals.map((w) => [w.status, w.amountFen, w.version]),
      [
        ['CANCELLED', 80000, 2],
        ['PAID', 80000, 5],
      ],
    );
    const paid = withdrawals[1];
    assert.notEqual(paid.requestedByUserId, paid.reviewedByUserId);
    assert.equal(paid.reviewedByUserId, paid.paidByUserId);
    assert.equal(paid.payoutReference, `SIM-${ready.runTag}`);
    assert.deepEqual(
      withdrawals.map((w) => w.id),
      final.withdrawals.map((w) => w.id),
    );
    const allocations = (
      await client.query(
        `SELECT a."withdrawalId",a."sourceId",a."amountFen" FROM "PartnerWithdrawalAllocation" a
       JOIN "PartnerWithdrawal" w ON w.id=a."withdrawalId" WHERE w."campusId"=$1::uuid`,
        [ready.campusId],
      )
    ).rows;
    assert.equal(allocations.length, 2);
    assert.ok(
      allocations.every(
        (a) => a.sourceId === sources[0].id && a.amountFen === 80000,
      ),
    );
    const proof = (
      await client.query(
        `SELECT p."withdrawalId",p.outcome,f.id,f."storageKey",f."mimeType",f."sizeBytes",f.sha256,f."createdByUserId"
       FROM "PartnerPayoutProof" p JOIN "StoredFile" f ON f.id=p."fileId"
       JOIN "PartnerWithdrawal" w ON w.id=p."withdrawalId" WHERE w."campusId"=$1::uuid`,
        [ready.campusId],
      )
    ).rows;
    assert.equal(proof.length, 1);
    assert.equal(proof[0].withdrawalId, paid.id);
    assert.equal(proof[0].outcome, 'PAID');
    assert.equal(proof[0].mimeType, 'application/pdf');
    assert.equal(proof[0].createdByUserId, paid.paidByUserId);
    const storageRoot = path.join(root, 'backend/storage/partner-pdf-test');
    const proofPath = path.resolve(
      storageRoot,
      ...proof[0].storageKey.split('/'),
    );
    assert.ok(proofPath.startsWith(`${storageRoot}${path.sep}`));
    const pdf = fs.readFileSync(proofPath);
    assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.equal(pdf.length, proof[0].sizeBytes);
    assert.equal(
      createHash('sha256').update(pdf).digest('hex'),
      proof[0].sha256,
    );
    const audits = (
      await client.query(
        'SELECT action,"actorUserId",outcome FROM "AuditLog" WHERE "campusId"=$1::uuid ORDER BY "createdAt"',
        [ready.campusId],
      )
    ).rows;
    assert.deepEqual(
      audits.map((a) => a.action),
      final.audits.map((a) => a.action),
    );
    assert.equal(audits.length, 10);
    assert.ok(
      audits.every(
        (a) => a.outcome === 'SUCCESS' && ready.userIds.includes(a.actorUserId),
      ),
    );
    assert.equal(
      audits.filter((a) => a.action === 'PARTNER_WITHDRAWAL_PROOF_READ').length,
      1,
    );
    const idempotency = (
      await client.query(
        'SELECT status,"responseStatus" FROM "IdempotencyRecord" WHERE "campusId"=$1::uuid',
        [ready.campusId],
      )
    ).rows;
    assert.equal(idempotency.length, 9);
    assert.ok(
      idempotency.every(
        (i) => i.status === 'COMPLETED' && i.responseStatus === 200,
      ),
    );
    const unwanted = (
      await client.query(
        `SELECT
       (SELECT count(*)::int FROM "PartnerSettlementIssue" i JOIN "PartnerWithdrawalAllocation" a ON a.id=i."allocationId" JOIN "PartnerWithdrawal" w ON w.id=a."withdrawalId" WHERE w."campusId"=$1::uuid) AS issues,
       (SELECT count(*)::int FROM "EnrollmentOrder" WHERE "campusId"=$1::uuid) AS orders,
       (SELECT count(*)::int FROM "FinanceReceipt" WHERE "campusId"=$1::uuid) AS receipts,
       (SELECT count(*)::int FROM "LessonLedgerEntry" WHERE "campusId"=$1::uuid) AS lesson_ledger,
       (SELECT count(*)::int FROM "Withdrawal" WHERE "campusId"=$1::uuid) AS teacher_withdrawals`,
        [ready.campusId],
      )
    ).rows[0];
    assert.ok(Object.values(unwanted).every((v) => v === 0));
    await client.query('COMMIT');
    report = {
      checkedAt: new Date().toISOString(),
      database,
      readOnly: true,
      runTag: ready.runTag,
      campusId: ready.campusId,
      disabledUserIds: users.map((u) => u.id),
      httpCalls: http.length,
      allHttp200: true,
      retainedWithdrawals: withdrawals.map((w) => ({
        id: w.id,
        status: w.status,
        amountFen: w.amountFen,
        version: w.version,
      })),
      settledEntitlementFen: 100000,
      reservedFen: 0,
      paidFen: 80000,
      availableFen: 20000,
      auditRecords: audits.length,
      completedIdempotencyRecords: idempotency.length,
      unwanted,
      proof: {
        id: proof[0].id,
        sizeBytes: pdf.length,
        mimeType: proof[0].mimeType,
        sha256Verified: true,
        header: '%PDF-',
        retained: true,
      },
    };
  } finally {
    await client.end();
  }
  assert.ok(
    Number.isInteger(ready.port) && ready.port > 0 && ready.port < 65536,
  );
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: '127.0.0.1',
      port: ready.port,
    });
    socket.once('connect', () => {
      socket.destroy();
      reject(Error('Owned listener still open'));
    });
    socket.once('error', (error) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve();
      else reject(Error('Listener state unknown'));
    });
    socket.setTimeout(1500, () => {
      socket.destroy();
      reject(Error('Listener state unknown'));
    });
  });
  report.port = { port: ready.port, refused: true };
  report.disposition =
    'synthetic records and proof retained; no deletion or external payout';
  const output = path.join(
    evidence,
    `partner-withdrawal-2026-10-16-native-postflight-${ready.runTag}.json`,
  );
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(JSON.stringify({ ...report, output }));
}
main().catch((error) => {
  console.error(
    'Read-only native withdrawal postflight failed; credentials withheld',
  );
  if (error instanceof assert.AssertionError)
    console.error(JSON.stringify({ code: error.code, message: error.message }));
  process.exitCode = 1;
});
