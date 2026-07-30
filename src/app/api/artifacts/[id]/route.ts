import { eq } from "drizzle-orm";
import { db } from "@/db";
import { artifacts } from "@/db/schema";
import { serializeArtifact } from "@/lib/artifact-serializers";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  /* Full artifact content (SBOMs, runbooks, reconstruction bundles) requires
     artifact:download — viewer role cannot access, only operator+. */
  const auth = await requirePermission(req, "artifact:download");
  if (auth instanceof Response) return auth;

  const { id } = await ctx.params;
  const rows = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, Number(id)))
    .limit(1);
  if (!rows.length) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(serializeArtifact(rows[0], true));
}
