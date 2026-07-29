/* Pure parity scoring helpers — unit-testable, no DB access. */

export interface ParityCheckBase {
  key: string;
  label: string;
  baselineValue: string;
  currentValue: string;
}

export interface ParityCheckResult extends ParityCheckBase {
  status: "passed" | "failed" | "warning" | "pending";
  difference?: string;
}

export function computeParityScore(
  checks: Array<{ status: "passed" | "failed" | "warning" | "pending" }>,
): { score: number; overallStatus: "passed" | "warning" | "failed" } {
  if (checks.length === 0) return { score: 100, overallStatus: "passed" };
  const failed = checks.filter((c) => c.status === "failed").length;
  const warnings = checks.filter((c) => c.status === "warning").length;
  const pending = checks.filter((c) => c.status === "pending").length;
  const score = Math.max(0, Math.min(100, 100 - failed * 12 - warnings * 4 - pending * 2));
  return {
    score,
    overallStatus: failed > 0 ? "failed" : warnings > 0 || pending > 0 ? "warning" : "passed",
  };
}

/* Compare two snapshots of checks (previous vs latest) */
export function diffParityChecks(
  previous: Array<{ key: string; label: string; status: string }> | undefined,
  latest: Array<{ key: string; label: string; status: string }> | undefined,
): Array<{ key: string; label: string; before: string; after: string }> {
  if (!previous || !latest) return [];
  const prevMap = new Map(previous.map((c) => [c.key, c]));
  const diffs: Array<{ key: string; label: string; before: string; after: string }> = [];
  for (const c of latest) {
    const p = prevMap.get(c.key);
    if (!p) {
      diffs.push({ key: c.key, label: c.label, before: "absent", after: c.status });
    } else if (p.status !== c.status) {
      diffs.push({ key: c.key, label: c.label, before: p.status, after: c.status });
    }
  }
  return diffs;
}

/* ------------------------------------------------------------------ */
/* Audit stage machine (pure) — shared by demo runner and worker.      */
/* ------------------------------------------------------------------ */
export interface StageDef {
  key: string;
  label: string;
  detail: string;
  artifacts: string[];
}

export interface ComputedStage {
  key: string;
  label: string;
  status: "pending" | "active" | "done" | "failed";
  startedAt?: string;
  durationMs?: number;
  artifacts: string[];
  detail: string;
}

export function computeStageStates(
  defs: StageDef[],
  durations: number[],
  startMs: number,
  elapsedMs: number,
  previous?: Array<{ key: string; status: string; startedAt?: string; durationMs?: number }>,
): { stages: ComputedStage[]; done: boolean; changed: boolean } {
  const bounds: number[] = [0];
  for (const d of durations) bounds.push(bounds[bounds.length - 1] + d);
  const done = elapsedMs >= bounds[bounds.length - 1];
  let changed = false;

  const stages = defs.map((def, i) => {
    const prev = previous?.find((s) => s.key === def.key);
    const isDone = elapsedMs >= bounds[i + 1];
    const isActive = !isDone && elapsedMs >= bounds[i];
    const status: ComputedStage["status"] = isDone ? "done" : isActive ? "active" : "pending";
    if (prev && prev.status !== status) changed = true;
    const stageProgress = isActive
      ? Math.min(1, Math.max(0, (elapsedMs - bounds[i]) / durations[i]))
      : isDone
        ? 1
        : 0;
    const artifactCount = Math.max(isActive ? 1 : 0, Math.floor(stageProgress * def.artifacts.length));
    return {
      key: def.key,
      label: def.label,
      status,
      startedAt: isActive || isDone ? new Date(startMs + bounds[i]).toISOString() : prev?.startedAt,
      durationMs: isDone ? durations[i] : prev?.durationMs,
      artifacts: isDone ? def.artifacts.slice() : def.artifacts.slice(0, artifactCount),
      detail: def.detail,
    };
  });

  return { stages, done, changed };
}
