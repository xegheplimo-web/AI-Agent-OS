import { getActor, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit-log";
import { runAuditRequestSchema } from "@/lib/contracts";
import { advanceIfDemo, startAudit } from "@/services/audit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  /* settle finished audits before the conflict check (no stale lock) */
  await advanceIfDemo();
  const actor = await getActor(req);
  if (!hasPermission(actor, "audit:run")) {
    await logAudit({ actor, action: "audit.run", resourceType: "audit", result: "denied", req });
    return Response.json(
      { error: "Cần đăng nhập với quyền operator/admin để chạy audit", code: "AUTH_REQUIRED" },
      { status: actor ? 403 : 401 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = runAuditRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await startAudit(parsed.data, actor);

  if (result.kind === "conflict") {
    return Response.json(
      { error: "An audit is already running", auditId: result.auditId, code: "AUDIT_RUNNING" },
      { status: 409 },
    );
  }

  if (result.kind === "waiting_approval") {
    return Response.json(
      {
        approvalRequired: true,
        approvalId: result.approvalId,
        audit: result.audit,
        message: "Audit production cần administrator phê duyệt (human-in-the-loop)",
      },
      { status: 202 },
    );
  }

  return Response.json(
    { approvalRequired: false, audit: result.audit, replayed: result.replayed },
    { status: result.replayed ? 200 : 201 },
  );
}
