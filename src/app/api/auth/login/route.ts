import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, SESSION_COOKIE, verifyPassword, type Role } from "@/lib/auth";
import { logAudit } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

// @public-endpoint Authentication entry point — must be reachable while
// unauthenticated. Protected by credential verification + audit logging of
// every denied attempt instead of a permission check.

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid credentials payload" }, { status: 400 });

  const rows = await db.select().from(users).where(eq(users.username, parsed.data.username)).limit(1);
  const user = rows[0];
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    await logAudit({
      actor: null,
      action: "auth.login",
      resourceType: "session",
      result: "denied",
      req,
      detail: { username: parsed.data.username },
    });
    return Response.json({ error: "Sai tài khoản hoặc mật khẩu" }, { status: 401 });
  }

  const token = await createSession(user.username, user.role as Role);
  await logAudit({
    actor: { type: "user", id: user.username, displayName: user.displayName, role: user.role as Role, permissions: [] },
    action: "auth.login",
    resourceType: "session",
    req,
  });

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
        "set-cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`,
      },
    },
  );
}
