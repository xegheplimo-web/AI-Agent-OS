import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { clientIp, type Actor } from "@/lib/auth";

/* ------------------------------------------------------------------ */
/* Immutable audit trail — every state-changing action writes a row.   */
/* ------------------------------------------------------------------ */

export async function logAudit(params: {
  actor: Actor | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  result?: "success" | "denied" | "error";
  req?: Request;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorType: params.actor?.type ?? "system",
      actorId: params.actor?.id ?? "anonymous",
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      requestId: randomUUID(),
      result: params.result ?? "success",
      ipAddress: params.req ? clientIp(params.req) : null,
      detail: params.detail ?? {},
    });
  } catch (err) {
    // audit log must never break the request path
    console.error("[audit-log] failed to write:", err);
  }
}
