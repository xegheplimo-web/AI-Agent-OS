import { NextResponse, type NextRequest } from "next/server";

/* ------------------------------------------------------------------ */
/* Fast gate for mutating endpoints. Edge runtime cannot verify DB     */
/* sessions, so it only enforces presence of credentials; handlers     */
/* perform the real permission check.                                  */
/* ------------------------------------------------------------------ */

const PROTECTED_PREFIXES = [
  "/api/audits/run",
  "/api/findings",
  "/api/jobs",
  "/api/settings",
  "/api/approvals",
];

const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!MUTATING.has(req.method)) return NextResponse.next();
  if (!PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

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
  matcher: ["/api/audits/run", "/api/findings", "/api/jobs", "/api/settings", "/api/approvals/:path*"],
};
