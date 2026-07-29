"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpenText,
  Bot,
  Box,
  Code2,
  Cog,
  Database,
  HeartPulse,
  Hexagon,
  ScanSearch,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { Panel, Skeleton } from "@/components/ui";
import { STATUS_COLORS } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  hermes: Hexagon,
  openclaw: Bot,
  opencode: Code2,
  gateway: Shield,
  worker: Cog,
  memory: Database,
  knowledge: BookOpenText,
  dashboard: BarChart3,
  auditor: ScanSearch,
};

export function HealthGrid() {
  const components = useQuery({ queryKey: ["components"], queryFn: api.components, refetchInterval: 8000 });

  return (
    <Panel title="Component Health" icon={HeartPulse} tone="mint" pad={false} bodyClassName="max-h-[300px] overflow-y-auto p-3">
      {components.isLoading && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-[86px]" />
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {components.data?.map((c) => {
          const Icon = ICONS[c.id] ?? Box;
          const color = STATUS_COLORS[c.status];
          return (
            <div
              key={c.id}
              className="glass-soft group rounded-xl px-3 py-2.5 transition-all duration-200 hover:border-cyan/35"
              style={{ boxShadow: `inset 3px 0 0 ${color}66` }}
            >
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border" style={{ borderColor: `${color}44`, background: `${color}10` }}>
                  <Icon className="size-4" style={{ color }} strokeWidth={2} />
                </span>
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-[12.5px] font-medium text-ink">{c.name}</div>
                  <div className="font-mono text-[9px] tracking-wider text-mute uppercase">{c.id} · v{c.version}</div>
                </div>
                <span className="ml-auto size-2 shrink-0 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 7px ${color}` }} />
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-ink/6 pt-1.5 font-mono text-[9.5px]">
                <span className="text-mute">
                  p50 <span className={c.latencyMs && c.latencyMs > 45 ? "text-amber" : "text-cyan"}>{c.latencyMs?.toFixed(1)}ms</span>
                </span>
                <span className="text-mute">
                  up <span className="text-mint">{c.uptimePct}%</span>
                </span>
                <span className="tracking-wider uppercase" style={{ color }}>{c.status}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
