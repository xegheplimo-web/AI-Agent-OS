import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, telemetryPoints } from "@/db/schema";
import { ensureEventFreshIfDemo } from "@/services/audit";
import { ensureTelemetryFresh } from "@/services/telemetry";
import type { TelemetrySummaryDTO } from "@/lib/types";

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

  const last = (arr: Array<{ value: number }>, fb: number) => (arr.length ? arr[arr.length - 1].value : fb);

  const seed = new Date().getMinutes();

  const payload: TelemetrySummaryDTO = {
    current: {
      latencyP95: last(p95, 128),
      latencyP50: last(p50, 54),
      throughput: last(thr, 1284),
      errorRate: last(err, 0.22),
      queueDepth: queueRows.length ? queueRows[0].value : 23,
    },
    series: { latencyP95: p95, latencyP50: p50, throughput: thr, errorRate: err },
    radar: {
      traces: { active: 480 + ((seed * 13) % 90), sampledPct: 12.4 },
      metrics: { series: 482, scrapeOk: 100 },
      logs: { linesPerMin: 17600 + ((seed * 89) % 2400), errorLines: Math.round(38 + last(err, 0.22) * 60) },
      baggage: { keys: 11, propagationPct: 96.2 },
    },
  };

  return Response.json(payload);
}
