import "dotenv/config";

/* ------------------------------------------------------------------ */
/* Production worker lifecycle verification.                           */
/*                                                                     */
/* Regression guard for the P1 defects:                                */
/*  1. audit.run job never completed                                   */
/*  2. audit.run excluded from stale recovery                          */
/*  3. two workers could execute the same audit                        */
/*  4. idempotency key not unique                                      */
/*  5. approval decision race                                          */
/* ------------------------------------------------------------------ */

process.env.APP_MODE = "production";

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const { db, pool, closeDb } = await import("../src/db");
  const { audits, jobs, approvals, findings, artifacts } = await import("../src/db/schema");
  const { startAudit, decideApproval, runClaimedAudits } = await import("../src/services/audit");
  const { requeueStaleJobs } = await import("../src/services/jobs");
  const { and, eq } = await import("drizzle-orm");

  const admin = {
    type: "user" as const,
    id: "verify-admin",
    displayName: "Verify Admin",
    role: "administrator" as const,
    permissions: [],
  };

  /* ---------- 1. enqueue: job must be queued and linked to the audit ---- */
  const key = `verify-${Date.now()}`;
  const started = await startAudit({ environment: "local", scope: [], idempotencyKey: key }, admin);
  if (started.kind !== "started") throw new Error(`expected started, got ${started.kind}`);
  const auditId = started.audit.id;

  const [job] = await db.select().from(jobs).where(eq(jobs.auditId, auditId));
  check("audit.run job is created linked to the audit", !!job && job.auditId === auditId, job?.id?.slice(0, 8));
  check("job starts queued in production (worker must claim it)", job?.status === "queued", job?.status);

  /* ---------- 2. idempotency replay ------------------------------------ */
  const replay = await startAudit({ environment: "local", scope: [], idempotencyKey: key }, admin);
  check(
    "same idempotencyKey replays instead of creating a second audit",
    replay.kind === "started" && replay.audit.id === auditId && replay.replayed,
  );

  /* ---------- 3. unique constraint blocks concurrent duplicates -------- */
  let duplicateBlocked = false;
  try {
    await db.insert(audits).values({
      name: "DUPLICATE", triggerType: "manual", status: "running", stages: [],
      environment: "local", requestedBy: "verify", idempotencyKey: key, startedAt: new Date(),
    });
  } catch {
    duplicateBlocked = true;
  }
  check("UNIQUE index rejects a duplicate idempotencyKey", duplicateBlocked);

  /* ---------- 4. exclusive claim: only one worker wins ----------------- */
  const claimSql = `UPDATE jobs SET status='running', locked_by=$1, worker=$1,
        heartbeat_at=now(), started_at=coalesce(started_at, now()),
        attempt=attempt+1, updated_at=now()
      WHERE id IN (SELECT id FROM jobs WHERE status='queued' AND attempt < max_attempts
                   ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 5)
      RETURNING id`;
  const [claimA, claimB] = await Promise.all([
    pool.query(claimSql, ["worker-A"]),
    pool.query(claimSql, ["worker-B"]),
  ]);
  const idsA = claimA.rows.map((r: { id: string }) => r.id);
  const idsB = claimB.rows.map((r: { id: string }) => r.id);
  const overlap = idsA.filter((id) => idsB.includes(id));
  check("concurrent claims never overlap (FOR UPDATE SKIP LOCKED)", overlap.length === 0, `A=${idsA.length} B=${idsB.length}`);

  const [claimedJob] = await db.select().from(jobs).where(eq(jobs.auditId, auditId));
  const owner = claimedJob.lockedBy!;
  check("claimed job records its owner", !!owner, owner);

  /* ---------- 5. non-owner worker must NOT run the audit --------------- */
  const other = owner === "worker-A" ? "worker-B" : "worker-A";
  await runClaimedAudits(other);
  const [afterOther] = await db.select().from(audits).where(eq(audits.id, auditId));
  check("a worker that did not claim the job does not run the audit", afterOther.status === "running", afterOther.status);

  /* ---------- 6. owner runs it; audit AND job both complete ------------ */
  const t0 = Date.now();
  await runClaimedAudits(owner);
  const [doneAudit] = await db.select().from(audits).where(eq(audits.id, auditId));
  const [doneJob] = await db.select().from(jobs).where(eq(jobs.auditId, auditId));

  check("audit reaches completed", doneAudit.status === "completed", `score=${doneAudit.score} in ${Date.now() - t0}ms`);
  check("audit.run job reaches completed (no more stuck running)", doneJob.status === "completed", `progress=${doneJob.progress}`);
  check("job progress is 100", doneJob.progress === 100);
  check("job has finishedAt", !!doneJob.finishedAt);

  /* ---------- 7. artifacts: raw + normalized + recon, all hashed ------- */
  const arts = await db.select().from(artifacts).where(eq(artifacts.auditId, auditId));
  const raw = arts.filter((a) => a.path.includes("/raw/"));
  const recon = arts.filter((a) => a.path.includes("/recon/"));
  const { createHash } = await import("node:crypto");
  const hashOk = arts.every((a) => createHash("sha256").update(a.content).digest("hex") === a.sha256);
  check("raw discovery artifacts are persisted", raw.length >= 5, `${raw.length} raw`);
  check("reconstruction artifacts are persisted", recon.length >= 5, `${recon.length} recon`);
  check("every artifact sha256 verifies", hashOk, `${arts.length} artifacts`);

  /* ---------- 8. secret evidence is redacted --------------------------- */
  const secretFindings = await db
    .select()
    .from(findings)
    .where(and(eq(findings.auditId, auditId), eq(findings.category, "security")));
  const leaked = secretFindings.filter(
    (f) => /:\/\/[^:\s/]+:(?!\*)[^@\s]{4,}@/.test(f.evidence) && !f.evidence.includes("REDACTED"),
  );
  check("secret evidence is redacted before storage", leaked.length === 0, `${secretFindings.length} security findings`);

  /* ---------- 9. resume is idempotent (re-run rewrites, not duplicates) - */
  const beforeCount = arts.length;
  const beforeFindings = (await db.select().from(findings).where(eq(findings.auditId, auditId))).length;
  await db.update(audits).set({ status: "running" }).where(eq(audits.id, auditId));
  const { runRealAudit } = await import("../src/services/auditor/engine");
  await runRealAudit(auditId, doneJob.id);
  const afterArts = (await db.select().from(artifacts).where(eq(artifacts.auditId, auditId))).length;
  const afterFindings = (await db.select().from(findings).where(eq(findings.auditId, auditId))).length;
  check("re-running an audit upserts artifacts (no duplicates)", afterArts === beforeCount, `${beforeCount} → ${afterArts}`);
  check("re-running an audit upserts findings (no duplicates)", afterFindings === beforeFindings, `${beforeFindings} → ${afterFindings}`);

  /* ---------- 10. stale recovery covers audit.run ---------------------- */
  /* Mark the previous audit as completed so the active_bucket unique index
     doesn't block the stale audit insert (only one audit can be active at
     a time). */
  await db.update(audits).set({ status: "completed", finishedAt: new Date() }).where(eq(audits.id, auditId));
  const [staleAudit] = await db.insert(audits).values({
    name: `AUD-STALE-${Date.now().toString().slice(-5)}`, triggerType: "ci", status: "running",
    stages: [], environment: "local", requestedBy: "verify", startedAt: new Date(),
  }).returning();
  const [staleJob] = await db.insert(jobs).values({
    type: "audit.run", auditId: staleAudit.id, status: "running", target: "audit:stale",
    progress: 30, attempt: 1, maxAttempts: 3, worker: "dead-worker", lockedBy: "dead-worker",
    heartbeatAt: new Date(Date.now() - 120_000), startedAt: new Date(Date.now() - 120_000),
  }).returning();

  const recovered = await requeueStaleJobs();
  const [reJob] = await db.select().from(jobs).where(eq(jobs.id, staleJob.id));
  check("stale audit.run job is recovered (was skipped before)", recovered >= 1 && reJob.status === "queued", `status=${reJob.status}`);
  check("recovered job releases its lock", reJob.lockedBy === null);

  /* exhausted attempts → timed_out, audit failed */
  await db.update(jobs).set({ status: "running", attempt: 3, lockedBy: "dead-worker", heartbeatAt: new Date(Date.now() - 120_000) }).where(eq(jobs.id, staleJob.id));
  await requeueStaleJobs();
  const [deadJob] = await db.select().from(jobs).where(eq(jobs.id, staleJob.id));
  const [deadAudit] = await db.select().from(audits).where(eq(audits.id, staleAudit.id));
  check("exhausted attempts mark the job timed_out", deadJob.status === "timed_out", deadJob.errorCode ?? "");
  check("its audit is marked failed, not left running", deadAudit.status === "failed", deadAudit.status);

  /* ---------- 11. approval decision is atomic -------------------------- */
  /* Use the stale audit (not the main audit) for the approval test — the
     main audit already has a pending artifact.package approval from the
     engine finalize, and the unique partial index blocks a second one. */
  const [appr] = await db.insert(approvals).values({
    actionType: "artifact.package", targetType: "audit", targetId: staleAudit.id,
    title: "verify concurrency", environment: "local", requestedBy: "verify",
  }).returning();

  /* Count only jobs spawned from THIS approval, not pre-existing rows. */
  const { gt } = await import("drizzle-orm");
  const raceStart = new Date();
  const [d1, d2] = await Promise.all([
    decideApproval(appr.id, "approved", admin, "race A"),
    decideApproval(appr.id, "approved", admin, "race B"),
  ]);
  const winners = [d1, d2].filter((d) => d.ok).length;
  check("only one concurrent approval decision succeeds", winners === 1, `${winners} winner(s)`);

  const spawned = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, "artifact.package"), gt(jobs.createdAt, raceStart)));
  check("a duplicate approval does not spawn a second job", spawned.length === 1, `${spawned.length} spawned by this race`);

  /* ---------- cleanup ---------- */
  await db.delete(audits).where(eq(audits.id, staleAudit.id));
  await closeDb();

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.error("FAILED:", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
