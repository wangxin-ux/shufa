import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import {
  createObservation,
  outgoingTag,
  describeError,
} from "./operator-contention-witness";
import {
  auxiliaryRoute,
  registerAuxiliary,
  registerAuxiliaryReceipt,
} from "./operator-contention-fixture";
import {
  checkSources,
  digest,
  requireSeries,
  validateAllocation,
} from "./operator-series-admission";
import type {
  CaseContext,
  Call,
  WireResponse,
} from "./operator-contention-cases";
import type { Fixture } from "./operator-contention-fixture";
import type { Fact } from "./operator-series-facts";
import type { Registry } from "./operator-series-contention-host";
import type { HttpRecord } from "./operator-series-pages";

export const loadSeriesModule = createRequire(__filename);

function redact(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string")
    return value
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted database URL]")
      .replace(
        /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
        "[redacted JWT]",
      );
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [
        key,
        /token|password|secret|authorization|phone|mobile/i.test(key) &&
        key !== "sourceManifestSha256"
          ? "[redacted]"
          : redact(field),
      ]),
    );
  return value;
}

export async function executeSeries(raw: unknown) {
  // This must remain the first operation, before imports, clients, fixture or Docker.
  const allocation = validateAllocation(raw);
  const root = resolve(__dirname, "../../..");
  const sourcePath = resolve(__dirname, "operator-contention-source.json");
  const sources = checkSources(allocation, root, sourcePath);
  const { fixtureFromPlan } = loadSeriesModule(
    "./operator-contention-fixture",
  ) as typeof import("./operator-contention-fixture");
  const preparedFixture = fixtureFromPlan(
    JSON.parse(
      readFileSync(
        resolve(__dirname, "operator-contention-fixture-plan.json"),
        "utf8",
      ),
    ) as unknown,
    allocation.execution,
  );
  const directory = resolve(
    root,
    ".tools-automation/tmp/operator-f02-contention",
    allocation.execution,
  );
  mkdirSync(directory, { recursive: true });
  const save = (name: string, value: unknown) => {
    requireSeries(/^[a-z][a-z0-9-]+$/.test(name), "receipt filename");
    writeFileSync(
      resolve(directory, `${name}.json`),
      JSON.stringify(redact(value), null, 2) + "\n",
      { flag: "wx" },
    );
  };
  const { seriesResource } = loadSeriesModule(
    "./operator-series-resource",
  ) as typeof import("./operator-series-resource");
  const resource = seriesResource(allocation, root, () => {
    validateAllocation(allocation);
  });
  const registry: Registry = { attempted: new Set(), issued: [], pending: [] };
  let prisma:
    | import("../../src/infrastructure/prisma/prisma.service").PrismaService
    | undefined;
  let audit: import("pg").Client | undefined;
  let host:
    | Awaited<
        ReturnType<
          typeof import("./operator-series-contention-host").compileSeriesHost
        >
      >
    | undefined;
  let fixture: Fixture | undefined, before: Fact[] | undefined;
  let target: URL | undefined,
    faultAfter = 0,
    businessClosed = false,
    factsClosed = false;
  let faultTriggered = false,
    inserted: string[] = [],
    listening = false,
    drained = false;
  let retirementClosed = false,
    ownershipClosed = false,
    evidenceClosed = true,
    succeeded = false;
  const marks: Array<{ name: string; at: string; details?: unknown }> = [];
  const failures: Array<Record<string, unknown>> = [];
  const httpRecords: Array<{
    method: string;
    path: string;
    key?: string;
    body?: unknown;
    status: number;
    response: unknown;
    responseSha256: string;
    schemaValidation?: string;
  }> = [];
  const pageRecords: HttpRecord[] = [];
  const failure = (stage: string, error: unknown) => {
    const assertion = error as {
      actual?: unknown;
      expected?: unknown;
      operator?: string;
    };
    failures.push({
      stage,
      diagnostic: describeError(error),
      lastSuccessfulStage: observer?.events.at(-1),
      name: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      actual: assertion?.actual,
      expected: assertion?.expected,
      operator: assertion?.operator,
    });
  };
  const saveCleanup = (name: string, value: unknown) => {
    try {
      save(name, value);
    } catch (error) {
      evidenceClosed = false;
      failure(`receipt:${name}`, error);
    }
  };
  let call: Call | undefined;
  let observer: ReturnType<typeof createObservation> | undefined;
  let observerClosed = true;
  const tokenDigests = () =>
    registry.issued.map(({ userId, kind, token }) => ({
      userId,
      kind,
      sha256: digest(token),
      accessProbe:
        "GET /me (refresh is rejected as access; no refresh revocation protocol claimed)",
    }));
  try {
    save("allocation", {
      ...allocation,
      source: "explicit fresh coordinator file, never inferred from proposal",
    });
    target = await resource.start();
    const { Client } = await import("pg");
    audit = new Client({
      connectionString: target.toString(),
      ssl: false,
      connectionTimeoutMillis: 5000,
      query_timeout: 10000,
      application_name: `f02-facts:${allocation.execution}`,
    });
    audit.on("error", () => undefined);
    await audit.connect();
    const identity = await audit.query<{
      db: string;
      role: string;
      super: boolean;
    }>(
      "SELECT current_database() AS db,current_user AS role,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS super",
    );
    requireSeries(
      identity.rows[0]?.db === allocation.resource.database &&
        identity.rows[0]?.role === allocation.resource.role &&
        identity.rows[0]?.super === true,
      "database identity or whole-instance audit visibility",
    );
    await audit.query("SELECT pg_stat_clear_snapshot()");
    requireSeries(
      (
        await audit.query(
          "SELECT pid FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()",
        )
      ).rowCount === 0,
      "unknown clients before fixture",
    );
    const { snapshotFacts, verifyMigrations } = loadSeriesModule(
      "./operator-series-facts",
    ) as typeof import("./operator-series-facts");
    await verifyMigrations(audit, sources.files);
    before = await snapshotFacts(audit);
    save(
      "original-fact-digests",
      before.map((f) => ({
        table: f.table,
        key: f.key,
        sha256: digest(f.raw),
      })),
    );
    const { PrismaService } = loadSeriesModule(
      "../../src/infrastructure/prisma/prisma.service",
    ) as typeof import("../../src/infrastructure/prisma/prisma.service");
    const { ConfigService } = await import("@nestjs/config");
    const url = new URL(target);
    url.searchParams.set(
      "application_name",
      `f02-business:${allocation.execution}`,
    );
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: url.toString() }),
    );
    await prisma.$connect();
    const { applyFixture, registerCommand, registerReceipt, recoverOwned } =
      loadSeriesModule(
        "./operator-contention-fixture",
      ) as typeof import("./operator-contention-fixture");
    fixture = preparedFixture;
    save("fixture-before", fixture);
    resource.assertHeld();
    validateAllocation(allocation);
    await applyFixture(prisma, fixture);
    await recoverOwned(prisma, fixture);
    observer = createObservation(
      prisma,
      audit,
      allocation.execution,
      save,
      target.toString(),
      (cleanup = false) => {
        resource.assertHeld();
        if (!cleanup) validateAllocation(allocation);
      },
    );
    const business = observer.business;
    const { compileSeriesHost } = loadSeriesModule(
      "./operator-series-contention-host",
    ) as typeof import("./operator-series-contention-host");
    host = await compileSeriesHost(
      business,
      {
        AUTH_DRIVER: "mock",
        JWT_ACCESS_SECRET: randomBytes(48).toString("hex"),
        JWT_REFRESH_SECRET: randomBytes(48).toString("hex"),
      },
      registry,
    );
    const sessions = new Map<string, string>();
    const { request } = await import("node:http");
    const base = `http://${allocation.http.host}:${allocation.http.port}`;
    const send: Call = (method, path, body, token, key) =>
      new Promise<WireResponse>((done, reject) => {
        if (
          !/^\/(?:me(?:\?|$)|operators\/me\/|teachers\/me\/|parents\/me\/)/.test(
            path,
          )
        ) {
          reject(Error("F02: unexpected route"));
          return;
        }
        const json = body === undefined ? undefined : JSON.stringify(body);
        const requestId = randomUUID();
        const req = request(
          base + path,
          {
            method,
            agent: false,
            headers: {
              Connection: "close",
              "X-Request-Id": requestId,
              ...(outgoingTag() ? { "X-F02-Contention": outgoingTag() } : {}),
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(json
                ? {
                    "Content-Type": "application/json",
                    "Content-Length": String(Buffer.byteLength(json)),
                  }
                : {}),
              ...(key ? { "Idempotency-Key": key } : {}),
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
              try {
                const body = JSON.parse(
                  Buffer.concat(chunks).toString("utf8"),
                ) as unknown;
                requireSeries(
                  (body as { requestId?: string }).requestId === requestId &&
                    res.headers["x-request-id"] === requestId,
                  "main HTTP request ID mismatch",
                );
                done({ status: res.statusCode ?? 0, body });
              } catch {
                reject(Error("F02: non-JSON HTTP response"));
              }
            });
            res.on("error", reject);
          },
        );
        req.setTimeout(30000, () => req.destroy(Error("F02: HTTP timeout")));
        req.on("error", reject);
        if (json) req.write(json);
        req.end();
      });
    const { seriesContract } = loadSeriesModule(
      "./operator-series-contract",
    ) as typeof import("./operator-series-contract");
    const validate = seriesContract(root);
    call = async (
      method,
      path,
      body,
      token = sessions.get(fixture!.operator),
      key,
    ) => {
      validateAllocation(allocation);
      resource.assertHeld();
      const isWrite =
        method !== "GET" && !/\/(?:preview|cancellation-preview)$/.test(path);
      const actor = [...sessions].find(
        ([, credential]) => credential === token,
      )?.[0];
      if (isWrite && auxiliaryRoute(path)) {
        requireSeries(actor, "unowned auxiliary credential");
        key = registerAuxiliary(
          fixture!,
          actor,
          method,
          path,
          body as Record<string, unknown>,
          key,
        );
      }
      if (
        isWrite &&
        !auxiliaryRoute(path) &&
        token === sessions.get(fixture!.operator)
      )
        key = registerCommand(fixture!, method, path, body, key);
      const result = await send(method, path, body, token, key);
      const record = {
        method,
        path,
        key,
        body,
        status: result.status,
        response: result.body,
        responseSha256: digest(JSON.stringify(result.body)),
        schemaValidation: "not-series-response",
      };
      httpRecords.push(record);
      if (
        isWrite &&
        !auxiliaryRoute(path) &&
        token === sessions.get(fixture!.operator) &&
        result.status === 200 &&
        key
      )
        registerReceipt(
          fixture!,
          key,
          path,
          (result.body as { data: unknown }).data,
        );
      if (isWrite && auxiliaryRoute(path) && result.status === 200 && key)
        registerAuxiliaryReceipt(
          fixture!,
          key,
          path,
          (result.body as { data: unknown }).data,
        );
      const section =
        path === "/operators/me/lesson-series/preview"
          ? "preview"
          : path === "/operators/me/lesson-series"
            ? "create"
            : /\/cancellation-preview$/.test(path)
              ? "cancellationPreview"
              : /\/cancel-selection$/.test(path)
                ? "cancel"
                : undefined;
      if (section) {
        record.schemaValidation = "failed";
        validate(section, result.status, result.body);
        record.schemaValidation = "passed";
      }
      return result;
    };
    resource.assertHeld();
    validateAllocation(allocation);
    await host.app.listen(allocation.http.port, allocation.http.host);
    listening = true;
    const address = (
      host.app.getHttpServer() as import("node:http").Server
    ).address();
    requireSeries(
      address &&
        typeof address === "object" &&
        address.address === allocation.http.host &&
        address.port === allocation.http.port,
      "owned HTTP binding mismatch",
    );
    for (const id of fixture.actors) {
      registry.attempted.add(id);
      const session = await host.auth.issueSessionForUser(id);
      sessions.set(id, session.accessToken);
    }
    const { runSeriesCases } = loadSeriesModule(
      "./operator-contention-cases",
    ) as typeof import("./operator-contention-cases");
    const mark: CaseContext["mark"] = (name, details) =>
      marks.push({ name, at: new Date().toISOString(), details });
    await runSeriesCases({
      root,
      base,
      p: prisma,
      audit,
      fixture,
      tokens: {
        operator: sessions.get(fixture.operator)!,
        teacher: sessions.get(fixture.teacherUser)!,
        otherTeacher: sessions.get(fixture.otherTeacherUser)!,
        parent: sessions.get(fixture.parent)!,
      },
      call,
      pageTransport: (method, path, body, headers) => {
        const authorization = Object.entries(headers ?? {}).find(
          ([k]) => k.toLowerCase() === "authorization",
        )?.[1];
        const key = Object.entries(headers ?? {}).find(
          ([k]) => k.toLowerCase() === "idempotency-key",
        )?.[1];
        requireSeries(
          authorization && /^Bearer \S+$/.test(authorization),
          "Page omitted actual Bearer header",
        );
        if (
          method !== "GET" &&
          !/\/(?:preview|cancellation-preview)$/.test(path)
        )
          requireSeries(key?.trim(), "Page omitted actual idempotency key");
        return call!(
          method,
          path,
          body,
          authorization.replace(/^Bearer /, ""),
          key,
        );
      },
      armFault(count) {
        faultAfter = count;
        inserted = [];
        faultTriggered = false;
      },
      faultEvidence: () => ({
        inserted: [...inserted],
        triggered: faultTriggered,
      }),
      pageEvidence(records) {
        pageRecords.push(...records);
      },
      mark,
    });
    succeeded = true;
  } catch (error) {
    failure("execution", error);
  } finally {
    faultAfter = 0;
    try {
      await observer?.finish();
    } catch (error) {
      observerClosed = false;
      failure("contention-release-drain", error);
    }
    try {
      await host?.quiesce();
      drained = true;
    } catch (error) {
      failure("HTTP-drain", error);
    }
    await Promise.allSettled(registry.pending);
    const { recoverOwned, retireFixture, verifyOwnedAudits } = loadSeriesModule(
      "./operator-contention-fixture",
    ) as typeof import("./operator-contention-fixture");
    if (prisma && fixture) {
      try {
        requireSeries(
          drained && observerClosed,
          "no fixture reconciliation while admission/guard/handler drain is uncertain",
        );
        resource.assertHeld();
        await recoverOwned(prisma, fixture);
        await verifyOwnedAudits(prisma, fixture);
        saveCleanup("fixture-final", fixture);
        ownershipClosed = true;
      } catch (error) {
        failure("ownership-recovery", error);
      }
      let retired: Awaited<ReturnType<typeof retireFixture>> = [];
      try {
        requireSeries(
          drained && observerClosed,
          "no actor mutation while request drain is uncertain",
        );
        resource.assertHeld();
        retired = await retireFixture(prisma, fixture);
        saveCleanup("actor-retirement", retired);
      } catch (error) {
        failure("actor-retirement", error);
        saveCleanup(
          "actor-retirement-unresolved",
          fixture.actors.map((userId) => ({ userId, state: "UNRESOLVED" })),
        );
      }
      const probes = [];
      for (const credential of registry.issued) {
        try {
          resource.assertHeld();
          requireSeries(
            listening &&
              (
                host?.app.getHttpServer() as
                  import("node:http").Server | undefined
              )?.listening,
            "owned probe listener unavailable; do not send credentials",
          );
          // Cleanup does not depend on a still-open business window.
          const { request } = await import("node:http");
          const status = await new Promise<number>((done, reject) => {
            const req = request(
              {
                hostname: allocation.http.host,
                port: allocation.http.port,
                path: "/me",
                agent: false,
                headers: {
                  Authorization: `Bearer ${credential.token}`,
                  Connection: "close",
                },
              },
              (res) => {
                res.resume();
                res.on("end", () => done(res.statusCode ?? 0));
                res.on("error", reject);
              },
            );
            req.setTimeout(5000, () =>
              req.destroy(Error("retirement probe timed out")),
            );
            req.on("error", reject);
            req.end();
          });
          probes.push({
            userId: credential.userId,
            kind: credential.kind,
            sha256: digest(credential.token),
            status,
          });
        } catch {
          probes.push({
            userId: credential.userId,
            kind: credential.kind,
            sha256: digest(credential.token),
            status: 0,
          });
        }
      }
      saveCleanup("credential-retirement", {
        credentials: tokenDigests(),
        probes,
      });
      retirementClosed =
        retired.length === fixture.actors.length &&
        retired.every((x) => ["DISABLED", "ABSENT"].includes(x.state)) &&
        probes.length === registry.issued.length &&
        probes.every((x) => x.status === 401);
      if (retirementClosed)
        marks.push({
          name: "credential-retirement",
          at: new Date().toISOString(),
        });
      else
        failure(
          "credential-retirement",
          Error("F02: unresolved actor or credential"),
        );
    } else {
      retirementClosed = registry.issued.length === 0;
      ownershipClosed = fixture === undefined;
    }
    saveCleanup("http-records", httpRecords);
    saveCleanup("page-records", pageRecords);
    let clientsClosed = true;
    for (const [name, close] of [
      ["http-host", () => host?.app.close()],
      ["prisma", () => prisma?.$disconnect()],
      ["fact-client", () => audit?.end()],
    ] as const) {
      try {
        await close();
      } catch (error) {
        clientsClosed = false;
        failure(name, error);
      }
    }
    listening = false;
    if (target && before && clientsClosed && drained) {
      let finalFacts: import("pg").Client | undefined;
      try {
        resource.assertHeld();
        const { Client } = await import("pg");
        finalFacts = new Client({
          connectionString: target.toString(),
          ssl: false,
          application_name: `f02-final-facts:${allocation.execution}`,
          connectionTimeoutMillis: 5000,
          query_timeout: 10000,
          options: "-c default_transaction_read_only=on",
        });
        finalFacts.on("error", () => undefined);
        await finalFacts.connect();
        const {
          compareFacts,
          snapshotFacts,
          verifyStaticFacts,
          verifySyntheticFacts,
          verifyStudentFacts,
        } = loadSeriesModule(
          "./operator-series-facts",
        ) as typeof import("./operator-series-facts");
        const after = await snapshotFacts(finalFacts);
        if (fixture) {
          verifyStaticFacts(after, fixture.expected);
          verifySyntheticFacts(after, fixture.syntheticSessions);
          verifyStudentFacts(after, fixture.expected.Student);
          const { auditEvidence } = loadSeriesModule(
            "./operator-contention-fixture",
          ) as typeof import("./operator-contention-fixture");
          await verifyOwnedAudits(auditEvidence(after), fixture);
        }
        const added = compareFacts(
          before,
          after,
          fixture ?? {
            run: allocation.execution,
            campusId: "",
            actors: [],
            ids: {},
            keys: [],
          },
        );
        saveCleanup(
          "final-fact-manifest",
          added.map((f) => ({
            table: f.table,
            key: f.key,
            sha256: digest(f.raw),
            disposition:
              "retained in isolated volume; actors disabled; no business/audit/idempotency deletion",
          })),
        );
        checkSources(allocation, root, sourcePath);
        factsClosed = true;
        marks.push({
          name: "original-facts-preserved",
          at: new Date().toISOString(),
        });
      } catch (error) {
        factsClosed = false;
        failure("original-facts", error);
      } finally {
        try {
          await finalFacts?.end();
        } catch (error) {
          clientsClosed = false;
          failure("final-fact-client", error);
        }
      }
    } else
      factsClosed =
        before === undefined &&
        fixture === undefined &&
        registry.issued.length === 0;
    businessClosed =
      observerClosed &&
      clientsClosed &&
      drained &&
      factsClosed &&
      retirementClosed &&
      ownershipClosed &&
      evidenceClosed;
    saveCleanup("resource-before-close", resource.state());
    businessClosed = businessClosed && evidenceClosed;
    const closeout = await resource.finish(businessClosed);
    const { CASES } = loadSeriesModule(
      "./operator-contention-cases",
    ) as typeof import("./operator-contention-cases");
    const missing = CASES.filter((name) => !marks.some((m) => m.name === name));
    const receipt = {
      at: new Date().toISOString(),
      execution: allocation.execution,
      realDatabaseExecuted: before !== undefined,
      marks,
      missing,
      failures,
      businessClosed,
      drained,
      factsClosed,
      retirementClosed,
      ownershipClosed,
      evidenceClosed,
      generation: resource.state().generation,
      closeout,
      passed:
        succeeded &&
        failures.length === 0 &&
        missing.length === 0 &&
        businessClosed &&
        closeout.stopped &&
        closeout.lockReleased &&
        !closeout.retained,
      nativeAcceptance: false,
      productionAcceptance: false,
    };
    save("result", receipt);
    if (!receipt.passed)
      throw Error(
        "F02: real acceptance incomplete; inspect redacted immutable result and retained ownership",
      );
    return receipt;
  }
}
if (createRequire(__filename).main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error("F02: fresh execution allocation required");
    process.exitCode = 1;
  } else {
    void executeSeries(
      JSON.parse(readFileSync(resolve(file), "utf8")) as unknown,
    )
      .then((result) =>
        console.log(
          JSON.stringify({
            passed: result.passed,
            execution: result.execution,
          }),
        ),
      )
      .catch(() => {
        console.error(
          "F02: execution refused or failed; no implicit allocation",
        );
        process.exitCode = 1;
      });
  }
}
