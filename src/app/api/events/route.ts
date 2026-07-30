import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { ensureEventFreshIfDemo } from "@/services/audit";
import { eventDtoSchema, type EventDTO } from "@/lib/contracts";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requirePermission(req, "system:read");
  if (auth instanceof Response) return auth;

  await ensureEventFreshIfDemo();
  const url = new URL(req.url);
  const limit = Math.min(60, Number(url.searchParams.get("limit") ?? 24));
  const source = url.searchParams.get("source");

  const rows = await db
    .select()
    .from(events)
    .where(source ? eq(events.source, source) : undefined)
    .orderBy(desc(events.createdAt))
    .limit(limit);

  const payload: EventDTO[] = rows.map((e) =>
    eventDtoSchema.parse({
      id: e.id,
      type: e.type,
      severity: e.severity,
      source: e.source,
      message: e.message,
      createdAt: e.createdAt.toISOString(),
    }),
  );
  return Response.json(payload);
}
