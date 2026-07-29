import { describe, expect, it } from "vitest";
import { computeParityScore, diffParityChecks } from "@/lib/parity";

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
