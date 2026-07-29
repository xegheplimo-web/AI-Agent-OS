"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

export type HermesNodeData = {
  label: string;
  subtitle: string;
  status: string;
  metrics?: Record<string, string | number>;
};

function PhoenixMark() {
  return (
    <svg viewBox="0 0 64 64" className="size-11" fill="none">
      <defs>
        <linearGradient id="phx" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9f6ff" />
          <stop offset="0.55" stopColor="#37d6ff" />
          <stop offset="1" stopColor="#3187ff" />
        </linearGradient>
      </defs>
      <g stroke="url(#phx)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ filter: "drop-shadow(0 0 8px rgba(55,214,255,0.8))" }}>
        <path d="M32 12 L36 22 L36 34 L32 44 L28 34 L28 22 Z" fill="rgba(55,214,255,0.18)" />
        <path d="M28 24 L14 14 L20 26 L8 24 L18 32 L6 38 L26 36" />
        <path d="M36 24 L50 14 L44 26 L56 24 L46 32 L58 38 L38 36" />
        <path d="M27 46 L32 52 L37 46" />
      </g>
    </svg>
  );
}

const R = 96; // half size

export function HermesCoreNode({ data, selected }: NodeProps<Node<HermesNodeData>>) {
  return (
    <div className={cn("relative size-48", selected && "scale-[1.02] transition-transform")}>
      {/* outer rotating dashed ring */}
      <div className="ring-dashed animate-spin-slow absolute -inset-5 rounded-full opacity-70" />
      {/* counter-rotating faint ring */}
      <div className="absolute -inset-2.5 rounded-full border border-cyan/15 animate-spin-rev" style={{ borderStyle: "dashed" }} />
      {/* glow halo */}
      <div className="absolute -inset-8 rounded-full bg-[radial-gradient(circle,rgba(30,150,255,0.22),transparent_62%)]" />

      {/* core circle */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center rounded-full border-2 border-cyan/60 bg-[radial-gradient(circle_at_50%_32%,rgba(20,60,120,0.95),rgba(4,14,34,0.98)_68%)] backdrop-blur-md"
        style={{ boxShadow: "0 0 40px rgba(30,160,255,0.4), inset 0 0 34px rgba(50,150,255,0.16)" }}
      >
        <PhoenixMark />
        <div className="mt-1 font-display text-[19px] font-bold tracking-[0.12em] text-ink text-glow-cyan">
          Hermes
        </div>
        <div className="mt-0.5 px-4 text-center font-mono text-[8.5px] leading-[1.4] tracking-[0.16em] text-[#9fd8ff]/85 uppercase">
          Orchestrator
          <br />& Coordinator
        </div>
      </div>

      {/* orbiting sparks */}
      <span className="absolute top-1/2 left-1/2 size-1.5 animate-spin-slow rounded-full" style={{ transformOrigin: `0 0` }}>
        <span className="absolute block size-1.5 rounded-full bg-cyan shadow-[0_0_8px_#37d6ff]" style={{ transform: `translateX(${R + 22}px)` }} />
      </span>

      {/* radial target handles (8 points) */}
      <Handle id="ttl" type="target" position={Position.Top} style={{ left: "22%" }} isConnectable={false} />
      <Handle id="tt" type="target" position={Position.Top} isConnectable={false} />
      <Handle id="ttr" type="target" position={Position.Top} style={{ left: "78%" }} isConnectable={false} />
      <Handle id="tr" type="target" position={Position.Right} isConnectable={false} />
      <Handle id="tbr" type="target" position={Position.Bottom} style={{ left: "78%" }} isConnectable={false} />
      <Handle id="tb" type="target" position={Position.Bottom} isConnectable={false} />
      <Handle id="tbl" type="target" position={Position.Bottom} style={{ left: "22%" }} isConnectable={false} />
      <Handle id="tl" type="target" position={Position.Left} isConnectable={false} />
    </div>
  );
}
