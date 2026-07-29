import { describe, expect, it } from "vitest";
import { computeStageStates } from "@/lib/parity";
import { AUDIT_STAGE_DEFS, STAGE_DURATION_MS } from "@/lib/audit-data";

const defs = AUDIT_STAGE_DEFS.map((d) => ({ key: d.key, label: d.label, detail: d.detail, artifacts: d.artifacts.slice() }));
const total = STAGE_DURATION_MS.reduce((a, b) => a + b, 0);

describe("computeStageStates (audit pipeline state machine)", () => {
  it("starts with discovery active immediately", () => {
    const { stages, done } = computeStageStates(defs, [...STAGE_DURATION_MS], 0, 0);
    expect(stages.map((s) => s.status)).toEqual(["active", "pending", "pending"]);
    expect(done).toBe(false);
  });

  it("activates discovery first, within its duration", () => {
    const { stages } = computeStageStates(defs, [...STAGE_DURATION_MS], 0, 2000);
    expect(stages.map((s) => s.status)).toEqual(["active", "pending", "pending"]);
    expect(stages[0].artifacts.length).toBeGreaterThan(0);
  });

  it("progresses to normalization after discovery duration", () => {
    const { stages } = computeStageStates(defs, [...STAGE_DURATION_MS], 0, STAGE_DURATION_MS[0] + 500);
    expect(stages.map((s) => s.status)).toEqual(["done", "active", "pending"]);
    expect(stages[0].durationMs).toBe(STAGE_DURATION_MS[0]);
  });

  it("completes exactly at the total duration with all artifacts", () => {
    const { stages, done } = computeStageStates(defs, [...STAGE_DURATION_MS], 0, total);
    expect(done).toBe(true);
    for (const s of stages) {
      expect(s.status).toBe("done");
      expect(s.artifacts.length).toBeGreaterThan(0);
    }
  });

  it("reports changed when a stage transitions", () => {
    const prev = [
      { key: "discovery", status: "active", startedAt: new Date(0).toISOString() },
      { key: "normalization", status: "pending" },
      { key: "reconstruction", status: "pending" },
    ];
    const { changed } = computeStageStates(defs, [...STAGE_DURATION_MS], 0, STAGE_DURATION_MS[0] + 10, prev);
    expect(changed).toBe(true);
  });
});
