const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('../../node_modules/pg');

const root = path.resolve(__dirname, '../../..');
const backend = path.join(root, 'backend');
const container = 'education-campus-archive-20261027';
const database = 'education_app_test_campus_archive_20261027_test';
const owner = 'codex-coordinator-campus-archive-20261027';
const resourceRun = 'archive-4534b1ea9d';
const volume =
  '065d7d37cd3e7573680bef7bc89849185ca2dde69e6141406d3263b03f324d2a';
const execution = crypto.randomUUID();
const prefix = `ot-${execution.slice(0, 8)}`;
const evidence = path.join(
  root,
  'docs/verification/operator-teacher-archive-20261028',
);
const tables = [
  'Campus',
  'User',
  'UserRole',
  'AuthIdentity',
  'TeacherProfile',
  'ClassGroup',
  'LessonSession',
  'TeachingRecord',
  'PartnerTeacherEvaluation',
  'PartnerTeacherEvaluationRevision',
  'CoursePackage',
  'LessonLedgerEntry',
  'TeacherEarningEntry',
  'PartnerEarningEntry',
  'AuditLog',
  'IdempotencyRecord',
];
let password;
let target;
let started = false;
let baseline;
let log = '';
let locked = false;
const lockRoot = path.join(root, '.tools-automation', 'tmp');
const lockPath = path.join(lockRoot, 'operator-teacher-archive-55437.lock');

function redact(value) {
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
    '[dedicated-test-database]',
  );
}
function command(program, args, timeout = 15_000) {
  const result = spawnSync(program, args, {
    cwd: backend,
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error || result.signal)
    throw new Error(
      redact(
        result.stderr ||
          result.stdout ||
          result.error?.message ||
          'Command failed',
      ),
    );
  return result.stdout;
}
function inspect() {
  const value = JSON.parse(command('docker', ['inspect', container]))[0];
  const env = Object.fromEntries(
    value.Config.Env.map((entry) => [
      entry.slice(0, entry.indexOf('=')),
      entry.slice(entry.indexOf('=') + 1),
    ]),
  );
  const binding = value.HostConfig.PortBindings['5432/tcp'];
  if (
    value.Name !== `/${container}` ||
    value.Config.Image !== 'postgres:17-alpine' ||
    value.Config.Labels['education.owner'] !== owner ||
    value.Config.Labels['education.database'] !== database ||
    value.Config.Labels['education.run'] !== resourceRun ||
    env.POSTGRES_DB !== database ||
    env.POSTGRES_USER !== 'carchive' ||
    binding?.length !== 1 ||
    binding[0].HostIp !== '127.0.0.1' ||
    binding[0].HostPort !== '55437' ||
    value.Mounts.length !== 1 ||
    value.Mounts[0].Type !== 'volume' ||
    value.Mounts[0].Name !== volume ||
    value.Mounts[0].Destination !== '/var/lib/postgresql/data'
  ) {
    throw new Error(
      'Exact coordinator resource ownership/volume/target gate failed',
    );
  }
  password = env.POSTGRES_PASSWORD;
  if (!password) throw new Error('Dedicated credentials unavailable');
  return value;
}
async function connect(action) {
  const client = new Client({
    connectionString: target.href,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    return await action(client);
  } finally {
    await client.end();
  }
}
async function snapshot(client) {
  const result = {};
  for (const table of tables) {
    const query = await client.query(
      `SELECT id::text AS id, md5(row_to_json(t)::text) AS digest FROM "${table}" t ORDER BY id`,
    );
    result[table] = query.rows;
  }
  return result;
}
async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--run')
    throw new Error('Explicit --run is required');
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
    throw new Error('Coordinator database is already in use');
  const listeners = command('powershell.exe', [
    '-NoProfile',
    '-Command',
    '$x = @(Get-NetTCPConnection -State Listen -LocalPort 55437 -ErrorAction SilentlyContinue); if ($x.Count) { throw "Coordinator database port is in use" }; exit 0',
  ]);
  if (listeners.trim()) throw new Error('Unexpected listener preflight output');
  command('docker', ['volume', 'inspect', volume]);
  fs.mkdirSync(evidence, { recursive: true });
  const pageHost = command(process.execPath, [
    'node_modules/jest/bin/jest.js',
    '--config',
    'test/jest-operator-teacher-archive.cjs',
    '--runInBand',
    '--runTestsByPath',
    'test/operator-teacher-page-host.e2e-spec.ts',
  ]);
  log += `PAGE_HOST_PREFLIGHT ${JSON.stringify({ passed: true, output: pageHost.trim() })}\n`;
  target = new URL(`postgresql://127.0.0.1:55437/${database}`);
  target.username = 'carchive';
  target.password = password;
  command('docker', ['start', container]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = spawnSync(
      'docker',
      ['exec', container, 'pg_isready', '-U', 'carchive', '-d', database],
      { encoding: 'utf8', windowsHide: true, timeout: 3000 },
    );
    if (result.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!ready) throw new Error('Dedicated database did not become ready');
  await connect(async (client) => {
    const identity = (
      await client.query(
        'SELECT current_database() AS database, current_user AS actor',
      )
    ).rows[0];
    if (identity.database !== database || identity.actor !== 'carchive')
      throw new Error('Database identity gate failed');
    const migrations = (
      await client.query(
        'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"',
      )
    ).rows.filter((row) => !row.rolled_back_at);
    const source = fs
      .readdirSync(path.join(backend, 'prisma/migrations'), {
        withFileTypes: true,
      })
      .filter((entry) => entry.isDirectory());
    if (migrations.length !== source.length)
      throw new Error('Migration count mismatch; no automatic deploy');
    for (const entry of source) {
      const applied = migrations.find(
        (row) => row.migration_name === entry.name,
      );
      const checksum = crypto
        .createHash('sha256')
        .update(
          fs.readFileSync(
            path.join(
              backend,
              'prisma/migrations',
              entry.name,
              'migration.sql',
            ),
          ),
        )
        .digest('hex');
      if (!applied?.finished_at || applied.checksum !== checksum)
        throw new Error(
          `Migration gate failed: ${entry.name}; no automatic deploy`,
        );
    }
    baseline = await snapshot(client);
    log += `PREFLIGHT ${JSON.stringify({ execution, prefix, container, database, owner, resourceRun, volume, loopbackPort: 55437, migrations: source.length, oldRows: Object.fromEntries(tables.map((table) => [table, baseline[table].length])) })}\n`;
  });
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    AUTH_DRIVER: 'mock',
    PAYMENT_DRIVER: 'mock',
    MESSAGE_DRIVER: 'mock',
    PAYOUT_DRIVER: 'manual',
    DATABASE_URL: target.href,
    CAMPUS_ARCHIVE_TEST_DB_NAME: database,
    JWT_ACCESS_SECRET: crypto.randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: crypto.randomBytes(32).toString('hex'),
    FILE_STORAGE_DRIVER: 'local',
    FILE_STORAGE_ROOT: path.join(
      backend,
      'storage/campus-archive-test',
      execution,
    ),
    OPERATOR_TEACHER_TEST_EXECUTION: execution,
    OPERATOR_TEACHER_TEST_EVIDENCE: evidence,
    TZ: 'Asia/Shanghai',
  };
  const tests = spawnSync(
    process.execPath,
    [
      'node_modules/jest/bin/jest.js',
      '--config',
      'test/jest-operator-teacher-archive.cjs',
      '--runInBand',
      '--verbose',
      '--runTestsByPath',
      'test/operator-teacher-archive.e2e-spec.ts',
    ],
    {
      cwd: backend,
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  log += redact((tests.stdout || '') + (tests.stderr || ''));
  log += `\nTEST_EXIT ${JSON.stringify({ status: tests.status, signal: tests.signal, error: tests.error?.message })}\n`;
  if (tests.status !== 0 || tests.signal || tests.error) process.exitCode = 1;
}
main()
  .catch((error) => {
    log += `FAILURE ${redact(error.stack)}\n`;
    process.exitCode = 1;
  })
  .finally(async () => {
    if (started) {
      let lifecycleIdle = false;
      try {
        await connect(async (client) => {
          const sessions = await client.query(
            'SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
            [database],
          );
          if (sessions.rows[0].count !== 0) {
            throw new Error(
              'Other database sessions remain; do not mutate fixture accounts',
            );
          }
          lifecycleIdle = true;
          const manifests = await client.query(
            'SELECT "resourceId", "actorUserId" FROM "AuditLog" WHERE action = $1 AND "resourceType" = \'User\' AND details->>\'execution\' = $2 AND details->>\'syntheticOnly\' = \'true\'',
            ['OPERATOR_TEACHER_ARCHIVE_FIXTURE_ACCOUNT', execution],
          );
          const ids = manifests.rows.map((row) => row.resourceId);
          const oldUsers = new Set((baseline?.User ?? []).map((row) => row.id));
          if (
            manifests.rows.some(
              (row) =>
                row.resourceId !== row.actorUserId ||
                oldUsers.has(row.resourceId) ||
                !/^[0-9a-f-]{36}$/.test(row.resourceId),
            ) ||
            new Set(ids).size !== ids.length
          ) {
            throw new Error(
              'Full execution manifest account gate failed; no fallback mutation',
            );
          }
          const stopped = ids.length
            ? await client.query(
                'UPDATE "User" SET status = \'DISABLED\', "updatedAt" = now() WHERE id = ANY($1::uuid[]) AND status <> \'DISABLED\' RETURNING id',
                [ids],
              )
            : { rowCount: 0 };
          const after = await snapshot(client);
          for (const table of tables) {
            const actual = new Map(
              after[table].map((row) => [row.id, row.digest]),
            );
            if (
              baseline?.[table].some((row) => actual.get(row.id) !== row.digest)
            )
              throw new Error(`Pre-existing facts changed in ${table}`);
          }
          log += `FACT_CLOSEOUT ${JSON.stringify({ preservedOldFacts: true, fallbackDisabledAccounts: stopped.rowCount, retained: true })}\n`;
        });
      } catch (error) {
        log += `CLOSEOUT_FAILURE ${redact(error.stack)}\n`;
        process.exitCode = 1;
      }
      try {
        if (!lifecycleIdle) {
          throw new Error(
            'No independent idle database check; retain container for investigation',
          );
        }
        inspect();
        command('docker', ['stop', '--time', '10', container], 30_000);
        const final = inspect();
        if (
          final.State.Running ||
          final.State.Pid !== 0 ||
          final.State.ExitCode !== 0
        )
          throw new Error('Dedicated database did not stop cleanly');
        command('powershell.exe', [
          '-NoProfile',
          '-Command',
          '$x = @(Get-NetTCPConnection -State Listen -LocalPort 55437 -ErrorAction SilentlyContinue); if ($x.Count) { throw "Coordinator database listener remains" }; exit 0',
        ]);
        log += `POSTFLIGHT ${JSON.stringify({ container, running: false, pid: 0, exitCode: 0, listeners: 0, volumeRetained: true })}\n`;
      } catch (error) {
        log += `POSTFLIGHT_FAILURE ${redact(error.stack)}\n`;
        process.exitCode = 1;
      }
    }
    if (locked) {
      try {
        const owned = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (
          owned.execution !== execution ||
          path.dirname(lockPath) !== lockRoot
        )
          throw new Error('Exclusive run lock ownership mismatch');
        fs.unlinkSync(lockPath);
        log += `LOCK_RELEASE ${JSON.stringify({ path: lockPath, reason: 'Release this execution exclusive, reconstructible temporary lock; not acceptance evidence' })}\n`;
      } catch (error) {
        log += `LOCK_RELEASE_FAILURE ${redact(error.stack)}\n`;
        process.exitCode = 1;
      }
    }
    fs.mkdirSync(evidence, { recursive: true });
    const output = path.join(evidence, `${execution}.log`);
    fs.writeFileSync(output, redact(log), { flag: 'wx' });
    process.stdout.write(`${redact(log)}\nEvidence: ${output}\n`);
  });
