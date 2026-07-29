import { destroySession, getActor, SESSION_COOKIE } from "@/lib/auth";
import { logAudit } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

// @public-endpoint Session teardown — safe for anonymous callers; it can only
// ever destroy the caller's own cookie-bound session.

export async function POST(req: Request) {
  const actor = await getActor(req);
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${SESSION_COOKIE}=`));
  if (match) {
    await destroySession(decodeURIComponent(match.split("=").slice(1).join("=")));
  }
  if (actor) {
    await logAudit({ actor, action: "auth.logout", resourceType: "session", req });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    },
  });
}
