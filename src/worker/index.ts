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
  const { advanceAuditsOnce, runClaimedAudits } = await import("../services/audit");
  const { advanceJobsOnce, requeueStaleJobs } = await import("../services/jobs");
  const { sampleTelemetryOnce } = await import("../services/telemetry");
  const { APP_MODE, isDemoMode } = await import("../services/mode");

  const workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;
  console.log(
    `[worker] ${workerId} started · APP_MODE=${APP_MODE} · engine=${isDemoMode ? "demo-timeline" : "real-auditor"}`,
  );

  /** Claim queued work atomically; other workers skip locked rows. */
  const claimJobs = async () => {
    const res = await pool.query(
      `UPDATE jobs
         SET status='running', locked_by=$1, worker=$1,
             heartbeat_at=now(), started_at=coalesce(started_at, now()),
             attempt=attempt+1, updated_at=now()
       WHERE id IN (
         SELECT id FROM jobs
          WHERE status='queued' AND attempt < max_attempts
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 3
       )
       RETURNING id, type, target`,
      [workerId],
    );
    for (const row of res.rows as Array<{ type: string; target: string }>) {
      console.log(`[worker] claimed ${row.type} → ${row.target}`);
    }
  };

  let beats = 0;
  let busy = false;

  const tick = async () => {
    if (busy) return; // a real audit can outlive one interval
    busy = true;
    try {
      await claimJobs();
      await advanceJobsOnce();

      if (isDemoMode) {
        await advanceAuditsOnce();
      } else {
        await runClaimedAudits(workerId);
      }

      beats += 1;
      if (beats % 12 === 0) {
        const requeued = await requeueStaleJobs();
        if (requeued) console.log(`[worker] recovered ${requeued} stale job(s)`);
      }
      if (beats % 8 === 0) await sampleTelemetryOnce();
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
    /* release anything still locked so another worker resumes immediately */
    try {
      await pool.query(
        `UPDATE jobs SET status='queued', locked_by=NULL, worker=NULL, updated_at=now()
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
