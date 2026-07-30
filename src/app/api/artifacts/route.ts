import { desc } from "drizzle-orm";
import { db } from "@/db";
import { artifacts } from "@/db/schema";
import { serializeArtifact } from "@/lib/artifact-serializers";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requirePermission(req, "system:read");
  if (auth instanceof Response) return auth;

  const rows = await db.select().from(artifacts).orderBy(desc(artifacts.updatedAt)).limit(50);
  return Response.json(rows.map((a) => serializeArtifact(a)));
}
