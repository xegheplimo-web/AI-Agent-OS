import { describe, expect, it } from "vitest";
import { computeParityScore, diffParityChecks } from "@/lib/parity";
import { parityChecksFrom } from "@/services/auditor/normalize";
import type { NormalizedInventory, ScanResult } from "@/services/auditor/types";

const baseInventory: NormalizedInventory = {
  host: {},
  repo: {},
  services: [{ name: "api", methods: ["GET"], guarded: true }],
  dependencies: [],
  schema: { tables: [], indexes: [], missingIndexes: [] },
  env: { declared: [], present: [], missing: [], undeclared: [] },
  findings: [],
};

describe("computeParityScore", () => {
  it("scores 100 when all pass", () => {
    const { score, overallStatus } = computeParityScore([
      { status: "passed" },
      { status: "passed" },
      { status: "passed" },
    ]);
    expect(score).toBe(100);
    expect(overallStatus).toBe("passed");
  });

  it("deducts 4 per warning and marks warning", () => {
    const { score, overallStatus } = computeParityScore([
      { status: "passed" },
      { status: "warning" },
      { status: "warning" },
    ]);
    expect(score).toBe(92);
    expect(overallStatus).toBe("warning");
  });

  it("marks failed on any failed check", () => {
    const { overallStatus, score } = computeParityScore([
      { status: "failed" },
      { status: "passed" },
    ]);
    expect(overallStatus).toBe("failed");
    expect(score).toBe(88);
  });

  it("treats empty as failed (fail-closed: no checks ≠ all passed)", () => {
    /* Previously returned 100/passed — a false-green when no scanner ran.
       Zero checks means nothing was measured, not that everything passed. */
    expect(computeParityScore([])).toEqual({ score: 0, overallStatus: "failed" });
  });

  it("deducts 2 per pending and marks warning", () => {
    const { score, overallStatus } = computeParityScore([
      { status: "passed" },
      { status: "pending" },
      { status: "pending" },
    ]);
    expect(score).toBe(96);
    expect(overallStatus).toBe("warning");
  });
});

describe("parityChecksFrom — p95 latency truthfulness", () => {
  it("reports pending when no telemetry is available (null), never passed-on-zero", () => {
    const checks = parityChecksFrom(baseInventory, null);
    const p95 = checks.find((c) => c.key === "p95_latency");
    expect(p95).toBeDefined();
    expect(p95?.status).toBe("pending");
    expect(p95?.currentValue).toBe("no data");
  });

  it("reports passed when real latency is within threshold", () => {
    const checks = parityChecksFrom(baseInventory, 120);
    expect(checks.find((c) => c.key === "p95_latency")?.status).toBe("passed");
  });

  it("reports warning when real latency exceeds threshold", () => {
    const checks = parityChecksFrom(baseInventory, 180);
    expect(checks.find((c) => c.key === "p95_latency")?.status).toBe("warning");
  });

  it("a pending p95 check drags the overall parity off green", () => {
    const checks = parityChecksFrom(baseInventory, null);
    const { overallStatus } = computeParityScore(checks);
    expect(overallStatus).not.toBe("passed");
  });
});

describe("parityChecksFrom — no false-green on unmeasured checks", () => {
  it("golden_tests is pending (auditor does not run the test suite)", () => {
    const checks = parityChecksFrom(baseInventory, 120);
    const golden = checks.find((c) => c.key === "golden_tests");
    expect(golden?.status).toBe("pending");
  });

  it("port_map is pending (no real port scan)", () => {
    const checks = parityChecksFrom(baseInventory, 120);
    const port = checks.find((c) => c.key === "port_map");
    expect(port?.status).toBe("pending");
  });

  it("ui_critical_paths is pending (no UI test runner)", () => {
    const checks = parityChecksFrom(baseInventory, 120);
    const ui = checks.find((c) => c.key === "ui_critical_paths");
    expect(ui?.status).toBe("pending");
  });

  it("the overall parity cannot be 'passed' when unmeasured checks are pending", () => {
    const checks = parityChecksFrom(baseInventory, 120);
    const { overallStatus } = computeParityScore(checks);
    expect(overallStatus).not.toBe("passed");
  });
});

describe("parityChecksFrom — db_schema fail-closed when DB scanner skipped", () => {
  /* Regression: when the DB scanner is skipped (no TARGET_DATABASE_URL),
     scannersForTarget omits it entirely, so `results` has no
     database-inventory entry. Previously db_schema still read "passed"
     because missingIndexes.length === 0 — a false-green: an unmeasured DB
     was reported as healthy. It must be "pending" (no evidence). */
  function scanResult(scanner: string, status: ScanResult["status"], data: Record<string, unknown> = {}): ScanResult {
    return {
      scanner,
      status,
      startedAt: "2026-07-30T00:00:00.000Z",
      finishedAt: "2026-07-30T00:00:00.000Z",
      durationMs: 1,
      artifacts: [],
      warnings: [],
      error: null,
      data,
    };
  }

  it("db_schema is pending when the DB scanner was skipped (no database-inventory result)", () => {
    const results: ScanResult[] = [
      scanResult("filesystem-inventory", "success"),
      scanResult("package-inventory", "success"),
      scanResult("secret-scan", "success"),
      /* database-inventory ABSENT — skipped because no TARGET_DATABASE_URL */
      scanResult("runtime-inventory", "success"),
      scanResult("route-inventory", "success"),
    ];
    const checks = parityChecksFrom(baseInventory, 120, results);
    const db = checks.find((c) => c.key === "db_schema");
    expect(db).toBeDefined();
    expect(db?.status).toBe("pending");
    expect(db?.currentValue).not.toBe("0 indexes");
  });

  it("db_schema is pending when scan results are not provided (no evidence of measurement)", () => {
    /* Fail-closed default: a caller that does not pass scan results cannot
       prove the DB was measured, so db_schema must not read "passed". */
    const checks = parityChecksFrom(baseInventory, 120);
    const db = checks.find((c) => c.key === "db_schema");
    expect(db?.status).toBe("pending");
  });

  it("db_schema is pending when the DB scanner ran but FAILED (no usable evidence)", () => {
    const results: ScanResult[] = [
      scanResult("database-inventory", "failed"),
      scanResult("filesystem-inventory", "success"),
    ];
    const checks = parityChecksFrom(baseInventory, 120, results);
    const db = checks.find((c) => c.key === "db_schema");
    expect(db?.status).toBe("pending");
  });

  it("db_schema is passed only when the DB scanner ran successfully AND no missing indexes AND migration ledger present", () => {
    const inv: NormalizedInventory = {
      ...baseInventory,
      schema: { tables: [{ table: "users", columns: 3, rows: 5 }], indexes: [{ table: "users", index: "idx", definition: "" }], missingIndexes: [] },
    };
    const results: ScanResult[] = [scanResult("database-inventory", "success", { tableCount: 1, migrationLedgerPresent: true })];
    const checks = parityChecksFrom(inv, 120, results);
    const db = checks.find((c) => c.key === "db_schema");
    expect(db?.status).toBe("passed");
  });

  it("db_schema is warning when the DB scanner ran successfully AND missing indexes exist", () => {
    const inv: NormalizedInventory = {
      ...baseInventory,
      schema: {
        tables: [{ table: "users", columns: 3, rows: 5 }],
        indexes: [],
        missingIndexes: [{ table: "users", column: "email" }],
      },
    };
    const results: ScanResult[] = [scanResult("database-inventory", "success", { tableCount: 1, migrationLedgerPresent: true })];
    const checks = parityChecksFrom(inv, 120, results);
    const db = checks.find((c) => c.key === "db_schema");
    expect(db?.status).toBe("warning");
  });

  it("db_schema is warning when DB has tables but no migration ledger (db:push was used)", () => {
    const inv: NormalizedInventory = {
      ...baseInventory,
      schema: { tables: [{ table: "users", columns: 3, rows: 5 }], indexes: [{ table: "users", index: "idx", definition: "" }], missingIndexes: [] },
    };
    const results: ScanResult[] = [scanResult("database-inventory", "success", { tableCount: 1, migrationLedgerPresent: false })];
    const checks = parityChecksFrom(inv, 120, results);
    const db = checks.find((c) => c.key === "db_schema");
    expect(db?.status).toBe("warning");
  });

  it("db_schema is pending when DB scanner ran successfully but found 0 tables (empty schema)", () => {
    const inv: NormalizedInventory = {
      ...baseInventory,
      schema: { tables: [], indexes: [], missingIndexes: [] },
    };
    const results: ScanResult[] = [scanResult("database-inventory", "success", { tableCount: 0, migrationLedgerPresent: false })];
    const checks = parityChecksFrom(inv, 120, results);
    const db = checks.find((c) => c.key === "db_schema");
    expect(db?.status).toBe("pending");
  });

  it("a skipped DB scanner drags the overall parity off green", () => {
    const results: ScanResult[] = [
      scanResult("filesystem-inventory", "success"),
      scanResult("route-inventory", "success"),
    ];
    const checks = parityChecksFrom(baseInventory, 120, results);
    const { overallStatus } = computeParityScore(checks);
    expect(overallStatus).not.toBe("passed");
  });
});

describe("diffParityChecks", () => {
  it("reports only changed checks", () => {
    const before = [
      { key: "a", label: "A", status: "passed" },
      { key: "b", label: "B", status: "warning" },
    ];
    const after = [
      { key: "a", label: "A", status: "passed" },
      { key: "b", label: "B", status: "passed" },
    ];
    const diff = diffParityChecks(before, after);
    expect(diff).toEqual([{ key: "b", label: "B", before: "warning", after: "passed" }]);
  });

  it("flags newly-added checks as absent→status", () => {
    const diff = diffParityChecks(
      [{ key: "a", label: "A", status: "passed" }],
      [
        { key: "a", label: "A", status: "passed" },
        { key: "c", label: "C", status: "warning" },
      ],
    );
    expect(diff).toHaveLength(1);
    expect(diff[0].before).toBe("absent");
  });
});
