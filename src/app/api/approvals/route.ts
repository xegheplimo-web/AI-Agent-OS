import { desc } from "drizzle-orm";
import { db } from "@/db";
import { approvals } from "@/db/schema";
import { approvalDtoSchema, type ApprovalDTO } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  const rows = await db.select().from(approvals).orderBy(desc(approvals.requestedAt)).limit(30);
  const payload: ApprovalDTO[] = rows
    .filter((r) => !status || status === "all" || r.status === status)
    .map((r) =>
      approvalDtoSchema.parse({
        id: r.id,
        actionType: r.actionType,
        targetType: r.targetType,
        targetId: r.targetId,
        title: r.title,
        status: r.status,
        environment: r.environment,
        requestedBy: r.requestedBy,
        requestedAt: r.requestedAt.toISOString(),
        decidedBy: r.decidedBy,
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
        reason: r.reason,
      }),
    );
  return Response.json(payload);
}
