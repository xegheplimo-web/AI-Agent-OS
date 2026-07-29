import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, telemetryPoints } from "@/db/schema";
import { ensureEventFreshIfDemo } from "@/services/audit";
import { ensureTelemetryFresh } from "@/services/telemetry";
import { isDemoMode } from "@/services/mode";
import type { TelemetrySource, TelemetrySummaryDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

async function seriesOf(metric: string, limit = 30) {
  const rows = await db
    .select()
    .from(telemetryPoints)
    .where(eq(telemetryPoints.metric, metric))
    .orderBy(desc(telemetryPoints.ts))
    .limit(limit);
  return rows.reverse().map((r) => ({ ts: r.ts.toISOString(), value: r.value }));
}

export async function GET() {
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

  /* Provenance:
   *   demo + data  → "synthetic"  (the random-walk sampler wrote the rows)
   *   prod + data  → "otlp"       (only a real collector could have written
   *                                them — there is no production sampler)
   *   no data      → "unavailable" (honest absence; never fabricate a fallback)
   *
   * The previous implementation returned hardcoded fallbacks (128/54/1284/
   * 0.22/23) and a synthetic radar when no rows existed, so a production
   * deployment with no collector displayed realistic-looking numbers with no
   * warning — false provenance. */
  const source: TelemetrySource = !hasData ? "unavailable" : isDemoMode ? "synthetic" : "otlp";

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
   * is telemetry at all, and its origin is always synthetic — the UI badge
   * discloses that. Returning it on `unavailable` would render fabricated
   * counts on a system with no collector. */
  const seed = new Date().getMinutes();
  const radar = hasData
    ? {
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
