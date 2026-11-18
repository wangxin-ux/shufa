const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { load } = require("../backend/node_modules/js-yaml");
const { Client } = require("../backend/node_modules/pg");
const {
  databaseReady,
  safeDiagnostics,
} = require("../backend/test/support/staff-create-runner-policy.cjs");
const root = path.resolve(__dirname, "..");
function evidencePath(input, exists = fs.existsSync) {
  const output = path.resolve(input || "");
  if (
    path.dirname(output) !== path.join(root, "docs/verification") ||
    !/^partner-application-tcp-2026-10-15-[a-z0-9-]+\.log$/.test(
      path.basename(output),
    ) ||
    exists(output)
  )
    throw new Error("A new application verification log is required");
  return output;
}
function redactDiagnostics(text) {
  return text
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[REDACTED_TOKEN]",
    )
    .replace(/Bearer [^\s"'<>]*/g, "[REDACTED_AUTHORIZATION]")
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/g, "[REDACTED_DATABASE_URL]");
}
function save(output, text, success) {
  const diagnostics = redactDiagnostics(text);
  if (!safeDiagnostics(diagnostics)) {
    console.error("Credential-like diagnostics withheld");
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(output, diagnostics, { flag: "wx" });
  process.stdout.write(diagnostics);
  process.exitCode = success ? 0 : 1;
}
async function main() {
  const output = evidencePath(process.argv[2]);
  const mode = process.argv[3] || "flow";
  if (!["flow", "postflight"].includes(mode))
    throw new Error("Unknown application verification mode");
  const compose = load(
    fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8"),
  );
  const database = compose.services.postgres_test;
  if (!database.ports.includes("5433:5432"))
    throw new Error("Existing isolated PostgreSQL mapping required");
  const target = new URL(
    "postgresql://127.0.0.1:5433/education_app_test_partner_pdf_20261012contact_test",
  );
  target.username = database.environment.POSTGRES_USER;
  target.password = database.environment.POSTGRES_PASSWORD;
  const databaseName = target.pathname.slice(1);
  const ready = await databaseReady(
    new Client({
      connectionString: target.href,
      connectionTimeoutMillis: 2500,
      query_timeout: 2500,
    }),
    databaseName,
  );
  const preflight = `APPLICATION_PAGE_PREFLIGHT ${JSON.stringify({
    database: databaseName,
    ready,
    mode,
    fixtureExecutionStarted: ready && mode === "flow",
  })}\n`;
  if (!ready) {
    save(
      output,
      preflight + "Database unavailable or mismatched; no fixtures executed.\n",
      false,
    );
    return;
  }
  const files = [
    "frontend/pages/partner/application/index.ts",
    "frontend/pages/partner/runtime/partner-application-runtime.ts",
    "frontend/pages/partner/runtime/partner-applicant-session.service.ts",
    "frontend/pages/partner/runtime/partner-application-bank-editor.ts",
    "frontend/pages/partner/runtime/partner-application-material-editor.ts",
    "frontend/pages/partner/runtime/partner-application-submission-editor.ts",
    "frontend/pages/partner/runtime/partner-application-review-editor.ts",
    "frontend/pages/partner/login/index.ts",
    "frontend/pages/partner/runtime/wechat-formal-login-runtime.ts",
    "frontend/pages/super-admin/partner-applications/index.ts",
    "frontend/pages/super-admin/runtime/partner-application-review.service.ts",
    "backend/test/partner-application-page-flow.e2e-spec.ts",
    "backend/test/partner-application-page-safety.e2e-spec.ts",
    "backend/test/partner-application-page-postflight.e2e-spec.ts",
    "backend/test/support/partner-application-page-harness.ts",
    "backend/test/support/partner-application-page-policy.ts",
    ".tools-automation/run-partner-application-page.cjs",
  ];
  const hashes = Object.fromEntries(
    files.map((file) => [
      file,
      createHash("sha256")
        .update(fs.readFileSync(path.join(root, file)))
        .digest("hex"),
    ]),
  );
  const args = [
    "node_modules/jest/bin/jest.js",
    "--config",
    "test/jest-e2e.json",
    "--runInBand",
    "--no-cache",
    "--verbose",
    "--runTestsByPath",
    ...(mode === "postflight"
      ? ["test/partner-application-page-postflight.e2e-spec.ts"]
      : [
          "test/partner-application-page-flow.e2e-spec.ts",
          "test/partner-application-page-safety.e2e-spec.ts",
          "test/partner-pdf-test-safety.e2e-spec.ts",
        ]),
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: path.join(root, "backend"),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      AUTH_DRIVER: "mock",
      PAYMENT_DRIVER: "mock",
      MESSAGE_DRIVER: "mock",
      DATABASE_URL: target.href,
      PARTNER_PDF_TEST_DB_NAME: databaseName,
    },
  });
  const text =
    preflight +
    `APPLICATION_PAGE_INPUTS ${JSON.stringify(hashes)}\n` +
    `APPLICATION_PAGE_COMMAND ${JSON.stringify(args)}\n` +
    (result.stdout || "") +
    (result.stderr || "") +
    `\nAPPLICATION_PAGE_EXIT ${JSON.stringify({
      code: result.status,
      error: result.error?.code || null,
      signal: result.signal || null,
    })}\n`;
  save(output, text, result.status === 0 && !result.error && !result.signal);
}
module.exports = { evidencePath, redactDiagnostics };
if (require.main === module)
  main().catch(() => {
    console.error("Application Page runner failed; credentials withheld");
    process.exitCode = 1;
  });
