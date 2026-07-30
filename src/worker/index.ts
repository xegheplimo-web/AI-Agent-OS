import "dotenv/config";

/* ------------------------------------------------------------------ */
/* External worker process.                                            */
/*                                                                     */
/*   APP_MODE=production → claims jobs with FOR UPDATE SKIP LOCKED and */
/*                         runs the REAL auditor engine for the audit  */
/*                         attached to each claimed audit.run job.     */
/*   APP_MODE=demo       → advances the scripted timeline instead.     */
/*                                                                     */
/* Safe to run several instances: each audit belongs to exactly one    */
/* claimed job, so no two workers can execute the same audit.          */
/* ------------------------------------------------------------------ */

async function main() {
  const { pool, closeDb } = await import("../db");
  const { advanceAuditsOnce, runClaimedAudits, expireStaleApprovals } = await import("../services/audit");
  const { advanceJobsOnce, requeueStaleJobs } = await import("../services/jobs");
  const { sampleTelemetryOnce } = await import("../services/telemetry");
  const { APP_MODE, isDemoMode } = await import("../services/mode");

  const workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;
  console.log(
    `[worker] ${workerId} started · APP_MODE=${APP_MODE} · engine=${isDemoMode ? "demo-timeline" : "real-auditor"}`,
  );

  /** Claim queued work atomically; other workers skip locked rows.
   *
   * Claims exactly ONE job per tick. The worker processes jobs sequentially,
   * so claiming three at once would leave two of them sitting in `running`
   * without a heartbeat — the stale supervisor would then requeue them before
   * they ever get processed. Once a real concurrency pool exists, raise the
   * limit again. */
  const claimJobs = async () => {
    const res = await pool.query(
      `UPDATE jobs
         SET status='running', locked_by=$1, worker=$1,
             lease_token=gen_random_uuid(),
             heartbeat_at=now(), started_at=coalesce(started_at, now()),
             attempt=attempt+1, updated_at=now()
       WHERE id IN (
         SELECT id FROM jobs
          WHERE status='queued' AND attempt < max_attempts
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       RETURNING id, type, target, audit_id, lease_token`,
      [workerId],
    );
    for (const row of res.rows as Array<{ type: string; target: string }>) {
      console.log(`[worker] claimed ${row.type} → ${row.target}`);
    }
    return res.rows as Array<{ id: string; type: string; target: string; audit_id: string | null; lease_token: string }>;
  };

  let beats = 0;
  let busy = false;

  const tick = async () => {
    if (busy) return; // a real audit can outlive one interval
    busy = true;
    try {
      await claimJobs();
      await advanceJobsOnce(workerId);

      if (isDemoMode) {
        await advanceAuditsOnce();
      } else {
        await runClaimedAudits(workerId);
      }

      beats += 1;
      if (beats % 12 === 0) {
        const requeued = await requeueStaleJobs();
        if (requeued) console.log(`[worker] recovered ${requeued} stale job(s)`);
        /* Expire stale pending approvals (>24h) and cancel their audits so
           the active-audit singleton slot is freed. Without this, an expired
           approval permanently blocks new audits. */
        const expired = await expireStaleApprovals();
        if (expired) console.log(`[worker] expired ${expired} stale approval(s)`);
      }
      /* Synthetic random-walk telemetry is a DEMO affordance only. Running it
         in production would seed the database with fabricated metrics that
         look real — false provenance. Production telemetry must come from a
         real OTLP collector; until one is wired in, the absence is honest. */
      if (isDemoMode && beats % 8 === 0) await sampleTelemetryOnce();
    } catch (err) {
      console.error("[worker] tick error:", err);
    } finally {
      busy = false;
    }
  };

  await tick();
  const timer = setInterval(tick, 1500);

  const shutdown = async () => {
    clearInterval(timer);
    /* Wait for the current tick to finish before releasing jobs — releasing
       mid-execution would let another worker claim and re-run a job whose
       executor is still writing. The stale supervisor (45s) is the safety net
       if the tick hangs. */
    const deadline = Date.now() + 60_000;
    while (busy && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (busy) {
      console.log("[worker] tick still running after 60s — releasing jobs; stale supervisor will recover");
    }
    /* release anything still locked so another worker resumes immediately.
       Clear lease_token so a fencing check by the old worker is a no-op. */
    try {
      await pool.query(
        `UPDATE jobs SET status='queued', locked_by=NULL, worker=NULL, lease_token=NULL, updated_at=now()
          WHERE status='running' AND locked_by=$1`,
        [workerId],
      );
    } catch {
      /* shutting down anyway */
    }
    await closeDb();
    console.log("[worker] stopped");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
