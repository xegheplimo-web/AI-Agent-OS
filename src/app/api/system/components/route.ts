import { db } from "@/db";
import { components } from "@/db/schema";
import { COMPONENT_DESCRIPTIONS } from "@/lib/audit-data";
import type { ComponentDTO } from "@/lib/types";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requirePermission(req, "system:read");
  if (auth instanceof Response) return auth;

  const rows = await db.select().from(components);
  const payload: ComponentDTO[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    group: r.group,
    status: r.status as ComponentDTO["status"],
    latencyMs: r.latencyMs,
    uptimePct: r.uptimePct ?? 99.9,
    version: r.version ?? "0.0.0",
    description: COMPONENT_DESCRIPTIONS[r.id] ?? "",
    position: r.position,
    metrics: (r.metrics ?? {}) as Record<string, string | number>,
  }));
  return Response.json(payload);
}
