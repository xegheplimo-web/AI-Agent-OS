"use client";

import { useQuery } from "@tanstack/react-query";
import { AlarmClock, GitCommitVertical, TriangleAlert, TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import { isDemoModeClient } from "@/lib/mode-client";
import { Panel } from "@/components/ui";

function SimulatedBanner() {
  if (!isDemoModeClient()) return null;
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber/25 bg-amber/8 px-2.5 py-1.5 font-mono text-[9px] tracking-[0.14em] text-amber/80 uppercase">
      <TriangleAlert className="size-3 shrink-0" />
      synthetic data — OTLP provider chưa kết nối
    </div>
  );
}

function useTelemetry() {
  return useQuery({ queryKey: ["telemetry"], queryFn: api.telemetry, refetchInterval: 6000 });
}

function fmtTime(ts: string) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const tooltipStyle = {
  background: "rgba(4,13,32,0.95)",
  border: "1px solid rgba(77,187,255,0.3)",
  borderRadius: 10,
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  color: "#e9f6ff",
  boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
};

export function LatencyChart() {
  const telemetry = useTelemetry();
  const p95 = telemetry.data?.series.latencyP95 ?? [];
  const p50 = telemetry.data?.series.latencyP50 ?? [];
  const data = p95.map((p, i) => ({ ts: p.ts, p95: p.value, p50: p50[i]?.value ?? null }));
  const cur = telemetry.data?.current;

  return (
    <Panel
      className="relative"
      title="Latency"
      icon={AlarmClock}
      tone="cyan"
      right={
        <div className="flex items-center gap-3 font-mono text-[9.5px] text-mute">
          <span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-cyan" />p95 <span className="text-cyan">{cur ? `${Math.round(cur.latencyP95)}ms` : ""}</span></span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-violet" />p50 <span className="text-violet">{cur ? `${Math.round(cur.latencyP50)}ms` : ""}</span></span>
        </div>
      }
    >
      <SimulatedBanner />
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="g95" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#37d6ff" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#37d6ff" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="g50" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(77,140,220,0.08)" vertical={false} />
            <XAxis dataKey="ts" tickFormatter={fmtTime} tick={{ fontSize: 9, fill: "#7890aa", fontFamily: "var(--font-mono)" }} tickLine={false} axisLine={false} minTickGap={40} />
            <YAxis tick={{ fontSize: 9, fill: "#7890aa", fontFamily: "var(--font-mono)" }} tickLine={false} axisLine={false} unit="ms" width={52} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => `t ${fmtTime(String(v))}`} cursor={{ stroke: "rgba(55,214,255,0.3)" }} />
            <Area type="monotone" dataKey="p95" stroke="#37d6ff" strokeWidth={1.8} fill="url(#g95)" dot={false} />
            <Area type="monotone" dataKey="p50" stroke="#8b5cf6" strokeWidth={1.8} fill="url(#g50)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

export function ThroughputChart() {
  const telemetry = useTelemetry();
  const data = (telemetry.data?.series.throughput ?? []).map((p) => ({ ts: p.ts, rps: p.value }));
  const cur = telemetry.data?.current;

  return (
    <Panel
      title="Throughput"
      icon={TrendingUp}
      tone="azure"
      right={<span className="font-mono text-[9.5px] text-mute">req/min · <span className="text-azure">{cur ? Math.round(cur.throughput) : ""}</span></span>}
    >
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -14 }}>
            <defs>
              <linearGradient id="gbar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3187ff" stopOpacity={0.95} />
                <stop offset="100%" stopColor="#3187ff" stopOpacity={0.25} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(77,140,220,0.08)" vertical={false} />
            <XAxis dataKey="ts" tickFormatter={fmtTime} tick={{ fontSize: 9, fill: "#7890aa", fontFamily: "var(--font-mono)" }} tickLine={false} axisLine={false} minTickGap={40} />
            <YAxis tick={{ fontSize: 9, fill: "#7890aa", fontFamily: "var(--font-mono)" }} tickLine={false} axisLine={false} width={48} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => `t ${fmtTime(String(v))}`} cursor={{ fill: "rgba(55,214,255,0.06)" }} />
            <Bar dataKey="rps" fill="url(#gbar)" radius={[3, 3, 0, 0]} maxBarSize={14} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

export function ErrorRateChart() {
  const telemetry = useTelemetry();
  const data = (telemetry.data?.series.errorRate ?? []).map((p) => ({ ts: p.ts, err: p.value }));
  const cur = telemetry.data?.current;

  return (
    <Panel
      title="Error Rate"
      icon={GitCommitVertical}
      tone="rose"
      right={<span className="font-mono text-[9.5px] text-mute">% · <span className="text-rose">{cur ? cur.errorRate.toFixed(2) : ""}%</span></span>}
    >
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="gerr" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ff5f7a" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#ff5f7a" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(77,140,220,0.08)" vertical={false} />
            <XAxis dataKey="ts" tickFormatter={fmtTime} tick={{ fontSize: 9, fill: "#7890aa", fontFamily: "var(--font-mono)" }} tickLine={false} axisLine={false} minTickGap={40} />
            <YAxis tick={{ fontSize: 9, fill: "#7890aa", fontFamily: "var(--font-mono)" }} tickLine={false} axisLine={false} width={46} unit="%" />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => `t ${fmtTime(String(v))}`} cursor={{ stroke: "rgba(255,95,122,0.3)" }} />
            <Area type="monotone" dataKey="err" stroke="#ff5f7a" strokeWidth={1.8} fill="url(#gerr)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
