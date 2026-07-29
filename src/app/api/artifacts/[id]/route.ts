import { eq } from "drizzle-orm";
import { db } from "@/db";
import { artifacts } from "@/db/schema";
import { serializeArtifact } from "../route";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rows = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, Number(id)))
    .limit(1);
  if (!rows.length) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(serializeArtifact(rows[0], true));
}
