import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { types } from 'node:util';

export interface ObserverOptions {
  runId: string;
  role: 'parent' | 'child';
  directory: string;
  allowedTarget: string;
  binding: { path: string; sha256: string };
  actorIds: readonly string[];
}
export interface StartupInput {
  backendPackageFile: string;
  programFiles: ReadonlyArray<{ path: string; sha256: string }>;
}
type Kind = 'access' | 'refresh';
type Identity = { ordinal: number; userId: string; kind: Kind };
type Ordinal = { ordinal: number };
interface CredentialState extends Identity {
  response?: number;
  clientEnd?: 'ended' | 'error' | 'aborted' | 'destroyed';
  receipt: boolean;
  server: boolean;
  guard: boolean;
  finish: boolean;
  close: boolean;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const MAX_EVENTS = 4096;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_LINE = 16 * 1024;
const EXPECTED = 264;
const errorNames = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError',
  'ReferenceError', 'Warning', 'DeprecationWarning', 'AggregateError']);
function object(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype && Object.getPrototypeOf(prototype) !== null) return;
    const properties = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).length !== keys.length
      || keys.some(key => !properties[key] || !('value' in properties[key]))) return;
    return Object.fromEntries(keys.map(key => [key, properties[key].value]));
  } catch { return; }
}
function safePath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1024 && isAbsolute(value)
    && !/[\r\n\x00]|(?:postgres(?:ql)?|https?):\/\/|\beyJ[\w-]*\.[\w-]+\.[\w-]+/i.test(value);
}
function hashFile(file: string) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function fileReference(file: string) {
  return { path: file, realpath: fs.realpathSync(file), sha256: hashFile(file) };
}
function diagnosticProperty(error: unknown, key: string): {
  value?: unknown; source: 'data' | 'accessor-not-read' | 'unavailable';
} {
  let owner = error;
  for (let depth = 0; depth < 8 && owner && typeof owner === 'object'; depth++) {
    if (types.isProxy(owner)) return { source: 'unavailable' };
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor) return 'value' in descriptor
      ? { value: descriptor.value, source: 'data' }
      : { source: 'accessor-not-read' };
    owner = Object.getPrototypeOf(owner) as unknown;
  }
  return { source: 'unavailable' };
}
function driver(role: string, file: string) {
  if (!safePath(file)) throw Error('Invalid physical driver path');
  let directory = dirname(file);
  while (!fs.existsSync(join(directory, 'package.json'))) {
    const parent = dirname(directory);
    if (parent === directory) throw Error('Driver package unavailable');
    directory = parent;
  }
  const packageFile = join(directory, 'package.json');
  const info = JSON.parse(fs.readFileSync(packageFile, 'utf8')) as {
    name?: unknown; version?: unknown;
  };
  if (typeof info.name !== 'string' || !/^[@a-z0-9/._-]{1,80}$/i.test(info.name)
    || typeof info.version !== 'string' || !/^[0-9a-z.+_-]{1,80}$/i.test(info.version))
    throw Error('Invalid driver package metadata');
  return { role, ...fileReference(file),
    package: { name: info.name, version: info.version, ...fileReference(packageFile) } };
}

export function createLifecycleObserver(input: ObserverOptions) {
  const options = object(input, ['runId', 'role', 'directory', 'allowedTarget', 'binding', 'actorIds']);
  if (!options || typeof input.runId !== 'string' || !UUID.test(input.runId)
    || !['parent', 'child'].includes(input.role) || !safePath(input.directory)
    || !safePath(input.allowedTarget)) throw Error('Invalid observer run whitelist');
  const directory = resolve(input.directory);
  const target = join(directory, `${input.runId}.${input.role}.observer.jsonl`);
  if (input.allowedTarget !== target || fs.realpathSync(directory) !== directory
    || fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory())
    throw Error('Observer target outside exact run whitelist');
  const binding = object(input.binding, ['path', 'sha256']);
  if (!binding || !safePath(input.binding.path) || typeof input.binding.sha256 !== 'string'
    || !HASH.test(input.binding.sha256)
    || hashFile(input.binding.path) !== input.binding.sha256)
    throw Error('Observer binding bytes do not match');
  if (!Array.isArray(input.actorIds) || input.actorIds.length !== 132
    || input.actorIds.some(id => typeof id !== 'string' || !UUID.test(id))
    || new Set(input.actorIds).size !== 132)
    throw Error('Observer requires exact 132 synthetic actor identities');
  const actors = new Set(input.actorIds);
  const runId = input.runId;
  const role = input.role;
  const bindingRef = { path: input.binding.path, sha256: input.binding.sha256 };
  const parentIdentity = fs.statSync(directory);
  const fd = fs.openSync(target, 'wx', 0o600);
  const identity = fs.fstatSync(fd);
  let sequence = 0, bytes = 0;
  let healthy = true, writerFailed = false, closed = false, startupRecorded = false;
  let monitoring = false;
  const requests = new Map<number, CredentialState>();
  const identities = new Set<string>();
  const frameRoots = new Set<string>([directory]);
  function emit(event: string, data: object): boolean {
    if (closed || writerFailed) return false;
    try {
      const parent = fs.statSync(directory);
      const named = fs.lstatSync(target);
      const held = fs.fstatSync(fd);
      if (parent.ino !== parentIdentity.ino || parent.dev !== parentIdentity.dev
        || fs.realpathSync(directory) !== directory || named.isSymbolicLink()
        || named.ino !== identity.ino || named.dev !== identity.dev
        || held.ino !== identity.ino || held.dev !== identity.dev)
        throw Error('Observer evidence ownership changed');
      const line = Buffer.from(JSON.stringify({
        runId, role, bindingSha256: bindingRef.sha256,
        sequence: sequence + 1, monotonicNs: process.hrtime.bigint().toString(),
        event, data,
      }) + '\n');
      if (sequence >= MAX_EVENTS || line.length > MAX_LINE || bytes + line.length > MAX_BYTES)
        throw Error('Observer evidence bound exceeded');
      if (fs.writeSync(fd, line) !== line.length) throw Error('Short observer write');
      sequence++;
      bytes += line.length;
      return true;
    } catch {
      healthy = false;
      writerFailed = true;
      return false;
    }
  }
  function reject() {
    healthy = false;
    emit('observation-rejected', { reason: 'identity-sequence-or-schema' });
    return false;
  }
  function existing(value: unknown, keys: readonly string[]) {
    const fields = object(value, keys);
    if (!fields || !Number.isInteger(fields.ordinal)) return;
    const request = requests.get(fields.ordinal as number);
    return request ? { fields, request } : undefined;
  }
  function state() {
    const all = [...requests.values()];
    const serverInFlight = all.filter(row => row.server && !(row.guard && row.finish && row.close)).length;
    const drained = healthy && all.length === EXPECTED && all.every(row =>
      row.response === 401 && row.receipt && row.clientEnd === 'ended'
      && row.server && row.guard && row.finish && row.close);
    return {
      healthy, writerFailed, closed, startupRecorded, expectedCredentials: EXPECTED,
      started: all.length, responses: all.filter(row => row.response !== undefined).length,
      clientTerminal: all.filter(row => row.clientEnd !== undefined).length,
      receipts: all.filter(row => row.receipt).length,
      serverStarted: all.filter(row => row.server).length,
      guardCompleted: all.filter(row => row.guard).length,
      serverFinished: all.filter(row => row.finish).length,
      serverClosed: all.filter(row => row.close).length,
      serverInFlight, drained,
      observationComplete: drained && startupRecorded,
      provesDatabaseOrNativeSocketDrain: false,
    };
  }
  function ordinalEvent(value: unknown, event: 'receipt-written' | 'server-finish' | 'server-close') {
    const current = existing(value, ['ordinal']);
    if (!current) return reject();
    const { request } = current;
    const field = event === 'receipt-written' ? 'receipt' : event === 'server-finish' ? 'finish' : 'close';
    if (request[field] || (field === 'receipt' ? request.response === undefined : !request.server))
      return reject();
    if (!emit(event, { ordinal: request.ordinal })) return false;
    request[field] = true;
    return true;
  }
  function contain(action: () => boolean) {
    try {
      return action();
    } catch {
      healthy = false;
      return false;
    }
  }
  function diagnostic(event: 'warning' | 'uncaught-exception', error: unknown, origin = 'unknown') {
    return contain(() => {
      if (event !== 'warning' && event !== 'uncaught-exception') return reject();
      // Do not invoke accessors: even reading a native lazy stack can alter fatal rendering.
      const nameValue = diagnosticProperty(error, 'name').value;
      const messageValue = diagnosticProperty(error, 'message').value;
      const stackProperty = diagnosticProperty(error, 'stack');
      const name = typeof nameValue === 'string' && errorNames.has(nameValue) ? nameValue : 'Other';
      const stack = typeof stackProperty.value === 'string' && stackProperty.value.length <= 65536
        ? stackProperty.value : '';
      const frames: Array<{ path: string; line: number; column: number }> = [];
      for (const line of stack.split('\n').slice(1, 33)) {
        const match = /(?:\(|\s)([A-Za-z]:[\\/][^()\r\n]+):(\d+):(\d+)\)?$/.exec(line);
        if (!match || !safePath(match[1])) continue;
        const file = resolve(match[1]);
        if (![...frameRoots].some(root => file.startsWith(root + '\\') || file.startsWith(root + '/'))) continue;
        if (!/\.(?:[cm]?js|ts)$/i.test(file) || !fs.existsSync(file)) continue;
        frames.push({ path: file, line: Number(match[2]), column: Number(match[3]) });
        if (frames.length === 12) break;
      }
      const knownWarning = messageValue === 'Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.';
      return emit(event, {
        name, classification: knownWarning ? 'PG_QUERY_QUEUE_DEPRECATION' : 'UNCLASSIFIED',
        message: '[REDACTED_FREE_TEXT]', frames, stackSource: stackProperty.source,
        origin: ['uncaughtException', 'unhandledRejection'].includes(origin) ? origin : 'unknown',
      });
    });
  }
  const onWarning = (warning: Error) => { contain(() => diagnostic('warning', warning)); };
  const onUncaught = (error: Error, origin: string) => {
    contain(() => diagnostic('uncaught-exception', error, origin));
  };
  const onExit = (exitCode: number) => {
    contain(() => {
      try { return emit('process-exit', { exitCode, observation: state() }); }
      finally { close(); }
    });
  };
  function close() {
    if (closed) return;
    if (monitoring) {
      process.off('warning', onWarning);
      process.off('uncaughtExceptionMonitor', onUncaught);
      process.off('exit', onExit);
      monitoring = false;
    }
    try { fs.fsyncSync(fd); } catch { healthy = false; writerFailed = true; }
    try { fs.closeSync(fd); } catch { healthy = false; writerFailed = true; }
    closed = true;
  }
  const observer = {
    requestId(ordinal: number) {
      if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > EXPECTED)
        throw Error('Invalid observer ordinal');
      return `${runId}:${ordinal}`;
    },
    credentialStart(value: Identity) {
      const fields = object(value, ['ordinal', 'userId', 'kind']);
      if (!fields || !Number.isInteger(fields.ordinal)
        || fields.ordinal !== requests.size + 1 || (fields.ordinal as number) > EXPECTED
        || typeof fields.userId !== 'string' || !actors.has(fields.userId)
        || (fields.kind !== 'access' && fields.kind !== 'refresh')
        || identities.has(`${fields.userId}:${fields.kind}`)) return reject();
      const record: Identity = { ordinal: fields.ordinal as number, userId: fields.userId, kind: fields.kind };
      if (!emit('credential-start', record)) return false;
      requests.set(record.ordinal, { ...record, receipt: false, server: false,
        guard: false, finish: false, close: false });
      identities.add(`${record.userId}:${record.kind}`);
      return true;
    },
    clientResponse(value: Ordinal & { status: number }) {
      const current = existing(value, ['ordinal', 'status']);
      if (!current || current.request.response !== undefined
        || !Number.isInteger(current.fields.status)
        || (current.fields.status as number) < 100 || (current.fields.status as number) > 599)
        return reject();
      const status = current.fields.status as number;
      if (!emit('client-response', { ordinal: current.request.ordinal, status })) return false;
      current.request.response = status;
      return true;
    },
    clientEnd(value: Ordinal & { outcome: 'ended' | 'error' | 'aborted' | 'destroyed' }) {
      const current = existing(value, ['ordinal', 'outcome']);
      if (!current || current.request.clientEnd !== undefined
        || typeof current.fields.outcome !== 'string'
        || !['ended', 'error', 'aborted', 'destroyed'].includes(current.fields.outcome))
        return reject();
      const outcome = current.fields.outcome as NonNullable<CredentialState['clientEnd']>;
      if (!emit('client-end', { ordinal: current.request.ordinal, outcome })) return false;
      current.request.clientEnd = outcome;
      return true;
    },
    receiptWritten: (value: Ordinal) => ordinalEvent(value, 'receipt-written'),
    serverStart(value: Ordinal & { requestId: string }) {
      const current = existing(value, ['ordinal', 'requestId']);
      if (!current || current.request.server
        || current.fields.requestId !== `${runId}:${current.request.ordinal}`) return reject();
      if (!emit('server-start', { ordinal: current.request.ordinal,
        requestId: current.fields.requestId })) return false;
      current.request.server = true;
      return true;
    },
    guardEnd(value: Ordinal & { outcome: 'allowed' | 'rejected' }) {
      const current = existing(value, ['ordinal', 'outcome']);
      if (!current || !current.request.server || current.request.guard
        || typeof current.fields.outcome !== 'string'
        || !['allowed', 'rejected'].includes(current.fields.outcome)) return reject();
      if (!emit('guard-end', { ordinal: current.request.ordinal, outcome: current.fields.outcome })) return false;
      current.request.guard = true;
      return true;
    },
    serverFinish: (value: Ordinal) => ordinalEvent(value, 'server-finish'),
    serverClose: (value: Ordinal) => ordinalEvent(value, 'server-close'),
    recordSummary: () => emit('observation-summary', state()),
    recordDiagnostic: diagnostic,
    recordStartup(value: StartupInput) {
      try {
        if (startupRecorded || !object(value, ['backendPackageFile', 'programFiles'])
          || !safePath(value.backendPackageFile)
          || basename(value.backendPackageFile) !== 'package.json'
          || basename(dirname(value.backendPackageFile)) !== 'backend'
          || !Array.isArray(value.programFiles) || value.programFiles.length < 1
          || value.programFiles.length > 12) return reject();
        const programs = value.programFiles.map(item => {
          if (!object(item, ['path', 'sha256']) || !safePath(item.path)
            || typeof item.sha256 !== 'string'
            || !HASH.test(item.sha256) || hashFile(item.path) !== item.sha256)
            throw Error('Startup program binding mismatch');
          return fileReference(item.path);
        });
        if (new Set(programs.map(item => item.path)).size !== programs.length) return reject();
        const main = dirname(dirname(value.backendPackageFile));
        frameRoots.add(main);
        for (const item of programs) frameRoots.add(dirname(item.path));
        const allowedArguments = new Set<string>([
          process.execPath, main, bindingRef.path, ...programs.map(item => item.path),
          '--child', 'execute', '--require', '--unhandled-rejections=throw', '--unhandled-rejections=strict',
        ]);
        const argv = (args: string[]) => args.slice(0, 32)
          .map(argument => allowedArguments.has(argument) ? argument : '[OMITTED_ARG]');
        const safeEnvironment: Record<string, string> = {};
        for (const [key, allowed] of Object.entries({
          NODE_ENV: 'test', AUTH_DRIVER: 'mock', PAYMENT_DRIVER: 'mock',
          MESSAGE_DRIVER: 'mock', NODE_DISABLE_COMPILE_CACHE: '1', DISABLE_V8_COMPILE_CACHE: '1',
        })) if (process.env[key] === allowed) safeEnvironment[key] = allowed;
        const startup = emit('startup', {
          node: {
            execPath: process.execPath, realpath: fs.realpathSync(process.execPath),
            sha256: hashFile(process.execPath), version: process.version,
            versions: { ...process.versions }, platform: process.platform, arch: process.arch,
            pid: process.pid, ppid: process.ppid,
          },
          argv: argv(process.argv), execArgv: argv(process.execArgv),
          environment: safeEnvironment, binding: bindingRef, programs,
          representsOnlyThisProcess: true, grantsResourceAdmission: false,
        });
        const backend = createRequire(value.backendPackageFile);
        const adapter = backend.resolve('@prisma/adapter-pg');
        const nestedPg = createRequire(adapter).resolve('pg');
        const nestedPool = createRequire(nestedPg).resolve('pg-pool');
        const topPg = backend.resolve('pg');
        const drivers = emit('drivers', {
          resolutionDomain: 'node-createRequire',
          confirmsJestLoadedTheseModules: false,
          modules: [
            driver('prisma-adapter', adapter), driver('adapter-pg-driver', nestedPg),
            driver('adapter-pg-client', join(dirname(nestedPg), 'client.js')),
            driver('adapter-pg-pool', nestedPool), driver('backend-pg-driver', topPg),
          ],
        });
        startupRecorded = startup && drivers;
        return startupRecorded;
      } catch {
        healthy = false;
        emit('startup-observation-failed', { reason: 'path-binding-or-resolution' });
        return false;
      }
    },
    installProcessMonitors() {
      if (closed || monitoring) return reject();
      process.on('warning', onWarning);
      process.on('uncaughtExceptionMonitor', onUncaught);
      process.on('exit', onExit);
      monitoring = true;
      return true;
    },
    state,
    close,
  };
  if (!emit('observer-open', { expectedCredentials: EXPECTED, actorCount: actors.size,
    scope: 'observation-only' })) {
    close();
    throw Error('Observer initial evidence write failed');
  }
  return observer;
}
export type LifecycleObserver = ReturnType<typeof createLifecycleObserver>;
