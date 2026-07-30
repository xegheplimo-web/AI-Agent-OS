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
  /* idempotency replay — return the existing audit's CURRENT state, not
     always "started". A replay of an audit that is `waiting_approval`
     must return `waiting_approval` (with its approval ID), not `started`
     — otherwise the caller would think the audit is running when it's
     actually still pending administrator approval. */
  if (input.idempotencyKey) {
    const existing = await db
      .select()
      .from(audits)
      .where(eq(audits.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing.length) {
      const a = existing[0];
      if (a.status === "waiting_approval") {
        const [approval] = await db
          .select()
          .from(approvals)
          .where(and(eq(approvals.targetId, a.id), eq(approvals.status, "pending")))
          .limit(1);
        return {
          kind: "waiting_approval",
          audit: serializeAudit(a),
          approvalId: approval?.id ?? "",
          /* replayed flag is not in this variant — the caller sees the
             same response as the original request */
        } as StartAuditResult;
      }
      return { kind: "started", audit: serializeAudit(a), replayed: true };
    }
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

  /* Production approval is required for ALL actors, including administrators.
     Previously administrators bypassed approval, which defeats the purpose
     of human-in-the-loop: a compromised admin account could run audits on
     production without a second person's sign-off. The approval gate is
     now a policy, not a convenience. */
  const needsApproval = input.environment === "production";

  /* Atomic insert: audit + approval (or audit + job) in a single
     transaction. Previously these were separate statements — a crash
     between them could leave an audit in `waiting_approval` with no
     approval row, or in `running` with no job (orphaned audit). */
  let row: typeof audits.$inferSelect;
  let approvalId: string | null = null;

  try {
    const result = await db.transaction(async (tx) => {
      const inserted = await tx
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
      const r = inserted[0];

      if (needsApproval) {
        const [approval] = await tx
          .insert(approvals)
          .values({
            actionType: "audit.run",
            targetType: "audit",
            targetId: r.id,
            title: `Chạy audit toàn hệ thống trên PRODUCTION (${name})`,
            environment: input.environment,
            requestedBy,
            payload: { auditId: r.id, environment: input.environment, scope: input.scope },
          })
          .returning();
        return { row: r, approvalId: approval.id };
      }

      /* No approval needed — enqueue the job in the same transaction */
      await tx.insert(jobs).values({
        type: "audit.run",
        status: isDemoMode ? "running" : "queued",
        auditId: r.id,
        target: `audit:${name}`,
        progress: 0,
        attempt: isDemoMode ? 1 : 0,
        lockedBy: isDemoMode ? "inline-demo" : null,
        worker: isDemoMode ? "inline-demo" : null,
        heartbeatAt: new Date(),
        startedAt: isDemoMode ? new Date() : null,
      });
      return { row: r, approvalId: null };
    });
    row = result.row;
    approvalId = result.approvalId;
  } catch (err) {
    const msg = String(err);
    /* audits_idempotency_uidx violation: a concurrent request with the same
       key won the race. Replay its audit instead of creating a second one. */
    if (input.idempotencyKey && msg.includes("audits_idempotency_uidx")) {
      const existing = await db
        .select()
        .from(audits)
        .where(eq(audits.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing.length) {
        const a = existing[0];
        if (a.status === "waiting_approval") {
          const [approval] = await db
            .select()
            .from(approvals)
            .where(and(eq(approvals.targetId, a.id), eq(approvals.status, "pending")))
            .limit(1);
          return { kind: "waiting_approval", audit: serializeAudit(a), approvalId: approval?.id ?? "" } as StartAuditResult;
        }
        return { kind: "started", audit: serializeAudit(a), replayed: true };
      }
    }
    /* audits_active_uidx violation: a concurrent request (different
       idempotency key) won the active-audit race — the partial unique index
       on (1) WHERE status IN ('running','waiting_approval') guarantees only
       one active audit, so the loser's INSERT fails here. Return a conflict
       pointing at the winning audit instead of erroring. */
    if (msg.includes("audits_active_uidx")) {
      const [active] = await db
        .select()
        .from(audits)
        .where(inArray(audits.status, ["running", "waiting_approval"]))
        .limit(1);
      return { kind: "conflict", auditId: active?.id ?? "" };
    }
    throw err;
  }

  if (needsApproval && approvalId) {
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
      detail: { environment: input.environment, approvalId },
    });
    return { kind: "waiting_approval", audit: serializeAudit(row), approvalId };
  }

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

      /* Self-approval forbid: the requester cannot approve their own request.
         Production approval exists to enforce a SECOND person's sign-off — a
         compromised or convenience-inclined requester approving their own
         request defeats human-in-the-loop. Revert the decision so the approval
         stays pending for a different approver. (System-initiated requests
         have requestedBy="system" and are exempt — there is no human to pair.) */
      if (approval.requestedBy === actor.id && approval.requestedBy !== "system") {
        await tx
          .update(approvals)
          .set({ status: "pending", decidedBy: null, decidedAt: null, reason: null })
          .where(eq(approvals.id, approvalId));
        return { ok: false as const, error: "Cannot approve your own request — a different person must sign off" };
      }

      /* Expiry check — the UPDATE matched, but was it stale? */
      if (new Date(approval.requestedAt) < cutoff) {
        /* An expired approval cannot be decided (approve or reject). Mark it
           expired (not pending) so it can't be retried, and cancel the audit
           it gates so the active-audit singleton index is freed. Previously
           this reverted to "pending" but left the audit in waiting_approval
           forever — no endpoint could cancel it, and the unique index blocked
           every new audit. Now the audit is cancelled atomically. */
        await tx
          .update(approvals)
          .set({ status: "expired", decidedBy: null, decidedAt: new Date(), reason: "auto-expired (>24h)" })
          .where(eq(approvals.id, approvalId));
        if (approval.actionType === "audit.run" && approval.targetId) {
          await tx.update(audits).set({ status: "cancelled", finishedAt: new Date() }).where(eq(audits.id, approval.targetId));
        }
        await tx.insert(events).values({
          type: "approval.expired",
          severity: "warning",
          source: "system",
          message: `Approval ${approvalId.slice(0, 8)} expired (>24h) — audit cancelled`,
        });
        return { ok: false as const, error: "Approval expired (>24h) — audit has been cancelled; start a new audit to retry" };
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
/* Cancel an audit — frees the active-audit singleton slot.            */
/* ------------------------------------------------------------------ */
export async function cancelAudit(
  auditId: string,
  actor: Actor,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await db.transaction(async (tx) => {
      /* Only running or waiting_approval audits can be cancelled. A completed
         or already-cancelled audit is immutable. The WHERE clause makes the
         check + update atomic. */
      const cancelled = await tx
        .update(audits)
        .set({ status: "cancelled", finishedAt: new Date() })
        .where(and(eq(audits.id, auditId), inArray(audits.status, ["running", "waiting_approval"])))
        .returning();

      if (!cancelled.length) {
        const [existing] = await tx.select().from(audits).where(eq(audits.id, auditId)).limit(1);
        return {
          ok: false as const,
          error: existing ? `Audit is ${existing.status} — cannot cancel` : "Audit not found",
        };
      }

      /* Cancel any pending approvals for this audit so they can't be decided
         later (which would try to start a cancelled audit). */
      await tx
        .update(approvals)
        .set({ status: "expired", decidedAt: new Date(), reason: `audit cancelled by ${actor.displayName}` })
        .where(and(eq(approvals.targetId, auditId), eq(approvals.status, "pending")));

      /* Requeue or cancel the active job so the worker doesn't keep running. */
      await tx
        .update(jobs)
        .set({ status: "cancelled", finishedAt: new Date(), errorCode: "AUDIT_CANCELLED", errorMessage: "audit cancelled by operator" })
        .where(and(eq(jobs.auditId, auditId), inArray(jobs.status, ["queued", "running"])));

      await tx.insert(events).values({
        type: "audit.cancelled",
        severity: "warning",
        source: actor.id,
        message: `Audit ${auditId.slice(0, 8)} cancelled by ${actor.displayName}${reason ? ` — ${reason}` : ""}`,
      });

      return { ok: true as const };
    });

    if (!result.ok) return result;

    await logAudit({
      actor,
      action: "audit.cancel",
      resourceType: "audit",
      resourceId: auditId,
      detail: { reason },
    });

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `Cancel failed (rolled back): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/* Expire stale pending approvals and cancel their audits. Called by the
   supervisor/cron to prevent the approval-expiry deadlock from accumulating.
   Returns the number of approvals expired. */
export async function expireStaleApprovals(): Promise<number> {
  const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - APPROVAL_TTL_MS);

  try {
    const expired = await db.transaction(async (tx) => {
      const stale = await tx
        .update(approvals)
        .set({ status: "expired", decidedAt: new Date(), reason: "auto-expired (>24h)" })
        .where(and(eq(approvals.status, "pending"), sql`${approvals.requestedAt} < ${cutoff}`))
        .returning();

      for (const a of stale) {
        if (a.actionType === "audit.run" && a.targetId) {
          await tx.update(audits).set({ status: "cancelled", finishedAt: new Date() }).where(eq(audits.id, a.targetId));
        }
        await tx.insert(events).values({
          type: "approval.expired",
          severity: "warning",
          source: "system",
          message: `Approval ${a.id.slice(0, 8)} auto-expired (>24h) — audit cancelled`,
        });
      }
      return stale.length;
    });
    return expired;
  } catch {
    return 0;
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

  /* Demo finalize: parity report + events + package approval + job
     completion in ONE transaction — mirrors the real engine's finalize tx
     so a crash cannot leave the audit completed with no packaging approval
     (or vice versa). The audit UPDATE above is separate (it sets the
     running→completed transition) but the rest is atomic. */
  await db.transaction(async (tx) => {
    await tx
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
        targetWhere: sql`${parityReports.auditId} IS NOT NULL`,
        set: { overallStatus, score: parityScore, checks, gates: PARITY_GATES.map((g) => ({ ...g })) },
      });

    await tx.insert(events).values([
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

    /* human-in-the-loop: packaging the reconstruction bundle needs approval.
       Inside the transaction so the demo path matches production — the audit
       cannot end up completed with no packaging approval. */
    await tx.insert(approvals).values({
      actionType: "artifact.package",
      targetType: "audit",
      targetId: auditId,
      title: `Package reconstruction bundle của ${audit?.name ?? "audit"} (local artifact)`,
      environment: audit?.environment ?? "production",
      requestedBy: "auditor-service",
      payload: { auditId, target: "audit/recon/bundle.tar.zst" },
    });

    await tx
      .update(jobs)
      .set({ status: "completed", progress: 100, finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(jobs.type, "audit.run"), eq(jobs.auditId, auditId)));
  });

  await logAudit({
    actor: null,
    action: "audit.completed",
    resourceType: "audit",
    resourceId: auditId,
    detail: { score, findings: counts, parityScore },
  });
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
