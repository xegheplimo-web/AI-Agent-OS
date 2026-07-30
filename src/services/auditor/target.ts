import { existsSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/* ------------------------------------------------------------------ */
/* Audit target registry.                                              */
/*                                                                     */
/* An audit request carries `environment` and `scope`, but those were  */
/* previously cosmetic — every scanner read from a single global ROOT  */
/* and the DB scanner always queried the control plane's own database. */
/*                                                                     */
/* This module resolves a concrete target from the request and the     */
/* environment, so an audit labelled "production" actually scans the   */
/* production repository/DB, not the auditor's own source tree.        */
/*                                                                     */
/* Fail-closed: if a target DB or runtime endpoint is not configured   */
/* for the requested environment, the corresponding scanner is SKIPPED */
/* (not silently run against the control plane's own DB). This prevents*/
/* a false-green where the auditor's own healthy DB is reported as the */
/* target system's health.                                             */
/* ------------------------------------------------------------------ */

/** All scanner scopes. A target's `scope` field filters which run. */
export const ALL_SCOPES = [
  "filesystem",
  "packages",
  "secrets",
  "database",
  "runtime",
  "routes",
] as const;
export type Scope = (typeof ALL_SCOPES)[number];

export interface AuditTarget {
  /** Filesystem root of the repository/system being audited. */
  root: string;
  /** Database URL to inspect. null = DB scanner will be SKIPPED (fail-closed). */
  databaseUrl: string | null;
  /** Runtime endpoint to probe. null = runtime scanner measures worker only. */
  runtimeEndpoint: string | null;
  /** Environment label from the audit request. */
  environment: string;
  /** Scope filter from the audit request. Empty = all scopes. */
  scope: Scope[];
  /** Human-readable label for reports. */
  label: string;
  /** Git commit SHA at the target root, if available. */
  commitSha: string | null;
  /** Whether the target root looks like a real source repository. */
  rootValid: boolean;
  /** Why the root is invalid, if applicable. */
  rootInvalidReason?: string;
}

/**
 * Environment-specific target configuration.
 *
 * Each environment can have its own root, database URL, and runtime
 * endpoint. This is read from env vars at resolve time — in a real
 * deployment these would come from a target registry table, but env vars
 * are sufficient for the current single-target-per-environment model.
 *
 * Resolution order for `root`:
 *   1. `AUDIT_TARGET_ROOT_{ENV}` (e.g. AUDIT_TARGET_ROOT_PRODUCTION)
 *   2. `AUDIT_TARGET_ROOT` (fallback for all environments)
 *   3. `process.cwd()` (worker running from the repository — demo only)
 *
 * Resolution order for `databaseUrl`:
 *   1. `TARGET_DATABASE_URL_{ENV}` (e.g. TARGET_DATABASE_URL_PRODUCTION)
 *   2. `TARGET_DATABASE_URL` (fallback for all environments)
 *   3. null — DB scanner SKIPPED (fail-closed, NOT control-plane DB)
 *
 * Resolution order for `runtimeEndpoint`:
 *   1. `TARGET_RUNTIME_ENDPOINT_{ENV}`
 *   2. `TARGET_RUNTIME_ENDPOINT`
 *   3. null — runtime scanner measures worker process only
 */
export function resolveTarget(environment: string, scope?: string[]): AuditTarget {
  const envKey = environment.toUpperCase().replace(/[^A-Z0-9]/g, "_");

  /* Root resolution. An explicit per-environment root (or the generic
     AUDIT_TARGET_ROOT) always wins. Only when neither is set do we fall back
     to process.cwd() — and for production that fallback is UNSAFE: the
     worker running from its own repository would audit itself instead of the
     real production target, producing a false-green. So for production we
     record the fallback as an invalid root (fail-closed) rather than
     silently scanning the worker's own checkout. */
  const explicitRoot = process.env[`AUDIT_TARGET_ROOT_${envKey}`] ?? process.env.AUDIT_TARGET_ROOT ?? null;
  const rootFallback = process.cwd();
  const root = path.resolve(explicitRoot ?? rootFallback);
  const rootFellBackToCwd = explicitRoot === null;
  const isProductionLike = environment === "production" || environment === "staging";

  const databaseUrl =
    process.env[`TARGET_DATABASE_URL_${envKey}`] ??
    process.env.TARGET_DATABASE_URL ??
    null;
  const runtimeEndpoint =
    process.env[`TARGET_RUNTIME_ENDPOINT_${envKey}`] ??
    process.env.TARGET_RUNTIME_ENDPOINT ??
    null;

  const scopeFilter = (scope ?? []).filter((s): s is Scope =>
    (ALL_SCOPES as readonly string[]).includes(s),
  );

  let rootCheck = checkRoot(root);
  if (rootCheck.valid && rootFellBackToCwd && isProductionLike) {
    rootCheck = {
      valid: false,
      reason: `production/staging target root not configured (AUDIT_TARGET_ROOT_${envKey} or AUDIT_TARGET_ROOT unset) — refusing to audit the worker's own checkout at ${root}`,
    };
  }

  return {
    root,
    databaseUrl,
    runtimeEndpoint,
    environment,
    scope: scopeFilter,
    label: `${environment} @ ${root}`,
    commitSha: getCommitSha(root),
    rootValid: rootCheck.valid,
    rootInvalidReason: rootCheck.reason,
  };
}

function checkRoot(root: string): { valid: boolean; reason?: string } {
  if (!existsSync(root)) return { valid: false, reason: `target root does not exist: ${root}` };
  if (!existsSync(path.join(root, "package.json"))) {
    return { valid: false, reason: `no package.json under ${root} — not a Node.js repository?` };
  }
  return { valid: true };
}

/** Best-effort `git rev-parse HEAD` at the target root. null if not a git
 *  repo or git is unavailable — the audit still runs, provenance just
 *  records "unknown commit". */
function getCommitSha(root: string): string | null {
  try {
    const sha = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf-8", timeout: 3000 }).trim();
    return sha.length === 40 ? sha : null;
  } catch {
    return null;
  }
}

/** Provenance block embedded in every artifact's metadata. */
export function targetProvenance(target: AuditTarget) {
  return {
    targetRoot: target.root,
    targetLabel: target.label,
    environment: target.environment,
    scope: target.scope.length ? target.scope : [...ALL_SCOPES],
    commitSha: target.commitSha,
    databaseUrl: target.databaseUrl ? "[redacted]" : null,
    runtimeEndpoint: target.runtimeEndpoint,
    rootValid: target.rootValid,
    resolvedAt: new Date().toISOString(),
  };
}

/** Whether a scanner scope should run for this target. */
export function scopeEnabled(target: AuditTarget, scope: Scope): boolean {
  if (!target.scope.length) return true; // empty = all scopes
  return target.scope.includes(scope);
}

/** Whether the DB scanner should run for this target. Fail-closed: if no
 *  target DB URL is configured, the DB scanner is SKIPPED — it must NOT
 *  fall back to the control plane's own DATABASE_URL, because that would
 *  produce a false-green (the auditor's DB is always healthy because the
 *  auditor is running). */
export function databaseScopeEnabled(target: AuditTarget): boolean {
  return scopeEnabled(target, "database") && target.databaseUrl !== null;
}

