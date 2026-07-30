import { db } from "@/db";
import { components } from "@/db/schema";
import { GRAPH_EDGES } from "@/lib/audit-data";
import type { ArchitectureGraphDTO, GraphNodeDTO } from "@/lib/types";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ICONS: Record<string, string> = {
  openclaw: "bot",
  opencode: "code",
  gateway: "shield",
  worker: "cog",
  memory: "database",
  knowledge: "book-open",
  dashboard: "bar-chart-3",
  auditor: "scan-search",
};

export async function GET(req: Request) {
  const auth = await requirePermission(req, "system:read");
  if (auth instanceof Response) return auth;

  const rows = await db.select().from(components);
  const nodes: GraphNodeDTO[] = rows.map((r) => ({
    id: r.id,
    type: r.id === "hermes" ? "hermes" : r.id === "auditor" ? "auditor" : "agent",
    position: r.position ?? { x: 0, y: 0 },
    data: {
      label: r.name,
      subtitle: r.role,
      status: r.status as GraphNodeDTO["data"]["status"],
      icon: ICONS[r.id] ?? "box",
      latencyMs: r.latencyMs,
      metrics: (r.metrics ?? {}) as Record<string, string | number>,
      tag:
        r.id === "auditor"
          ? "ĐỘC LẬP • READ-ONLY • KHÔNG CAN THIỆP RUNTIME"
          : undefined,
    },
  }));

  const payload: ArchitectureGraphDTO = {
    nodes,
    edges: GRAPH_EDGES.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      kind: e.kind as "runtime" | "audit",
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
  };
  return Response.json(payload);
}
