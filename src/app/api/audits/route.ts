import { desc, eq, and, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { audits } from "@/db/schema";
import { advanceIfDemo, serializeAudit } from "@/services/audit";
import { type AuditDTO } from "@/lib/contracts";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requirePermission(req, "system:read");
  if (auth instanceof Response) return auth;

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
