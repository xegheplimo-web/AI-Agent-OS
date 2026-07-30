import { advanceIfDemo } from "@/services/audit";
import { serializeAuditDetail } from "@/lib/audit-serializers";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, "system:read");
  if (auth instanceof Response) return auth;

  await advanceIfDemo();
  const { id } = await ctx.params;
  const detail = await serializeAuditDetail(id);
  if (!detail) return Response.json({ error: "Audit not found" }, { status: 404 });
  return Response.json(detail);
}
