import { decideApproval } from "@/services/audit";
import { getActor, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit-log";
import { decideApprovalSchema } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor(req);
  if (!hasPermission(actor, "approval:approve")) {
    await logAudit({ actor, action: "approval.decide", resourceType: "approval", result: "denied", req });
    return Response.json({ error: "Cần quyền administrator (approval:approve)" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = decideApprovalSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid payload" }, { status: 400 });

  const { id } = await ctx.params;
  const result = await decideApproval(id, parsed.data.decision, actor!, parsed.data.reason);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true, id, decision: parsed.data.decision });
}
