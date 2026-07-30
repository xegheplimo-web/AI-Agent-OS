import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";

/* ------------------------------------------------------------------ */
/* Lease fencing primitives shared by the audit engine and the non-   */
/* audit job executors.                                                */
/*                                                                     */
/* A worker claims a job with FOR UPDATE SKIP LOCKED and stores a      */
/* unique `lease_token`. Every state-changing write must be gated on  */
/* that token: if the stale supervisor requeued the job (clearing     */
/* lease_token) and another worker claimed it, the original worker's  */
/* writes must become no-ops and it must ABORT — otherwise it would   */
/* clobber the new owner's run or emit duplicate completion events.   */
/* ------------------------------------------------------------------ */

/** Thrown when a lease-fenced write matches 0 rows — the worker lost
 *  ownership of the job. The caller must abort all further writes and
 *  exit silently (no retry, no failure event); the new owner handles it. */
export class LeaseLostError extends Error {
  constructor() {
    super("LEASE_LOST: job was requeued by the stale supervisor before this worker could finalize — aborting to avoid duplicate completion");
    this.name = "LeaseLostError";
  }
}

export interface LeaseFence {
  jobId: string;
  leaseToken: string | null;
  /** True once the background heartbeat detected the lease was cleared. */
  leaseLost: () => boolean;
  /** Throws LeaseLostError if the lease is gone (background flag OR explicit
   *  DB check). Call this before each major side-effect group. */
  assert: () => Promise<void>;
  /** Stop the background heartbeat timer. */
  stop: () => void;
}

const HEARTBEAT_INTERVAL_MS = 15_000;

/** Starts a background heartbeat timer (every 15s) and returns a fence the
 *  executor can `assert()` before each write. When no lease token is present
 *  (demo mode / inline jobs) the fence is a no-op so behavior is unchanged. */
export function createLeaseFence(jobId: string | undefined, leaseToken: string | null | undefined): LeaseFence {
  if (!jobId || !leaseToken) {
    return {
      jobId: jobId ?? "",
      leaseToken: null,
      leaseLost: () => false,
      assert: async () => {},
      stop: () => {},
    };
  }
  let lost = false;
  const timer = setInterval(async () => {
    try {
      const filter = and(eq(jobs.id, jobId), eq(jobs.leaseToken, leaseToken));
      const updated = await db
        .update(jobs)
        .set({ heartbeatAt: new Date(), updatedAt: new Date() })
        .where(filter)
        .returning({ id: jobs.id });
      if (!updated.length) lost = true;
    } catch {
      /* heartbeat failure is non-fatal — the next assert() will catch it */
    }
  }, HEARTBEAT_INTERVAL_MS);

  return {
    jobId,
    leaseToken,
    leaseLost: () => lost,
    assert: async () => {
      if (lost) throw new LeaseLostError();
      /* Explicit DB check: even if the background timer hasn't fired yet,
         the lease may have been cleared by a concurrent requeue. */
      const rows = await db.select({ leaseToken: jobs.leaseToken }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
      if (!rows.length || rows[0].leaseToken !== leaseToken) throw new LeaseLostError();
    },
    stop: () => clearInterval(timer),
  };
}
