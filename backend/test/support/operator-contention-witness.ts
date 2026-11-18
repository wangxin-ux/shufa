import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import type { Client } from "pg";
import type { PrismaService } from "../../src/infrastructure/prisma/prisma.service";

export interface Acquired {
  pid: number;
  tag: string;
  xid: string;
  sql: string;
}
export interface Wanted {
  winner: number;
  loser: number;
  winnerTag: string;
  loserTag: string;
  winnerXid?: string;
}
export interface LockSample {
  pid: number;
  blockers: number[];
  waitType: string | null;
  winnerTag?: string;
  loserTag?: string;
  winnerXid?: string;
  waitingLocks?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}
export function isWitness(sample: LockSample, wanted: Wanted) {
  return (
    wanted.winner > 0 &&
    wanted.loser > 0 &&
    wanted.winner !== wanted.loser &&
    sample.pid === wanted.loser &&
    sample.waitType === "Lock" &&
    sample.blockers.includes(wanted.winner) &&
    sample.winnerTag === wanted.winnerTag &&
    sample.loserTag === wanted.loserTag &&
    (!wanted.winnerXid || sample.winnerXid === wanted.winnerXid) &&
    sample.waitingLocks?.some((lock) => lock.granted === false) === true
  );
}
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
export async function waitForWitness(
  control: Pick<Client, "query">,
  wanted: Wanted,
  timeout = 1500,
): Promise<LockSample> {
  const deadline = Date.now() + timeout;
  let last: LockSample | undefined;
  while (Date.now() < deadline) {
    // pg returns this void result; it is deliberately never decoded by Prisma.
    await control.query("SELECT pg_stat_clear_snapshot()");
    const result = await control.query<LockSample>(
      `SELECT l.pid,pg_blocking_pids(l.pid) AS blockers,l.wait_event_type AS "waitType",
        l.wait_event AS "waitEvent",l.backend_xid::text AS "loserXid",
        w.backend_xid::text AS "winnerXid",w.application_name AS "winnerTag",
        l.application_name AS "loserTag",w.state AS "winnerState",l.state AS "loserState",
        (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'locktype',k.locktype,'mode',k.mode,'granted',k.granted,
          'relation',k.relation::text,'transactionid',k.transactionid::text,
          'classid',k.classid::text,'objid',k.objid::text,'objsubid',k.objsubid)), '[]'::jsonb)
         FROM pg_locks k WHERE k.pid=l.pid AND NOT k.granted) AS "waitingLocks"
       FROM pg_stat_activity l CROSS JOIN pg_stat_activity w
       WHERE l.pid=$2 AND w.pid=$1`,
      [wanted.winner, wanted.loser],
    );
    last = result.rows[0];
    if (last && isWitness(last, wanted)) return last;
    await pause(Math.min(20, Math.max(0, deadline - Date.now())));
  }
  const error = new Error("F02 contention: SQL lock wait unproved");
  Object.assign(error, { wanted, lastSample: last });
  throw error;
}
export class AcquisitionGate {
  private value?: Acquired;
  private released = false;
  private releaseHeld?: () => void;
  constructor(
    readonly tag: string,
    readonly timeout = 2500,
  ) {}
  async acquired(value: Acquired) {
    if (this.value || this.released) return;
    this.value = value;
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            Error(`F02 contention: held acquisition timeout: ${this.tag}`),
          ),
        this.timeout,
      );
      this.releaseHeld = () => {
        clearTimeout(timer);
        done();
      };
      if (this.released) this.releaseHeld();
    });
  }
  async wait() {
    const deadline = Date.now() + this.timeout;
    while (!this.value && !this.released && Date.now() < deadline)
      await pause(5);
    if (!this.value)
      throw Error(
        `F02 contention: acquisition observation timeout: ${this.tag}`,
      );
    return this.value;
  }
  release() {
    this.released = true;
    this.releaseHeld?.();
  }
}
const clientTag = new AsyncLocalStorage<string>();
const serverTag = new AsyncLocalStorage<string>();
export const tagged = <T>(tag: string, action: () => T) =>
  clientTag.run(tag, action);
export const outgoingTag = () => clientTag.getStore();
export const admitTaggedRequest = (tag: unknown, next: () => void) => {
  if (typeof tag === "string" && /^[a-z0-9-]{1,32}$/.test(tag))
    serverTag.run(tag, next);
  else next();
};
type Matcher = (sql: string, values: readonly unknown[]) => boolean;
interface Participant {
  tag: string;
  application: string;
  gate?: AcquisitionGate;
  matcher?: Matcher;
  acquired: boolean;
  pid?: number;
  xid?: string;
}
type RecordValue = Record<string, unknown>;
let current: ReturnType<typeof createObservation> | undefined;
export function observation() {
  if (!current) throw Error("F02 contention observer not initialized");
  return current;
}
export function createObservation(
  prisma: PrismaService,
  audit: Client,
  execution: string,
  save: (name: string, value: unknown) => void,
  databaseUrl: string,
  assertMutation: (cleanup?: boolean) => void,
) {
  if (current) throw Error("F02 contention observer is single-use");
  const participants = new Map<string, Participant>();
  const pending = new Set<Promise<unknown>>();
  const controls = new Set<Client>();
  const events: RecordValue[] = [];
  let healthy = true;
  const application = (tag: string) => `f02c:${execution.slice(-8)}:${tag}`;
  const event = (value: RecordValue) => {
    if (events.length >= 1000) throw Error("F02 contention event bound");
    events.push({ at: new Date().toISOString(), ...value });
  };
  const instrument = (transaction: object, actor: Participant): object =>
    new Proxy(transaction, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        if (property !== "$queryRaw" && property !== "$queryRawUnsafe")
          return value.bind(target);
        return async (...args: unknown[]) => {
          const template = args[0];
          const sql = (
            typeof template === "string"
              ? template
              : Array.from(template as TemplateStringsArray).join("$")
          )
            .replace(/\s+/g, " ")
            .trim();
          const values = args.slice(1);
          const result = await Reflect.apply(value, target, args);
          if (!actor.acquired && actor.matcher?.(sql, values)) {
            actor.acquired = true;
            const acquired = {
              tag: actor.application,
              pid: actor.pid!,
              xid: actor.xid!,
              sql: sql.slice(0, 1000),
            };
            event({
              stage: "actual-lock-acquired",
              participant: actor.tag,
              ...acquired,
            });
            await actor.gate!.acquired(acquired);
          }
          return result;
        };
      },
    });
  const business = new Proxy(prisma, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property !== "$transaction")
        return typeof value === "function" ? value.bind(target) : value;
      return (callback: unknown, options?: unknown) => {
        const label = serverTag.getStore();
        if (!label) return Reflect.apply(value, target, [callback, options]);
        const actor = participants.get(label);
        if (!actor || typeof callback !== "function")
          throw Error("F02 contention: unregistered transaction participant");
        if (actor.pid)
          throw Error("F02 contention: unexpected second transaction");
        return Reflect.apply(value, target, [
          async (tx: PrismaService) => {
            const [identity] = await tx.$queryRawUnsafe<
              Array<{ pid: number; xid: string }>
            >(
              "SELECT pg_backend_pid()::int AS pid,txid_current()::text AS xid",
            );
            actor.pid = identity.pid;
            actor.xid = identity.xid;
            await tx.$queryRawUnsafe(
              "SELECT set_config('application_name',$1,true)::text",
              actor.application,
            );
            event({
              stage: "transaction-bound",
              participant: actor.tag,
              pid: actor.pid,
              xid: actor.xid,
            });
            return callback(instrument(tx, actor));
          },
          options,
        ]);
      };
    },
  });
  const api = {
    business,
    events,
    application,
    assertMutation(cleanup = false) {
      if (!healthy || (cleanup && (pending.size || controls.size)))
        throw Error(
          "F02 contention: pending request/control drain is unconfirmed; mutation refused",
        );
      assertMutation(cleanup);
    },
    watchControl(client: Client) {
      if (controls.has(client))
        throw Error("F02 contention control already tracked");
      controls.add(client);
      client.on("error", (error: unknown) => {
        healthy = false;
        event({ stage: "control-error", diagnostic: describeError(error) });
        for (const actor of participants.values()) actor.gate?.release();
      });
    },
    controlClosed(client: Client) {
      controls.delete(client);
    },
    participant(tag: string) {
      const actor = participants.get(tag);
      if (!actor) throw Error("F02 contention: participant missing");
      return actor;
    },
    control(tag: string) {
      if (!participants.has(tag))
        throw Error("F02 contention: unregistered control");
      const { Client } = createRequire(__filename)("pg") as typeof import("pg");
      const client = new Client({
        connectionString: databaseUrl,
        ssl: false,
        application_name: application(tag),
        connectionTimeoutMillis: 3000,
        query_timeout: 5000,
        options: "-c lock_timeout=3000 -c statement_timeout=5000",
      });
      api.watchControl(client);
      return client;
    },
    register(tag: string, matcher?: Matcher) {
      if (participants.has(tag))
        throw Error("F02 contention participant reused");
      const actor: Participant = {
        tag,
        application: application(tag),
        matcher,
        acquired: false,
        gate: matcher ? new AcquisitionGate(tag) : undefined,
      };
      participants.set(tag, actor);
      return actor;
    },
    bindControl(tag: string, pid: number, xid: string) {
      const actor = participants.get(tag);
      if (!actor || actor.pid) throw Error("F02 contention control identity");
      actor.pid = pid;
      actor.xid = xid;
    },
    track<T>(promise: Promise<T>) {
      pending.add(promise);
      void promise
        .finally(() => pending.delete(promise))
        .catch(() => undefined);
      return promise;
    },
    async witness(winnerTag: string, loserTag: string) {
      const winner = participants.get(winnerTag)!;
      const loser = participants.get(loserTag)!;
      const deadline = Date.now() + 1200;
      while (!loser.pid && Date.now() < deadline) await pause(5);
      if (!winner.pid || !winner.xid || !loser.pid)
        throw Error("F02 contention: bound transaction identity missing");
      const evidence = await waitForWitness(
        audit,
        {
          winner: winner.pid,
          loser: loser.pid,
          winnerTag: winner.application,
          loserTag: loser.application,
          winnerXid: winner.xid,
        },
        1200,
      );
      event({
        stage: "actual-sql-wait-witness",
        winner: winnerTag,
        loser: loserTag,
        evidence,
      });
      save(`wait-${winnerTag}-${loserTag}`, evidence);
      return evidence;
    },
    release(tag: string) {
      participants.get(tag)?.gate?.release();
      event({ stage: "release", participant: tag });
    },
    async finish() {
      for (const actor of participants.values()) actor.gate?.release();
      const deadline = Date.now() + 35000;
      while (pending.size && Date.now() < deadline) await pause(10);
      if (pending.size || controls.size) healthy = false;
      save("contention-observation", {
        healthy,
        pending: pending.size,
        controls: controls.size,
        events,
      });
      if (!healthy) throw Error("F02 contention request drain unconfirmed");
    },
  };
  current = api;
  return api;
}
export const resourceLock =
  (kind: "class" | "teacher", id: string): Matcher =>
  (sql, values) =>
    sql.includes("pg_advisory_xact_lock") &&
    values.includes(`operator-schedule:${kind}:${id}`);
export const rowLock =
  (
    table: "LessonSession" | "ClassGroup" | "TeacherProfile" | "User",
    mode: "SHARE" | "UPDATE",
  ): Matcher =>
  (sql) =>
    sql.includes(`FROM "${table}"`) && sql.includes(`FOR ${mode}`);
export function describeError(
  error: unknown,
  depth = 0,
): Record<string, unknown> {
  const value = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    stack?: unknown;
    cause?: unknown;
    lastSample?: unknown;
    wanted?: unknown;
  };
  const text = (field: unknown, limit: number) =>
    field === undefined ? undefined : String(field).slice(0, limit);
  return {
    name: text(value?.name, 100),
    code: text(value?.code, 100),
    message: text(value?.message ?? error, 2000),
    stack: text(value?.stack, 10000),
    cause:
      depth < 3 && value?.cause
        ? describeError(value.cause, depth + 1)
        : undefined,
    lastSample: value?.lastSample,
    wanted: value?.wanted,
  };
}
