"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
} from "@xyflow/react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Cable, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { api } from "@/lib/api";
import { useUIStore } from "@/lib/store";
import { AgentNode } from "@/components/architecture/agent-node";
import { AuditorNode } from "@/components/architecture/auditor-node";
import { HermesCoreNode } from "@/components/architecture/hermes-core-node";
import { Chip, KV } from "@/components/ui";
import { SEVERITY_STYLES, STATUS_COLORS, cn, timeAgo } from "@/lib/utils";

const nodeTypes = {
  agent: AgentNode,
  hermes: HermesCoreNode,
  auditor: AuditorNode,
};

function NodeInspector({ id }: { id: string }) {
  const setSelectedNode = useUIStore((s) => s.setSelectedNode);
  const components = useQuery({ queryKey: ["components"], queryFn: api.components, refetchInterval: 10000 });
  const graph = useQuery({ queryKey: ["graph"], queryFn: api.graph, staleTime: 15000 });
  const find = useQuery({
    queryKey: ["node-findings", id],
    queryFn: () => api.findings(`component=${id}&status=open`),
    refetchInterval: 10000,
  });
  const evts = useQuery({
    queryKey: ["node-events", id],
    queryFn: () => api.events(4, id),
    refetchInterval: 8000,
  });

  const selected = components.data?.find((c) => c.id === id) ?? null;
  const links = useMemo(() => {
    if (!graph.data) return [];
    return graph.data.edges
      .filter((e) => e.source === id || e.target === id)
      .map((e) => (e.source === id ? e.target : e.source));
  }, [graph.data, id]);

  if (!selected) return null;
  const openFindings = find.data ?? [];

  return (
    <motion.aside
      initial={{ opacity: 0, x: 24, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 18, scale: 0.98 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="glass hud-corner absolute top-3 right-3 z-20 w-80 rounded-xl p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-display text-[15px] font-semibold text-ink">{selected.name}</div>
          <div className="mt-0.5 font-mono text-[9.5px] tracking-[0.14em] text-mute uppercase">{selected.role}</div>
        </div>
        <button
          onClick={() => setSelectedNode(null)}
          className="rounded-md p-1 text-mute transition-colors hover:bg-ink/5 hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Chip
          tone={
            selected.status === "healthy"
              ? "mint"
              : selected.status === "degraded"
                ? "amber"
                : selected.status === "readonly"
                  ? "violet"
                  : "rose"
          }
        >
          <span
            className="size-1.5 rounded-full"
            style={{ backgroundColor: STATUS_COLORS[selected.status], boxShadow: `0 0 6px ${STATUS_COLORS[selected.status]}` }}
          />
          {selected.status}
        </Chip>
        <Chip tone="azure">v{selected.version}</Chip>
        <Chip tone="cyan">{selected.latencyMs?.toFixed(1)}ms</Chip>
      </div>

      <p className="mt-3 text-[11.5px] leading-relaxed text-mute">{selected.description}</p>

      <div className="mt-3 border-t border-ink/8 pt-2">
        {Object.entries(selected.metrics).slice(0, 4).map(([k, v]) => (
          <KV key={k} k={k} v={String(v)} tone="text-cyan" />
        ))}
        <KV k="uptime" v={`${selected.uptimePct}%`} tone="text-mint" />
      </div>

      {links.length > 0 && (
        <div className="mt-2 border-t border-ink/8 pt-2">
          <div className="mb-1 flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-mute uppercase">
            <Cable className="size-3" /> connections ({links.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {links.map((l) => (
              <span key={l} className="rounded border border-azure/25 bg-azure/8 px-1.5 py-0.5 font-mono text-[9px] text-azure">
                {l}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* operational data: findings + events */}
      <div className="mt-2 border-t border-ink/8 pt-2">
        <div className="mb-1 flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-mute uppercase">
          <TriangleAlert className="size-3 text-amber" /> open findings ({openFindings.length})
        </div>
        {openFindings.slice(0, 3).map((f) => (
          <Link key={f.id} href="/audit" className="group mb-1 flex items-center gap-2 rounded-lg border border-ink/8 px-2 py-1.5 transition-colors hover:border-cyan/30">
            <span className={cn("size-1.5 shrink-0 rounded-full", SEVERITY_STYLES[f.severity].dot)} />
            <span className="min-w-0 truncate text-[10.5px] text-ink/80 group-hover:text-ink">{f.title}</span>
          </Link>
        ))}
        {openFindings.length === 0 && <div className="py-1 font-mono text-[9.5px] text-mint/70">không có finding mở ✓</div>}
      </div>

      <div className="mt-2 border-t border-ink/8 pt-2">
        <div className="mb-1 font-mono text-[9px] tracking-widest text-mute uppercase">recent events</div>
        {(evts.data ?? []).map((e) => (
          <div key={e.id} className="mb-1 truncate font-mono text-[9.5px] text-mute">
            <span className="text-cyan/70">{timeAgo(e.createdAt)}</span> · {e.message}
          </div>
        ))}
        {(evts.data ?? []).length === 0 && <div className="py-1 font-mono text-[9.5px] text-mute/60">chưa có event gần đây từ nguồn này</div>}
      </div>
    </motion.aside>
  );
}

function CanvasInner({ interactive, minimap }: { interactive: boolean; minimap: boolean }) {
  const graph = useQuery({ queryKey: ["graph"], queryFn: api.graph, refetchInterval: 8000 });
  const selectedNodeId = useUIStore((s) => s.selectedNodeId);
  const setSelectedNode = useUIStore((s) => s.setSelectedNode);

  const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);

  useEffect(() => {
    if (!graph.data) return;
    const g = graph.data;
    setNodes((prev: any[]) =>
      g.nodes.map((n) => {
        const existing = prev.find((p) => p.id === n.id);
        return {
          id: n.id,
          type: n.type,
          position: existing?.position ?? n.position,
          data: {
            label: n.data.label,
            subtitle: n.data.subtitle,
            status: n.data.status,
            icon: n.data.icon,
            latencyMs: n.data.latencyMs,
            metrics: n.data.metrics,
            tag: n.data.tag,
          },
          draggable: interactive,
        };
      }),
    );
    setEdges(
      g.edges.map(
        (e): Edge => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
          type: "smoothstep",
          className: e.kind === "audit" ? "audit-edge animated-edge" : "",
          style:
            e.kind === "audit"
              ? { stroke: "rgba(139,92,246,0.65)", strokeWidth: 1.5 }
              : { stroke: "rgba(60,190,255,0.55)", strokeWidth: 1.6, filter: "drop-shadow(0 0 4px rgba(55,214,255,0.45))" },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: e.kind === "audit" ? "#8b5cf6" : "#37d6ff",
          },
        }),
      ),
    );
  }, [graph.data, interactive, setNodes, setEdges]);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => setSelectedNode(node.id === selectedNodeId ? null : node.id)}
        onPaneClick={() => setSelectedNode(null)}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1.05 }}
        minZoom={0.35}
        maxZoom={1.6}
        zoomOnScroll={interactive}
        panOnScroll={false}
        panOnDrag={interactive}
        zoomOnPinch
        preventScrolling={interactive}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Lines} gap={42} color="rgba(45,140,220,0.055)" />
        {interactive && <Controls showInteractive={false} position="bottom-left" />}
        {minimap && (
          <MiniMap pannable zoomable position="bottom-right" nodeStrokeWidth={3} style={{ width: 150, height: 96 }} />
        )}
      </ReactFlow>

      <AnimatePresence>{selectedNodeId && <NodeInspector key={selectedNodeId} id={selectedNodeId} />}</AnimatePresence>

      {graph.isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="font-mono text-[11px] tracking-[0.3em] text-cyan/70 uppercase animate-blink">
            Linking topology…
          </div>
        </div>
      )}
    </div>
  );
}

export function ArchitectureCanvas({
  interactive = true,
  minimap = false,
  className = "",
}: {
  interactive?: boolean;
  minimap?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <ReactFlowProvider>
        <CanvasInner interactive={interactive} minimap={minimap} />
      </ReactFlowProvider>
    </div>
  );
}
