import { advanceIfDemo } from "@/services/audit";
import { serializeAuditDetail } from "../route";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await advanceIfDemo();
  const { id } = await ctx.params;
  const detail = await serializeAuditDetail(id);
  if (!detail) return Response.json({ error: "Audit not found" }, { status: 404 });
  return Response.json(detail);
}
