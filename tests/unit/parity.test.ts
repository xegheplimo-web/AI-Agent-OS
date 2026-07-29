import { describe, expect, it } from "vitest";
import { computeParityScore, diffParityChecks } from "@/lib/parity";
import { parityChecksFrom } from "@/services/auditor/normalize";
import type { NormalizedInventory } from "@/services/auditor/types";

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

  it("treats empty as passed", () => {
    expect(computeParityScore([])).toEqual({ score: 100, overallStatus: "passed" });
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
