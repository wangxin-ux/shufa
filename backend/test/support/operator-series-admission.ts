import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function requireSeries(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`F02: ${message}`);
}
export const RESOURCE = {
  container: "education-campus-archive-20261027",
  containerId:
    "913a842e5dacecd93070c812b3f32d7d69be763771b1bf8ad0b4863bf059cec2",
  image:
    "sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73",
  volume: "065d7d37cd3e7573680bef7bc89849185ca2dde69e6141406d3263b03f324d2a",
  database: "education_app_test_campus_archive_20261027_test",
  role: "carchive",
  host: "127.0.0.1",
  port: 55437,
  owner: "codex-coordinator-campus-archive-20261027",
  resourceRun: "archive-4534b1ea9d",
} as const;
export interface Allocation {
  assigned: true;
  purpose: "operator-finite-series-http";
  execution: string;
  coordinatorApproval: string;
  notBefore: string;
  expiresAt: string;
  sourceManifestSha256: string;
  resource: typeof RESOURCE;
  http: { host: "127.0.0.1"; port: number };
  permissions: {
    startStop: true;
    fixture: true;
    businessHttp: true;
    retire: true;
    migrate: false;
  };
}
export interface SourceManifest {
  files: Array<{ path: string; sha256: string }>;
  executionPrerequisites: { blockers: string[] };
}
export const digest = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex");

export function validateAllocation(
  value: unknown,
  now = new Date(),
): Allocation {
  requireSeries(
    value && typeof value === "object",
    "fresh execution allocation required",
  );
  const a = value as Allocation;
  const start = Date.parse(a.notBefore),
    end = Date.parse(a.expiresAt);
  requireSeries(
    a.assigned === true && a.purpose === "operator-finite-series-http",
    "assigned F02 allocation required",
  );
  requireSeries(
    /^f02-[0-9a-f-]{36}$/.test(a.execution) &&
      typeof a.coordinatorApproval === "string" &&
      a.coordinatorApproval.length >= 12,
    "explicit coordinator allocation authority required",
  );
  requireSeries(
    start <= now.getTime() &&
      end > now.getTime() &&
      end - start > 0 &&
      end - start <= 3_600_000,
    "allocation window closed or invalid",
  );
  requireSeries(
    /^[0-9a-f]{64}$/.test(a.sourceManifestSha256),
    "source manifest SHA required",
  );
  requireSeries(
    a.resource &&
      Object.keys(RESOURCE).every(
        (key) =>
          a.resource[key as keyof typeof RESOURCE] ===
          RESOURCE[key as keyof typeof RESOURCE],
      ),
    "exact isolated target required",
  );
  requireSeries(
    a.http?.host === "127.0.0.1" &&
      Number.isInteger(a.http.port) &&
      a.http.port >= 1024 &&
      a.http.port <= 65535 &&
      a.http.port !== RESOURCE.port,
    "allocated loopback HTTP port required",
  );
  requireSeries(
    a.permissions?.startStop === true &&
      a.permissions.fixture === true &&
      a.permissions.businessHttp === true &&
      a.permissions.retire === true &&
      a.permissions.migrate === false,
    "explicit narrow permissions required; migrations forbidden",
  );
  return a;
}
export function checkSources(
  a: Allocation,
  root: string,
  manifestPath: string,
) {
  const bytes = readFileSync(manifestPath);
  requireSeries(
    digest(bytes) === a.sourceManifestSha256,
    "allocation source manifest mismatch",
  );
  const manifest = JSON.parse(bytes.toString("utf8")) as SourceManifest;
  requireSeries(
    Array.isArray(manifest.executionPrerequisites?.blockers) &&
      manifest.executionPrerequisites.blockers.length === 0,
    "unresolved shared dependency; refresh and verify the source checkpoint",
  );
  requireSeries(
    Array.isArray(manifest.files) && manifest.files.length > 0,
    "empty source manifest",
  );
  const paths = new Set<string>();
  for (const item of manifest.files) {
    requireSeries(
      !paths.has(item.path) &&
        !item.path.includes("\\") &&
        !item.path.startsWith("/") &&
        !item.path.split("/").includes("..") &&
        /^[0-9a-f]{64}$/.test(item.sha256),
      "invalid source manifest entry",
    );
    paths.add(item.path);
    requireSeries(
      digest(readFileSync(resolve(root, item.path))) === item.sha256,
      `source drift: ${item.path}`,
    );
  }
  requireSeries(
    paths.has("backend/prisma/schema.prisma") &&
      paths.has(
        "backend/src/modules/operator/operator-lesson-series.service.ts",
      ) &&
      paths.has("frontend/pages/operator/schedule-editor/index.ts") &&
      paths.has("frontend/pages/operator/schedule/index.ts"),
    "incomplete source closure",
  );
  return manifest;
}
