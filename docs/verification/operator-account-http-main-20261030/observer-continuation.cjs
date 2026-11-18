'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Module } = require('node:module');
const { spawn } = require('node:child_process');
const stage = process.argv[2];
const main = path.resolve(process.argv[3] || path.resolve(__dirname, '../../..'));
const allocationFile = process.env.OPERATOR_ACCOUNT_MAIN_ALLOCATION;
assert(['execute', '--child'].includes(stage), 'Only allocated execute or child mode');
assert(allocationFile && path.resolve(allocationFile) === allocationFile,
  'Absolute new observer allocation required before any write');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const allocation = read(allocationFile);
const directory = path.dirname(allocationFile);
const entry = 'backend/test/support/operator-account-main-lifecycle.live.ts';
const self = 'docs/verification/operator-account-http-main-20261030/observer-continuation.cjs';
const helper = 'backend/test/support/operator-account-main-observation.ts';
const observer = 'backend/test/support/operator-account-lifecycle-observer.ts';
const transform = 'docs/verification/operator-account-http-main-20261030/transform-main.cjs';
assert.equal(sha(allocationFile), read(path.join(directory, 'allocation-receipt.json')).allocationSha256);
assert(allocation.kind === 'E01_E02_PAGE_HTTP_POSTGRES' && allocation.status === 'ALLOCATED'
  && allocation.coordinatorApproved === true && allocation.mainIntegrated === true);
assert.equal(allocation.executionScope,
  'Only new account credential lifecycle observation; preserve captured business and original credential gaps');
assert(Date.now() >= Date.parse(allocation.opensAt)
  && Date.now() + 5 * 60_000 < Date.parse(allocation.expiresAt));
for (const [name, expected] of Object.entries(allocation.sources)) {
  assert(!path.isAbsolute(name) && !name.split(/[\\/]/).includes('..'));
  assert.equal(sha(path.resolve(main, name)), expected, 'Bound source changed: ' + name);
}
for (const name of [self, helper, observer, entry, transform])
  assert.equal(allocation.sources[name], sha(path.resolve(main, name)));
assert.equal(sha(__filename), allocation.sources[self]);
const redact = value => String(value ?? '')
  .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>\\]+/gi, '[REDACTED_POSTGRES_URL]')
  .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]');
function loadBound(name) {
  const filename = path.resolve(main, name);
  const compiled = require(path.resolve(main, transform)).process(fs.readFileSync(filename, 'utf8'), filename).code;
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  instance._compile(compiled, filename);
  return instance.exports;
}
const factory = loadBound(observer).createLifecycleObserver;
if (stage === '--child') {
  // This closure keeps the real Node resolver; Jest has its own virtual createRequire.
  process.accountObserverNodeFactory = {
    create: factory, path: path.resolve(main, observer), sha256: allocation.sources[observer],
  };
  const { runCLI } = require(path.join(main, 'backend/node_modules/jest'));
  (async () => {
    const { results } = await runCLI({ config: JSON.stringify({
      rootDir: main, roots: [path.join(main, 'backend/test/support')],
      testMatch: [path.join(main, entry).replaceAll('\\', '/')],
      moduleFileExtensions: ['ts', 'js', 'json', 'cjs'], testEnvironment: 'node',
      modulePaths: [path.join(main, 'backend/node_modules'), path.join(main, 'frontend/node_modules')],
      transform: { '^.+\\.ts$': path.join(main, transform) },
      cache: false, cacheDirectory: path.join(directory, 'jest-cache'), reporters: [],
    }), runInBand: true, watch: false }, [main]);
    fs.writeFileSync(path.join(directory, allocation.execution + '-jest-result.json'), redact(JSON.stringify({
      at: new Date().toISOString(), actualMainEntry: true, success: results.success,
      lifecycleObservationOnly: true, passed: results.numPassedTests, failed: results.numFailedTests,
      failures: results.testResults.flatMap(suite => suite.failureMessage || []),
    }, null, 2)) + '\n', { flag: 'wx' });
    process.exitCode = results.success ? 0 : 1;
  })().catch(error => { console.error(redact(error.stack)); process.exitCode = 1; });
} else {
  loadBound(helper).createAllocatedObservation(allocation, main, allocationFile, 'parent', factory);
  fs.writeFileSync(path.join(directory, allocation.execution + '-parent-claim.json'),
    JSON.stringify({ at: new Date().toISOString(), execution: allocation.execution }) + '\n', { flag: 'wx' });
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(?:NODE_OPTIONS|NODE_COMPILE_CACHE|TS_NODE_|DATABASE_URL|PGOPTIONS|PGPASSWORD|AUTH_|JWT_|OPERATOR_ACCOUNT_MAIN_ALLOCATION)/i.test(key)));
  (async () => {
    const child = spawn(process.execPath, [__filename, '--child', main], {
      cwd: main, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...inherited, NODE_ENV: 'test', AUTH_DRIVER: 'mock', PAYMENT_DRIVER: 'mock', MESSAGE_DRIVER: 'mock',
        OPERATOR_ACCOUNT_MAIN_ALLOCATION: allocationFile,
        NODE_DISABLE_COMPILE_CACHE: '1', DISABLE_V8_COMPILE_CACHE: '1' },
    });
    let failure;
    const parentErrors = [];
    const output = { stdout: [], stderr: [] };
    const remember = (source, error) => {
      failure ??= error;
      parentErrors.push({ source, message: error.message });
    };
    child.on('error', error => remember('child', error));
    for (const name of ['stdout', 'stderr']) {
      child[name].setEncoding('utf8');
      child[name].on('data', text => output[name].push(text));
      child[name].on('error', error => remember(name, error));
    }
    const closed = await new Promise(resolve => child.once('close', (status, signal) =>
      resolve({ status: child.pid === undefined ? null : status, signal })));
    const receipt = path.join(directory, allocation.execution + '-runner.json');
    fs.writeFileSync(receipt, redact(JSON.stringify({
      at: new Date().toISOString(), status: closed.status, signal: closed.signal,
      error: failure?.message, stdout: output.stdout.join(''), stderr: output.stderr.join(''),
      parentErrors,
    }, null, 2)) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ execution: allocation.execution, status: closed.status, receipt }));
    process.exitCode = closed.status === 0 && !failure ? 0 : 1;
  })().catch(error => { console.error(redact(error.stack)); process.exitCode = 1; });
}
