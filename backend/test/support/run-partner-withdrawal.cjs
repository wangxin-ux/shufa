const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { load } = require('../../node_modules/js-yaml');
const { Client } = require('../../node_modules/pg');
const { databaseReady, safeDiagnostics } = require('./staff-create-runner-policy.cjs');
const root = path.resolve(__dirname, '../../..');
const databaseName = 'education_app_test_partner_pdf_20261012contact_test';
const migrations = ['202610160001_partner_withdrawal_simulation', '202610160002_partner_payout_evidence_outcome'];
async function main() {
  const mode = process.argv[2];
  if (!['red', 'green', 'migrate'].includes(mode)) throw Error('Unsupported mode');
  const output = path.join(root, `docs/verification/partner-withdrawal-2026-10-16-${mode}-${Date.now()}.log`);
  const config = load(fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8')).services.postgres_test;
  if (!config.ports.includes('5433:5432')) throw Error('Isolated database mapping mismatch');
  const target = new URL(`postgresql://127.0.0.1:5433/${databaseName}`);
  target.username = config.environment.POSTGRES_USER; target.password = config.environment.POSTGRES_PASSWORD;
  if (!await databaseReady(new Client({ connectionString: target.href, connectionTimeoutMillis: 3000, query_timeout: 3000 }), databaseName))
    throw Error('Isolated database unavailable; no writes executed');
  if (mode === 'migrate') {
    const pg = new Client({ connectionString: target.href });
    await pg.connect();
    try {
      const applied = new Set((await pg.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows.map(r => r.migration_name));
      const pending = fs.readdirSync(path.join(root, 'backend/prisma/migrations'), { withFileTypes: true }).filter(d => d.isDirectory() && !applied.has(d.name)).map(d => d.name);
      if (!pending.length || pending.some(name => !migrations.includes(name))) throw Error('Unexpected pending migrations; stopped');
    } finally { await pg.end(); }
  }
  const command = mode === 'migrate'
    ? ['node_modules/prisma/build/index.js', 'migrate', 'deploy']
    : ['node_modules/jest/bin/jest.js', '--config', 'test/jest-e2e.json', '--runInBand', '--verbose', '--runTestsByPath', 'test/partner-withdrawal.e2e-spec.ts'];
  const result = spawnSync(process.execPath, command, {
    cwd: path.join(root, 'backend'), encoding: 'utf8', timeout: 180000,
    env: { ...process.env, NODE_ENV: 'test', AUTH_DRIVER: 'mock', PAYMENT_DRIVER: 'mock', MESSAGE_DRIVER: 'mock', DATABASE_URL: target.href, PARTNER_PDF_TEST_DB_NAME: databaseName, PARTNER_WITHDRAWAL_DRIVER: 'mock' },
  });
  let text = `PARTNER_WITHDRAWAL_PREFLIGHT ${JSON.stringify({ database: databaseName, mode })}\n${result.stdout || ''}${result.stderr || ''}\nEXIT ${result.status}\n`;
  text = text.replaceAll(target.href, '[DATABASE_URL]').replace(/postgres(?:ql)?:\/\/[^\s'"]+/g, '[DATABASE_URL]');
  if (!safeDiagnostics(text)) throw Error('Sensitive diagnostics withheld');
  fs.writeFileSync(output, text, { flag: 'wx' });
  process.stdout.write(text);
  process.exitCode = result.status === 0 && !result.error && !result.signal ? 0 : 1;
}
main().catch(() => { console.error('Withdrawal runner stopped before unsafe action; details withheld'); process.exitCode = 1; });
