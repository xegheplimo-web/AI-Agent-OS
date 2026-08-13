"use client";

import { Radio, TriangleAlert } from "lucide-react";
import type { TelemetrySource } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Provenance badge for telemetry panels.                              */
/*                                                                     */
/* Replaces the old SimulatedBanner, which only surfaced a warning in  */
/* demo mode. The real risk is the opposite: a production deployment   */
/* with no OTLP collector used to display fabricated fallback numbers  */
/* (128ms / 1284 rps / radar traces) with NO warning at all. The badge */
/* now keys off the API's `source` field so every mode is honest:      */
/*                                                                     */
/*   otlp        → green "otlp live"                                   */
/*   synthetic   → amber "synthetic data — no collector"               */
/*   unavailable → rose "no telemetry — collector not connected"       */
/* ------------------------------------------------------------------ */

const STYLES: Record<
  TelemetrySource,
  { label: string; tone: string; icon: typeof Radio }
> = {
  otlp: {
    label: "otlp live",
    tone: "border-mint/25 bg-mint/8 text-mint/80",
    icon: Radio,
  },
  synthetic: {
    label: "synthetic data — no collector",
    tone: "border-amber/25 bg-amber/8 text-amber/80",
    icon: TriangleAlert,
  },
  manual: {
    label: "manual/seed data — no collector",
    tone: "border-amber/25 bg-amber/8 text-amber/80",
    icon: TriangleAlert,
  },
  stale: {
    label: "stale data — collector may have stopped",
    tone: "border-amber/25 bg-amber/8 text-amber/80",
    icon: TriangleAlert,
  },
  unavailable: {
    label: "no telemetry — collector not connected",
    tone: "border-rose/25 bg-rose/8 text-rose/80",
    icon: TriangleAlert,
  },
};

export function DataSourceBadge({ source }: { source: TelemetrySource }) {
  const s = STYLES[source];
  const Icon = s.icon;
  return (
    <div
      className={`mb-2 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 font-mono text-[9px] tracking-[0.14em] uppercase ${s.tone}`}
    >
      <Icon className="size-3 shrink-0" />
      {s.label}
    </div>
  );
}
