"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BookOpenText,
  Gauge,
  Hexagon,
  Home,
  LayoutDashboard,
  ListChecks,
  Radar,
  ScanSearch,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { cn, sparklinePath } from "@/lib/utils";
import { StatusDot } from "@/components/ui";

const NAV = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/architecture", label: "Architecture", icon: LayoutDashboard },
  { href: "/audit", label: "Audit Center", icon: ScanSearch },
  { href: "/parity", label: "Parity Center", icon: ListChecks },
  { href: "/observability", label: "Observability", icon: Radar },
  { href: "/knowledge", label: "Knowledge", icon: BookOpenText },
  { href: "/settings", label: "Settings", icon: Settings },
];

function MiniSpark({ values, color }: { values: number[]; color: string }) {
  return (
    <svg width="46" height="16" viewBox="0 0 46 16" className="opacity-80">
      <path d={sparklinePath(values, 46, 16, 1)} fill="none" stroke={color} strokeWidth="1.4" />
    </svg>
  );
}

export function AppSidebar() {
  const pathname = usePathname();

  const health = useQuery({
    queryKey: ["system-health"],
    queryFn: api.systemHealth,
    refetchInterval: 5000,
  });
  const telemetry = useQuery({
    queryKey: ["telemetry"],
    queryFn: api.telemetry,
    refetchInterval: 6000,
  });

  const h = health.data;
  const p95Series = telemetry.data?.series.latencyP95.slice(-12).map((p) => p.value) ?? [];
  const queueSeries = telemetry.data?.series.throughput.slice(-12).map((p) => p.value % 40) ?? [];

  const statusTone =
    h?.status === "healthy" ? "text-mint" : h?.status === "degraded" ? "text-amber" : "text-rose";

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line/50 bg-[#030b1c]/85 backdrop-blur-xl">
      {/* logo row */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-4">
        <div className="relative flex size-10 items-center justify-center">
          <Hexagon className="absolute size-10 text-cyan" strokeWidth={1.1} style={{ filter: "drop-shadow(0 0 10px rgba(55,214,255,0.55))" }} />
          <Activity className="size-4.5 text-cyan" strokeWidth={2.4} />
        </div>
        <div className="leading-tight">
          <div className="font-display text-[15px] font-bold tracking-wide text-ink">AI Agent OS</div>
          <div className="font-mono text-[10px] tracking-[0.18em] text-mute uppercase">Control Plane</div>
        </div>
      </div>

      {/* system health pill */}
      <div className="px-4 pb-4">
        <div className="angled-pill glass-soft flex items-center gap-2.5 px-4 py-2.5">
          <StatusDot status={h?.status ?? "healthy"} pulse />
          <div className="leading-tight">
            <div className="font-mono text-[9px] tracking-[0.22em] text-mute uppercase">System Health</div>
            <div className={cn("font-display text-[12px] font-semibold capitalize", statusTone)}>
              {h ? h.status : "…"}
            </div>
          </div>
          <span className="ml-auto font-mono text-[9px] text-mute/70">LIVE</span>
        </div>
      </div>

      {/* nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] transition-all duration-200",
                active
                  ? "bg-gradient-to-r from-azure/25 to-cyan/10 font-medium text-ink"
                  : "text-mute hover:bg-ink/5 hover:text-ink",
              )}
            >
              {active && (
                <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-gradient-to-b from-cyan to-azure shadow-[0_0_10px_rgba(55,214,255,0.8)]" />
              )}
              <item.icon
                className={cn("size-4.5 transition-colors", active ? "text-cyan" : "text-mute group-hover:text-cyan/80")}
                strokeWidth={active ? 2.2 : 1.8}
              />
              {item.label}
              {active && <span className="ml-auto size-1.5 rounded-full bg-cyan shadow-[0_0_6px_rgba(55,214,255,0.9)]" />}
            </Link>
          );
        })}
      </nav>

      {/* system status */}
      <div className="px-3 pb-5">
        <div className="glass-soft rounded-xl p-3.5">
          <div className="mb-2.5 flex items-center gap-2 font-mono text-[9px] tracking-[0.24em] text-mute uppercase">
            <Gauge className="size-3 text-cyan/70" /> System Status
          </div>
          <div className="space-y-2 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-mute"><span className="size-1.5 rounded-full bg-mint shadow-[0_0_6px_rgba(32,227,162,0.8)]" />Agents</span>
              <span className="font-mono text-ink">{h ? `${h.agentsOnline} Online` : "…"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-mute"><span className="size-1.5 rounded-full bg-azure" />Workers</span>
              <span className="font-mono text-ink">{h ? `${h.workersIdle} Idle` : "…"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-mute"><span className="size-1.5 rounded-full bg-cyan" />Queue</span>
              <span className="flex items-center gap-2 font-mono text-ink">
                {queueSeries.length > 2 && <MiniSpark values={queueSeries} color="#37d6ff" />}
                {h?.queueDepth ?? "…"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-mute"><span className="size-1.5 rounded-full bg-amber" />Latency (p95)</span>
              <span className="flex items-center gap-2 font-mono text-ink">
                {p95Series.length > 2 && <MiniSpark values={p95Series} color="#ffb454" />}
                {h ? `${Math.round(h.latencyP95)}ms` : "…"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-mute"><span className="size-1.5 rounded-full bg-violet" />Uptime</span>
              <span className="font-mono text-mint">{h?.uptimePct ?? "…"}</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
