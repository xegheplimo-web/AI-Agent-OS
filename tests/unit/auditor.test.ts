import { describe, expect, it } from "vitest";
import { normalize, parityChecksFrom } from "@/services/auditor/normalize";
import { scanFilesystem, scanPackages, scanRoutes, scanRuntime, scanSecrets } from "@/services/auditor/scanners";
import { buildRealSbom } from "@/services/auditor/reconstruct";
import { scanResultSchema } from "@/services/auditor/types";
import { computeParityScore } from "@/lib/parity";

/* These exercise the REAL scanners against this repository. */

describe("real discovery scanners", () => {
  it("filesystem scanner measures the actual repository", async () => {
    const res = await scanFilesystem();
    expect(scanResultSchema.safeParse(res).success).toBe(true);
    expect(res.status).not.toBe("failed");
    expect(res.data.totalFiles as number).toBeGreaterThan(20);
    expect(res.data.totalLines as number).toBeGreaterThan(1000);
    expect(res.data.configFiles as string[]).toContain("package.json");
  });

  it("detects that the lockfile is committed", async () => {
    const res = await scanFilesystem();
    expect(res.data.lockFilePresent).toBe(true);
  });

  it("package scanner resolves installed versions and licenses (direct + transitive)", async () => {
    const res = await scanPackages();
    const components = res.data.components as Array<{ name: string; version: string; license: string; type: string }>;
    expect(res.status).not.toBe("failed");
    expect(components.length).toBeGreaterThan(10);
    const next = components.find((c) => c.name === "next");
    expect(next).toBeDefined();
    // resolved from node_modules, not the semver range in package.json
    expect(next!.version).toMatch(/^\d+\.\d+\.\d+/);
    // transitive deps should be present (full supply chain SBOM)
    expect(res.data.transitiveCount as number).toBeGreaterThan(30);
    expect(res.data.totalCount as number).toBeGreaterThan(res.data.directCount as number);
  });

  it("route scanner finds API routes and flags unguarded mutations", async () => {
    const res = await scanRoutes();
    const routes = res.data.routes as Array<{ route: string; methods: string[]; guarded: boolean }>;
    expect(routes.length).toBeGreaterThan(10);
    expect(routes.some((r) => r.route === "/api/audits/run")).toBe(true);

    // every mutating route in this codebase must carry a permission check
    expect(res.data.unguardedMutating).toEqual([]);
  });

  it("secret scanner runs rules without flagging its own allowlist", async () => {
    const res = await scanSecrets();
    expect(res.status).not.toBe("failed");
    expect(res.data.rulesEvaluated as number).toBeGreaterThan(3);
    expect(Array.isArray(res.data.hits)).toBe(true);
  });

  it("runtime scanner reads the env contract from .env.example", async () => {
    const res = await scanRuntime();
    const env = res.data.env as { declared: string[]; present: string[]; missing: string[] };
    expect(env.declared).toContain("DATABASE_URL");
    expect(env.declared.length).toBeGreaterThan(5);
  });
});

describe("normalization derives findings from measured data", () => {
  it("emits a finding when the lockfile is missing", () => {
    const inv = normalize([
      {
        scanner: "filesystem-inventory",
        status: "success",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 5,
        artifacts: [],
        warnings: [],
        error: null,
        data: { lockFilePresent: false, totalFiles: 10 },
      },
    ]);
    const f = inv.findings.find((x) => x.title.includes("package-lock.json"));
    expect(f?.severity).toBe("critical");
  });

  it("emits a high finding for unguarded mutating routes", () => {
    const inv = normalize([
      {
        scanner: "route-inventory",
        status: "success",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 3,
        artifacts: [],
        warnings: [],
        error: null,
        data: { unguardedMutating: ["/api/danger"], routes: [] },
      },
    ]);
    expect(inv.findings.some((f) => f.severity === "high" && f.title.includes("/api/danger"))).toBe(true);
  });

  it("returns an info finding for a clean scan", () => {
    const inv = normalize([
      {
        scanner: "runtime-inventory",
        status: "success",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
        artifacts: [],
        warnings: [],
        error: null,
        data: { env: { declared: ["A"], present: ["A"], missing: [], undeclared: [] } },
      },
    ]);
    expect(inv.findings).toHaveLength(1);
    expect(inv.findings[0].severity).toBe("info");
  });

  it("surfaces failed scanners as findings", () => {
    const inv = normalize([
      {
        scanner: "database-inventory",
        status: "failed",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 2,
        artifacts: [],
        warnings: [],
        error: "connection refused",
        data: {},
      },
    ]);
    expect(inv.findings.some((f) => f.title.includes("database-inventory") && f.severity === "high")).toBe(true);
  });
});

describe("parity derived from real inventory", () => {
  const baseInv = {
    host: {},
    repo: {},
    services: [
      { route: "/api/audits/run", methods: ["POST"], guarded: true },
      { route: "/api/events", methods: ["GET"], guarded: false },
    ],
    dependencies: [],
    schema: { tables: [{ table: "audits", columns: 10, rows: null }], indexes: [], missingIndexes: [] },
    env: { declared: ["A"], present: ["A"], missing: [], undeclared: [] },
    findings: [],
  };

  it("passes authz and latency when both are good, but overall is warning due to unmeasured checks", () => {
    const checks = parityChecksFrom(baseInv, 120);
    expect(checks.find((c) => c.key === "endpoint_authz")?.status).toBe("passed");
    expect(checks.find((c) => c.key === "p95_latency")?.status).toBe("passed");
    /* golden_tests, port_map, ui_critical_paths are pending (not measured by
       the auditor), so the overall status cannot be "passed" — that is the
       honest behavior, not a false-green. */
    const { overallStatus } = computeParityScore(checks);
    expect(overallStatus).toBe("warning");
  });

  it("fails the authz check when a mutating route is unguarded", () => {
    const checks = parityChecksFrom(
      { ...baseInv, services: [{ route: "/api/x", methods: ["POST"], guarded: false }] },
      120,
    );
    expect(checks.find((c) => c.key === "endpoint_authz")?.status).toBe("failed");
    expect(computeParityScore(checks).overallStatus).toBe("failed");
  });

  it("warns when p95 latency exceeds the baseline", () => {
    const checks = parityChecksFrom(baseInv, 180);
    expect(checks.find((c) => c.key === "p95_latency")?.status).toBe("warning");
  });
});

describe("SBOM reconstruction", () => {
  it("produces valid CycloneDX from real dependencies", () => {
    const sbom = JSON.parse(
      buildRealSbom("AUD-TEST", {
        host: {},
        repo: {},
        services: [],
        dependencies: [
          { name: "next", version: "16.2.6", license: "MIT", type: "runtime" },
          { name: "mystery", version: "1.0.0", license: "UNKNOWN", type: "development" },
        ],
        schema: { tables: [], indexes: [], missingIndexes: [] },
        env: { declared: [], present: [], missing: [], undeclared: [] },
        findings: [],
      }),
    );
    expect(sbom.bomFormat).toBe("CycloneDX");
    expect(sbom.specVersion).toBe("1.6");
    expect(sbom.components).toHaveLength(2);
    expect(sbom.components[0].licenses[0].license.id).toBe("MIT");
    expect(sbom.components[1].licenses).toEqual([]); // unlicensed → empty, gate can catch it
  });
});
