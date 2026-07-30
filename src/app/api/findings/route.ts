import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, findings } from "@/db/schema";
import { advanceIfDemo } from "@/services/audit";
import { getActor, hasPermission, requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit-log";
import { findingDtoSchema, patchFindingSchema, type FindingDTO } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requirePermission(req, "system:read");
  if (auth instanceof Response) return auth;

  await advanceIfDemo();

  const url = new URL(req.url);
  const severity = url.searchParams.get("severity");
  const status = url.searchParams.get("status");
  const component = url.searchParams.get("component");
  const q = url.searchParams.get("q");

  const conditions = [];
  if (severity && severity !== "all") conditions.push(eq(findings.severity, severity));
  if (status && status !== "all") conditions.push(eq(findings.status, status));
  if (component && component !== "all") conditions.push(eq(findings.component, component));
  if (q) {
    conditions.push(
      or(ilike(findings.title, `%${q}%`), ilike(findings.description, `%${q}%`), ilike(findings.component, `%${q}%`)),
    );
  }

  const rows = await db
    .select()
    .from(findings)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      desc(
        sql`case ${findings.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`,
      ),
      desc(findings.createdAt),
    )
    .limit(120);

  const payload: FindingDTO[] = rows.map((f) =>
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

  return Response.json(payload);
}

export async function PATCH(req: Request) {
  const actor = await getActor(req);
  if (!hasPermission(actor, "finding:update")) {
    await logAudit({ actor, action: "finding.update", resourceType: "finding", result: "denied", req });
    return Response.json({ error: "Cần quyền operator (finding:update)" }, { status: actor ? 403 : 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchFindingSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid payload" }, { status: 400 });

  const [updated] = await db
    .update(findings)
    .set({ status: parsed.data.status })
    .where(eq(findings.id, parsed.data.id))
    .returning();
  if (!updated) return Response.json({ error: "Not found" }, { status: 404 });

  await logAudit({
    actor,
    action: "finding.update",
    resourceType: "finding",
    resourceId: String(updated.id),
    req,
    detail: { status: parsed.data.status, title: updated.title },
  });

  if (parsed.data.status === "resolved") {
    await db.insert(events).values({
      type: "finding.resolved",
      severity: "success",
      source: actor?.id ?? "operator",
      message: `Finding #${updated.id} resolved: ${updated.title}`,
    });
  }

  return Response.json({ ok: true, id: updated.id, status: updated.status });
}
