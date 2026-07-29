"use client";

import { EventsFeed } from "@/components/observability/events-feed";
import { HealthGrid } from "@/components/observability/health-card";
import { JobsTable } from "@/components/observability/jobs-table";
import { ErrorRateChart, LatencyChart, ThroughputChart } from "@/components/observability/latency-chart";
import { TelemetryRadar } from "@/components/observability/telemetry-radar";

export default function ObservabilityPage() {
  return (
    <div className="space-y-4">
      {/* charts row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <LatencyChart />
        <ThroughputChart />
        <ErrorRateChart />
      </div>

      {/* health + radar + events */}
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr_1.1fr]">
        <HealthGrid />
        <TelemetryRadar />
        <EventsFeed />
      </div>

      {/* jobs */}
      <JobsTable />
    </div>
  );
}
