"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, BarChart4, Footprints, Radio, ScrollText } from "lucide-react";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { Panel } from "@/components/ui";
import { DataSourceBadge } from "@/components/observability/data-source-badge";

const BLIPS = [
  { angle: 40, dist: 0.62, color: "#37d6ff" },
  { angle: 158, dist: 0.4, color: "#8b5cf6" },
  { angle: 246, dist: 0.75, color: "#20e3a2" },
  { angle: 322, dist: 0.5, color: "#ffb454" },
];

export function TelemetryRadar({ compact = false }: { compact?: boolean }) {
  const telemetry = useQuery({ queryKey: ["telemetry"], queryFn: api.telemetry, refetchInterval: 6000 });
  /* Radar has its own source field — always "synthetic" — separate from the
     main telemetry source. Using telemetry.data.source here would show
     "otlp live" on the radar badge when the real telemetry source is otlp,
     even though the radar data is always fabricated. */
  const radarSource = telemetry.data?.radar?.source ?? "unavailable";
  const r = telemetry.data?.radar;

  const size = compact ? 148 : 176;
  const c = size / 2;

  const channels = [
    { icon: Activity, label: "traces", value: r ? `${r.traces.active} active` : "—", sub: r ? `${r.traces.sampledPct}% sampled` : "", color: "#37d6ff" },
    { icon: BarChart4, label: "metrics", value: r ? `${r.metrics.series} series` : "—", sub: r ? `${r.metrics.scrapeOk}% scrape ok` : "", color: "#8b5cf6" },
    { icon: ScrollText, label: "logs", value: r ? `${formatNumber(r.logs.linesPerMin)}/min` : "—", sub: r ? `${r.logs.errorLines} errors` : "", color: "#20e3a2" },
    { icon: Footprints, label: "baggage", value: r ? `${r.baggage.keys} keys` : "—", sub: r ? `${r.baggage.propagationPct}% propagated` : "", color: "#ffb454" },
  ];

  return (
    <Panel title="Observability" icon={Radio} tone="cyan">
      <DataSourceBadge source={radarSource} />
      <div className="flex items-center gap-4">
        {/* radar disc */}
        <div className="relative shrink-0 rounded-full border border-cyan/20" style={{ width: size, height: size }}>
          {/* sweep */}
          <div
            className="animate-sweep absolute inset-0 rounded-full"
            style={{
              background: "conic-gradient(from 0deg, rgba(55,214,255,0.34), transparent 72deg)",
              maskImage: "radial-gradient(circle, black, black)",
            }}
          />
          <svg width={size} height={size} className="absolute inset-0">
            {[0.33, 0.66, 1].map((f) => (
              <circle key={f} cx={c} cy={c} r={c * f - 2} fill="none" stroke="rgba(55,214,255,0.14)" strokeWidth="1" />
            ))}
            <line x1={c} y1="4" x2={c} y2={size - 4} stroke="rgba(55,214,255,0.1)" />
            <line x1="4" y1={c} x2={size - 4} y2={c} stroke="rgba(55,214,255,0.1)" />
            {BLIPS.map((b, i) => {
              const rad = (b.angle * Math.PI) / 180;
              const x = c + Math.cos(rad) * b.dist * (c - 8);
              const y = c + Math.sin(rad) * b.dist * (c - 8);
              return (
                <g key={i}>
                  <circle cx={x} cy={y} r="5" fill={b.color} opacity="0.18" className="animate-blink" />
                  <circle cx={x} cy={y} r="2.2" fill={b.color} style={{ filter: `drop-shadow(0 0 4px ${b.color})` }} />
                </g>
              );
            })}
            <circle cx={c} cy={c} r="2.6" fill="#37d6ff" style={{ filter: "drop-shadow(0 0 6px #37d6ff)" }} />
          </svg>
        </div>

        {/* channel list */}
        <ul className="min-w-0 flex-1 space-y-2.5">
          {channels.map((ch) => (
            <li key={ch.label} className="flex items-center gap-2.5">
              <span
                className="flex size-7.5 shrink-0 items-center justify-center rounded-lg border"
                style={{ borderColor: `${ch.color}40`, background: `${ch.color}10` }}
              >
                <ch.icon className="size-3.5" style={{ color: ch.color }} strokeWidth={2} />
              </span>
              <div className="min-w-0 leading-tight">
                <div className="font-mono text-[10px] tracking-[0.14em] text-mute uppercase">{ch.label}</div>
                <div className="mt-0.5 font-mono text-[11px] text-ink">
                  {ch.value} <span className="text-[9px] text-mute">{ch.sub}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
