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
const evidence = path.join(
  root,
  'docs/verification/operator-rankings-20261028',
);
const lockRoot = path.join(root, '.tools-automation/tmp');
const lockPath = path.join(lockRoot, 'operator-teacher-archive-55437.lock');
const allowed = new Set([
  'Campus',
  'User',
  'UserRole',
  'TeacherProfile',
  'ClassGroup',
  'Student',
  'LessonSession',
  'TeachingRecord',
  'PartnerEarningBasis',
  'PartnerEarningEntry',
  'PartnerEarningRule',
  'PartnerRankingStudentFact',
  'PartnerRankingRevision',
  'PartnerRankingRow',
  'AuditLog',
]);
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
let password, target, baseline, tables;
let locked = false;
let startAttempted = false;
let resourceClosed = true;
let accountsClosed = true;
let closeoutAccountIds = [];
let log = '';

function redact(value) {
  let result = String(value);
  for (const secret of [
    password,
    password && encodeURIComponent(password),
    target?.href,
  ])
    if (secret) result = result.split(secret).join('[withheld]');
  return result.replace(
    /postgres(?:ql)?:\/\/[^\s"'<>]+/g,
    '[coordinator-test-database]',
  );
}
function command(program, args, timeout = 15000) {
  const result = spawnSync(program, args, {
    cwd: backend,
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
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
  const current = JSON.parse(command('docker', ['inspect', container]))[0];
  const env = Object.fromEntries(
    current.Config.Env.map((entry) => {
      const at = entry.indexOf('=');
      return [entry.slice(0, at), entry.slice(at + 1)];
    }),
  );
  const binding = current.HostConfig.PortBindings['5432/tcp'];
  const storedVolume = JSON.parse(
    command('docker', ['volume', 'inspect', volume]),
  )[0];
  if (
    current.Name !== `/${container}` ||
    current.Config.Image !== 'postgres:17-alpine' ||
    current.Config.Labels['education.owner'] !== owner ||
    current.Config.Labels['education.database'] !== database ||
    current.Config.Labels['education.run'] !== resourceRun ||
    storedVolume.Name !== volume ||
    Object.keys(storedVolume.Labels).length !== 1 ||
    storedVolume.Labels['com.docker.volume.anonymous'] !== '' ||
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
    throw new Error(
      'Exact coordinator resource, ownership, volume or target gate failed',
    );
  password = env.POSTGRES_PASSWORD;
  if (!password) throw new Error('Owned credentials unavailable');
  return current;
}
function noListener() {
  command('powershell.exe', [
    '-NoProfile',
    '-Command',
    '$rankingListeners = @(Get-NetTCPConnection -State Listen -LocalPort 55437 -ErrorAction SilentlyContinue); if ($rankingListeners.Count) { throw "Coordinator port is in use" }; exit 0',
  ]);
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
async function idle(client) {
  const value = await client.query(
    'SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [database],
  );
  if (value.rows[0].count)
    throw new Error('Other database sessions remain; do not mutate or stop');
}
async function snapshot(client) {
  const result = {};
  for (const table of tables) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table))
      throw new Error('Unsafe table name');
    result[table] = (
      await client.query(`
      SELECT md5(row_to_json(t)::text) AS digest, row_to_json(t)->>'id' AS id,
      row_to_json(t)->>'campusId' AS campus, row_to_json(t)->>'userId' AS "userId",
      row_to_json(t)->>'studentId' AS student, row_to_json(t)->>'revisionId' AS revision,
      row_to_json(t)->>'status' AS status, row_to_json(t)->>'code' AS code
      FROM "${table}" t ORDER BY digest
    `)
    ).rows;
  }
  return result;
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
  if (process.argv.length !== 3 || process.argv[2] !== '--run')
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
  const context = JSON.parse(command('docker', ['context', 'inspect']))[0];
  if (!context.Endpoints.docker.Host.startsWith('npipe:'))
    throw new Error('Local Docker context required');
  target = new URL(`postgresql://127.0.0.1:55437/${database}`);
  target.username = 'carchive';
  target.password = password;
  fs.mkdirSync(evidence, { recursive: true });
  startAttempted = true;
  resourceClosed = false;
  command('docker', ['start', container]);
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = spawnSync(
      'docker',
      ['exec', container, 'pg_isready', '-q', '-U', 'carchive', '-d', database],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 3000,
      },
    );
    if (result.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!ready) throw new Error('Owned database did not become ready');
  await connect(async (client) => {
    await idle(client);
    const identity = (
      await client.query(
        'SELECT current_database() AS database, current_user AS actor',
      )
    ).rows[0];
    if (identity.database !== database || identity.actor !== 'carchive')
      throw new Error('Database identity mismatch');
    const migrations = (
      await client.query(
        'SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL',
      )
    ).rows;
    const source = fs
      .readdirSync(path.join(backend, 'prisma/migrations'), {
        withFileTypes: true,
      })
      .filter((row) => row.isDirectory());
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
      )
        throw new Error(
          `Migration checksum mismatch: ${item.name}; no automatic deploy`,
        );
    }
    tables = (
      await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename",
      )
    ).rows.map((row) => row.tablename);
    baseline = await snapshot(client);
    const allocation = {
      execution,
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
    };
    fs.writeFileSync(
      path.join(evidence, `${execution}-baseline.json`),
      JSON.stringify(baseline),
      { flag: 'wx' },
    );
    fs.writeFileSync(
      path.join(evidence, `${execution}-allocation.json`),
      JSON.stringify(allocation, null, 2),
      { flag: 'wx' },
    );
    log += `PREFLIGHT ${JSON.stringify({ ...allocation, oldUserIds: allocation.oldUserIds.length, oldCampusIds: allocation.oldCampusIds.length, tables: tables.length })}\n`;
  });
  accountsClosed = false;
  const test = spawnSync(
    process.execPath,
    [
      'node_modules/jest/bin/jest.js',
      '--config',
      'test/jest-e2e.json',
      '--runInBand',
      '--verbose',
      '--runTestsByPath',
      'test/operator-ranking.e2e-spec.ts',
    ],
    {
      cwd: backend,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        AUTH_DRIVER: 'mock',
        PAYMENT_DRIVER: 'mock',
        MESSAGE_DRIVER: 'mock',
        PAYOUT_DRIVER: 'manual',
        PORT: '3001',
        REDIS_URL: 'redis://127.0.0.1:6379',
        JWT_ACCESS_SECRET: crypto.randomBytes(32).toString('hex'),
        JWT_REFRESH_SECRET: crypto.randomBytes(32).toString('hex'),
        FILE_STORAGE_DRIVER: 'local',
        FILE_STORAGE_ROOT: path.join(
          backend,
          'storage/operator-ranking-test',
          execution,
        ),
        DATABASE_URL: target.href,
        CAMPUS_ARCHIVE_TEST_DB_NAME: database,
        OPERATOR_RANKING_TEST_ENABLED: '1',
        OPERATOR_RANKING_TEST_EXECUTION: execution,
        OPERATOR_RANKING_TEST_EVIDENCE: evidence,
        OPERATOR_RANKING_RESOURCE_RUN: resourceRun,
        TZ: 'Asia/Shanghai',
      },
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
    if (startAttempted) {
      let canStop = false;
      try {
        const current = inspect();
        if (!current.State.Running) {
          resourceClosed = current.State.Pid === 0;
          noListener();
          throw new Error(
            'Resource exited before independent account/fact closeout; no automatic restart',
          );
        }
        await connect(async (client) => {
          await idle(client);
          canStop = true;
          if (!baseline) throw new Error('No baseline; no account mutation');
          const manifests = (
            await client.query(
              `SELECT details, "actorUserId", "campusId" FROM "AuditLog"
          WHERE action = 'OPERATOR_RANKING_FIXTURE' AND "resourceId" = $1
          AND details->>'execution' = $1 AND details->>'syntheticOnly' = 'true'`,
              [execution],
            )
          ).rows;
          if (manifests.length > 1)
            throw new Error('Duplicate ranking fixture manifest');
          const manifest = manifests[0];
          const actors = manifest?.details.actors || [];
          const ids = actors.map((actor) => actor.id);
          closeoutAccountIds = ids;
          const oldIds = new Set(baseline.User.map((row) => row.id));
          if (
            new Set(ids).size !== ids.length ||
            ids.some((id) => oldIds.has(id))
          )
            throw new Error(
              'Manifest account gate failed; no fallback mutation',
            );
          if (ids.length) {
            const actual = (
              await client.query(
                'SELECT id FROM "User" WHERE id = ANY($1::uuid[])',
                [ids],
              )
            ).rows;
            const roles = (
              await client.query(
                'SELECT "userId", "roleCode", "campusId" FROM "UserRole" WHERE "userId" = ANY($1::uuid[])',
                [ids],
              )
            ).rows;
            if (
              actual.length !== ids.length ||
              actors.some((actor) => {
                const rows = roles.filter((role) => role.userId === actor.id);
                return (
                  rows.length !== actor.roles.length ||
                  actor.roles.some(
                    (role) =>
                      !rows.some(
                        (row) =>
                          row.roleCode === role.roleCode &&
                          row.campusId === role.campusId,
                      ),
                  )
                );
              })
            )
              throw new Error(
                'Persisted actor roles differ from the atomic manifest',
              );
          }
          const fallback = ids.length
            ? await client.query(
                `UPDATE "User" SET status = 'DISABLED', "updatedAt" = now() WHERE id = ANY($1::uuid[]) AND status <> 'DISABLED' RETURNING id`,
                [ids],
              )
            : { rowCount: 0 };
          const accountStates = ids.length
            ? (
                await client.query(
                  'SELECT id, status FROM "User" WHERE id = ANY($1::uuid[])',
                  [ids],
                )
              ).rows
            : [];
          if (
            accountStates.length !== ids.length ||
            accountStates.some((row) => row.status !== 'DISABLED')
          )
            throw new Error('Not all manifested ranking accounts are disabled');
          const after = await snapshot(client);
          const additions = Object.fromEntries(
            tables.map((table) => [table, newRows(after, table)]),
          );
          const campuses = new Set(additions.Campus.map((row) => row.id));
          const students = new Set(additions.Student.map((row) => row.id));
          const revisions = new Set(
            additions.PartnerRankingRevision.map((row) => row.id),
          );
          if (
            additions.User.length !== ids.length ||
            additions.Campus.some(
              (row) => !row.code.startsWith(`orank-${execution}-`),
            ) ||
            (manifest &&
              JSON.stringify([...campuses].sort()) !==
                JSON.stringify([...manifest.details.campusIds].sort()))
          )
            throw new Error(
              'New identities or campuses do not match the execution',
            );
          accountsClosed = true;
          for (const table of tables)
            for (const row of additions[table]) {
              if (!allowed.has(table))
                throw new Error(`Unallocated table was written: ${table}`);
              if (
                table === 'User' &&
                (!ids.includes(row.id) || row.status !== 'DISABLED')
              )
                throw new Error('Unmanifested or active ranking fixture user');
              if (table === 'UserRole' && !ids.includes(row.userId))
                throw new Error('Unexpected role owner');
              if (table === 'PartnerRankingRow') {
                if (!revisions.has(row.revision))
                  throw new Error(
                    'Rows added to a pre-existing ranking revision',
                  );
              } else if (row.campus && !campuses.has(row.campus))
                throw new Error(
                  `Row outside allocated synthetic campuses: ${table}`,
                );
              if (
                table === 'PartnerRankingStudentFact' &&
                !students.has(row.student)
              )
                throw new Error(
                  'Ranking trigger fact references another execution student',
                );
            }
          const resultFile = path.join(evidence, `${execution}-result.json`);
          const result = fs.existsSync(resultFile)
            ? JSON.parse(fs.readFileSync(resultFile, 'utf8'))
            : null;
          if (
            manifest &&
            (!result ||
              !result.hostClosed ||
              !result.factsUnchanged ||
              result.revoked.length !== ids.length ||
              result.revoked.some(
                (row) =>
                  row.status !== 'DISABLED' ||
                  row.issuedCredentialStatus !== 401,
              ))
          )
            throw new Error(
              'Missing actual app, business fact or issued credential closeout evidence',
            );
          const closeout = {
            execution,
            oldFactsPreserved: true,
            oldFactsSha256: hash(JSON.stringify(baseline)),
            checkedTables: tables.length,
            fallbackDisabledAccounts: fallback.rowCount,
            addedRows: Object.fromEntries(
              tables
                .filter((table) => additions[table].length)
                .map((table) => [table, additions[table].length]),
            ),
            accounts: ids.length,
            issuedCredentials401: result?.revoked.length || 0,
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
        if (!accountsClosed)
          log += `ACCOUNT_CLOSEOUT_UNCONFIRMED ${JSON.stringify({ execution, accountIds: closeoutAccountIds, lockRetained: true })}\n`;
        process.exitCode = 1;
      }
      if (canStop)
        try {
          inspect();
          command('docker', ['stop', '--time', '10', container], 30000);
          const final = inspect();
          if (
            final.State.Running ||
            final.State.Pid !== 0 ||
            final.State.ExitCode !== 0
          )
            throw new Error('Coordinator resource did not stop cleanly');
          noListener();
          resourceClosed = true;
          log += `POSTFLIGHT ${JSON.stringify({ running: false, pid: 0, exitCode: 0, listeners: 0, volumeRetained: true })}\n`;
        } catch (error) {
          log += `POSTFLIGHT_FAILURE ${redact(error.stack)}\n`;
          process.exitCode = 1;
        }
    }
    if (locked && resourceClosed && accountsClosed)
      try {
        const recorded = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (
          recorded.execution !== execution ||
          path.dirname(lockPath) !== lockRoot
        )
          throw new Error('Lock ownership mismatch');
        fs.unlinkSync(lockPath);
        log +=
          'LOCK_RELEASE this execution exclusive reconstructible temporary lock; no acceptance evidence removed\n';
      } catch (error) {
        log += `LOCK_RELEASE_FAILURE ${redact(error.stack)}\n`;
        process.exitCode = 1;
      }
    else if (locked)
      log += `LOCK_RETAINED ${JSON.stringify({ execution, resourceClosed, accountsClosed, accountIds: closeoutAccountIds })}\n`;
    fs.mkdirSync(evidence, { recursive: true });
    const output = path.join(evidence, `${execution}.log`);
    fs.writeFileSync(output, redact(log), { flag: 'wx' });
    process.stdout.write(`${redact(log)}\nEvidence: ${output}\n`);
  });
