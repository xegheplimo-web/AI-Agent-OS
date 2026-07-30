import { sql } from "drizzle-orm";
import { db } from "@/db";
import { APP_IDENTITY, PROTOCOL_VERSION } from "@/lib/app-identity";

export const dynamic = "force-dynamic";

/* Public health endpoint — no authentication required (in PUBLIC_PATHS).
 *
 * Returns a MINIMAL response: only `ok`, `app`, `protocol`, `timestamp`.
 * The DB is still checked internally to determine `ok`, but the details
 * (database status, schema readiness, mode, latency) are NOT exposed —
 * those are available via the authenticated /api/system/health endpoint.
 *
 * Docker Compose, CI smoke tests, and the Tauri desktop shell all call
 * this endpoint without credentials. */
export async function GET() {
  let ok = false;
  try {
    await db.execute(sql`select 1`);
    const t = await db.execute(
      sql`select count(*)::int as n from information_schema.tables
          where table_schema='public' and table_name in ('audits','jobs','components')`,
    );
    const rows = (t as unknown as { rows: Array<{ n: number }> }).rows ?? [];
    ok = (rows[0]?.n ?? 0) === 3;
  } catch {
    ok = false;
  }

  return Response.json(
    {
      ok,
      app: APP_IDENTITY,
      protocol: PROTOCOL_VERSION,
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
