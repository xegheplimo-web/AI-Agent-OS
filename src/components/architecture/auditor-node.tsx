"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";

export type AuditorNodeData = {
  label: string;
  subtitle: string;
  status: string;
  tag?: string;
};

export function AuditorNode({ data, selected }: NodeProps<Node<AuditorNodeData>>) {
  return (
    <div className="w-[250px]">
      <div
        className={cn(
          "relative rounded-xl border border-violet/55 bg-[#150a33]/95 px-3.5 py-3 backdrop-blur-md node-glow-violet",
          selected && "shadow-[0_0_34px_rgba(139,92,246,0.55)]",
        )}
      >
        <span className="absolute -top-px -left-px size-2 border-t border-l border-violet/80" />
        <span className="absolute -right-px -bottom-px size-2 border-r border-b border-violet/80" />
        <div className="flex items-center gap-3">
          <span className="relative flex size-10 shrink-0 items-center justify-center rounded-lg border border-violet/40 bg-violet/15">
            <ScanSearch className="size-5 text-violet" strokeWidth={2} />
            <span className="absolute inset-0 animate-ping-soft rounded-lg bg-violet/20" />
          </span>
          <div className="leading-tight">
            <div className="font-display text-[13.5px] font-semibold tracking-wide text-ink">{data.label}</div>
            <div className="mt-0.5 font-mono text-[8.5px] leading-[1.4] tracking-[0.08em] text-[#c9b8ff]/80 uppercase">
              {data.subtitle}
            </div>
          </div>
        </div>

        <Handle id="st" type="source" position={Position.Top} isConnectable={false} />
        <Handle id="sl" type="source" position={Position.Left} isConnectable={false} />
        <Handle id="sr" type="source" position={Position.Right} isConnectable={false} />
      </div>

      {data.tag && (
        <div className="mx-auto mt-2 w-fit rounded-md border border-violet/45 bg-[#1a0d3d]/90 px-3 py-1 font-mono text-[8px] tracking-[0.18em] text-[#c9b8ff] uppercase shadow-[0_0_18px_rgba(139,92,246,0.35)]">
          {data.tag}
        </div>
      )}
    </div>
  );
}
