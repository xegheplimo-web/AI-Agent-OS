import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { audits, findings } from "@/db/schema";
import { serializeAudit } from "@/services/audit";
import { findingDtoSchema, type FindingDTO } from "@/lib/contracts";

/* Detail serializer extracted from the audits route module so the route
 * only exports Next.js-recognized symbols. Next.js generated-route types
 * reject arbitrary exports like `serializeAuditDetail`. */

export async function serializeAuditDetail(id: string) {
  const rows = await db.select().from(audits).where(eq(audits.id, id)).limit(1);
  if (!rows.length) return null;
  const findingRows = await db
    .select()
    .from(findings)
    .where(eq(findings.auditId, id))
    .orderBy(desc(findings.createdAt));
  const findingDTOs: FindingDTO[] = findingRows.map((f) =>
    findingDtoSchema.parse({
      id: f.id,
      auditId: f.auditId,
      severity: f.severity,
      category: f.category,
      component: f.component,
      title: f.title,
      description: f.description,
      evidence: f.evidence,
      status: f.status,
      createdAt: f.createdAt.toISOString(),
    }),
  );
  return { audit: serializeAudit(rows[0]), findings: findingDTOs };
}
