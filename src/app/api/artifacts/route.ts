import { desc } from "drizzle-orm";
import { db } from "@/db";
import { artifacts } from "@/db/schema";
import type { ArtifactDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

function serialize(a: typeof artifacts.$inferSelect, withContent = false): ArtifactDTO {
  return {
    id: a.id,
    auditId: a.auditId,
    kind: a.kind,
    format: a.format,
    title: a.title,
    path: a.path,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    sizeKb: a.sizeKb ?? 0,
    sha256: a.sha256,
    generator: a.generator,
    generatorVersion: a.generatorVersion,
    schemaVersion: a.schemaVersion,
    tags: a.tags ?? [],
    updatedAt: a.updatedAt.toISOString(),
    ...(withContent ? { content: a.content } : {}),
  };
}

export async function GET() {
  const rows = await db.select().from(artifacts).orderBy(desc(artifacts.updatedAt)).limit(50);
  return Response.json(rows.map((a) => serialize(a)));
}

export { serialize as serializeArtifact };
