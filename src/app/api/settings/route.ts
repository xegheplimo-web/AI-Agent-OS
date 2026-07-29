import { db } from "@/db";
import { settings } from "@/db/schema";
import {
  NOTIFICATIONS_DEFAULT,
  PRODUCTION_RULES_DEFAULT,
  WORKSPACE_DEFAULT,
} from "@/lib/audit-data";
import { getActor, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit-log";
import type { SettingsDTO } from "@/lib/types";
import { z } from "zod";

export const dynamic = "force-dynamic";

async function readAll(): Promise<SettingsDTO> {
  const rows = await db.select().from(settings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    production_rules: (map.get("production_rules") as SettingsDTO["production_rules"]) ?? PRODUCTION_RULES_DEFAULT,
    workspace: { ...WORKSPACE_DEFAULT, ...((map.get("workspace") as object) ?? {}) } as SettingsDTO["workspace"],
    notifications: { ...NOTIFICATIONS_DEFAULT, ...((map.get("notifications") as object) ?? {}) } as SettingsDTO["notifications"],
  };
}

export async function GET() {
  return Response.json(await readAll());
}

const putSchema = z.discriminatedUnion("section", [
  z.object({
    section: z.literal("production_rules"),
    value: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        icon: z.string(),
        tone: z.string(),
        enabled: z.boolean(),
      }),
    ),
  }),
  z.object({
    section: z.literal("workspace"),
    value: z.object({
      refreshIntervalMs: z.number().min(1000).max(60000),
      animationsEnabled: z.boolean(),
      clockFormat: z.enum(["utc", "local"]),
      sidebarCompact: z.boolean(),
    }),
  }),
  z.object({
    section: z.literal("notifications"),
    value: z.object({
      auditCompleted: z.boolean(),
      findingCritical: z.boolean(),
      parityWarning: z.boolean(),
    }),
  }),
]);

export async function PUT(req: Request) {
  const actor = await getActor(req);
  if (!hasPermission(actor, "settings:update")) {
    await logAudit({ actor, action: "settings.update", resourceType: "settings", result: "denied", req });
    return Response.json({ error: "Cần quyền administrator (settings:update)" }, { status: actor ? 403 : 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid payload" }, { status: 400 });

  const { section, value } = parsed.data;
  await db
    .insert(settings)
    .values({ key: section, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });

  await logAudit({
    actor,
    action: "settings.update",
    resourceType: "settings",
    resourceId: section,
    req,
    detail: { section },
  });

  return Response.json({ ok: true, section });
}
