import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

/* Application identity. The desktop shell checks these fields before it
   attaches to an already-listening port — otherwise it could adopt some
   unrelated Next.js dev server that happens to own :3000. */
export const APP_IDENTITY = "ai-agent-os-control-plane";
export const PROTOCOL_VERSION = 1;

export async function GET() {
  const started = Date.now();
  let database: "up" | "down" = "up";
  let schemaReady = false;

  try {
    await db.execute(sql`select 1`);
    const t = await db.execute(
      sql`select count(*)::int as n from information_schema.tables
          where table_schema='public' and table_name in ('audits','jobs','components')`,
    );
    const rows = (t as unknown as { rows: Array<{ n: number }> }).rows ?? [];
    schemaReady = (rows[0]?.n ?? 0) === 3;
  } catch {
    database = "down";
  }

  const ok = database === "up" && schemaReady;

  return Response.json(
    {
      ok,
      app: APP_IDENTITY,
      protocol: PROTOCOL_VERSION,
      mode: process.env.APP_MODE ?? "demo",
      database,
      schemaReady,
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
