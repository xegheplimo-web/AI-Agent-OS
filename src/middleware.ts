import { NextResponse, type NextRequest } from "next/server";

/* ------------------------------------------------------------------ */
/* Auth gate for ALL API endpoints.                                    */
/*                                                                     */
/* Edge runtime cannot verify DB sessions, so it only enforces         */
/* presence of credentials (session cookie or service token);          */
/* handlers perform the real permission check.                         */
/*                                                                     */
/* Previously only MUTATING requests on a few prefixes were gated, so  */
/* GET /api/artifacts, /api/findings, /api/audit-logs, /api/events     */
/* were fully public — anyone could read audit findings, artifact      */
/* contents (SBOMs, runbooks, reconstruction bundles) and immutable    */
/* audit logs without any credentials. Now every /api/* path except    */
/* the explicit public allowlist requires credentials for ALL methods. */
/* ------------------------------------------------------------------ */

/* Public paths: health check, auth login/logout, and the SSE event
   stream (which sends the session cookie same-origin). */
const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  /* Only gate /api/* paths. */
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  /* Public allowlist — no credentials needed. */
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const hasSession = !!req.cookies.get("aos_session")?.value;
  const hasServiceToken = !!req.headers.get("x-service-token");

  if (!hasSession && !hasServiceToken) {
    return NextResponse.json(
      { error: "Authentication required — đăng nhập với quyền operator/admin", code: "AUTH_REQUIRED" },
      { status: 401 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
