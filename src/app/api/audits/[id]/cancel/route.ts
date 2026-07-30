import { cancelAudit } from "@/services/audit";
import { getActor, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

/* POST /api/audits/[id]/cancel — cancel a running or waiting_approval audit.
   Frees the active-audit singleton slot so a new audit can start. Any pending
   approvals for the audit are expired and the active job is cancelled. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor(req);
  if (!hasPermission(actor, "approval:approve")) {
    await logAudit({ actor, action: "audit.cancel", resourceType: "audit", result: "denied", req });
    return Response.json({ error: "Cần quyền administrator (approval:approve) để cancel audit" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason : undefined;

  const result = await cancelAudit(id, actor!, reason);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true, id, status: "cancelled" });
}
