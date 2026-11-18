const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { load } = require('../../node_modules/js-yaml');
const { Client } = require('../../node_modules/pg');
const root = path.resolve(__dirname, '../../..');
const directory = path.join(root, 'docs/verification');
const database = 'education_app_test_partner_pdf_20261012contact_test';
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function closed(port) {
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1500);
    socket.once('connect', () => {
      socket.destroy();
      reject(Error('Owned listener still open'));
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(Error('Listener state unknown'));
    });
    socket.once('error', (error) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve({ port, closed: true });
      else reject(Error('Listener closure unconfirmed'));
    });
  });
}
async function main() {
  const config = load(
    fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8'),
  ).services.postgres_test;
  assert.ok(config.ports.includes('5433:5432'));
  const target = new URL(`postgresql://127.0.0.1:5433/${database}`);
  target.username = config.environment.POSTGRES_USER;
  target.password = config.environment.POSTGRES_PASSWORD;
  const manifests = [];
  for (const file of fs
    .readdirSync(directory)
    .filter((name) =>
      /^partner-withdrawal-2026-10-16-(red|green)-\d+\.log$/.test(name),
    )) {
    const text = fs.readFileSync(path.join(directory, file), 'utf8');
    for (const match of text.matchAll(
      /^PARTNER_WITHDRAWAL_FIXTURES (\{[^\r\n]+\})$/gm,
    ))
      manifests.push({ ...JSON.parse(match[1]), file });
  }
  assert.ok(manifests.length);
  assert.equal(new Set(manifests.map((m) => m.runTag)).size, manifests.length);
  const client = new Client({
    connectionString: target.href,
    connectionTimeoutMillis: 3000,
    query_timeout: 5000,
  });
  const result = [];
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(
      (await client.query('SELECT current_database() AS name')).rows[0].name,
      database,
    );
    const discovered = await client.query(
      `SELECT DISTINCT substring("displayName" from '^pw-[a-f0-9]{8}') AS tag
       FROM "User" WHERE "displayName" ~ '^pw-[a-f0-9]{8}-[0-9]+$'`,
    );
    const recovered = [];
    for (const { tag } of discovered.rows.filter(
      (r) => !manifests.some((m) => m.runTag === r.tag),
    )) {
      const users = await client.query(
        'SELECT id FROM "User" WHERE "displayName" LIKE $1',
        [`${tag}-%`],
      );
      const campuses = await client.query(
        'SELECT id FROM "Campus" WHERE code LIKE $1',
        [`${tag}-%`],
      );
      const manifest = {
        runTag: tag,
        userIds: users.rows.map((r) => r.id),
        campusIds: campuses.rows.map((r) => r.id),
        file: 'recovered from unique synthetic run prefix; initial fixture error prevented receipt',
        port: null,
      };
      manifests.push(manifest);
      recovered.push(tag);
    }
    for (const m of manifests) {
      assert.match(m.runTag, /^pw-[0-9a-f]{8}$/);
      for (const ids of [m.userIds, m.campusIds]) {
        assert.ok(Array.isArray(ids) && ids.every((id) => uuid.test(id)));
        assert.equal(new Set(ids).size, ids.length);
      }
      const users = await client.query(
        'SELECT id, status, "displayName" FROM "User" WHERE id = ANY($1::uuid[])',
        [m.userIds],
      );
      assert.equal(users.rows.length, m.userIds.length);
      assert.ok(
        users.rows.every(
          (u) =>
            u.status === 'DISABLED' && u.displayName.startsWith(`${m.runTag}-`),
        ),
      );
      const campuses = await client.query(
        'SELECT id, code FROM "Campus" WHERE id = ANY($1::uuid[])',
        [m.campusIds],
      );
      assert.equal(campuses.rows.length, m.campusIds.length);
      assert.ok(campuses.rows.every((c) => c.code.startsWith(`${m.runTag}-`)));
      const withdrawals = await client.query(
        `SELECT w.id, w.status, w."amountFen", w."payoutReference", p.outcome,
         (SELECT COALESCE(sum(a."amountFen"),0)::int FROM "PartnerWithdrawalAllocation" a WHERE a."withdrawalId"=w.id) AS allocated
         FROM "PartnerWithdrawal" w LEFT JOIN "PartnerPayoutProof" p ON p."withdrawalId"=w.id
         WHERE w."campusId"=ANY($1::uuid[])`,
        [m.campusIds],
      );
      assert.ok(
        withdrawals.rows.every(
          (w) => w.amountFen > 0 && w.allocated === w.amountFen,
        ),
      );
      assert.ok(
        withdrawals.rows
          .filter((w) => w.status === 'PAID')
          .every((w) => /^SIM-\S+$/.test(w.payoutReference)),
      );
      const occupied = await client.query(
        `SELECT s.id FROM "PartnerSettlementSource" s
         JOIN "PartnerWithdrawalAllocation" a ON a."sourceId"=s.id
         JOIN "PartnerWithdrawal" w ON w.id=a."withdrawalId"
         WHERE s."campusId"=ANY($1::uuid[]) AND w.status IN ('SUBMITTED','APPROVED','PAYING','RECONCILING','PAID')
         GROUP BY s.id HAVING sum(a."amountFen") > s."amountFen"`,
        [m.campusIds],
      );
      assert.equal(occupied.rows.length, 0);
      const issues = await client.query(
        `SELECT i."amountFen", a."amountFen" AS allocation, w.status FROM "PartnerSettlementIssue" i
         JOIN "PartnerWithdrawalAllocation" a ON a.id=i."allocationId"
         JOIN "PartnerWithdrawal" w ON w.id=a."withdrawalId" WHERE w."campusId"=ANY($1::uuid[])`,
        [m.campusIds],
      );
      assert.ok(
        issues.rows.every(
          (i) => i.amountFen === i.allocation && i.status === 'PAID',
        ),
      );
      const audit = await client.query(
        `SELECT count(*)::int AS count FROM "AuditLog" WHERE "campusId"=ANY($1::uuid[]) AND action LIKE 'PARTNER_%'`,
        [m.campusIds],
      );
      const payments = await client.query(
        `SELECT count(*)::int AS count FROM "EnrollmentOrder" WHERE "campusId"=ANY($1::uuid[])`,
        [m.campusIds],
      );
      assert.equal(payments.rows[0].count, 0);
      result.push({
        ...m,
        disabledUsers: users.rows.length,
        retainedCampuses: campuses.rows.length,
        withdrawals: withdrawals.rows.length,
        paid: withdrawals.rows.filter((w) => w.status === 'PAID').length,
        genericHistoricalProofs: withdrawals.rows.filter(
          (w) => w.outcome === null && w.payoutReference,
        ).length,
        issues: issues.rows.length,
        auditRecords: audit.rows[0].count,
        sourceOverAllocation: false,
        enrollmentOrders: 0,
      });
    }
    await client.query('COMMIT');
    const ports = [];
    for (const port of new Set(
      manifests.map((m) => m.port).filter((p) => p !== null),
    ))
      ports.push(await closed(port));
    const report = {
      checkedAt: new Date().toISOString(),
      database,
      readOnly: true,
      recoveredRunTags: recovered,
      runs: result,
      ports,
      missingInitialPortReceipt: manifests.some((m) => m.port === null),
      disposition:
        'all synthetic records and files retained; no cleanup, production or external payout',
    };
    const output = path.join(
      directory,
      `partner-withdrawal-2026-10-16-postflight-${Date.now()}.json`,
    );
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx',
    });
    console.log(
      JSON.stringify({
        runs: result.length,
        disabledUsers: result.reduce((sum, r) => sum + r.disabledUsers, 0),
        recoveredRunTags: recovered,
        closedPorts: ports.length,
        missingInitialPortReceipt: report.missingInitialPortReceipt,
        output,
      }),
    );
  } finally {
    await client.end();
  }
}
main().catch(() => {
  console.error(
    'Read-only withdrawal postflight failed; sensitive details withheld',
  );
  process.exitCode = 1;
});
