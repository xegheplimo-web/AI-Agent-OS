import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { audits, events, jobs } from "@/db/schema";
import type { Actor } from "@/lib/auth";
import { logAudit } from "@/lib/audit-log";
import { jobDtoSchema, type JobDTO } from "@/lib/contracts";
import { isDemoMode } from "@/services/mode";

/* ------------------------------------------------------------------ */
/* Job service — DB-backed queue. Demo mode advances jobs inline; in   */
/* production the external worker (src/worker/index.ts) claims them.   */
/* ------------------------------------------------------------------ */

const JOB_DURATION_MS: Record<string, number> = {
  "sbom.export": 6000,
  "parity.gate": 9000,
  "artifact.package": 8000,
  "knowledge.reindex": 7000,
  "audit.run": 16000,
};

export function serializeJob(j: typeof jobs.$inferSelect): JobDTO {
  return jobDtoSchema.parse({
    id: j.id,
    type: j.type,
    status: j.status,
    target: j.target,
    progress: j.progress,
    attempt: j.attempt,
    maxAttempts: j.maxAttempts,
    worker: j.worker,
    errorMessage: j.errorMessage,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  });
}

export async function enqueueJob(
  type: "sbom.export" | "parity.gate" | "artifact.package" | "knowledge.reindex",
  target: string,
  actor: Actor | null,
): Promise<JobDTO> {
  const [row] = await db
    .insert(jobs)
    .values({
      type,
      status: isDemoMode ? "running" : "queued",
      target,
      progress: 0,
      attempt: 1,
      worker: isDemoMode ? "inline-demo" : null,
      lockedBy: isDemoMode ? "inline-demo" : null,
      heartbeatAt: new Date(),
      startedAt: isDemoMode ? new Date() : null,
    })
    .returning();

  await db.insert(events).values({
    type: "job.started",
    severity: "info",
    source: actor?.id ?? "system",
    message: `${type} ${isDemoMode ? "started" : "queued"} for ${target}`,
  });
  await logAudit({ actor, action: "job.create", resourceType: "job", resourceId: row.id, detail: { type, target } });

  return serializeJob(row);
}

/* One engine tick — shared by demo inline runner and the worker process. */
export async function advanceJobsOnce(): Promise<void> {
  const active = await db.select().from(jobs).where(eq(jobs.status, "running"));
  const now = Date.now();
  for (const job of active) {
    if (job.type === "audit.run") continue; // audit pipeline owns its own completion
    const duration = JOB_DURATION_MS[job.type] ?? 8000;
    const startMs = new Date(job.startedAt ?? job.createdAt).getTime();
    const elapsed = now - startMs;
    const progress = Math.min(100, Math.round((elapsed / duration) * 100));
    if (progress >= 100) {
      await db
        .update(jobs)
        .set({ status: "completed", progress: 100, finishedAt: new Date(), heartbeatAt: new Date(), updatedAt: new Date() })
        .where(eq(jobs.id, job.id));
      await db.insert(events).values({
        type: "job.completed",
        severity: "success",
        source: job.worker ?? job.lockedBy ?? "worker",
        message: `${job.type} finished for ${job.target}`,
      });
    } else if (progress !== job.progress) {
      await db
        .update(jobs)
        .set({ progress, heartbeatAt: new Date(), updatedAt: new Date() })
        .where(eq(jobs.id, job.id));
    }
  }
}

/**
 * Requeue jobs whose worker died (heartbeat stale > 45s).
 *
 * audit.run jobs are INCLUDED: the engine heartbeats them while it runs, so a
 * stale heartbeat genuinely means the worker crashed mid-audit. Previously
 * they were skipped and could sit in `running` forever. Recovering the job
 * also resets its audit so another worker can pick the work back up.
 */
const STALE_MS = 45_000;

export async function requeueStaleJobs(): Promise<number> {
  const active = await db.select().from(jobs).where(eq(jobs.status, "running"));
  const now = Date.now();
  let requeued = 0;

  for (const job of active) {
    if (job.lockedBy === "inline-demo") continue; // demo runner owns these
    const hb = job.heartbeatAt ? new Date(job.heartbeatAt).getTime() : new Date(job.createdAt).getTime();
    if (now - hb <= STALE_MS) continue;

    const exhausted = job.attempt >= job.maxAttempts;

    if (exhausted) {
      await db
        .update(jobs)
        .set({
          status: "timed_out",
          finishedAt: new Date(),
          errorCode: "HEARTBEAT_LOST",
          errorMessage: `Worker heartbeat lost after ${Math.round((now - hb) / 1000)}s`,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));

      if (job.type === "audit.run" && job.auditId) {
        await db
          .update(audits)
          .set({ status: "failed", finishedAt: new Date() })
          .where(and(eq(audits.id, job.auditId), eq(audits.status, "running")));
      }
    } else {
      await db
        .update(jobs)
        .set({ status: "queued", lockedBy: null, worker: null, progress: 0, updatedAt: new Date() })
        .where(eq(jobs.id, job.id));

      /* keep the audit runnable so the next claimer resumes it (upserts make
         the partial work from the dead worker safe to rewrite) */
      if (job.type === "audit.run" && job.auditId) {
        await db
          .update(audits)
          .set({ status: "running", finishedAt: null })
          .where(eq(audits.id, job.auditId));
      }
    }

    await db.insert(events).values({
      type: "job.requeued",
      severity: "warning",
      source: "worker-supervisor",
      message: `${job.type} (${job.target}) ${exhausted ? "timed out" : "requeued"} — heartbeat lost`,
    });
    requeued += 1;
  }
  return requeued;
}

export async function advanceJobsIfDemo(): Promise<void> {
  if (!isDemoMode) return;
  await advanceJobsOnce();
}

export async function latestJobs(limit = 20): Promise<JobDTO[]> {
  const rows = await db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(limit);
  return rows.map(serializeJob);
}
