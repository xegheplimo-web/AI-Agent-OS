"use client";

import { useQuery } from "@tanstack/react-query";
import { Boxes, Cable, HeartPulse, Network, ScanEye } from "lucide-react";
import { ArchitectureCanvas } from "@/components/architecture/architecture-canvas";
import { api } from "@/lib/api";
import { Panel, Skeleton } from "@/components/ui";

function Stat({ label, value, tone, icon: Icon }: { label: string; value: string; tone: string; icon: typeof Boxes }) {
  return (
    <div className="glass-soft flex items-center gap-3 rounded-xl px-4 py-3">
      <span className="flex size-9 items-center justify-center rounded-lg border" style={{ borderColor: `${tone}40`, background: `${tone}10` }}>
        <Icon className="size-4.5" style={{ color: tone }} strokeWidth={2} />
      </span>
      <div className="leading-tight">
        <div className="font-display text-[19px] font-bold text-ink">{value}</div>
        <div className="font-mono text-[9px] tracking-[0.2em] text-mute uppercase">{label}</div>
      </div>
    </div>
  );
}

export default function ArchitecturePage() {
  const graph = useQuery({ queryKey: ["graph"], queryFn: api.graph, refetchInterval: 8000 });
  const components = useQuery({ queryKey: ["components"], queryFn: api.components, refetchInterval: 10000 });

  const total = components.data?.length ?? 0;
  const healthy = components.data?.filter((c) => c.status === "healthy").length ?? 0;
  const edgeCount = graph.data?.edges.length ?? 0;
  const readOnlyEdges = graph.data?.edges.filter((e) => e.kind === "audit").length ?? 0;

  return (
    <div className="space-y-4">
      {/* stats */}
      {components.data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Components" value={String(total)} tone="#37d6ff" icon={Boxes} />
          <Stat label="Healthy" value={`${healthy}/${total}`} tone="#20e3a2" icon={HeartPulse} />
          <Stat label="Runtime links" value={String(edgeCount - readOnlyEdges)} tone="#3187ff" icon={Cable} />
          <Stat label="Read-only links" value={String(readOnlyEdges)} tone="#8b5cf6" icon={ScanEye} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      )}

      {/* canvas */}
      <Panel
        title="Live System Topology"
        icon={Network}
        tone="azure"
        pad={false}
        bodyClassName="relative h-[calc(100vh-240px)] min-h-[560px] overflow-hidden rounded-b-2xl"
        right={
          <div className="flex items-center gap-3 font-mono text-[9.5px] tracking-widest text-mute uppercase">
            <span>drag nodes · scroll to zoom · click to inspect</span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 animate-blink rounded-full bg-mint shadow-[0_0_5px_#20e3a2]" /> live
            </span>
          </div>
        }
      >
        <ArchitectureCanvas className="h-full w-full" interactive minimap />
      </Panel>
    </div>
  );
}
