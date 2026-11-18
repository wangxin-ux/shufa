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
const evidenceRoot = path.join(
  root,
  'docs/verification/operator-independent-20261027',
);
const runTag = `archive-${crypto.randomBytes(5).toString('hex')}`;
let password;
let target;
let started = false;
let log = '';

function redact(text) {
  let safe = String(text);
  for (const value of [
    target?.href,
    password,
    password && encodeURIComponent(password),
  ]) {
    if (value) safe = safe.split(value).join('[withheld]');
  }
  return safe.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/g, '[test-database]');
}
function command(program, args, env = process.env, timeout = 120_000) {
  const result = spawnSync(program, args, {
    cwd: backend,
    env,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    maxBuffer: 12 * 1024 * 1024,
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
  const result = spawnSync('docker', ['inspect', container], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  const value = JSON.parse(result.stdout)[0];
  if (
    value.Name !== `/${container}` ||
    value.Config.Image !== 'postgres:17-alpine' ||
    value.Config.Labels['education.owner'] !== owner ||
    value.Config.Labels['education.database'] !== database ||
    !/^archive-[0-9a-f]{10}$/.test(
      value.Config.Labels['education.run'] ?? '',
    ) ||
    value.HostConfig.PortBindings['5432/tcp']?.length !== 1 ||
    value.HostConfig.PortBindings['5432/tcp'][0].HostIp !== '127.0.0.1' ||
    value.HostConfig.PortBindings['5432/tcp'][0].HostPort !== '55437'
  )
    throw new Error('Existing container ownership or target mismatch');
  return value;
}

async function main() {
  if (
    !((process.argv.length === 3 && process.argv[2] === '--run') ||
      (process.argv.length === 4 && process.argv[2] === '--run' && process.argv[3] === '--flow-only'))
  ) {
    throw new Error('Use --run for this dedicated local archive verification');
  }
  let current = inspect();
  if (!current) {
    command('docker', ['image', 'inspect', 'postgres:17-alpine']);
    password = crypto.randomBytes(24).toString('hex');
    command('docker', [
      'create',
      '--name',
      container,
      '--label',
      `education.owner=${owner}`,
      '--label',
      `education.database=${database}`,
      '--label',
      `education.run=${runTag}`,
      '--cpus=1',
      '--memory=384m',
      '--publish',
      '127.0.0.1:55437:5432',
      '--env',
      'POSTGRES_USER=carchive',
      '--env',
      `POSTGRES_PASSWORD=${password}`,
      '--env',
      `POSTGRES_DB=${database}`,
      'postgres:17-alpine',
    ]);
    current = inspect();
  }
  if (!current || current.State.Running) {
    throw new Error(
      'Expected an owned stopped test container, not an active writer',
    );
  }
  password = current.Config.Env.find((entry) =>
    entry.startsWith('POSTGRES_PASSWORD='),
  )?.slice(18);
  if (!password) throw new Error('Owned test credentials unavailable');
  target = new URL(`postgresql://127.0.0.1:55437/${database}`);
  target.username = 'carchive';
  target.password = password;
  command('docker', ['start', container]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = spawnSync(
      'docker',
      [
        'exec',
        container,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'carchive',
        '-d',
        database,
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      },
    );
    if (result.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Owned database did not become ready');
  const client = new Client({
    connectionString: target.href,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    const result = await client.query(
      'SELECT current_database() AS database, current_user AS actor',
    );
    if (
      result.rows[0].database !== database ||
      result.rows[0].actor !== 'carchive'
    ) {
      throw new Error('Database identity mismatch');
    }
  } finally {
    await client.end();
  }
  log += `PREFLIGHT ${JSON.stringify({ runTag, container, database, owner, loopbackPort: 55437, verified: true })}\n`;
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    AUTH_DRIVER: 'mock',
    PAYMENT_DRIVER: 'mock',
    MESSAGE_DRIVER: 'mock',
    PAYOUT_DRIVER: 'manual',
    PORT: '3001',
    REDIS_URL: 'redis://127.0.0.1:6379',
    DATABASE_URL: target.href,
    CAMPUS_ARCHIVE_TEST_DB_NAME: database,
    JWT_ACCESS_SECRET: 'campus-archive-test-access-secret-32-characters',
    JWT_REFRESH_SECRET: 'campus-archive-test-refresh-secret-32-characters',
    FILE_STORAGE_DRIVER: 'local',
    FILE_STORAGE_ROOT: path.join(
      backend,
      'storage/campus-archive-test',
      runTag,
    ),
    TZ: 'Asia/Shanghai',
  };
  log += command(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    env,
  );
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/jest/bin/jest.js',
      '--config',
      'test/jest-e2e.json',
      '--runInBand',
      '--verbose',
      '--runTestsByPath',
      ...(process.argv[3] === '--flow-only' ? [] : ['test/operator-student-archive.e2e-spec.ts']),
      'test/operator-copy-flow.e2e-spec.ts',
    ],
    {
      cwd: backend,
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 180_000,
      maxBuffer: 12 * 1024 * 1024,
    },
  );
  log += redact((result.stdout || '') + (result.stderr || ''));
  log += `\nTEST_EXIT ${JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message })}\n`;
  if (result.status !== 0 || result.error || result.signal)
    process.exitCode = 1;
}

main()
  .catch((error) => {
    log += `FAILURE ${redact(error.message)}\n`;
    process.exitCode = 1;
  })
  .finally(() => {
    if (started) {
      try {
        inspect();
        command(
          'docker',
          ['stop', '--time', '10', container],
          process.env,
          30_000,
        );
        const final = inspect();
        if (final.State.Running)
          throw new Error('Owned container is still running');
        log += `POSTFLIGHT ${JSON.stringify({ container, running: false, retained: true })}\n`;
      } catch (error) {
        log += `POSTFLIGHT_FAILURE ${redact(error.message)}\n`;
        process.exitCode = 1;
      }
    }
    fs.mkdirSync(evidenceRoot, { recursive: true });
    const output = path.join(evidenceRoot, `${runTag}.log`);
    fs.writeFileSync(output, redact(log), { flag: 'wx' });
    process.stdout.write(`${redact(log)}\nEvidence: ${output}\n`);
  });
