const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('../../node_modules/pg');
const { assertRankingForeignKeys } = require('./teacher-ranking-fixture-ownership.cjs');

const root = path.resolve(__dirname, '../../..');
const backend = path.join(root, 'backend');
const container = 'education-campus-archive-20261027';
const database = 'education_app_test_campus_archive_20261027_test';
const owner = 'codex-coordinator-campus-archive-20261027';
const resourceRun = 'archive-4534b1ea9d';
const volume =
  '065d7d37cd3e7573680bef7bc89849185ca2dde69e6141406d3263b03f324d2a';
const auditOnly = process.argv[2] === '--audit';
const rankings = process.argv[2] === '--rankings';
const accountAction = rankings
  ? 'TEACHER_ACCOUNT_RANKING_INTEGRATION_ACCOUNT'
  : 'TEACHER_FEEDBACK_INTEGRATION_ACCOUNT';
const execution = auditOnly ? process.argv[3] : crypto.randomUUID();
if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    execution ?? '',
  )
) {
  throw new Error('A valid execution UUID is required');
}
const evidence = path.join(
  root,
  rankings
    ? 'docs/verification/teacher-account-rankings-main-20261028'
    : 'docs/verification/teacher-feedback-main-integration-20261028',
);
const lockRoot = path.join(root, '.tools-automation/tmp');
const lockPath = path.join(lockRoot, 'operator-teacher-archive-55437.lock');
const allowed = new Set(
  rankings
    ? [
        'Campus',
        'User',
        'UserRole',
        'TeacherProfile',
        'Student',
        'ClassGroup',
        'ClassMember',
        'LessonSession',
        'CoursePackage',
        'TeachingRecord',
        'AttendanceRecord',
        'LessonLedgerEntry',
        'TeacherEarningRule',
        'TeacherEarningBasis',
        'TeacherEarningEntry',
        'PartnerEarningBasis',
        'PartnerEarningEntry',
        'PartnerRankingStudentFact',
        'AuditLog',
        'IdempotencyRecord',
      ]
    : [
        'Campus',
        'User',
        'UserRole',
        'TeacherProfile',
        'Student',
        'ClassGroup',
        'ClassMember',
        'ParentStudentBinding',
        'LessonSession',
        'CoursePackage',
        'TeachingRecord',
        'AttendanceRecord',
        'LessonLedgerEntry',
        'TeacherEarningBasis',
        'TeacherEarningEntry',
        'PartnerEarningBasis',
        'PartnerEarningEntry',
        'StudentFeedback',
        'StudentFeedbackRevision',
        'StudentFeedbackImage',
        'ParentLessonReview',
        'StoredFile',
        'FinanceReceipt',
        'FinancePackageIssuance',
        'AuditLog',
        'IdempotencyRecord',
        'PartnerRankingStudentFact',
      ],
);
let password, target, baseline, tableNames;
let started = false,
  locked = false;
let startAttempted = false;
let resourceClosed = true;
let accountsClosed = true;
let fixturesStarted = false;
let log = '';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const redact = (value) => {
  let text = String(value);
  for (const secret of [
    password,
    password && encodeURIComponent(password),
    target?.href,
  ]) {
    if (secret) text = text.split(secret).join('[withheld]');
  }
  return text.replace(
    /postgres(?:ql)?:\/\/[^\s"'<>]+/g,
    '[coordinator-test-database]',
  );
};
function command(program, args, timeout = 15000) {
  const result = spawnSync(program, args, {
    cwd: backend,
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error || result.signal) {
    throw new Error(
      redact(
        result.stderr ||
          result.stdout ||
          result.error?.message ||
          'Command failed',
      ),
    );
  }
  return result.stdout;
}
function inspect() {
  const current = JSON.parse(command('docker', ['inspect', container]))[0];
  const env = Object.fromEntries(
    current.Config.Env.map((entry) => {
      const index = entry.indexOf('=');
      return [entry.slice(0, index), entry.slice(index + 1)];
    }),
  );
  const binding = current.HostConfig.PortBindings['5432/tcp'];
  if (rankings) {
    const stored = JSON.parse(
      command('docker', ['volume', 'inspect', volume]),
    )[0];
    const context = JSON.parse(command('docker', ['context', 'inspect']))[0];
    if (
      stored.Name !== volume ||
      Object.keys(stored.Labels ?? {}).length !== 1 ||
      stored.Labels['com.docker.volume.anonymous'] !== '' ||
      !context.Endpoints.docker.Host.startsWith('npipe:')
    ) {
      throw new Error('Exact local volume or Docker context gate failed');
    }
  }
  if (
    current.Name !== `/${container}` ||
    current.Config.Image !== 'postgres:17-alpine' ||
    current.Config.Labels['education.owner'] !== owner ||
    current.Config.Labels['education.database'] !== database ||
    current.Config.Labels['education.run'] !== resourceRun ||
    env.POSTGRES_DB !== database ||
    env.POSTGRES_USER !== 'carchive' ||
    binding?.length !== 1 ||
    binding[0].HostIp !== '127.0.0.1' ||
    binding[0].HostPort !== '55437' ||
    current.Mounts.length !== 1 ||
    current.Mounts[0].Type !== 'volume' ||
    current.Mounts[0].Name !== volume ||
    current.Mounts[0].Destination !== '/var/lib/postgresql/data'
  )
    throw new Error('Exact resource ownership, target or volume gate failed');
  password = env.POSTGRES_PASSWORD;
  if (!password) throw new Error('Owned credentials are unavailable');
  return current;
}
function noListener() {
  command('powershell.exe', [
    '-NoProfile',
    '-Command',
    '$feedbackListeners = @(Get-NetTCPConnection -State Listen -LocalPort 55437 -ErrorAction SilentlyContinue); if ($feedbackListeners.Count) { throw "Coordinator database port is in use" }; exit 0',
  ]);
}
async function connect(action) {
  const client = new Client({
    connectionString: target.href,
    connectionTimeoutMillis: 5000,
    options: `-c session_replication_role=origin -c search_path=public${auditOnly ? ' -c default_transaction_read_only=on' : ''}`,
  });
  try {
    await client.connect();
    const settings = (
      await client.query(
        "SELECT current_setting('session_replication_role') AS replication, current_schema() AS schema",
      )
    ).rows[0];
    if (settings.replication !== 'origin' || settings.schema !== 'public')
      throw new Error('Unexpected database session semantics');
    return await action(client);
  } finally {
    await client.end();
  }
}
async function idle(client) {
  const result = await client.query(
    'SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [database],
  );
  if (result.rows[0].count !== 0)
    throw new Error('Other database sessions remain; do not start or stop');
}
async function snapshot(client) {
  const result = {};
  for (const table of tableNames) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table))
      throw new Error('Unsafe table identifier');
    result[table] = (
      await client.query(
        `SELECT md5(row_to_json(t)::text) AS digest, row_to_json(t)->>'id' AS id,
       row_to_json(t)->>'campusId' AS campus, row_to_json(t)->>'createdByUserId' AS creator,
       row_to_json(t)->>'feedbackId' AS feedback, row_to_json(t)->>'receiptId' AS receipt,
       row_to_json(t)->>'code' AS code, row_to_json(t)->>'status' AS status
       ${rankings ? ", row_to_json(t)->>'userId' AS \"userId\", row_to_json(t)->>'studentId' AS student, row_to_json(t)->>'actorUserId' AS actor" : ''}
       FROM "${table}" t ORDER BY digest`,
      )
    ).rows;
  }
  return result;
}
function scopeMatches(table, row, campuses, users, feedbacks, receipts) {
  if (table === 'Campus') return campuses.has(row.id);
  if (table === 'User') return users.has(row.id);
  if (row.campus) return campuses.has(row.campus);
  if (table === 'StoredFile') return users.has(row.creator);
  if (table === 'StudentFeedbackImage') return feedbacks.has(row.feedback);
  if (table === 'FinancePackageIssuance') return receipts.has(row.receipt);
  return false;
}
async function reconstructAuditBaseline(client) {
  const allocation = JSON.parse(
    fs.readFileSync(
      path.join(evidence, `${execution}-allocation.json`),
      'utf8',
    ),
  );
  if (
    allocation.execution !== execution ||
    allocation.container !== container ||
    allocation.database !== database ||
    allocation.owner !== owner ||
    allocation.resourceRun !== resourceRun ||
    allocation.volume !== volume
  )
    throw new Error(
      'Prior execution allocation does not match the owned target',
    );
  const previous = fs.readFileSync(
    path.join(evidence, `${execution}.log`),
    'utf8',
  );
  if (
    !previous.includes('TEST_EXIT {"status":0,"signal":null}') ||
    !previous.includes(
      'Unallocated table was written: PartnerRankingStudentFact',
    ) ||
    !previous.includes(
      'POSTFLIGHT {"container":"education-campus-archive-20261027","running":false,"pid":0,"exitCode":0',
    )
  )
    throw new Error(
      'Audit continuation requires the exact completed business batch and failed scope check',
    );
  const fixtures = [
    'TEACHER_FEEDBACK_FIXTURES',
    'TEACHER_RATINGS_FIXTURES',
    'TEACHER_ARCHIVE_FIXTURES',
  ].map((marker) => {
    const matched = previous.match(new RegExp(`${marker} (\\{[^\\r\\n]+\\})`));
    if (!matched)
      throw new Error(`Missing completed fixture record: ${marker}`);
    return JSON.parse(matched[1]);
  });
  const tags = fixtures.map((value) => value.runTag);
  const users = new Set(fixtures.flatMap((value) => value.userIds));
  if (users.size !== 12)
    throw new Error('Unexpected completed fixture account count');
  const current = await snapshot(client);
  const addedCampuses = current.Campus.filter(
    (row) => !allocation.oldCampusIds.includes(row.id),
  );
  if (
    addedCampuses.length !== 5 ||
    addedCampuses.some(
      (row) =>
        !tags.some((tag) => row.code === tag || row.code === `${tag}-outside`),
    )
  )
    throw new Error(
      'New campuses do not match the completed execution fixtures',
    );
  const campuses = new Set(addedCampuses.map((row) => row.id));
  const actualUsers = current.User.filter(
    (row) => !allocation.oldUserIds.includes(row.id),
  );
  if (
    actualUsers.length !== users.size ||
    actualUsers.some((row) => !users.has(row.id) || row.status !== 'DISABLED')
  )
    throw new Error('Completed accounts are missing, unknown or active');
  const feedbacks = new Set(
    current.StudentFeedback.filter((row) => campuses.has(row.campus)).map(
      (row) => row.id,
    ),
  );
  const receipts = new Set(
    current.FinanceReceipt.filter((row) => campuses.has(row.campus)).map(
      (row) => row.id,
    ),
  );
  const restored = Object.fromEntries(
    tableNames.map((table) => [
      table,
      current[table].filter(
        (row) =>
          !scopeMatches(table, row, campuses, users, feedbacks, receipts),
      ),
    ]),
  );
  if (hash(JSON.stringify(restored)) !== allocation.oldFactsSha256) {
    throw new Error(
      'Reconstructed pre-existing facts do not match the original before digest',
    );
  }
  const unexpected = await client.query(
    `SELECT count(*)::int AS count FROM "PartnerRankingStudentFact" fact
     LEFT JOIN "Student" student ON student.id = fact."studentId"
     WHERE fact."campusId" = ANY($1::uuid[])
     AND (student.id IS NULL OR student."campusId" <> fact."campusId")`,
    [[...campuses]],
  );
  if (unexpected.rows[0].count !== 0)
    throw new Error(
      'Ranking trigger facts do not reference the same synthetic campus students',
    );
  log += `AUDIT_ONLY ${JSON.stringify({ execution, businessReplayed: false, writes: false, reconstructedBeforeSha256: allocation.oldFactsSha256, oldFactsMatch: true, syntheticCampusCount: campuses.size, triggerSource: '202610150001_partner_monthly_rankings/record_partner_ranking_student_fact' })}\n`;
  return restored;
}
function newRows(after, table) {
  const counts = new Map();
  for (const row of after[table])
    counts.set(row.digest, (counts.get(row.digest) || 0) + 1);
  for (const row of baseline[table]) {
    if (!counts.get(row.digest))
      throw new Error(`Pre-existing row changed or removed: ${table}`);
    counts.set(row.digest, counts.get(row.digest) - 1);
  }
  return after[table].filter((row) => {
    if (!counts.get(row.digest)) return false;
    counts.set(row.digest, counts.get(row.digest) - 1);
    return true;
  });
}
async function main() {
  if (process.env.PGOPTIONS)
    throw new Error(
      'External PGOPTIONS are not allowed for an isolated verification',
    );
  if (
    !(auditOnly
      ? process.argv.length === 4
      : process.argv.length === 3 && (process.argv[2] === '--run' || rankings))
  )
    throw new Error('Explicit --run required');
  fs.mkdirSync(lockRoot, { recursive: true });
  const lock = fs.openSync(lockPath, 'wx');
  locked = true;
  try {
    fs.writeFileSync(lock, JSON.stringify({ execution, container, database }));
  } finally {
    fs.closeSync(lock);
  }
  const current = inspect();
  if (current.State.Running || current.State.Pid !== 0)
    throw new Error('Coordinator resource is already in use');
  noListener();
  command('docker', ['volume', 'inspect', volume]);
  fs.mkdirSync(evidence, { recursive: true });
  if (!auditOnly) {
    command(process.execPath, [
      'node_modules/jest/bin/jest.js',
      '--config',
      'test/jest-teacher-feedback-integration.cjs',
      '--runInBand',
      '--runTestsByPath',
      rankings
        ? 'test/teacher-account-ranking-page-host.e2e-spec.ts'
        : 'test/teacher-feedback-page-host.e2e-spec.ts',
    ]);
  }
  target = new URL(`postgresql://127.0.0.1:55437/${database}`);
  target.username = 'carchive';
  target.password = password;
  startAttempted = true;
  resourceClosed = false;
  command('docker', ['start', container]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const probe = spawnSync(
      'docker',
      ['exec', container, 'pg_isready', '-U', 'carchive', '-d', database],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 3000,
      },
    );
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!ready) throw new Error('Owned database did not become ready');
  await connect(async (client) => {
    const identity = (
      await client.query(
        'SELECT current_database() AS database, current_user AS actor',
      )
    ).rows[0];
    if (identity.database !== database || identity.actor !== 'carchive')
      throw new Error('Database identity mismatch');
    await idle(client);
    const migrations = (
      await client.query(
        'SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL',
      )
    ).rows;
    const source = fs
      .readdirSync(path.join(backend, 'prisma/migrations'), {
        withFileTypes: true,
      })
      .filter((item) => item.isDirectory());
    if (migrations.length !== source.length)
      throw new Error('Migration count mismatch; no automatic deploy');
    for (const item of source) {
      const applied = migrations.find(
        (row) => row.migration_name === item.name,
      );
      if (
        !applied?.finished_at ||
        applied.checksum !==
          hash(
            fs.readFileSync(
              path.join(
                backend,
                'prisma/migrations',
                item.name,
                'migration.sql',
              ),
            ),
          )
      ) {
        throw new Error(
          `Migration checksum mismatch: ${item.name}; no automatic deploy`,
        );
      }
    }
    tableNames = (
      await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename",
      )
    ).rows.map((row) => row.tablename);
    baseline = auditOnly
      ? await reconstructAuditBaseline(client)
      : await snapshot(client);
    if (auditOnly) return;
    fs.writeFileSync(
      path.join(evidence, `${execution}-baseline.json`),
      JSON.stringify(baseline),
      { flag: 'wx' },
    );
    fs.writeFileSync(
      path.join(evidence, `${execution}-allocation.json`),
      JSON.stringify(
        {
          execution,
          ...(rankings ? { purpose: 'teacher-account-rankings' } : {}),
          container,
          database,
          owner,
          resourceRun,
          volume,
          allowedTables: [...allowed],
          oldUserIds: baseline.User.map((row) => row.id),
          oldCampusIds: baseline.Campus.map((row) => row.id),
          oldFactsSha256: hash(JSON.stringify(baseline)),
          migrations: migrations.length,
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
    log += `PREFLIGHT ${JSON.stringify({ execution, container, database, resourceRun, migrations: migrations.length, tables: tableNames.length, oldFactsSha256: hash(JSON.stringify(baseline)) })}\n`;
  });
  if (auditOnly) return;
  const env = {
    ...process.env,
    PGOPTIONS: '-c session_replication_role=origin -c search_path=public',
    NODE_ENV: 'test',
    AUTH_DRIVER: 'mock',
    PAYMENT_DRIVER: 'mock',
    MESSAGE_DRIVER: 'mock',
    PAYOUT_DRIVER: 'manual',
    DATABASE_URL: target.href,
    CAMPUS_ARCHIVE_TEST_DB_NAME: database,
    TEACHER_FEEDBACK_INTEGRATION_EXECUTION: execution,
    TEACHER_FEEDBACK_RESOURCE_RUN: resourceRun,
    TEACHER_FEEDBACK_INTEGRATION_EVIDENCE: evidence,
    TEACHER_PDF_TEST_RUN_ID: `main${execution.replaceAll('-', '').slice(0, 12)}`,
    TEACHER_PDF_NATIVE_ENABLED: 'false',
    TEACHER_PDF_NATIVE_HISTORICAL_ONLY: 'false',
    TEACHER_ACCOUNT_RANKING_INTEGRATION_ENABLED: rankings ? '1' : undefined,
    TZ: 'Asia/Shanghai',
  };
  accountsClosed = false;
  fixturesStarted = true;
  const suites = rankings
    ? ['test/teacher-monthly-rankings.e2e-spec.ts']
    : [
        'test/teacher-four-ratings.e2e-spec.ts',
        'test/teacher-pdf-feedback-flow.e2e-spec.ts',
        'test/teacher-student-archive.e2e-spec.ts',
      ];
  const test = spawnSync(
    process.execPath,
    [
      'node_modules/jest/bin/jest.js',
      '--config',
      'test/jest-teacher-feedback-integration.cjs',
      '--runInBand',
      '--verbose',
      '--runTestsByPath',
      ...suites,
      ...(rankings
        ? [
            '--json',
            '--outputFile',
            path.join(evidence, `${execution}-jest.json`),
          ]
        : [
            '--testNamePattern',
            '^(?!.*lists current warning and available hours).*$',
          ]),
    ],
    {
      cwd: backend,
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 240000,
      maxBuffer: 12 * 1024 * 1024,
    },
  );
  log += redact((test.stdout || '') + (test.stderr || ''));
  log += `\nTEST_EXIT ${JSON.stringify({ status: test.status, signal: test.signal, error: test.error?.message })}\n`;
  if (test.status !== 0 || test.signal || test.error) process.exitCode = 1;
}
main()
  .catch((error) => {
    log += `FAILURE ${redact(error.stack)}\n`;
    process.exitCode = 1;
  })
  .finally(async () => {
    let observedRunning = false;
    if (startAttempted) {
      try {
        const observed = inspect();
        observedRunning = observed.State.Running;
        resourceClosed = !observed.State.Running && observed.State.Pid === 0;
        log += `START_RECONCILIATION ${JSON.stringify({ running: observed.State.Running, pid: observed.State.Pid })}\n`;
        if (observedRunning) started = true;
        else {
          noListener();
          if (started || observed.State.ExitCode !== 0) {
            throw new Error(
              'Resource exited before required fact/account closeout; no success claim or automatic restart',
            );
          }
        }
      } catch (error) {
        log += `START_RECONCILIATION_FAILURE ${redact(error.stack)}\n`;
        process.exitCode = 1;
      }
    }
    if (observedRunning) {
      let lifecycleIdle = false;
      try {
        await connect(async (client) => {
          await idle(client);
          lifecycleIdle = true;
          if (!baseline)
            throw new Error('No baseline; do not mutate any accounts');
          const manifest = (
            await client.query(
              `SELECT "resourceId", "actorUserId" FROM "AuditLog"
           WHERE action = $2
           AND details->>'execution' = $1 AND details->>'syntheticOnly' = 'true'`,
              [execution, accountAction],
            )
          ).rows;
          const ids = manifest.map((row) => row.resourceId);
          const beforeIds = new Set(baseline.User.map((row) => row.id));
          if (
            new Set(ids).size !== ids.length ||
            manifest.some(
              (row) =>
                row.resourceId !== row.actorUserId ||
                beforeIds.has(row.resourceId),
            )
          ) {
            throw new Error(
              'Execution manifest mismatch; no fallback account mutation',
            );
          }
          const fallback =
            !auditOnly && ids.length
              ? await client.query(
                  `UPDATE "User" SET status = 'DISABLED', "updatedAt" = now()
           WHERE id = ANY($1::uuid[]) AND status <> 'DISABLED' RETURNING id`,
                  [ids],
                )
              : { rowCount: 0 };
          const retiredRules =
            rankings && ids.length
              ? await client.query(
                  `UPDATE "TeacherEarningRule" SET status = 'RETIRED', "updatedAt" = now()
                   WHERE "createdByUserId" = ANY($1::uuid[]) AND status = 'ACTIVE'
                   AND "campusId" NOT IN (SELECT unnest($2::uuid[]))
                   RETURNING id`,
                  [ids, baseline.Campus.map((row) => row.id)],
                )
              : { rowCount: 0 };
          const after = await snapshot(client);
          const additions = Object.fromEntries(
            tableNames.map((table) => [table, newRows(after, table)]),
          );
          if (ids.length !== additions.User.length)
            throw new Error('Account manifest and new account counts differ');
          const campuses = new Set(additions.Campus.map((row) => row.id));
          if (
            additions.Campus.some(
              (row) =>
                !(
                  rankings
                    ? /^trank-20261025-[a-f0-9]{8}(?:-outside)?$/
                    : /^(tratings-20261025-|tarchive-20261025-|tfeedback-main)/
                ).test(row.code),
            )
          ) {
            throw new Error('Unexpected new campus outside fixture scope');
          }
          const feedbacks = new Set(
            additions.StudentFeedback.map((row) => row.id),
          );
          const receipts = new Set(
            additions.FinanceReceipt.map((row) => row.id),
          );
          const students = new Set(additions.Student.map((row) => row.id));
          for (const table of tableNames) {
            if (additions[table].length && !allowed.has(table))
              throw new Error(`Unallocated table was written: ${table}`);
            for (const row of additions[table]) {
              if (row.campus && !campuses.has(row.campus))
                throw new Error(`New row outside allocated campuses: ${table}`);
              if (
                table === 'User' &&
                (!ids.includes(row.id) || row.status !== 'DISABLED')
              )
                throw new Error('Unmanifested or active fixture account');
              if (rankings && table === 'UserRole' && !ids.includes(row.userId))
                throw new Error(
                  'Role added for an actor outside this execution',
                );
              if (
                rankings &&
                ['AuditLog', 'IdempotencyRecord'].includes(table) &&
                (!campuses.has(row.campus) || !ids.includes(row.actor))
              )
                throw new Error(
                  'Unallocated or missing audit/idempotency scope',
                );
              if (
                rankings &&
                table === 'TeacherEarningRule' &&
                (!ids.includes(row.creator) || row.status === 'ACTIVE')
              )
                throw new Error(
                  'Unowned or active ranking fixture earning rule',
                );
              if (
                rankings &&
                table === 'PartnerRankingStudentFact' &&
                !students.has(row.student)
              )
                throw new Error(
                  'Ranking trigger fact uses another execution student',
                );
              if (table === 'StoredFile' && !ids.includes(row.creator))
                throw new Error('Unallocated file creator');
              if (
                table === 'StudentFeedbackImage' &&
                !feedbacks.has(row.feedback)
              )
                throw new Error('Unallocated feedback image');
              if (
                table === 'FinancePackageIssuance' &&
                !receipts.has(row.receipt)
              )
                throw new Error('Unallocated package issuance');
            }
          }
          if (rankings) {
            await assertRankingForeignKeys(client, additions);
          }
          const credentialFiles = fs
            .readdirSync(evidence)
            .filter(
              (file) =>
                file.startsWith(`${execution}-`) &&
                file.endsWith('-credentials.json'),
            );
          const credentials = credentialFiles.map((file) =>
            JSON.parse(fs.readFileSync(path.join(evidence, file), 'utf8')),
          );
          const checkedIds = new Set(
            credentials.flatMap((value) =>
              value.denied.map((row) => row.userId),
            ),
          );
          if (
            credentials.length !== (rankings ? 1 : 3) ||
            (!rankings &&
              (checkedIds.size !== ids.length ||
                ids.some((id) => !checkedIds.has(id)))) ||
            (rankings &&
              (credentials[0]?.createdAccounts?.length !== ids.length ||
                credentials[0].createdAccounts.some(
                  (id) => !ids.includes(id),
                ) ||
                credentials[0].issuedCredentialCount !==
                  credentials[0].denied.length ||
                checkedIds.size !== credentials[0].issuedUserIds?.length ||
                credentials[0].issuedUserIds.some(
                  (id) => !ids.includes(id) || !checkedIds.has(id),
                ) ||
                credentials[0].denied.some(
                  (item) => !ids.includes(item.userId),
                ))) ||
            credentials.some(
              (value) =>
                value.execution !== execution ||
                value.denied.some((row) => row.status !== 401) ||
                !value.applicationClosed,
            )
          ) {
            throw new Error(
              'Credential denial/application closeout evidence is incomplete',
            );
          }
          accountsClosed = true;
          const closeout = {
            execution,
            auditOnly,
            allPreexistingFactsPreserved: true,
            oldFactsSha256: hash(JSON.stringify(baseline)),
            newRows: Object.fromEntries(
              tableNames
                .filter((table) => additions[table].length)
                .map((table) => [table, additions[table].length]),
            ),
            accounts: ids,
            accountsDisabled: ids.length,
            checkedCredentials: credentials.reduce(
              (sum, value) => sum + value.denied.length,
              0,
            ),
            fallbackDisabledAccounts: fallback.rowCount,
            ...(rankings
              ? { fallbackRetiredRules: retiredRules.rowCount }
              : {}),
            retainedFactsAndFiles: true,
          };
          fs.writeFileSync(
            path.join(evidence, `${execution}-closeout.json`),
            JSON.stringify(closeout, null, 2),
            { flag: 'wx' },
          );
          log += `FACT_CLOSEOUT ${JSON.stringify(closeout)}\n`;
        });
      } catch (error) {
        log += `CLOSEOUT_FAILURE ${redact(error.stack)}\n`;
        process.exitCode = 1;
      }
      try {
        if (!lifecycleIdle || (fixturesStarted && !accountsClosed))
          throw new Error(
            'No complete idle/account closeout proof; retain resource and lock for investigation',
          );
        inspect();
        command('docker', ['stop', '--time', '10', container], 30000);
        const final = inspect();
        if (
          final.State.Running ||
          final.State.Pid !== 0 ||
          final.State.ExitCode !== 0
        )
          throw new Error('Database did not stop cleanly');
        noListener();
        resourceClosed = true;
        log += `POSTFLIGHT ${JSON.stringify({ container, running: false, pid: 0, exitCode: 0, listeners: 0, volumeRetained: true })}\n`;
      } catch (error) {
        log += `POSTFLIGHT_FAILURE ${redact(error.stack)}\n`;
        process.exitCode = 1;
      }
    }
    if (locked && (!resourceClosed || !accountsClosed)) {
      log +=
        'LOCK_RETAINED Resource or account closure is unproven; preserve exclusive lock for investigation\n';
      process.exitCode = 1;
    }
    if (locked && resourceClosed && accountsClosed) {
      try {
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (lock.execution !== execution || path.dirname(lockPath) !== lockRoot)
          throw new Error('Temporary lock ownership mismatch');
        fs.unlinkSync(lockPath);
        log += `LOCK_RELEASE ${JSON.stringify({ path: lockPath, reason: 'This execution exclusive reconstructible temporary lock; not acceptance evidence' })}\n`;
      } catch (error) {
        log += `LOCK_RELEASE_FAILURE ${redact(error.stack)}\n`;
        process.exitCode = 1;
      }
    }
    fs.mkdirSync(evidence, { recursive: true });
    const file = path.join(
      evidence,
      auditOnly
        ? `${execution}-audit-${crypto.randomUUID()}.log`
        : `${execution}.log`,
    );
    fs.writeFileSync(file, redact(log), { flag: 'wx' });
    process.stdout.write(`${redact(log)}\nEvidence: ${file}\n`);
  });
