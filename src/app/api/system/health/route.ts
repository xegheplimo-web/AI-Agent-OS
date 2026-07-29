import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { components, jobs, telemetryPoints } from "@/db/schema";
import type { SystemHealthDTO } from "@/lib/types";
import { ensureTelemetryFresh } from "@/services/telemetry";
import { isDemoMode } from "@/services/mode";

export const dynamic = "force-dynamic";

const BOOT_TIME = Date.now();
const WORKER_ALIVE_MS = 45_000;

export async function GET() {
  await ensureTelemetryFresh();

  const rows = await db.select().from(components);

  /* ---- real queue + worker numbers, measured from the jobs table ---- */
  const [queued] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(eq(jobs.status, "queued"));
  const [running] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(eq(jobs.status, "running"));

  /* a worker is "alive" if one of its jobs heartbeated recently */
  const liveWorkers = await db
    .selectDistinct({ worker: jobs.lockedBy })
    .from(jobs)
    .where(
      and(eq(jobs.status, "running"), gte(jobs.heartbeatAt, new Date(Date.now() - WORKER_ALIVE_MS))),
    );
  const activeWorkers = liveWorkers.filter((w) => !!w.worker && w.worker !== "inline-demo").length;

  const queueDepth = Number(queued?.n ?? 0);
  const runningJobs = Number(running?.n ?? 0);

  const latestP95 = await db
    .select()
    .from(telemetryPoints)
    .where(eq(telemetryPoints.metric, "latency_p95"))
    .orderBy(desc(telemetryPoints.ts))
    .limit(1);

  const degraded = rows.filter((r) => r.status === "degraded").length;
  const offline = rows.filter((r) => r.status === "offline").length;
  const agentsOnline = rows.filter((r) => r.status === "healthy" || r.status === "readonly").length;

  /* In production a growing queue with no live worker is a real degradation. */
  const workerStarved = !isDemoMode && queueDepth > 0 && activeWorkers === 0;

  const uptimeSeconds = Math.floor((Date.now() - BOOT_TIME) / 1000);

  const payload: SystemHealthDTO = {
    status: offline > 0 || workerStarved ? "offline" : degraded > 0 ? "degraded" : "healthy",
    environment: process.env.APP_MODE === "production" ? "production" : "local",
    timestamp: new Date().toISOString(),
    uptimeSeconds,
    /* measured availability of this process, not a decorative constant */
    uptimePct: `${(100 - Math.min(100, (offline / Math.max(1, rows.length)) * 100)).toFixed(2)}%`,
    agentsOnline,
    agentsTotal: rows.length,
    workersIdle: Math.max(0, activeWorkers - runningJobs),
    workersTotal: activeWorkers,
    queueDepth,
    latencyP95: latestP95.length ? latestP95[0].value : 0,
  };

  return Response.json(payload);
}
