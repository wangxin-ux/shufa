import {
  closeSync,
  fstatSync,
  ftruncateSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
  fsyncSync,
} from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { Client } from "pg";
import { type Allocation, requireSeries } from "./operator-series-admission";

export interface Generation {
  startedAt: string;
  pid: number;
  restartCount: number;
}
export interface CloseOperations {
  assertLock(): Promise<void>;
  generation(): Promise<Generation>;
  freshAudit(): Promise<void>;
  clearSnapshot(): Promise<void>;
  unknownClients(): Promise<number[]>;
  closeAudit(): Promise<void>;
  stop(): Promise<void>;
  verifyStopped(): Promise<void>;
  release(): Promise<void>;
}
export interface CloseResult {
  stopped: boolean;
  retained: boolean;
  lockReleased: boolean;
  reason?: string;
}
export async function closeResource(
  original: Generation,
  businessClosed: boolean,
  operations: CloseOperations,
): Promise<CloseResult> {
  let stopped = false,
    lockReleased = false;
  if (!businessClosed)
    return {
      stopped,
      lockReleased,
      retained: true,
      reason: "business-cleanup-incomplete",
    };
  const same = async () => {
    const actual = await operations.generation();
    requireSeries(
      original.pid > 0 &&
        Number.isInteger(original.pid) &&
        Number.isInteger(original.restartCount) &&
        original.restartCount >= 0 &&
        Number.isFinite(Date.parse(original.startedAt)) &&
        actual.startedAt === original.startedAt &&
        actual.pid === original.pid &&
        actual.restartCount === original.restartCount,
      "resource generation changed",
    );
  };
  try {
    await operations.assertLock();
    await same();
    await operations.freshAudit();
    await operations.clearSnapshot();
    requireSeries(
      (await operations.unknownClients()).length === 0,
      "unknown instance clients",
    );
    await operations.assertLock();
    await operations.clearSnapshot();
    requireSeries(
      (await operations.unknownClients()).length === 0,
      "late unknown instance clients",
    );
    await same();
    // The audit client stays connected until stop; no business/fact clients remain.
    await operations.stop();
    await operations.closeAudit();
    await operations.verifyStopped();
    stopped = true;
    await operations.release();
    lockReleased = true;
    return { stopped, lockReleased, retained: false };
  } catch {
    try {
      await operations.closeAudit();
    } catch {
      /* retain ownership on any uncertainty */
    }
    return {
      stopped,
      lockReleased,
      retained: true,
      reason: "ownership-client-generation-or-stop-unconfirmed",
    };
  }
}
interface Inspect {
  Id: string;
  Name: string;
  Image: string;
  RestartCount: number;
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
  };
}
export function seriesResource(
  a: Allocation,
  root: string,
  window: () => void,
) {
  const r = a.resource,
    nonce = randomUUID();
  const lockPath = resolve(
    root,
    ".tools-automation/tmp/operator-teacher-archive-55437.lock",
  );
  let fd: number | undefined,
    generation: Generation | undefined,
    target: URL | undefined;
  let endpoint = "",
    audit: Client | undefined,
    finished: Promise<CloseResult> | undefined;
  const docker = (...args: string[]) => {
    const result = spawnSync(
      "docker",
      [...(endpoint ? ["--host", endpoint] : []), ...args],
      { encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 4e6 },
    );
    requireSeries(
      result.status === 0 && !result.error && !result.signal,
      "Docker operation failed",
    );
    return result.stdout;
  };
  const inspect = () => {
    const x = (JSON.parse(docker("inspect", r.containerId)) as Inspect[])[0];
    const env = Object.fromEntries(
      x.Config.Env.map((s) => {
        const n = s.indexOf("=");
        return [s.slice(0, n), s.slice(n + 1)];
      }),
    );
    const ports = x.HostConfig.PortBindings,
      labels = x.Config.Labels;
    requireSeries(
      x.Id === r.containerId &&
        x.Name === `/${r.container}` &&
        x.Image === r.image &&
        Object.keys(labels).length === 3 &&
        labels["education.owner"] === r.owner &&
        labels["education.database"] === r.database &&
        labels["education.run"] === r.resourceRun &&
        Object.keys(ports).length === 1 &&
        ports["5432/tcp"]?.length === 1 &&
        ports["5432/tcp"][0].HostIp === r.host &&
        ports["5432/tcp"][0].HostPort === String(r.port) &&
        x.Mounts.length === 1 &&
        x.Mounts[0].Type === "volume" &&
        x.Mounts[0].Name === r.volume &&
        x.Mounts[0].Destination === "/var/lib/postgresql/data" &&
        env.POSTGRES_DB === r.database &&
        env.POSTGRES_USER === r.role &&
        !!env.POSTGRES_PASSWORD,
      "container/image/volume/labels/target mismatch",
    );
    return { x, password: env.POSTGRES_PASSWORD };
  };
  const current = () => {
    const { x } = inspect();
    requireSeries(
      x.State.Running && x.State.Pid > 0,
      "running resource required",
    );
    return {
      startedAt: x.State.StartedAt,
      pid: x.State.Pid,
      restartCount: x.RestartCount,
    };
  };
  const lock = () => {
    requireSeries(fd !== undefined, "common lock absent");
    const held = fstatSync(fd),
      named = statSync(lockPath);
    const value = JSON.parse(readFileSync(lockPath, "utf8")) as Record<
      string,
      unknown
    >;
    requireSeries(
      held.ino === named.ino &&
        held.dev === named.dev &&
        value.execution === a.execution &&
        value.nonce === nonce &&
        value.containerId === r.containerId &&
        (!generation ||
          JSON.stringify(value.generation) === JSON.stringify(generation)),
      "common maintenance lock changed",
    );
  };
  const portClosed = () =>
    new Promise<void>((done, reject) => {
      const socket = createConnection({ host: r.host, port: r.port });
      socket.setTimeout(1500);
      socket.once("connect", () => {
        socket.destroy();
        reject(Error("port already open"));
      });
      socket.once("timeout", () => {
        socket.destroy();
        reject(Error("port closure uncertain"));
      });
      socket.once("error", (error: NodeJS.ErrnoException) => {
        socket.destroy();
        if (error.code === "ECONNREFUSED") done();
        else reject(Error("port closure uncertain"));
      });
    });
  return {
    lockPath,
    state: () => ({ generation, lockHeld: fd !== undefined }),
    assertHeld() {
      lock();
      requireSeries(
        generation && JSON.stringify(current()) === JSON.stringify(generation),
        "generation drift",
      );
    },
    async start() {
      window();
      requireSeries(
        fd === undefined && !generation && !finished,
        "resource single-use",
      );
      fd = openSync(lockPath, "wx");
      const text = JSON.stringify({
        execution: a.execution,
        nonce,
        containerId: r.containerId,
      });
      requireSeries(
        writeSync(fd, text) === Buffer.byteLength(text),
        "lock short write",
      );
      fsyncSync(fd);
      const context = (
        JSON.parse(docker("context", "inspect")) as Array<{
          Endpoints?: { docker?: { Host?: string } };
        }>
      )[0];
      endpoint = context.Endpoints?.docker?.Host ?? "";
      requireSeries(
        /^npipe:\/{4}\.\/pipe\/[A-Za-z0-9_-]+$/.test(endpoint),
        "local Docker named pipe required",
      );
      lock();
      const { x, password } = inspect();
      requireSeries(
        x.State.Status === "exited" &&
          x.State.Pid === 0 &&
          x.State.ExitCode === 0,
        "resource not previously safely stopped",
      );
      const volume = (
        JSON.parse(docker("volume", "inspect", r.volume)) as Array<{
          Name: string;
          Labels?: Record<string, string>;
        }>
      )[0];
      requireSeries(
        volume.Name === r.volume &&
          Object.keys(volume.Labels ?? {}).length === 1 &&
          volume.Labels?.["com.docker.volume.anonymous"] === "" &&
          docker("ps", "-q", "--filter", `volume=${r.volume}`).trim() === "",
        "volume ownership uncertain",
      );
      await portClosed();
      window();
      lock();
      docker("start", r.containerId);
      generation = current();
      const marker = JSON.stringify({
        execution: a.execution,
        nonce,
        containerId: r.containerId,
        generation,
      });
      ftruncateSync(fd, 0);
      requireSeries(
        writeSync(fd, marker, 0, "utf8") === Buffer.byteLength(marker),
        "generation marker short write",
      );
      fsyncSync(fd);
      let ready = false;
      for (let n = 0; n < 3; n++) {
        const result = spawnSync(
          "docker",
          [
            "--host",
            endpoint,
            "exec",
            r.containerId,
            "pg_isready",
            "-U",
            r.role,
            "-d",
            r.database,
          ],
          { encoding: "utf8", windowsHide: true, timeout: 5000 },
        );
        if (result.status === 0) {
          ready = true;
          break;
        }
        if (n < 2)
          await new Promise<void>((resolveReady) =>
            setTimeout(resolveReady, 500),
          );
      }
      requireSeries(ready, "three readiness probes failed");
      target = new URL(
        `postgresql://${r.role}@${r.host}:${r.port}/${r.database}`,
      );
      target.password = password;
      return target;
    },
    finish(safe: boolean) {
      finished ??= (async () => {
        if (fd === undefined)
          return { stopped: false, lockReleased: false, retained: false };
        if (!generation || !target) {
          closeSync(fd);
          fd = undefined;
          return {
            stopped: false,
            lockReleased: false,
            retained: true,
            reason: "start-unconfirmed",
          };
        }
        const result = await closeResource(generation, safe, {
          async assertLock() {
            lock();
          },
          async generation() {
            return current();
          },
          async freshAudit() {
            audit = new Client({
              connectionString: target!.toString(),
              ssl: false,
              application_name: `f02-final:${a.execution}`,
              connectionTimeoutMillis: 3000,
              query_timeout: 3000,
              options:
                "-c default_transaction_read_only=on -c statement_timeout=3000",
            });
            audit.on("error", () => undefined);
            await audit.connect();
            const who = await audit.query<{ db: string; role: string }>(
              "SELECT current_database() AS db,current_user AS role",
            );
            requireSeries(
              who.rows[0]?.db === r.database && who.rows[0]?.role === r.role,
              "fresh audit identity",
            );
          },
          async clearSnapshot() {
            requireSeries(audit, "audit absent");
            await audit.query("SELECT pg_stat_clear_snapshot()");
          },
          async unknownClients() {
            requireSeries(audit, "audit absent");
            const clients = await audit.query<{ pid: number }>(
              "SELECT pid FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()",
            );
            return clients.rows.map((x) => x.pid);
          },
          async closeAudit() {
            if (audit) {
              const client = audit;
              audit = undefined;
              await client.end();
            }
          },
          async stop() {
            docker("stop", "--time", "10", r.containerId);
          },
          async verifyStopped() {
            await portClosed();
            const { x } = inspect();
            requireSeries(
              x.State.Status === "exited" &&
                x.State.Running === false &&
                x.State.Pid === 0 &&
                x.State.ExitCode === 0 &&
                generation &&
                x.State.StartedAt === generation.startedAt &&
                x.RestartCount === generation.restartCount,
              "stop state or generation unconfirmed",
            );
          },
          async release() {
            lock();
            // One explicitly owned disposable marker, after verified stop; volume/facts remain.
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
      return finished;
    },
  };
}
