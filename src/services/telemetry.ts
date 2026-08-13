import { desc, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { telemetryPoints } from "@/db/schema";
import { isDemoMode } from "@/services/mode";

/* ------------------------------------------------------------------ */
/* Telemetry providers.                                                */
/* DemoTelemetryProvider: synthetic random-walk sampler (demo mode).   */
/* OtelTelemetryProvider: placeholder for real OTLP ingestion — kept   */
/* behind APP_MODE=production wiring.                                  */
/* ------------------------------------------------------------------ */

function rnd(seed: number) {
  const x = Math.sin(seed * 9973.7) * 43758.5453;
  return x - Math.floor(x);
}

async function lastValue(metric: string, fallback: number): Promise<number> {
  const rows = await db
    .select()
    .from(telemetryPoints)
    .where(eq(telemetryPoints.metric, metric))
    .orderBy(desc(telemetryPoints.ts))
    .limit(1);
  return rows.length ? rows[0].value : fallback;
}

export async function sampleTelemetryOnce(): Promise<void> {
  const now = Date.now();
  const seed = Math.floor(now / 12000);
  const p95 = Math.min(165, Math.max(95, (await lastValue("latency_p95", 128)) + (rnd(seed) - 0.5) * 14 - 1));
  const p50 = Math.min(72, Math.max(38, (await lastValue("latency_p50", 54)) + (rnd(seed + 1) - 0.5) * 6));
  const thr = Math.min(1650, Math.max(850, (await lastValue("throughput", 1284)) + (rnd(seed + 2) - 0.5) * 120));
  const err = Math.min(1.4, Math.max(0.02, (await lastValue("error_rate", 0.21)) + (rnd(seed + 3) - 0.52) * 0.12));
  const queue = Math.min(38, Math.max(6, (await lastValue("queue_depth", 23)) + (rnd(seed + 4) - 0.5) * 5));

  await db.insert(telemetryPoints).values([
    { metric: "latency_p95", value: Math.round(p95 * 10) / 10, source: "synthetic" },
    { metric: "latency_p50", value: Math.round(p50 * 10) / 10, source: "synthetic" },
    { metric: "throughput", value: Math.round(thr), source: "synthetic" },
    { metric: "error_rate", value: Math.round(err * 100) / 100, source: "synthetic" },
    { metric: "queue_depth", value: Math.round(queue), source: "synthetic" },
  ]);

  /* keep ~2.5h of data */
  await db.delete(telemetryPoints).where(lte(telemetryPoints.ts, new Date(now - 1000 * 60 * 150)));
}

export async function ensureTelemetryFresh(): Promise<void> {
  if (!isDemoMode) return; // production: OTLP ingestion owns sampling
  const latest = await db
    .select()
    .from(telemetryPoints)
    .where(eq(telemetryPoints.metric, "latency_p95"))
    .orderBy(desc(telemetryPoints.ts))
    .limit(1);
  const now = Date.now();
  if (latest.length && now - new Date(latest[0].ts).getTime() < 12000) return;
  await sampleTelemetryOnce();
}
