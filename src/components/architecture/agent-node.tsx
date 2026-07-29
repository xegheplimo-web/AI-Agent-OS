"use client";

import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import {
  BarChart3,
  BookOpenText,
  Bot,
  Box,
  Braces,
  Code2,
  Cog,
  Database,
  ScanSearch,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  bot: Bot,
  code: Code2,
  shield: Shield,
  cog: Cog,
  database: Database,
  "book-open": BookOpenText,
  "bar-chart-3": BarChart3,
  "scan-search": ScanSearch,
  braces: Braces,
};

export type AgentNodeData = {
  label: string;
  subtitle: string;
  status: "healthy" | "degraded" | "offline" | "readonly";
  icon: string;
  latencyMs?: number | null;
};

const STATUS_COLOR: Record<string, string> = {
  healthy: "#20e3a2",
  degraded: "#ffb454",
  offline: "#ff5f7a",
  readonly: "#8b5cf6",
};

export function AgentNode({ data, selected }: NodeProps<Node<AgentNodeData>>) {
  const Icon = ICONS[data.icon] ?? Box;
  const color = STATUS_COLOR[data.status] ?? STATUS_COLOR.healthy;

  return (
    <div
      className={cn(
        "group relative w-[208px] rounded-xl border bg-[#061630]/95 px-3 py-2.5 backdrop-blur-md transition-all duration-300",
        data.status === "degraded"
          ? "border-amber/50 node-glow shadow-[0_0_18px_rgba(255,180,84,0.25)]"
          : data.status === "readonly"
            ? "border-violet/50 node-glow-violet"
            : "border-azure/40 node-glow",
        selected && "border-cyan/80 shadow-[0_0_28px_rgba(55,214,255,0.45)]",
      )}
    >
      {/* corner ticks */}
      <span className="absolute -top-px -left-px size-2 border-t border-l border-cyan/70" />
      <span className="absolute -right-px -bottom-px size-2 border-r border-b border-cyan/70" />

      <div className="flex items-center gap-2.5">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border"
          style={{
            borderColor: `${color}55`,
            background: `${color}14`,
            boxShadow: `0 0 14px ${color}33`,
          }}
        >
          <Icon className="size-4.5" style={{ color }} strokeWidth={2} />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="font-display text-[13px] font-semibold tracking-wide text-ink">{data.label}</div>
          <div className="mt-0.5 font-mono text-[8.5px] leading-[1.35] tracking-[0.08em] text-mute uppercase">
            {data.subtitle}
          </div>
        </div>
        <span
          className="absolute top-2 right-2 size-1.5 rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 7px ${color}` }}
        />
      </div>

      {typeof data.latencyMs === "number" && (
        <div className="mt-1.5 flex items-center justify-between border-t border-ink/6 pt-1.5 font-mono text-[9px] text-mute">
          <span>LATENCY</span>
          <span className={data.latencyMs > 45 ? "text-amber" : "text-cyan"}>{data.latencyMs.toFixed(1)}ms</span>
        </div>
      )}

      {/* handles */}
      <Handle id="st" type="source" position={Position.Top} isConnectable={false} />
      <Handle id="sb" type="source" position={Position.Bottom} isConnectable={false} />
      <Handle id="sl" type="source" position={Position.Left} isConnectable={false} />
      <Handle id="sr" type="source" position={Position.Right} isConnectable={false} />
      <Handle id="tt" type="target" position={Position.Top} isConnectable={false} />
      <Handle id="tb" type="target" position={Position.Bottom} isConnectable={false} />
      <Handle id="tl" type="target" position={Position.Left} isConnectable={false} />
      <Handle id="tr" type="target" position={Position.Right} isConnectable={false} />
    </div>
  );
}
