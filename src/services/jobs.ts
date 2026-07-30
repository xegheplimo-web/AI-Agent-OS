import { and, desc, eq, or, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { audits, events, jobs } from "@/db/schema";
import type { Actor } from "@/lib/auth";
import { logAudit } from "@/lib/audit-log";
import { jobDtoSchema, type JobDTO } from "@/lib/contracts";
import { isDemoMode } from "@/services/mode";
import { hasExecutor, runExecutor } from "@/services/executors";
import { createLeaseFence, LeaseLostError } from "@/services/lease";

/* ------------------------------------------------------------------ */
/* Job service — DB-backed queue. Demo mode advances jobs inline; in   */
/* production the external worker (src/worker/index.ts) claims them.   */
/* ------------------------------------------------------------------ */

/* Demo-mode pacing only. In production the executor runs synchronously and
 * the job completes when the executor returns (or fails). The durations are
 * kept so a demo deployment still shows the staged-progress timeline without
 * running the real (potentially slow) scanners on every API request. */
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
      attempt: 0,
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

/**
 * One engine tick — shared by demo inline runner and the worker process.
 *
 * `workerId` scopes the query to jobs this worker owns (locked_by match).
 * Without it, every worker's tick would advance every running job, making
 * the locked_by ownership field decorative for non-audit.run job types.
 * Demo mode calls without a workerId because all jobs are owned by
 * "inline-demo" and there is only one inline runner.
 */
export async function advanceJobsOnce(workerId?: string): Promise<void> {
  const ownerFilter = workerId
    ? and(eq(jobs.status, "running"), or(eq(jobs.lockedBy, workerId), eq(jobs.lockedBy, "inline-demo")))
    : eq(jobs.status, "running");
  const active = await db.select().from(jobs).where(ownerFilter);
  const now = Date.now();
  for (const job of active) {
    if (job.type === "audit.run") continue; // audit pipeline owns its own completion

    /* Production: run the real executor. The job was claimed by a worker, so
     * this is the worker's tick — it runs the executor synchronously and
     * marks the job completed/failed based on the outcome. There is no
     * wall-clock simulation in production: a job that has no executor is a
     * configuration error, not a "slow" job. */
    if (!isDemoMode && hasExecutor(job.type)) {
      /* Background heartbeat + lease fence: a long executor (e.g.
         artifact.package on a large audit) could exceed the 45s stale-
         recovery threshold. The fence heartbeats every 15s AND gives the
         executor an `assert()` it must call before each side effect, so a
         stale worker aborts the moment it loses ownership instead of
         continuing to write artifacts/reports that clobber the new owner's
         run. */
      const fence = createLeaseFence(job.id, job.leaseToken);

      try {
        if (fence.leaseLost()) throw new LeaseLostError();
        await runExecutor(job, fence);
        /* Lease fencing: only mark completed if we still own the job. If the
           stale supervisor requeued it (clearing lease_token) and another
           worker claimed it, this update is a no-op — we lost ownership
           during the executor run. */
        const leaseFilter = job.leaseToken
          ? and(eq(jobs.id, job.id), eq(jobs.leaseToken, job.leaseToken))
          : eq(jobs.id, job.id);
        const finalized = await db
          .update(jobs)
          .set({ status: "completed", progress: 100, finishedAt: new Date(), heartbeatAt: new Date(), updatedAt: new Date() })
          .where(leaseFilter)
          .returning({ id: jobs.id });
        if (job.leaseToken && !finalized.length) {
          await db.insert(events).values({
            type: "job.requeued",
            severity: "warning",
            source: job.worker ?? job.lockedBy ?? "worker",
            message: `${job.type} for ${job.target}: lease lost during executor — another worker owns this job now`,
          });
        } else {
          await db.insert(events).values({
            type: "job.completed",
            severity: "success",
            source: job.worker ?? job.lockedBy ?? "worker",
            message: `${job.type} finished for ${job.target} (real executor)`,
          });
        }
      } catch (err) {
        /* LEASE_LOST: the worker lost ownership (stale supervisor requeued the
           job, another worker claimed it). The new owner will handle it. This
           worker must NOT mark the job failed/retried — that would race the
           new owner's completion. It DOES emit a `job.requeued` warning event
           so operators can see the lease change in the event feed (this is
           observability, not a state mutation). */
        if (err instanceof LeaseLostError) {
          await db.insert(events).values({
            type: "job.requeued",
            severity: "warning",
            source: job.worker ?? job.lockedBy ?? "worker",
            message: `${job.type} for ${job.target}: lease lost during executor — aborting, another worker owns this job now`,
          });
        } else {
          const message = err instanceof Error ? err.message : String(err);
          const leaseFilter = job.leaseToken
            ? and(eq(jobs.id, job.id), eq(jobs.leaseToken, job.leaseToken))
            : eq(jobs.id, job.id);
          /* Retry while attempts remain — previously this always set status=
             'failed', ignoring maxAttempts. A transient executor error (e.g.
             DB blip during SBOM export) would permanently fail the job instead
             of giving it the configured retry budget. */
          const exhausted = job.attempt >= job.maxAttempts;
          await db
            .update(jobs)
            .set({
              status: exhausted ? "failed" : "queued",
              lockedBy: null,
              leaseToken: null,
              worker: exhausted ? job.worker : null,
              finishedAt: exhausted ? new Date() : null,
              heartbeatAt: new Date(),
              updatedAt: new Date(),
              errorMessage: message,
            })
            .where(leaseFilter);
          await db.insert(events).values({
            type: exhausted ? "job.failed" : "job.requeued",
            severity: "error",
            source: job.worker ?? job.lockedBy ?? "worker",
            message: `${job.type} ${exhausted ? "failed" : "requeued for retry"} for ${job.target}: ${message}`,
          });
        }
      } finally {
        fence.stop();
      }
      continue;
    }

    /* Demo mode (or a job type with no executor yet): staged wall-clock
     * progress so the dashboard shows a timeline without running the real
     * (slow) scanners on every API request. */
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
        message: `${job.type} finished for ${job.target}${isDemoMode ? " (demo timeline)" : " (no executor — timer only)"}`,
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
 *
 * Atomic: the stale check AND the state transition happen in a single
 * `UPDATE ... WHERE heartbeat_at < ... RETURNING` statement per outcome. The
 * previous implementation SELECTed rows, evaluated staleness in JS, then
 * UPDATEd by id — a worker could heartbeat between the SELECT and the UPDATE,
 * yet the supervisor would still requeue based on the stale snapshot. With
 * RETURNING, a row is only recovered if the conditional UPDATE actually
 * matched it; no row returned means no recovery happened.
 */
const STALE_INTERVAL_MS = 45_000;

export async function requeueStaleJobs(): Promise<number> {
  /* The job update + audit update + event insert are wrapped in a single
     transaction so a stale supervisor cannot leave the job requeued but the
     audit still "running" (or vice versa). Previously these were separate
     statements — a crash between them could leave the audit stuck running
     with a requeued job, or a new worker could complete the audit while the
     old supervisor was still writing the audit back to "running". */
  try {
    return await db.transaction(async (tx) => {
      /* --- exhausted attempts → terminal `timed_out` --- */
      const timedOut = await tx.execute(
        sql`UPDATE jobs
               SET status='timed_out',
                   finished_at=now(),
                   error_code='HEARTBEAT_LOST',
                   error_message='Worker heartbeat lost after '
                     || round(extract(epoch from (now() - coalesce(heartbeat_at, created_at)))::numeric)
                     || 's',
                   lease_token=NULL,
                   updated_at=now()
             WHERE status='running'
               AND locked_by IS DISTINCT FROM 'inline-demo'
               AND coalesce(heartbeat_at, created_at) < now() - (${sql.raw(String(STALE_INTERVAL_MS / 1000))} || ' seconds')::interval
               AND attempt >= max_attempts
             RETURNING id, type, target, audit_id`,
      );

      /* --- attempts remain → back to `queued` for another worker --- */
      const requeued = await tx.execute(
        sql`UPDATE jobs
               SET status='queued', locked_by=NULL, worker=NULL, lease_token=NULL, progress=0, updated_at=now()
             WHERE status='running'
               AND locked_by IS DISTINCT FROM 'inline-demo'
               AND coalesce(heartbeat_at, created_at) < now() - (${sql.raw(String(STALE_INTERVAL_MS / 1000))} || ' seconds')::interval
               AND attempt < max_attempts
             RETURNING id, type, target, audit_id`,
      );

      let recovered = 0;
      const timedOutRows = (timedOut.rows ?? []) as Array<{ type: string; target: string; audit_id: string | null }>;
      for (const row of timedOutRows) {
        if (row.type === "audit.run" && row.audit_id) {
          await tx
            .update(audits)
            .set({ status: "failed", finishedAt: new Date() })
            .where(and(eq(audits.id, row.audit_id), eq(audits.status, "running")));
        }
        await tx.insert(events).values({
          type: "job.requeued",
          severity: "warning",
          source: "worker-supervisor",
          message: `${row.type} (${row.target}) timed out — heartbeat lost`,
        });
        recovered += 1;
      }
      const requeuedRows = (requeued.rows ?? []) as Array<{ type: string; target: string; audit_id: string | null }>;
      for (const row of requeuedRows) {
        /* keep the audit runnable so the next claimer resumes it (upserts make
           the partial work from the dead worker safe to rewrite) */
        if (row.type === "audit.run" && row.audit_id) {
          await tx
            .update(audits)
            .set({ status: "running", finishedAt: null })
            .where(eq(audits.id, row.audit_id));
        }
        await tx.insert(events).values({
          type: "job.requeued",
          severity: "warning",
          source: "worker-supervisor",
          message: `${row.type} (${row.target}) requeued — heartbeat lost`,
        });
        recovered += 1;
      }
      return recovered;
    });
  } catch (err) {
    /* Transaction failed — nothing was committed, no partial state. */
    console.error("[jobs] requeueStaleJobs transaction failed:", err);
    return 0;
  }
}

export async function advanceJobsIfDemo(): Promise<void> {
  if (!isDemoMode) return;
  await advanceJobsOnce();
}

export async function latestJobs(limit = 20): Promise<JobDTO[]> {
  const rows = await db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(limit);
  return rows.map(serializeJob);
}
