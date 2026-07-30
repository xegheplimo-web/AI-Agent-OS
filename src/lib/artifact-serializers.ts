import { artifacts } from "@/db/schema";
import type { ArtifactDTO } from "@/lib/types";

/* Artifact serializer extracted from the artifacts route module so the route
 * only exports Next.js-recognized symbols. Next.js generated-route types
 * reject arbitrary exports like `serializeArtifact`. */

export function serializeArtifact(
  a: typeof artifacts.$inferSelect,
  withContent = false,
): ArtifactDTO {
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
