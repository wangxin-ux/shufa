import {
  readFileSync,
  openSync,
  closeSync,
  fstatSync,
  statSync,
  ftruncateSync,
  fsyncSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { Client } from 'pg';
import {
  requireMain,
  assertMainStoppedPredecessor,
  type MainAllocation,
} from './operator-account-main-admission';
import {
  closeOwnedResource,
  type Generation,
  type ResourceCloseout,
} from './operator-account-main-resource';

interface DockerContainer {
  Id: string;
  Name: string;
  Image: string;
  Config: { Labels: Record<string, string>; Env: string[] };
  HostConfig: {
    PortBindings: Record<string, Array<{ HostIp: string; HostPort: string }>>;
  };
  Mounts: Array<{ Type: string; Name: string; Destination: string }>;
  State: {
    Running: boolean;
    Status: string;
    Pid: number;
    ExitCode: number;
    StartedAt: string;
    FinishedAt: string;
  };
  RestartCount: number;
}
interface DockerVolume {
  Name: string;
  Labels?: Record<string, string>;
}
interface DockerContext {
  Endpoints?: { docker?: { Host?: string } };
}
interface LockMarker {
  execution: string;
  nonce: string;
  containerId: string;
  generation?: Generation;
}

// Same common lock as all current 55437 consumers. No role-specific lock.
export function createMainAccountResource(
  a: Pick<
    MainAllocation,
    'execution' | 'resource' | 'executionScope' | 'predecessor'
  >,
  mainRoot: string,
  ready: () => void,
) {
  const r = a.resource,
    nonce = randomUUID();
  const lockPath = resolve(
    mainRoot,
    '.tools-automation/tmp/operator-teacher-archive-55437.lock',
  );
  let fd: number | undefined,
    started: Generation | undefined,
    audit: Client | undefined;
  let recorded = false,
    dockerHost = '',
    closing: Promise<ResourceCloseout> | undefined;
  const command = (...args: string[]) => {
    const result = spawnSync(
      'docker',
      [...(dockerHost ? ['--host', dockerHost] : []), ...args],
      { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 4e6 },
    );
    requireMain(
      result.status === 0 && !result.error && !result.signal,
      'docker command failed',
    );
    return result.stdout;
  };
  const inspect = () => {
    const current = (
      JSON.parse(command('inspect', r.containerId)) as DockerContainer[]
    )[0];
    const labels = current.Config.Labels,
      bindings = current.HostConfig.PortBindings;
    const env = Object.fromEntries(
      current.Config.Env.map((entry: string) => {
        const index = entry.indexOf('=');
        return [entry.slice(0, index), entry.slice(index + 1)];
      }),
    );
    requireMain(
      current.Id === r.containerId &&
        current.Name === `/${r.container}` &&
        current.Image === r.image &&
        Object.keys(labels).length === 3 &&
        labels['education.database'] === r.database &&
        labels['education.owner'] === r.owner &&
        labels['education.run'] === r.resourceRun &&
        Object.keys(bindings).length === 1 &&
        bindings['5432/tcp'].length === 1 &&
        bindings['5432/tcp'][0].HostIp === r.host &&
        bindings['5432/tcp'][0].HostPort === String(r.port) &&
        current.Mounts.length === 1 &&
        current.Mounts[0].Type === 'volume' &&
        current.Mounts[0].Name === r.volume &&
        current.Mounts[0].Destination === '/var/lib/postgresql/data' &&
        env.POSTGRES_DB === r.database &&
        env.POSTGRES_USER === r.role &&
        typeof env.POSTGRES_PASSWORD === 'string' &&
        !!env.POSTGRES_PASSWORD,
      'resource identity mismatch',
    );
    return { current, password: env.POSTGRES_PASSWORD };
  };
  const generation = (): Generation => {
    const { current } = inspect();
    requireMain(
      current.State.Running === true &&
        current.State.Pid > 0 &&
        Number.isFinite(Date.parse(current.State.StartedAt)) &&
        Number.isInteger(current.RestartCount),
      'running generation unavailable',
    );
    return {
      startedAt: current.State.StartedAt,
      pid: current.State.Pid,
      restartCount: current.RestartCount,
    };
  };
  const assertLock = () => {
    requireMain(fd !== undefined, 'common lock not owned');
    const held = fstatSync(fd),
      named = statSync(lockPath);
    const value = JSON.parse(readFileSync(lockPath, 'utf8')) as LockMarker;
    requireMain(
      held.ino === named.ino &&
        held.dev === named.dev &&
        value.execution === a.execution &&
        value.nonce === nonce &&
        value.containerId === r.containerId &&
        (!recorded ||
          JSON.stringify(value.generation) === JSON.stringify(started)),
      'common lock ownership changed',
    );
  };
  const assertPortClosed = () =>
    new Promise<void>((done, reject) => {
      const socket = createConnection({ host: r.host, port: r.port });
      socket.setTimeout(1500);
      socket.once('connect', () => {
        socket.destroy();
        reject(new Error('Dedicated DB port remains open'));
      });
      socket.once('error', (error: NodeJS.ErrnoException) => {
        socket.destroy();
        if (error.code === 'ECONNREFUSED') done();
        else reject(new Error('Dedicated DB port closure unconfirmed'));
      });
      socket.once('timeout', () => {
        socket.destroy();
        reject(new Error('DB port closure timed out'));
      });
    });
  const writeMarker = () => {
    requireMain(fd !== undefined, 'common lock not owned');
    const text = JSON.stringify({
      execution: a.execution,
      nonce,
      containerId: r.containerId,
      generation: started,
    });
    ftruncateSync(fd, 0);
    requireMain(
      writeSync(fd, text, 0, 'utf8') === Buffer.byteLength(text),
      'lock short write',
    );
    fsyncSync(fd);
  };
  return {
    lockPath,
    assertLockHeld() {
      assertLock();
    },
    state: () => ({
      generation: started,
      lockHeld: fd !== undefined,
      dockerHost,
    }),
    assertHeld() {
      assertLock();
      const { current } = inspect();
      requireMain(
        started &&
          current.State.Running &&
          current.State.StartedAt === started.startedAt &&
          current.State.Pid === started.pid &&
          current.RestartCount === started.restartCount,
        'generation changed',
      );
    },
    async start(): Promise<URL> {
      ready();
      requireMain(
        fd === undefined && !started && !closing,
        'resource start cannot be replayed',
      );
      fd = openSync(lockPath, 'wx');
      writeMarker();
      const context = (
        JSON.parse(command('context', 'inspect')) as DockerContext[]
      )[0];
      dockerHost = context.Endpoints?.docker?.Host ?? '';
      requireMain(
        /^npipe:\/{4}\.\/pipe\/[A-Za-z0-9_-]+$/.test(dockerHost),
        'local Docker named pipe required',
      );
      assertLock();
      const { current, password } = inspect();
      assertMainStoppedPredecessor(a, current);
      requireMain(
        current.State.Status === 'exited' &&
          current.State.Pid === 0 &&
          current.State.ExitCode === 0,
        'dedicated resource not safely released',
      );
      const volume = (
        JSON.parse(command('volume', 'inspect', r.volume)) as DockerVolume[]
      )[0];
      requireMain(
        volume.Name === r.volume &&
          Object.keys(volume.Labels ?? {}).length === 1 &&
          volume.Labels?.['com.docker.volume.anonymous'] === '',
        'volume ownership',
      );
      requireMain(
        command('ps', '-q', '--filter', `volume=${r.volume}`).trim() === '',
        'volume in use',
      );
      await assertPortClosed();
      command('start', r.containerId);
      started = generation();
      writeMarker();
      recorded = true;
      let available = false;
      for (let attempt = 0; attempt < 3 && !available; attempt++) {
        const result = spawnSync(
          'docker',
          [
            '--host',
            dockerHost,
            'exec',
            r.containerId,
            'pg_isready',
            '-U',
            r.role,
            '-d',
            r.database,
          ],
          { windowsHide: true, encoding: 'utf8', timeout: 5000 },
        );
        available = result.status === 0;
        if (!available && attempt < 2)
          await new Promise<void>((done) => setTimeout(done, 500));
      }
      requireMain(
        available,
        'dedicated PostgreSQL not ready after three bounded probes',
      );
      const target = new URL(
        `postgresql://${r.role}@${r.host}:${r.port}/${r.database}`,
      );
      target.password = password;
      return target;
    },
    finish(safeToStop: boolean): Promise<ResourceCloseout> {
      closing ??= (async () => {
        if (fd === undefined)
          return {
            stopped: false,
            lockReleased: false,
            retained: false,
            reason: 'not-acquired',
          };
        if (!started || !recorded || !safeToStop) {
          closeSync(fd);
          fd = undefined;
          return {
            stopped: false,
            lockReleased: false,
            retained: true,
            reason: 'ownership-or-cleanup-incomplete',
          };
        }
        const result = await closeOwnedResource(started, {
          assertLock() {
            assertLock();
          },
          generation,
          async freshAuditConnection() {
            requireMain(!audit, 'fresh audit already connected');
            const { password } = inspect();
            audit = new Client({
              host: r.host,
              port: r.port,
              database: r.database,
              user: r.role,
              password,
              ssl: false,
              connectionTimeoutMillis: 3000,
              query_timeout: 3000,
              application_name: `account-closeout:${a.execution}`,
              options:
                '-c default_transaction_read_only=on -c search_path=public -c statement_timeout=3000',
            });
            audit.on('error', () => undefined);
            await audit.connect();
            const identity = await audit.query<{
              database: string;
              actor: string;
            }>('SELECT current_database() AS database, current_user AS actor');
            requireMain(
              identity.rows[0]?.database === r.database &&
                identity.rows[0]?.actor === r.role,
              'fresh audit identity',
            );
          },
          async clearStatisticsSnapshot() {
            requireMain(audit, 'fresh audit not connected');
            await audit.query('SELECT pg_stat_clear_snapshot()');
          },
          async unknownClients() {
            requireMain(audit, 'fresh audit not connected');
            const result = await audit.query(
              "SELECT pid FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()",
            );
            return result.rows.map((row: { pid: number }) => row.pid);
          },
          async closeAuditConnection() {
            if (audit) {
              const client = audit;
              audit = undefined;
              await client.end();
            }
          },
          stop() {
            command('stop', '--time', '10', r.containerId);
          },
          async assertStopped() {
            await assertPortClosed();
            const { current } = inspect();
            requireMain(
              started &&
                current.State.Running === false &&
                current.State.Status === 'exited' &&
                current.State.ExitCode === 0 &&
                current.State.Pid === 0 &&
                current.State.StartedAt === started.startedAt &&
                current.RestartCount === started.restartCount,
              'dedicated stop state or generation unconfirmed',
            );
          },
          releaseLock() {
            assertLock();
            requireMain(
              lockPath ===
                resolve(
                  mainRoot,
                  '.tools-automation/tmp/operator-teacher-archive-55437.lock',
                ),
              'single disposable lock path',
            );
            // This task's unique reconstructible lock only, after verified stop and retained volume.
            unlinkSync(lockPath);
            closeSync(fd!);
            fd = undefined;
          },
        });
        if (fd !== undefined) {
          closeSync(fd);
          fd = undefined;
        }
        return result;
      })();
      return closing;
    },
  };
}
