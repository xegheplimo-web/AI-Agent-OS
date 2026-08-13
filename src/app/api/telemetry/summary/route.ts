import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, telemetryPoints } from "@/db/schema";
import { ensureEventFreshIfDemo } from "@/services/audit";
import { ensureTelemetryFresh } from "@/services/telemetry";
import type { TelemetrySource, TelemetrySummaryDTO } from "@/lib/types";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

/* Data older than this is considered stale — not "live". 10 minutes is
   generous for a 5-min scrape interval; anything older means the collector
   stopped or was never configured. */
const FRESHNESS_MS = 10 * 60 * 1000;

async function seriesOf(metric: string, limit = 30) {
  const rows = await db
    .select()
    .from(telemetryPoints)
    .where(eq(telemetryPoints.metric, metric))
    .orderBy(desc(telemetryPoints.ts))
    .limit(limit);
  return rows.reverse().map((r) => ({ ts: r.ts.toISOString(), value: r.value, source: r.source }));
}

export async function GET(req: Request) {
  const auth = await requirePermission(req, "system:read");
  if (auth instanceof Response) return auth;

  await ensureTelemetryFresh();
  await ensureEventFreshIfDemo();

  const [p95, p50, thr, err] = await Promise.all([
    seriesOf("latency_p95"),
    seriesOf("latency_p50"),
    seriesOf("throughput"),
    seriesOf("error_rate"),
  ]);
  const queueRows = await db
    .select()
    .from(telemetryPoints)
    .where(eq(telemetryPoints.metric, "queue_depth"))
    .orderBy(desc(telemetryPoints.ts))
    .limit(1);

  const hasData = p95.length > 0 || p50.length > 0 || thr.length > 0 || err.length > 0 || queueRows.length > 0;

  /* Provenance is determined by the `source` column on the telemetry rows,
     NOT inferred from "has data + production mode". The previous logic
     falsely labeled seed/demo data as "otlp" because it assumed only a real
     collector could write rows in production — but seed.ts inserts
     latency_p95=128ms in every environment, so a fresh production deploy
     with no collector showed "OTLP live" on synthetic data.

     Resolution:
       no data                    → "unavailable" (honest absence)
       any row source="synthetic" → "synthetic" (demo sampler, never prod)
       any row source="otlp"      → "otlp" (real collector — not yet wired)
       all rows source="manual"   → "manual" (seed or manual insert)
       data but all stale (>10m)  → "stale" (collector stopped or never set up)

     The freshest row's source wins — a mix means the collector started
     after seed data was loaded. */
  const allRows = [...p95, ...p50, ...thr, ...err, ...queueRows.map((r) => ({ ts: r.ts.toISOString(), value: r.value, source: r.source }))];
  const freshest = allRows.toSorted((a, b) => b.ts.localeCompare(a.ts))[0];
  const freshestAge = freshest ? Date.now() - new Date(freshest.ts).getTime() : Infinity;

  let source: TelemetrySource;
  if (!hasData) {
    source = "unavailable";
  } else if (freshestAge > FRESHNESS_MS) {
    source = "stale";
  } else if (freshest?.source === "otlp") {
    source = "otlp";
  } else if (freshest?.source === "synthetic") {
    source = "synthetic";
  } else {
    source = "manual";
  }

  const last = (arr: Array<{ value: number }>): number | null => (arr.length ? arr[arr.length - 1].value : null);

  const current = hasData
    ? {
        latencyP95: last(p95) ?? 0,
        latencyP50: last(p50) ?? 0,
        throughput: last(thr) ?? 0,
        errorRate: last(err) ?? 0,
        queueDepth: queueRows.length ? queueRows[0].value : 0,
      }
    : null;

  /* The radar panel (traces/metrics/logs/baggage) is decorative and has no
   * real backing data source in either mode. It is only returned when there
   * is telemetry at all, and its origin is always "synthetic" — separate
   * from the main telemetry source so the UI badge never labels fabricated
   * radar numbers as "otlp live". */
  const seed = new Date().getMinutes();
  const radar = hasData
    ? {
        source: "synthetic" as const,
        traces: { active: 480 + ((seed * 13) % 90), sampledPct: 12.4 },
        metrics: { series: 482, scrapeOk: 100 },
        logs: { linesPerMin: 17600 + ((seed * 89) % 2400), errorLines: Math.round(38 + (last(err) ?? 0) * 60) },
        baggage: { keys: 11, propagationPct: 96.2 },
      }
    : null;

  const payload: TelemetrySummaryDTO = {
    source,
    current,
    series: { latencyP95: p95, latencyP50: p50, throughput: thr, errorRate: err },
    radar,
  };

  return Response.json(payload);
}
