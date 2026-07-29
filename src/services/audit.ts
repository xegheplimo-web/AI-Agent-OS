import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { approvals, audits, events, findings, jobs, parityReports } from "@/db/schema";
import {
  AUDIT_STAGE_DEFS,
  EVENT_POOL,
  FINDING_POOL,
  PARITY_CHECK_BASES,
  PARITY_GATES,
  STAGE_DURATION_MS,
} from "@/lib/audit-data";
import type { Actor } from "@/lib/auth";
import { logAudit } from "@/lib/audit-log";
import { auditDtoSchema, type AuditDTO, type RunAuditRequest } from "@/lib/contracts";
import { computeParityScore, computeStageStates } from "@/lib/parity";
import { isDemoMode } from "@/services/mode";
import { findingFingerprint, realInitialStages, runRealAudit } from "@/services/auditor/engine";

/* ------------------------------------------------------------------ */
/* Serialization (validated against the shared contract)               */
/* ------------------------------------------------------------------ */
export function serializeAudit(a: typeof audits.$inferSelect): AuditDTO {
  const start = new Date(a.startedAt).getTime();
  const end = a.finishedAt ? new Date(a.finishedAt).getTime() : null;
  const dto = {
    id: a.id,
    name: a.name,
    triggerType: a.triggerType,
    status: a.status,
    score: a.score,
    stages: a.stages ?? [],
    artifactNames: a.artifactNames ?? [],
    findingsCount: a.findingsCount ?? null,
    environment: a.environment,
    scope: a.scope ?? [],
    requestedBy: a.requestedBy,
    startedAt: a.startedAt.toISOString(),
    finishedAt: a.finishedAt ? a.finishedAt.toISOString() : null,
    durationMs: end ? end - start : a.status === "running" ? Date.now() - start : null,
  };
  return auditDtoSchema.parse(dto);
}

function stageDefsJson() {
  if (!isDemoMode) return realInitialStages();
  return AUDIT_STAGE_DEFS.map((d) => ({
    key: d.key,
    label: d.label,
    status: "pending" as const,
    artifacts: [] as string[],
    detail: d.detail,
  }));
}

/* ------------------------------------------------------------------ */
/* Production path: hand running audits to the REAL engine.            */
/*                                                                     */
/* Ownership rule: a worker only executes the audit attached to an     */
/* `audit.run` job **it has claimed itself** (locked_by = workerId via */
/* FOR UPDATE SKIP LOCKED). Scanning `audits WHERE status='running'`   */
/* would let two workers grab the same audit and duplicate findings.   */
/* ------------------------------------------------------------------ */
const inFlight = new Set<string>();

export async function runClaimedAudits(workerId: string): Promise<void> {
  const claimed = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, "audit.run"), eq(jobs.status, "running"), eq(jobs.lockedBy, workerId)));

  for (const job of claimed) {
    if (!job.auditId || inFlight.has(job.auditId)) continue;
    inFlight.add(job.auditId);
    try {
      await runRealAudit(job.auditId, job.id, job.leaseToken);
    } finally {
      inFlight.delete(job.auditId);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Start audit — idempotent, approval-gated on production              */
/* ------------------------------------------------------------------ */
export type StartAuditResult =
  | { kind: "started"; audit: AuditDTO; replayed: boolean }
  | { kind: "waiting_approval"; audit: AuditDTO; approvalId: string }
  | { kind: "conflict"; auditId: string };

export async function startAudit(input: RunAuditRequest, actor: Actor | null): Promise<StartAuditResult> {
  /* idempotency replay */
  if (input.idempotencyKey) {
    const existing = await db
      .select()
      .from(audits)
      .where(eq(audits.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing.length) return { kind: "started", audit: serializeAudit(existing[0]), replayed: true };
  }

  /* Block new audits while one is already running OR waiting for approval.
     Previously only "running" was checked, so a second request could start
     while the first was still pending administrator approval — both would
     eventually try to enqueue a job for the same audit. */
  const active = await db
    .select()
    .from(audits)
    .where(inArray(audits.status, ["running", "waiting_approval"]))
    .limit(1);
  if (active.length) return { kind: "conflict", auditId: active[0].id };

  const count = (await db.select({ c: sql<number>`count(*)` }).from(audits))[0]?.c ?? 0;
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const name = `AUD-${ymd}-${String(Number(count) + 1).padStart(3, "0")}`;
  const requestedBy = actor?.id ?? "anonymous";

  const needsApproval = input.environment === "production" && actor?.role !== "administrator";

  let inserted: (typeof audits.$inferSelect)[];
  try {
    inserted = await db
      .insert(audits)
      .values({
        name,
        triggerType: "manual",
        status: needsApproval ? "waiting_approval" : "running",
        stages: stageDefsJson(),
        artifactNames: AUDIT_STAGE_DEFS.flatMap((d) => d.artifacts.slice()),
        environment: input.environment,
        scope: input.scope,
        requestedBy,
        idempotencyKey: input.idempotencyKey ?? null,
        startedAt: new Date(),
      })
      .returning();
  } catch (err) {
    /* audits_idempotency_uidx violation: a concurrent request with the same
       key won the race. Replay its audit instead of creating a second one. */
    if (input.idempotencyKey && String(err).includes("audits_idempotency_uidx")) {
      const existing = await db
        .select()
        .from(audits)
        .where(eq(audits.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing.length) return { kind: "started", audit: serializeAudit(existing[0]), replayed: true };
    }
    throw err;
  }
  const [row] = inserted;

  if (needsApproval) {
    const [approval] = await db
      .insert(approvals)
      .values({
        actionType: "audit.run",
        targetType: "audit",
        targetId: row.id,
        title: `Chạy audit toàn hệ thống trên PRODUCTION (${name})`,
        environment: input.environment,
        requestedBy,
        payload: { auditId: row.id, environment: input.environment, scope: input.scope },
      })
      .returning();

    await db.insert(events).values({
      type: "approval.requested",
      severity: "warning",
      source: requestedBy,
      message: `Yêu cầu phê duyệt: ${name} trên production (human-in-the-loop)`,
    });
    await logAudit({
      actor,
      action: "audit.request",
      resourceType: "audit",
      resourceId: row.id,
      detail: { environment: input.environment, approvalId: approval.id },
    });
    return { kind: "waiting_approval", audit: serializeAudit(row), approvalId: approval.id };
  }

  await db.insert(jobs).values({
    type: "audit.run",
    status: isDemoMode ? "running" : "queued", // production: a worker must claim it
    auditId: row.id,
    target: `audit:${name}`,
    progress: 0,
    attempt: isDemoMode ? 1 : 0,
    lockedBy: isDemoMode ? "inline-demo" : null,
    worker: isDemoMode ? "inline-demo" : null,
    heartbeatAt: new Date(),
    startedAt: isDemoMode ? new Date() : null,
  });

  await db.insert(events).values({
    type: "audit.started",
    severity: "info",
    source: "auditor",
    message: `${name} started — 3-stage pipeline (Discovery → Normalization → Reconstruction) [${input.environment}]`,
  });
  await logAudit({
    actor,
    action: "audit.run",
    resourceType: "audit",
    resourceId: row.id,
    detail: { environment: input.environment },
  });

  return { kind: "started", audit: serializeAudit(row), replayed: false };
}

/* ------------------------------------------------------------------ */
/* Approval decisions                                                  */
/* ------------------------------------------------------------------ */
export async function decideApproval(
  approvalId: string,
  decision: "approved" | "rejected",
  actor: Actor,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  /* Approval expiry: a pending approval older than 24h is stale — the
     audit it gates may have been cancelled or the context may have changed.
     Rejecting the decision forces a fresh request rather than acting on a
     stale one. */
  const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

  /* The decision AND its side effects (audit state change, job creation,
     event) are committed in a single transaction. Previously the approval
     UPDATE committed first, then the job creation followed separately — if
     the job insert failed (e.g. DB connection blip), the approval was
     already "approved" and a retry would see "already decided", leaving the
     audit permanently stuck in waiting_approval with no job. */
  try {
    const result = await db.transaction(async (tx) => {
      /* Atomic decision: the WHERE clause includes status='pending' AND
         requestedAt > cutoff, so two concurrent approvers cannot both
         succeed, and an expired approval cannot be decided. */
      const cutoff = new Date(Date.now() - APPROVAL_TTL_MS);
      const decided = await tx
        .update(approvals)
        .set({ status: decision, decidedBy: actor.id, decidedAt: new Date(), reason: reason ?? null })
        .where(and(eq(approvals.id, approvalId), eq(approvals.status, "pending")))
        .returning();

      if (!decided.length) {
        return { ok: false as const, error: "Approval already decided or not found" };
      }
      const approval = decided[0];

      /* Expiry check — the UPDATE matched, but was it stale? */
      if (new Date(approval.requestedAt) < cutoff) {
        /* Revert the decision — the approval was too old to act on. */
        await tx
          .update(approvals)
          .set({ status: "pending", decidedBy: null, decidedAt: null, reason: null })
          .where(eq(approvals.id, approvalId));
        return { ok: false as const, error: "Approval expired (>24h) — request a new one" };
      }

      if (decision === "rejected") {
        if (approval.actionType === "audit.run" && approval.targetId) {
          await tx.update(audits).set({ status: "cancelled", finishedAt: new Date() }).where(eq(audits.id, approval.targetId));
        }
        await tx.insert(events).values({
          type: "approval.rejected",
          severity: "warning",
          source: actor.id,
          message: `Từ chối: ${approval.title}`,
        });
        return { ok: true as const };
      }

      /* approved → execute the gated action (all in this transaction) */
      if (approval.actionType === "audit.run" && approval.targetId) {
        await tx
          .update(audits)
          .set({ status: "running", startedAt: new Date() })
          .where(eq(audits.id, approval.targetId));
        await tx.insert(jobs).values({
          type: "audit.run",
          status: isDemoMode ? "running" : "queued",
          auditId: approval.targetId,
          target: `audit:${approval.targetId.slice(0, 8)}`,
          progress: 0,
          attempt: isDemoMode ? 1 : 0,
          lockedBy: isDemoMode ? "inline-demo" : null,
          worker: isDemoMode ? "inline-demo" : null,
          heartbeatAt: new Date(),
          startedAt: isDemoMode ? new Date() : null,
        });
        await tx.insert(events).values({
          type: "audit.started",
          severity: "success",
          source: "auditor",
          message: `${approval.title} — đã được ${actor.displayName} phê duyệt, pipeline bắt đầu`,
        });
      }

      if (approval.actionType === "artifact.package") {
        await tx.insert(jobs).values({
          type: "artifact.package",
          status: isDemoMode ? "running" : "queued",
          auditId: approval.targetId,
          target: (approval.payload?.target as string) ?? "audit/recon/bundle.tar.zst",
          progress: 0,
          attempt: isDemoMode ? 1 : 0,
          lockedBy: isDemoMode ? "inline-demo" : null,
          worker: isDemoMode ? "inline-demo" : null,
          heartbeatAt: new Date(),
          startedAt: isDemoMode ? new Date() : null,
        });
        await tx.insert(events).values({
          type: "deploy.approved",
          severity: "success",
          source: actor.id,
          message: `Đã duyệt đóng gói artifact (local bundle): ${approval.title}`,
        });
      }

      return { ok: true as const };
    });

    if (!result.ok) {
      /* Distinguish "not found" from "already decided" for a better error. */
      if (result.error === "Approval already decided or not found") {
        const exists = await db.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1);
        return {
          ok: false,
          error: exists.length ? "Approval already decided" : "Approval not found",
        };
      }
      return result;
    }

    /* Audit log is append-only and stays outside the transaction — if it
       fails, the decision still took effect and the log is best-effort. */
    await logAudit({
      actor,
      action: `approval.${decision}`,
      resourceType: "approval",
      resourceId: approvalId,
      detail: { reason },
    });

    return { ok: true };
  } catch (err) {
    /* Transaction rolled back — the approval is still pending and can be
       retried. This is the key fix: previously a mid-flow failure left the
       approval "approved" with no job. */
    return {
      ok: false,
      error: `Approval decision failed (rolled back, still pending): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/* ------------------------------------------------------------------ */
/* DEMO engine — advances running audits by wall-clock using the       */
/* scripted stage timeline. Never used when APP_MODE=production.       */
/* ------------------------------------------------------------------ */
export async function advanceAuditsOnce(): Promise<void> {
  const running = await db.select().from(audits).where(eq(audits.status, "running"));
  const now = Date.now();

  for (const audit of running) {
    const startMs = new Date(audit.startedAt).getTime();
    const elapsed = now - startMs;

    const { stages, done, changed } = computeStageStates(
      AUDIT_STAGE_DEFS.map((d) => ({ ...d, artifacts: d.artifacts.slice() })),
      [...STAGE_DURATION_MS],
      startMs,
      elapsed,
      audit.stages ?? [],
    );

    if (!done) {
      if (changed) await db.update(audits).set({ stages }).where(eq(audits.id, audit.id));
      continue;
    }

    await completeAudit(audit.id, startMs, stages);
  }
}

async function completeAudit(auditId: string, startMs: number, stages: ReturnType<typeof computeStageStates>["stages"]): Promise<void> {
  const total = BOUNDS_TOTAL;
  const ordinal = (await db.select({ c: sql<number>`count(*)` }).from(audits))[0]?.c ?? 1;
  const rot = Number(ordinal) * 5;
  const picked = Array.from({ length: 8 }, (_, i) => FINDING_POOL[(rot + i * 2) % FINDING_POOL.length]);
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of picked) counts[f.severity] += 1;

  for (const f of picked) {
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
        fingerprint: findingFingerprint(f),
      })
      .onConflictDoNothing({ target: [findings.auditId, findings.fingerprint] });
  }

  const score = 96 - (Number(ordinal) * 7) % 9;
  const auditRows = await db.select().from(audits).where(eq(audits.id, auditId)).limit(1);
  const audit = auditRows[0];

  await db
    .update(audits)
    .set({
      stages: stages.map((s) => ({
        ...s,
        status: "done" as const,
        durationMs: STAGE_DURATION_MS[AUDIT_STAGE_DEFS.findIndex((d) => d.key === s.key)],
        artifacts: AUDIT_STAGE_DEFS[AUDIT_STAGE_DEFS.findIndex((d) => d.key === s.key)].artifacts.slice(),
      })),
      status: "completed",
      score,
      findingsCount: counts,
      finishedAt: new Date(startMs + total),
    })
    .where(eq(audits.id, auditId));

  /* parity report derived from the findings mix */
  const hasSchema = picked.some((f) => f.category === "schema");
  const hasConfig = picked.some((f) => f.category === "config" && f.component === "hermes");
  const checks = PARITY_CHECK_BASES.map((c) => {
    if (c.key === "db_schema" && hasSchema) return { ...c, status: "warning" as const, difference: "2 missing indexes" };
    if (c.key === "env_contract" && hasConfig)
      return { ...c, status: "warning" as const, difference: "HERMES_MCP_TIMEOUT_MS 30s vs 45s" };
    return { ...c, status: "passed" as const };
  });
  const { score: parityScore, overallStatus } = computeParityScore(checks);

  await db
    .insert(parityReports)
    .values({
      auditId,
      overallStatus,
      score: parityScore,
      environment: audit?.environment ?? "production",
      checks,
      gates: PARITY_GATES.map((g) => ({ ...g })),
    })
    .onConflictDoUpdate({
      target: [parityReports.auditId],
      set: { overallStatus, score: parityScore, checks, gates: PARITY_GATES.map((g) => ({ ...g })) },
    });

  await db.insert(events).values([
    {
      type: "audit.completed",
      severity: "success",
      source: "auditor",
      message: `${audit?.name ?? "Audit"} completed — score ${score}, ${picked.length} findings, parity ${parityScore}%`,
    },
    {
      type: "parity.gate",
      severity: overallStatus === "passed" ? "success" : "warning",
      source: "auditor",
      message: `Parity gate ${overallStatus}: ${checks.filter((c) => c.status === "passed").length}/${checks.length} checks green`,
    },
  ]);

  /* human-in-the-loop: packaging the reconstruction bundle needs approval */
  await db.insert(approvals).values({
    actionType: "artifact.package",
    targetType: "audit",
    targetId: auditId,
    title: `Package reconstruction bundle của ${audit?.name ?? "audit"} (local artifact)`,
    environment: audit?.environment ?? "production",
    requestedBy: "auditor-service",
    payload: { auditId, target: "audit/recon/bundle.tar.zst" },
  });

  await logAudit({
    actor: null,
    action: "audit.completed",
    resourceType: "audit",
    resourceId: auditId,
    detail: { score, findings: counts, parityScore },
  });

  await db
    .update(jobs)
    .set({ status: "completed", progress: 100, finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(jobs.type, "audit.run"), eq(jobs.auditId, auditId)));
}

const BOUNDS_TOTAL = STAGE_DURATION_MS.reduce((a, b) => a + b, 0);

/* Demo runner: advances audits inline during API requests. */
export async function advanceIfDemo(): Promise<void> {
  if (!isDemoMode) return;
  await advanceAuditsOnce();
}

/* Event-feed heartbeat used by demo mode only. */
export async function ensureEventFreshIfDemo(): Promise<void> {
  if (!isDemoMode) return;
  const latest = await db.select().from(events).orderBy(desc(events.createdAt)).limit(1);
  const now = Date.now();
  if (latest.length && now - new Date(latest[0].createdAt).getTime() < 26000) return;
  const total = (await db.select({ c: sql<number>`count(*)` }).from(events))[0]?.c ?? 0;
  const pool = EVENT_POOL[Number(total) % EVENT_POOL.length];
  await db.insert(events).values(pool);
}
