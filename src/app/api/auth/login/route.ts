import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, SESSION_COOKIE, verifyPassword, clientIp, type Role } from "@/lib/auth";
import { logAudit } from "@/lib/audit-log";
import { isLockedOut, lockoutRemainingSec, recordFailedLogin, recordSuccessfulLogin } from "@/lib/rate-limit";
import { isDemoMode } from "@/services/mode";

export const dynamic = "force-dynamic";

// @public-endpoint Authentication entry point — must be reachable while
// unauthenticated. Protected by credential verification + rate limiting +
// audit logging of every denied attempt instead of a permission check.

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid credentials payload" }, { status: 400 });

  const ip = clientIp(req) ?? "unknown";
  const username = parsed.data.username;

  /* Rate limit: lock out after 5 failed attempts within 15 min. */
  if (isLockedOut(username, ip)) {
    const remaining = lockoutRemainingSec(username, ip);
    await logAudit({
      actor: null,
      action: "auth.login",
      resourceType: "session",
      result: "denied",
      req,
      detail: { username, reason: "rate_limited", lockoutSec: remaining },
    });
    return Response.json(
      { error: `Tài khoản tạm khóa do nhiều lần sai liên tiếp. Thử lại sau ${remaining} giây.` },
      { status: 429 },
    );
  }

  const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
  const user = rows[0];
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    recordFailedLogin(username, ip);
    await logAudit({
      actor: null,
      action: "auth.login",
      resourceType: "session",
      result: "denied",
      req,
      detail: { username },
    });
    return Response.json({ error: "Sai tài khoản hoặc mật khẩu" }, { status: 401 });
  }

  recordSuccessfulLogin(username, ip);
  const token = await createSession(user.username, user.role as Role);
  await logAudit({
    actor: { type: "user", id: user.username, displayName: user.displayName, role: user.role as Role, permissions: [] },
    action: "auth.login",
    resourceType: "session",
    req,
  });

  /* Cookie flags:
     - HttpOnly: JS cannot read the cookie (XSS defense)
     - SameSite=Lax: CSRF defense (cross-site POST won't send the cookie)
     - Secure: only sent over HTTPS — required in production
     - Max-Age: 7 days */
  const isProduction = !isDemoMode && process.env.NODE_ENV === "production";
  const secureFlag = isProduction ? "; Secure" : "";
  return new Response(
    JSON.stringify({
      user: {
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Max-Age=${60 * 60 * 24 * 7}`,
      },
    },
  );
}
