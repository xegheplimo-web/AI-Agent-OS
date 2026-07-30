import { desc } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { auditLogDtoSchema, type AuditLogDTO } from "@/lib/contracts";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requirePermission(req, "system:read");
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const limit = Math.min(60, Number(url.searchParams.get("limit") ?? 20));

  const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
  const payload: AuditLogDTO[] = rows.map((r) =>
    auditLogDtoSchema.parse({
      id: r.id,
      actorType: r.actorType,
      actorId: r.actorId,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      result: r.result,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt.toISOString(),
    }),
  );
  return Response.json(payload);
}
