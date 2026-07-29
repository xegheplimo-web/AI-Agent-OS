import { desc, eq, and, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { audits, findings } from "@/db/schema";
import { advanceIfDemo, serializeAudit } from "@/services/audit";
import { findingDtoSchema, type AuditDTO, type FindingDTO } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await advanceIfDemo();

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const status = url.searchParams.get("status");
  const environment = url.searchParams.get("environment");

  const conditions = [];
  if (from) conditions.push(gte(audits.startedAt, new Date(from)));
  if (to) conditions.push(lte(audits.startedAt, new Date(to)));
  if (status) conditions.push(eq(audits.status, status));
  if (environment && environment !== "all") conditions.push(eq(audits.environment, environment));

  const rows = await db
    .select()
    .from(audits)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(audits.startedAt))
    .limit(25);

  return Response.json(rows.map(serializeAudit) satisfies AuditDTO[]);
}

/* detail serializer used by /[id] route */
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
