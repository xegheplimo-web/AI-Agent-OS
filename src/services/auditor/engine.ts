import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvals, artifacts, audits, events, findings, jobs, parityReports, telemetryPoints } from "@/db/schema";
import { computeParityScore } from "@/lib/parity";
import { logAudit } from "@/lib/audit-log";
import { DISCOVERY_SCANNERS } from "@/services/auditor/scanners";
import { normalize, parityChecksFrom } from "@/services/auditor/normalize";
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

/** Keeps the owning job alive so stale-recovery does not steal a live audit. */
async function heartbeat(jobId?: string) {
  if (!jobId) return;
  await db.update(jobs).set({ heartbeatAt: new Date(), updatedAt: new Date() }).where(eq(jobs.id, jobId));
}

async function setJobProgress(jobId: string | undefined, progress: number) {
  if (!jobId) return;
  await db
    .update(jobs)
    .set({ progress, heartbeatAt: new Date(), updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

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
}) {
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
    generatorVersion: "0.4.0",
    environment: params.environment,
    content: params.content,
    tags: params.tags,
    metadata: params.metadata ?? {},
    updatedAt: new Date(),
  };
  /* Resume-safe: (audit_id, path) is UNIQUE, so a retried stage rewrites
     the artifact instead of inserting a duplicate. */
  await db
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
export async function runRealAudit(auditId: string, jobId?: string): Promise<void> {
  const rows = await db.select().from(audits).where(eq(audits.id, auditId)).limit(1);
  if (!rows.length) return;
  const audit = rows[0];
  if (audit.status !== "running") return;

  const environment = audit.environment;
  const stages = initialStages();
  const t0 = Date.now();

  try {
    /* ---------------- Stage 1: Discovery ---------------- */
    stages[0].status = "active";
    stages[0].startedAt = new Date().toISOString();
    await setStages(auditId, stages);
    await setJobProgress(jobId, 5);

    const results: ScanResult[] = [];
    for (const scanner of DISCOVERY_SCANNERS) {
      const res = await scanner();
      results.push(res);
      stages[0].artifacts = Array.from(new Set(results.flatMap((r) => r.artifacts)));
      await setStages(auditId, stages);

      /* Persist the RAW scan envelope immediately — Discovery advertises
         raw/* artifacts, so they must actually exist in the artifact table. */
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
        metadata: { stage: "discovery", scanner: res.scanner, status: res.status, audit: audit.name },
      });

      await setJobProgress(jobId, 5 + Math.round((results.length / DISCOVERY_SCANNERS.length) * 40));
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
      });
    }

    stages[1].status = "done";
    stages[1].durationMs = Date.now() - t1;
    stages[1].artifacts = normalizedArtifacts.map((a) => a.path.replace("/audit/", ""));
    await setStages(auditId, stages);

    /* real findings → DB (upsert on fingerprint so retries don't duplicate) */
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of inv.findings) {
      counts[f.severity] += 1;
      const fingerprint = findingFingerprint(f);
      await db
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
    await setJobProgress(jobId, 65);

    await db.insert(events).values({
      type: "audit.stage.completed",
      severity: counts.critical > 0 ? "error" : counts.high > 0 ? "warning" : "info",
      source: "auditor",
      message: `${audit.name} · Normalization — ${inv.findings.length} findings thật (${counts.critical} critical, ${counts.high} high)`,
    });

    /* ---------------- Stage 3: Reconstruction ---------------- */
    const t2 = Date.now();
    stages[2].status = "active";
    stages[2].startedAt = new Date().toISOString();
    await setStages(auditId, stages);
    await heartbeat(jobId);

    const p95Rows = await db
      .select()
      .from(telemetryPoints)
      .where(eq(telemetryPoints.metric, "latency_p95"))
      .orderBy(desc(telemetryPoints.ts))
      .limit(1);
    const latencyP95 = p95Rows.length ? p95Rows[0].value : 0;

    const checks = parityChecksFrom(inv, latencyP95);
    const { score: parityScore, overallStatus } = computeParityScore(checks);

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
          overallStatus,
          checks,
        }),
        tags: ["parity", "gate"],
      },
    ];

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
      });
    }

    stages[2].status = "done";
    stages[2].durationMs = Date.now() - t2;
    stages[2].artifacts = recon.map((a) => a.path.replace("/audit/", ""));
    await setStages(auditId, stages);
    await setJobProgress(jobId, 92);

    /* ---------------- finalize ---------------- */
    const severityPenalty = counts.critical * 12 + counts.high * 6 + counts.medium * 3 + counts.low * 1;
    const auditScore = Math.max(0, Math.min(100, 100 - severityPenalty));

    await db.insert(parityReports).values({
      overallStatus,
      score: parityScore,
      environment,
      checks,
      gates: [
        { key: "secrets_scan", label: "Secrets scan", status: counts.critical > 0 ? "failed" : "passed" },
        { key: "sbom_diff", label: "SBOM generated", status: "passed" },
        { key: "endpoint_authz", label: "Endpoint authorization", status: checks.find((c) => c.key === "endpoint_authz")?.status ?? "passed" },
        { key: "lockfile", label: "Deterministic install (lockfile)", status: (inv.repo as { lockFilePresent?: boolean }).lockFilePresent ? "passed" : "failed" },
      ],
    });

    await db
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

    await db.insert(events).values({
      type: "audit.completed",
      severity: "success",
      source: "auditor",
      message: `${audit.name} completed (real engine) — score ${auditScore}, ${inv.findings.length} findings, parity ${parityScore}%`,
    });

    await db.insert(approvals).values({
      actionType: "artifact.push",
      targetType: "audit",
      targetId: auditId,
      title: `Package & push reconstruction bundle của ${audit.name} (read-only source)`,
      environment,
      requestedBy: "auditor-service",
      payload: { auditId, target: "audit/recon/bundle.tar.zst" },
    });

    await logAudit({
      actor: null,
      action: "audit.completed",
      resourceType: "audit",
      resourceId: auditId,
      detail: { engine: "real", score: auditScore, parityScore, findings: counts, scanners: results.length },
    });

    /* The owning job finishes with the audit — previously audit.run jobs were
       skipped by the job runner and stayed `running` forever. */
    if (jobId) {
      await db
        .update(jobs)
        .set({ status: "completed", progress: 100, finishedAt: new Date(), heartbeatAt: new Date(), updatedAt: new Date() })
        .where(eq(jobs.id, jobId));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const idx = stages.findIndex((s) => s.status === "active");
    if (idx >= 0) stages[idx].status = "failed";
    await db
      .update(audits)
      .set({ status: "failed", finishedAt: new Date(), stages })
      .where(eq(audits.id, auditId));

    if (jobId) {
      /* Let the queue decide: retry while attempts remain, otherwise fail. */
      const jobRows = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
      const job = jobRows[0];
      const exhausted = !job || job.attempt >= job.maxAttempts;
      await db
        .update(jobs)
        .set({
          status: exhausted ? "failed" : "queued",
          lockedBy: null,
          worker: exhausted ? job?.worker : null,
          progress: exhausted ? job?.progress ?? 0 : 0,
          errorCode: "AUDIT_ENGINE_ERROR",
          errorMessage: message.slice(0, 500),
          finishedAt: exhausted ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId));

      /* A retryable job puts the audit back in the runnable state. */
      if (!exhausted) {
        await db.update(audits).set({ status: "running", finishedAt: null }).where(eq(audits.id, auditId));
      }
    }

    await db.insert(events).values({
      type: "audit.failed",
      severity: "error",
      source: "auditor",
      message: `${audit.name} failed: ${message}`,
    });
    await logAudit({
      actor: null,
      action: "audit.failed",
      resourceType: "audit",
      resourceId: auditId,
      result: "error",
      detail: { error: message, jobId },
    });
  }
}

export { initialStages as realInitialStages };
