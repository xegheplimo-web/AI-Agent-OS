import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { artifacts, audits, events, findings, jobs, parityReports, telemetryPoints } from "@/db/schema";
import { computeParityScore } from "@/lib/parity";
import { logAudit } from "@/lib/audit-log";
import { GENERATOR_VERSION } from "@/lib/version";
import { isDemoMode } from "@/services/mode";
import { LeaseLostError } from "@/services/lease";
import { scannersForTarget } from "@/services/auditor/scanners";
import { normalize, parityChecksFrom } from "@/services/auditor/normalize";
import { resolveTarget, targetProvenance, type AuditTarget } from "@/services/auditor/target";
import {
  buildInventoryJson,
  buildRealArchitectureMmd,
  buildRealReadme,
  buildRealRunbook,
  buildRealSbom,
} from "@/services/auditor/reconstruct";
import type { NormalizedInventory, ScanResult } from "@/services/auditor/types";

/* ------------------------------------------------------------------ */
/* REAL audit engine.                                                  */
/*                                                                     */
/* Executes the 3-stage pipeline against the live system instead of a  */
/* wall-clock timeline: Discovery runs actual scanners, Normalization  */
/* derives findings from measured data, Reconstruction writes real     */
/* artifacts (README/SBOM/mermaid/runbook/inventories) with sha256.    */
/* ------------------------------------------------------------------ */

const STAGE_META = [
  { key: "discovery", label: "Discovery", detail: "filesystem, repo, packages, secrets, database, runtime, routes" },
  {
    key: "normalization",
    label: "Normalization",
    detail: "host_inventory.json, repo_inventory.json, service_catalog.json, dependency_graph.json, security_findings.json",
  },
  {
    key: "reconstruction",
    label: "Reconstruction",
    detail: "README, CycloneDX SBOM, Mermaid graph, runbook recovery, parity gates",
  },
];

type StageRow = {
  key: string;
  label: string;
  status: "pending" | "active" | "done" | "failed";
  startedAt?: string;
  durationMs?: number;
  artifacts: string[];
  detail?: string;
};

function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

/** Stable dedupe key so a resumed run upserts instead of duplicating. */
export function findingFingerprint(f: { component: string; category: string; title: string }) {
  return sha256(`${f.component}|${f.category}|${f.title}`).slice(0, 32);
}

function initialStages(): StageRow[] {
  return STAGE_META.map((m) => ({ ...m, status: "pending" as const, artifacts: [] }));
}

async function setStages(auditId: string, stages: StageRow[]) {
  await db.update(audits).set({ stages }).where(eq(audits.id, auditId));
}

/** Error thrown when a lease-fenced update matches 0 rows — the worker lost
 *  ownership of the job (stale supervisor requeued it, another worker claimed
 *  it). The caller must abort all further writes and exit silently. */
// LeaseLostError is imported from @/services/lease so the audit engine and
// the non-audit executors share one error class (instanceof works across
// modules).

/** Keeps the owning job alive so stale-recovery does not steal a live audit.
 *
 *  Lease fencing: the update only matches if lease_token still equals the
 *  token this worker was given at claim time. If a stale supervisor requeued
 *  the job (clearing lease_token) and another worker claimed it, this update
 *  matches 0 rows — the worker lost ownership and must not continue writing.
 *
 *  Uses RETURNING to detect the 0-row case and throws LeaseLostError so the
 *  caller can abort immediately instead of continuing to write stale data. */
async function heartbeat(jobId?: string, leaseToken?: string | null): Promise<void> {
  if (!jobId) return;
  const filter = leaseToken ? and(eq(jobs.id, jobId), eq(jobs.leaseToken, leaseToken)) : eq(jobs.id, jobId);
  const updated = await db
    .update(jobs)
    .set({ heartbeatAt: new Date(), updatedAt: new Date() })
    .where(filter)
    .returning({ id: jobs.id });
  if (leaseToken && !updated.length) throw new LeaseLostError();
}

async function setJobProgress(jobId: string | undefined, progress: number, leaseToken?: string | null): Promise<void> {
  if (!jobId) return;
  const filter = leaseToken ? and(eq(jobs.id, jobId), eq(jobs.leaseToken, leaseToken)) : eq(jobs.id, jobId);
  const updated = await db
    .update(jobs)
    .set({ progress, heartbeatAt: new Date(), updatedAt: new Date() })
    .where(filter)
    .returning({ id: jobs.id });
  if (leaseToken && !updated.length) throw new LeaseLostError();
}

/** Starts a background heartbeat timer that fires every 15s while the audit
 *  pipeline runs. Without this, a scanner or executor that takes longer than
 *  the stale-recovery threshold (45s) would have its job requeued even though
 *  the worker is still alive and making progress.
 *
 *  Returns a stop function — call it when the pipeline finishes (success or
 *  failure) to clear the interval. If a heartbeat detects lease loss, it
 *  sets a flag that the next `assertLease()` check will see. */
function startHeartbeatLoop(jobId: string | undefined, leaseToken: string | null | undefined): {
  stop: () => void;
  leaseLost: () => boolean;
} {
  let lost = false;
  if (!jobId || !leaseToken) return { stop: () => {}, leaseLost: () => false };
  const timer = setInterval(async () => {
    try {
      await heartbeat(jobId, leaseToken);
    } catch (err) {
      if (err instanceof LeaseLostError) {
        lost = true;
      }
    }
  }, 15_000);
  return {
    stop: () => clearInterval(timer),
    leaseLost: () => lost,
  };
}

/** Throws LeaseLostError if the background heartbeat detected lease loss or
 *  if an explicit lease check fails. Call this before each major side-effect
 *  group (scanner results, findings, reconstruction artifacts, finalize). */
async function assertLease(jobId: string | undefined, leaseToken: string | null | undefined, heartbeatState: { leaseLost: () => boolean }): Promise<void> {
  if (!jobId || !leaseToken) return;
  if (heartbeatState.leaseLost()) throw new LeaseLostError();
  /* Explicit DB check: even if the background timer hasn't fired yet, the
     lease may have been cleared by a concurrent requeue. */
  const rows = await db.select({ leaseToken: jobs.leaseToken }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!rows.length || rows[0].leaseToken !== leaseToken) throw new LeaseLostError();
}

type TxOrDb = typeof db | import("drizzle-orm/node-postgres").NodePgDatabase<Record<string, never>>;

async function persistArtifact(params: {
  auditId: string;
  kind: string;
  format: string;
  mimeType: string;
  title: string;
  path: string;
  content: string;
  tags: string[];
  environment: string;
  metadata?: Record<string, unknown>;
  /** Optional transaction handle — when provided, the insert runs inside the
   *  caller's transaction (with its lease guard) instead of a standalone db
   *  call. This closes the TOCTOU window between assertLease() and the write. */
  tx?: TxOrDb;
}) {
  const conn = params.tx ?? db;
  const bytes = Buffer.byteLength(params.content, "utf-8");
  const row = {
    auditId: params.auditId,
    kind: params.kind,
    format: params.format,
    title: params.title,
    path: params.path,
    storageProvider: "db",
    storageKey: params.path,
    mimeType: params.mimeType,
    sizeBytes: bytes,
    sizeKb: Math.round((bytes / 1024) * 10) / 10,
    sha256: sha256(params.content),
    schemaVersion: "1.0",
    generator: "ai-system-auditor",
    generatorVersion: GENERATOR_VERSION,
    environment: params.environment,
    content: params.content,
    tags: params.tags,
    metadata: params.metadata ?? {},
    updatedAt: new Date(),
  };
  /* Resume-safe: (audit_id, path) is UNIQUE, so a retried stage rewrites
     the artifact instead of inserting a duplicate. */
  await conn
    .insert(artifacts)
    .values(row)
    .onConflictDoUpdate({
      target: [artifacts.auditId, artifacts.path],
      set: {
        content: row.content,
        sha256: row.sha256,
        sizeBytes: row.sizeBytes,
        sizeKb: row.sizeKb,
        metadata: row.metadata,
        updatedAt: row.updatedAt,
      },
    });
}

/** Run a callback inside a transaction with an atomic lease guard as the
 *  first statement. The SELECT FOR UPDATE locks the job row for the duration
 *  of the transaction — if cancelAudit or requeueStaleJobs clears the lease
 *  concurrently, it blocks until we commit. If the lease is already gone, we
 *  get 0 rows → LeaseLostError before the callback runs. This closes the
 *  TOCTOU window between assertLease() and the side-effect writes. */
async function fencedTx<T>(
  jobId: string | undefined,
  leaseToken: string | null | undefined,
  heartbeatState: { leaseLost: () => boolean },
  fn: (tx: import("drizzle-orm/node-postgres").NodePgDatabase<Record<string, never>>) => Promise<T>,
): Promise<T> {
  if (heartbeatState.leaseLost()) throw new LeaseLostError();
  if (!jobId || !leaseToken) {
    /* No lease (demo/inline) — run without guard but still in a transaction
       so the writes are atomic. */
    return db.transaction(async (tx) => fn(tx));
  }
  return db.transaction(async (tx) => {
    const rows = await tx.execute(
      sql`SELECT 1 FROM jobs WHERE id = ${jobId} AND lease_token = ${leaseToken} AND status = 'running' FOR UPDATE`,
    );
    if (!(rows.rows ?? []).length) throw new LeaseLostError();
    return fn(tx);
  });
}

/**
 * Runs the real pipeline for one audit row.
 *
 * `jobId` is the queue job that owns this audit — the worker only ever calls
 * this for a job it claimed with FOR UPDATE SKIP LOCKED, so two workers can
 * never execute the same audit. The job is heartbeated throughout and
 * completed/failed together with the audit.
 *
 * Resume-safe: findings and artifacts are upserted on their unique keys, so
 * a crashed run that is retried rewrites rows instead of duplicating them.
 */
export async function runRealAudit(auditId: string, jobId?: string, leaseToken?: string | null): Promise<void> {
  const rows = await db.select().from(audits).where(eq(audits.id, auditId)).limit(1);
  if (!rows.length) return;
  const audit = rows[0];
  if (audit.status !== "running") return;

  const environment = audit.environment;
  const target = resolveTarget(environment, audit.scope ?? []);
  const stages = initialStages();
  const t0 = Date.now();

  /* Background heartbeat: fires every 15s so a long-running scanner or
     executor doesn't get requeued by stale recovery (threshold 45s). */
  const hb = startHeartbeatLoop(jobId, leaseToken);

  try {
    /* ---------------- Stage 1: Discovery ---------------- */
    /* Assert the lease BEFORE the first side effect: previously setStages
       and the first raw artifact were written before any lease check, so a
       worker that had already lost ownership would still mutate the audit's
       stage state. The heartbeat loop may not have fired yet, so this explicit
       DB check catches a concurrent requeue immediately. */
    await assertLease(jobId, leaseToken, hb);
    stages[0].status = "active";
    stages[0].startedAt = new Date().toISOString();
    await setStages(auditId, stages);
    await setJobProgress(jobId, 5, leaseToken);

    /* Target-aware scanning: only run scanners whose scope is in the audit
       request's scope list. Each scanner receives the resolved target so it
       reads from the target root / target DB, not the control plane's own. */
    const scanners = scannersForTarget(target);
    const results: ScanResult[] = [];
    for (const { name, run } of scanners) {
      const res = await run();
      results.push(res);
      stages[0].artifacts = Array.from(new Set(results.flatMap((r) => r.artifacts)));
      await setStages(auditId, stages);

      /* Persist the RAW scan envelope immediately — Discovery advertises
         raw/* artifacts, so they must actually exist in the artifact table.
         The persist is inside a fencedTx so the lease check (SELECT FOR UPDATE)
         and the artifact insert are atomic — no TOCTOU window between
         assertLease and the write. */
      await fencedTx(jobId, leaseToken, hb, async (tx) => {
        await persistArtifact({
          auditId,
          kind: "json",
          format: "json",
          mimeType: "application/json",
          title: `raw · ${res.scanner}.json`,
          path: `/audit/raw/${res.scanner}.json`,
          content: buildInventoryJson(`${res.scanner}.json`, res),
          tags: ["discovery", "raw", res.scanner],
          environment,
          metadata: {
            stage: "discovery",
            scanner: res.scanner,
            status: res.status,
            audit: audit.name,
            provenance: targetProvenance(target),
          },
          tx,
        });
      });

      await setJobProgress(jobId, 5 + Math.round((results.length / scanners.length) * 40), leaseToken);
    }
    stages[0].status = "done";
    stages[0].durationMs = Date.now() - t0;
    stages[0].artifacts = results.map((r) => `raw/${r.scanner}.json`);
    await setStages(auditId, stages);

    await db.insert(events).values({
      type: "audit.stage.completed",
      severity: "info",
      source: "auditor",
      message: `${audit.name} · Discovery hoàn tất — ${results.length} scanners, ${results.filter((r) => r.status === "success").length} success`,
    });

    /* ---------------- Stage 2: Normalization ---------------- */
    await assertLease(jobId, leaseToken, hb);
    const t1 = Date.now();
    stages[1].status = "active";
    stages[1].startedAt = new Date().toISOString();
    await setStages(auditId, stages);

    const inv: NormalizedInventory = normalize(results);
    const normalizedArtifacts: Array<{ path: string; title: string; payload: unknown }> = [
      { path: "/audit/normalized/host_inventory.json", title: "host_inventory.json", payload: inv.host },
      { path: "/audit/normalized/repo_inventory.json", title: "repo_inventory.json", payload: inv.repo },
      { path: "/audit/normalized/service_catalog.json", title: "service_catalog.json", payload: inv.services },
      { path: "/audit/normalized/dependency_graph.json", title: "dependency_graph.json", payload: inv.dependencies },
      { path: "/audit/normalized/database_schema.json", title: "database_schema.json", payload: inv.schema },
      { path: "/audit/normalized/security_findings.json", title: "security_findings.json", payload: inv.findings },
      { path: "/audit/normalized/scan_results.json", title: "scan_results.json", payload: results },
    ];

    /* All normalization artifacts + findings are persisted inside a single
       fencedTx so the lease check and ALL writes are atomic — a lease loss
       during this stage cannot leave a partial set of normalized artifacts. */
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of inv.findings) counts[f.severity] += 1;

    await fencedTx(jobId, leaseToken, hb, async (tx) => {
      for (const a of normalizedArtifacts) {
        await persistArtifact({
          auditId,
          kind: "json",
          format: "json",
          mimeType: "application/json",
          title: a.title,
          path: a.path,
          content: buildInventoryJson(a.title, a.payload),
          tags: ["normalization", "inventory"],
          environment,
          metadata: { stage: "normalization", audit: audit.name },
          tx,
        });
      }

      /* real findings → DB (upsert on fingerprint so retries don't duplicate) */
      for (const f of inv.findings) {
        const fingerprint = findingFingerprint(f);
        await tx
          .insert(findings)
          .values({
            auditId,
            severity: f.severity,
            category: f.category,
            component: f.component,
            title: f.title,
            description: f.description,
            evidence: f.evidence,
            status: "open",
            fingerprint,
          })
          .onConflictDoUpdate({
            target: [findings.auditId, findings.fingerprint],
            set: { severity: f.severity, description: f.description, evidence: f.evidence },
          });
      }
    });

    stages[1].status = "done";
    stages[1].durationMs = Date.now() - t1;
    stages[1].artifacts = normalizedArtifacts.map((a) => a.path.replace("/audit/", ""));
    await setStages(auditId, stages);
    await setJobProgress(jobId, 65, leaseToken);

    await db.insert(events).values({
      type: "audit.stage.completed",
      severity: counts.critical > 0 ? "error" : counts.high > 0 ? "warning" : "info",
      source: "auditor",
      message: `${audit.name} · Normalization — ${inv.findings.length} findings thật (${counts.critical} critical, ${counts.high} high)`,
    });

    /* ---------------- Stage 3: Reconstruction ---------------- */
    await assertLease(jobId, leaseToken, hb);
    const t2 = Date.now();
    stages[2].status = "active";
    stages[2].startedAt = new Date().toISOString();
    await setStages(auditId, stages);
    await heartbeat(jobId, leaseToken);

    /* p95 latency from telemetry — filtered by source, freshness, and
       environment so synthetic/manual/stale data cannot make a production
       parity gate pass. Only "otlp" (or "manual" in demo mode) sources
       count; data older than 10 minutes is treated as absent. */
    const FRESHNESS_MS = 10 * 60 * 1000;
    const cutoff = new Date(Date.now() - FRESHNESS_MS);
    const p95Rows = await db
      .select()
      .from(telemetryPoints)
      .where(and(
        eq(telemetryPoints.metric, "latency_p95"),
        sql`${telemetryPoints.ts} > ${cutoff}`,
        inArray(telemetryPoints.source, isDemoMode ? ["synthetic", "manual"] : ["otlp"]),
      ))
      .orderBy(desc(telemetryPoints.ts))
      .limit(1);
    /* null — not 0 — when there is no telemetry. A 0ms fallback used to make
       the p95 parity check read "passed" on a system with no collector, which
       is a false-green. null propagates to a `pending` check instead. */
    const latencyP95: number | null = p95Rows.length ? p95Rows[0].value : null;

    const checks = parityChecksFrom(inv, latencyP95, results);
    const { score: parityScore, overallStatus } = computeParityScore(checks);

    /* P1-3: Compute parityGates + effectiveParityStatus BEFORE building the
       recon artifacts. Previously parity_report.json was created with
       `overallStatus` (from checks only) while the DB parity report used
       `effectiveParityStatus` (checks + gates) — the artifact could say
       "passed/warning" while the DB report said "failed". Now both use the
       same effective status. */
    const parityGates = [
      { key: "secrets_scan", label: "Secrets scan", status: counts.critical > 0 ? "failed" : "passed" },
      { key: "sbom_generated", label: "SBOM generated", status: "passed" },
      { key: "endpoint_authz", label: "Endpoint authorization", status: checks.find((c) => c.key === "endpoint_authz")?.status ?? "passed" },
      { key: "lockfile", label: "Deterministic install (lockfile)", status: (inv.repo as { lockFilePresent?: boolean }).lockFilePresent ? "passed" : "failed" },
    ];
    const anyGateFailed = parityGates.some((g) => g.status === "failed");
    const effectiveParityStatus: "passed" | "warning" | "failed" =
      anyGateFailed ? "failed" : overallStatus;

    const recon = [
      {
        kind: "markdown",
        format: "md",
        mime: "text/markdown",
        title: "README — Reconstructed System Overview",
        path: "/audit/recon/README.md",
        content: buildRealReadme(audit.name, inv, results),
        tags: ["reconstruction", "readme"],
      },
      {
        kind: "sbom",
        format: "json",
        mime: "application/json",
        title: "SBOM — CycloneDX 1.6 (resolved versions)",
        path: "/audit/recon/sbom.cyclonedx.json",
        content: buildRealSbom(audit.name, inv),
        tags: ["sbom", "supply-chain"],
      },
      {
        kind: "mermaid",
        format: "mmd",
        mime: "text/vnd.mermaid",
        title: "Architecture Graph — Mermaid (from route inventory)",
        path: "/audit/recon/architecture.mmd",
        content: buildRealArchitectureMmd(inv),
        tags: ["diagram", "architecture"],
      },
      {
        kind: "runbook",
        format: "md",
        mime: "text/markdown",
        title: "RUNBOOK — Incident & Recovery",
        path: "/audit/recon/RUNBOOK.md",
        content: buildRealRunbook(inv, results),
        tags: ["runbook", "recovery"],
      },
      {
        kind: "json",
        format: "json",
        mime: "application/json",
        title: "parity_report.json",
        path: "/audit/recon/parity_report.json",
        content: buildInventoryJson("parity_report.json", {
          methodology:
            "Behavioural parity measured from live inventory: routes, env contract, DB schema/indexes, endpoint authorization and p95 latency — not source diff.",
          score: parityScore,
          overallStatus: effectiveParityStatus,
          checks,
          gates: parityGates,
        }),
        tags: ["parity", "gate"],
      },
    ];

    /* P0-1: All recon artifacts are persisted inside a single fencedTx so the
       lease check (SELECT FOR UPDATE) and ALL writes are atomic — a lease
       loss during reconstruction cannot leave a partial set of artifacts. */
    await fencedTx(jobId, leaseToken, hb, async (tx) => {
      for (const a of recon) {
        await persistArtifact({
          auditId,
          kind: a.kind,
          format: a.format,
          mimeType: a.mime,
          title: a.title,
          path: a.path,
          content: a.content,
          tags: a.tags,
          environment,
          metadata: { stage: "reconstruction", audit: audit.name },
          tx,
        });
      }
    });

    stages[2].status = "done";
    stages[2].durationMs = Date.now() - t2;
    stages[2].artifacts = recon.map((a) => a.path.replace("/audit/", ""));
    await setStages(auditId, stages);
    await setJobProgress(jobId, 92, leaseToken);

    /* ---------------- finalize ---------------- */
    const severityPenalty = counts.critical * 12 + counts.high * 6 + counts.medium * 3 + counts.low * 1;
    const auditScore = Math.max(0, Math.min(100, 100 - severityPenalty));

    /* The audit→completed, parity report, outcome event and job→completed
       transitions are committed together inside a fencedTx — the lease check
       (SELECT FOR UPDATE) is the first statement, so cancel/requeue cannot
       clear the lease between the check and the writes. The transaction
       returns `parityFailed` so the caller knows whether to emit the
       audit.completed log (P0-2: previously `return` inside the transaction
       callback did NOT exit runRealAudit, so logAudit ran even when parity
       failed). */
    const parityFailed = await fencedTx(jobId, leaseToken, hb, async (tx) => {
      await tx
        .insert(parityReports)
        .values({
          auditId,
          overallStatus: effectiveParityStatus,
          score: parityScore,
          environment,
          checks,
          gates: parityGates,
        })
        .onConflictDoUpdate({
          target: [parityReports.auditId],
          targetWhere: sql`${parityReports.auditId} IS NOT NULL`,
          set: {
            overallStatus: effectiveParityStatus,
            score: parityScore,
            checks,
            gates: parityGates,
            environment,
          },
        });

      /* Parity gate enforcement: if effective parity failed (either from
         checks or from a gate), the audit is marked failed and NO
         audit.completed success event is emitted — only a parity.gate.failed
         event. Previously the engine emitted audit.completed (success) and
         THEN flipped the audit to failed, making the event feed
         self-contradictory. */
      if (effectiveParityStatus === "failed") {
        await tx
          .update(audits)
          .set({ status: "failed", score: auditScore, finishedAt: new Date(), stages })
          .where(eq(audits.id, auditId));
        await tx.insert(events).values({
          type: "parity.gate.failed",
          severity: "error",
          source: "auditor",
          message: `${audit.name} — parity gate FAILED, packaging approval blocked`,
        });
        if (jobId) {
          const leaseFilter = leaseToken
            ? and(eq(jobs.id, jobId), eq(jobs.leaseToken, leaseToken), eq(jobs.status, "running"))
            : eq(jobs.id, jobId);
          /* P0-2: Check the returning result — if 0 rows matched, the lease
             was lost (stale supervisor requeued the job). Throw LeaseLostError
             to abort the transaction so the parity report + audit→failed +
             event are NOT committed by a worker that lost ownership. */
          const finalized = await tx
            .update(jobs)
            .set({ status: "failed", progress: 100, finishedAt: new Date(), heartbeatAt: new Date(), updatedAt: new Date(), errorCode: "PARITY_GATE_FAILED", errorMessage: "parity gate failed — packaging blocked" })
            .where(leaseFilter)
            .returning({ id: jobs.id });
          if (leaseToken && !finalized.length) {
            throw new LeaseLostError();
          }
        }
        return true; // parity failed — caller skips audit.completed log
      }

      /* Only emit audit.completed when parity is passed or warning. */
      await tx
        .update(audits)
        .set({
          status: "completed",
          score: auditScore,
          findingsCount: counts,
          artifactNames: [...stages[0].artifacts, ...stages[1].artifacts, ...stages[2].artifacts],
          finishedAt: new Date(),
          stages,
        })
        .where(eq(audits.id, auditId));

      await tx.insert(events).values({
        type: "audit.completed",
        severity: "success",
        source: "auditor",
        message: `${audit.name} completed (real engine) — score ${auditScore}, ${inv.findings.length} findings, parity ${parityScore}%`,
      });

      /* The owning job finishes with the audit — previously audit.run jobs were
         skipped by the job runner and stayed `running` forever.
         Lease fencing: the update only matches if lease_token still equals the
         token this worker was given at claim time. If a stale supervisor
         requeued the job (clearing lease_token) and another worker claimed it,
         this update matches 0 rows — the worker lost ownership and must not
         finalize. We detect the 0-row case and abort the transaction. */
      if (jobId) {
        const leaseFilter = leaseToken
          ? and(eq(jobs.id, jobId), eq(jobs.leaseToken, leaseToken), eq(jobs.status, "running"))
          : eq(jobs.id, jobId);
        const finalized = await tx
          .update(jobs)
          .set({ status: "completed", progress: 100, finishedAt: new Date(), heartbeatAt: new Date(), updatedAt: new Date() })
          .where(leaseFilter)
          .returning({ id: jobs.id });
        if (leaseToken && !finalized.length) {
          throw new LeaseLostError();
        }
      }

      /* The artifact.package approval is created INSIDE the finalize
         transaction so the audit cannot end up "completed" with no packaging
         approval (or vice versa) if one write succeeds and the other fails.
         Parity gate: only created when parity is "passed" or "warning" —
         a "failed" parity blocks packaging (see above). */
      await tx.execute(sql`
        INSERT INTO approvals (id, action_type, target_type, target_id, title, status, environment, requested_by, payload)
        VALUES (gen_random_uuid(), 'artifact.package', 'audit', ${auditId},
                ${`Package reconstruction bundle của ${audit.name} (local artifact)${effectiveParityStatus === "warning" ? " [parity warning]" : ""}`},
                'pending', ${environment}, 'auditor-service',
                ${JSON.stringify({ auditId, target: "audit/recon/bundle.tar.zst", parityStatus: effectiveParityStatus })}::jsonb)
        ON CONFLICT (action_type, target_id) WHERE status = 'pending' DO NOTHING
      `);
      return false; // parity passed/warning — caller emits audit.completed log
    });

    /* P0-2: Only log audit.completed when parity passed. Previously the
       `return` inside the transaction callback did NOT exit runRealAudit,
       so this logAudit ran even when parity failed — recording a "completed"
       action for an audit that was just marked "failed". */
    if (!parityFailed) {
      await logAudit({
        actor: null,
        action: "audit.completed",
        resourceType: "audit",
        resourceId: auditId,
        detail: { engine: "real", score: auditScore, parityScore, findings: counts, scanners: results.length },
      });
    }
  } catch (err) {
    hb.stop();

    /* LEASE_LOST is silent: the worker lost ownership of the job (stale
       supervisor requeued it, another worker claimed it). The new owner
       will handle the audit. This worker must NOT touch audit/job/event
       state — doing so would corrupt the new owner's run. */
    if (err instanceof LeaseLostError) {
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    const idx = stages.findIndex((s) => s.status === "active");
    if (idx >= 0) stages[idx].status = "failed";

    /* P0-1: Fence the ENTIRE error path — not just a pre-check. Previously
       the error path did a lease check, then wrote audit→failed, job update,
       and event in SEPARATE statements. The lease could be lost between the
       check and any of those writes, letting a stale worker clobber the new
       owner's audit state or emit a spurious audit.failed event.

       Now the entire error path runs inside fencedTx: SELECT FOR UPDATE on
       the job row (verifying lease_token + status = 'running') is the first
       statement, and all writes (audit→failed, job→failed/queued, event,
       audit→running for retry) are in the same transaction. If the lease is
       lost, the transaction aborts before ANY write — no partial state.

       Lock order: jobs row locked first (FOR UPDATE), then audits updated —
       same order as the finalize path, so cancel and finalize/error cannot
       deadlock (P1-2). */
    try {
      await fencedTx(jobId, leaseToken, hb, async (tx) => {
        /* Read the job row to determine retry vs fail — it's already locked
           by the FOR UPDATE in fencedTx, so this read is consistent. */
        let exhausted = true;
        let jobWorker: string | null = null;
        let jobProgress = 0;
        if (jobId) {
          const jobRows = await tx.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
          const job = jobRows[0];
          exhausted = !job || job.attempt >= job.maxAttempts;
          jobWorker = job?.worker ?? null;
          jobProgress = job?.progress ?? 0;
        }

        /* audit → failed. Same transaction as the job update so a crash
           between them cannot orphan either side. The retry path below
           flips it back to "running" once the job is confirmed requeueable
           (and not already timed out by a concurrent requeue). */
        await tx
          .update(audits)
          .set({ status: "failed", finishedAt: new Date(), stages })
          .where(eq(audits.id, auditId));

        if (jobId) {
          /* Job update with lease filter — 0 rows means lease lost, throw to
             abort the transaction. The WHERE clause includes lease_token +
             status = 'running' so cancelAudit (which sets status='cancelled'
             and clears lease_token) prevents this update from matching. */
          const leaseFilter = leaseToken
            ? and(eq(jobs.id, jobId), eq(jobs.leaseToken, leaseToken), eq(jobs.status, "running"))
            : eq(jobs.id, jobId);
          const updated = await tx
            .update(jobs)
            .set({
              status: exhausted ? "failed" : "queued",
              lockedBy: null,
              leaseToken: null,
              worker: exhausted ? jobWorker : null,
              progress: exhausted ? jobProgress : 0,
              errorCode: "AUDIT_ENGINE_ERROR",
              errorMessage: message.slice(0, 500),
              finishedAt: exhausted ? new Date() : null,
              updatedAt: new Date(),
            })
            .where(leaseFilter)
            .returning({ id: jobs.id });
          if (leaseToken && !updated.length) {
            throw new LeaseLostError();
          }

          /* Retryable: put audit back to running — but only if the job
             wasn't already timed_out by a concurrent requeueStaleJobs. */
          if (!exhausted) {
            const [currentJob] = await tx.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
            if (currentJob?.status !== "timed_out") {
              await tx
                .update(audits)
                .set({ status: "running", finishedAt: null })
                .where(and(eq(audits.id, auditId), eq(audits.status, "failed")));
            }
          }
        }

        await tx.insert(events).values({
          type: "audit.failed",
          severity: "error",
          source: "auditor",
          message: `${audit.name} failed: ${message}`,
        });
      });
    } catch (fenceErr) {
      /* If the fencedTx threw LeaseLostError, the lease was lost during the
         error path — another worker owns the audit now, or it was cancelled.
         Do not write anything; exit silently. */
      if (fenceErr instanceof LeaseLostError) return;
      throw fenceErr;
    }

    await logAudit({
      actor: null,
      action: "audit.failed",
      resourceType: "audit",
      resourceId: auditId,
      result: "error",
      detail: { error: message, jobId },
    });
  } finally {
    hb.stop();
  }
}

export { initialStages as realInitialStages };
