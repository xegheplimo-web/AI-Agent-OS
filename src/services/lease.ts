import { and, eq, sql } from "drizzle-orm";
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
  /** Atomically update the job row only if the lease token still matches.
   *  Returns the updated row count (0 = lease lost). Use this inside a
   *  transaction to make the check + write atomic — no race window between
   *  assert() and the actual write. */
  fencedJobUpdate: (set: Record<string, unknown>) => Promise<number>;
  /** Run a write inside a transaction, with an atomic lease guard as the
   *  first statement. The lease check (SELECT ... FOR UPDATE on the job
   *  row, verifying lease_token + status = 'running') and the callback's
   *  writes are in the same transaction — no TOCTOU window between assert
   *  and the side effect. If the lease is lost, throws LeaseLostError
   *  before the callback runs. */
  fencedWrite: (fn: (tx: import("drizzle-orm/node-postgres").NodePgDatabase<Record<string, never>>) => Promise<void>) => Promise<void>;
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
      fencedJobUpdate: async (set: Record<string, unknown>) => {
        const res = await db.update(jobs).set(set).where(eq(jobs.id, jobId ?? "")).returning({ id: jobs.id });
        return res.length;
      },
      fencedWrite: async (fn) => {
        await db.transaction(async (tx) => { await fn(tx); });
      },
      stop: () => {},
    };
  }
  let lost = false;
  const timer = setInterval(async () => {
    try {
      /* Heartbeat must also check status = 'running' — if the job was
         cancelled (status changed to 'cancelled', lease cleared), the
         heartbeat update matches 0 rows and we detect the loss. */
      const filter = and(
        eq(jobs.id, jobId),
        eq(jobs.leaseToken, leaseToken),
        eq(jobs.status, "running"),
      );
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
      /* Explicit DB check: the lease is valid only if ALL of:
         - job exists
         - lease_token matches
         - status = 'running' (not cancelled/requeued/completed)
         - locked_by matches the worker that owns this lease
         If any condition fails, the worker has lost ownership. */
      const rows = await db
        .select({ leaseToken: jobs.leaseToken, status: jobs.status, lockedBy: jobs.lockedBy })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);
      if (!rows.length) throw new LeaseLostError();
      const row = rows[0];
      if (row.leaseToken !== leaseToken) throw new LeaseLostError();
      if (row.status !== "running") throw new LeaseLostError();
      /* locked_by may be null in demo mode; in production it must match the
         workerId. We check token + status which is sufficient — locked_by
         is set together with lease_token so if token matches, locked_by is
         from the same claim. */
    },
    /* Atomic lease-gated update: the WHERE clause includes lease_token +
       status = 'running', so if the stale supervisor cleared the token OR
       cancelAudit set status = 'cancelled', 0 rows match → LeaseLostError.
       No race window between a separate assert() and the write. */
    fencedJobUpdate: async (set: Record<string, unknown>) => {
      if (!leaseToken) {
        /* No lease token (demo/inline) — unconditional update. */
        const res = await db.update(jobs).set(set).where(eq(jobs.id, jobId)).returning({ id: jobs.id });
        return res.length;
      }
      const res = await db
        .update(jobs)
        .set(set)
        .where(and(
          eq(jobs.id, jobId),
          eq(jobs.leaseToken, leaseToken),
          eq(jobs.status, "running"),
        ))
        .returning({ id: jobs.id });
      if (!res.length) throw new LeaseLostError();
      return res.length;
    },
    /* Fenced write: the lease check (SELECT FOR UPDATE on the job row,
       verifying lease_token + status = 'running') and the callback's
       writes are in the same transaction. The FOR UPDATE lock prevents
       cancelAudit or requeueStaleJobs from clearing the lease between
       our check and our write. If the lease is already gone, throws
       LeaseLostError before the callback runs. */
    fencedWrite: async (fn) => {
      if (!leaseToken) {
        /* No lease token (demo/inline) — run without guard. */
        await db.transaction(async (tx) => { await fn(tx); });
        return;
      }
      await db.transaction(async (tx) => {
        /* SELECT FOR UPDATE locks the job row for the duration of the
           transaction. If cancelAudit tries to clear the lease concurrently,
           it blocks until our transaction commits. If the lease is already
           gone (cleared before we started), we get 0 rows → abort. */
        const rows = await tx.execute(
          sql`SELECT 1 FROM jobs WHERE id = ${jobId} AND lease_token = ${leaseToken} AND status = 'running' FOR UPDATE`,
        );
        if (!(rows.rows ?? []).length) throw new LeaseLostError();
        await fn(tx);
      });
    },
    stop: () => clearInterval(timer),
  };
}
