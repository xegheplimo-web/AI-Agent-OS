import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq, gt, and } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";

/* ------------------------------------------------------------------ */
/* Minimal built-in auth: scrypt passwords + DB-backed sessions.       */
/* Mutating endpoints resolve an Actor and check permissions.          */
/* ------------------------------------------------------------------ */

export type Role = "viewer" | "operator" | "administrator" | "auditor-service" | "worker-service";

export type Permission =
  | "system:read"
  | "audit:run"
  | "audit:cancel"
  | "finding:update"
  | "artifact:download"
  | "artifact:write"
  | "job:create"
  | "job:claim"
  | "settings:update"
  | "approval:approve";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  viewer: ["system:read"],
  operator: ["system:read", "audit:run", "finding:update", "artifact:download", "job:create"],
  administrator: [
    "system:read",
    "audit:run",
    "audit:cancel",
    "finding:update",
    "artifact:download",
    "job:create",
    "settings:update",
    "approval:approve",
  ],
  "auditor-service": ["system:read", "audit:run", "artifact:write", "job:create"],
  "worker-service": ["system:read", "job:claim", "artifact:write"],
};

export interface Actor {
  type: "user" | "service";
  id: string;
  displayName: string;
  role: Role;
  permissions: Permission[];
}

export const SESSION_COOKIE = "aos_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

/* ---------------- password hashing ---------------- */

/** Constant-time string comparison to prevent timing oracle attacks on
 *  service tokens. Falls back to length check + timingSafeEqual on the
 *  raw bytes, matching the pattern used for passwords and cookie sigs. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/** Password policy: min 10 chars, at least 1 letter and 1 digit. Used by
 *  seed.ts and any future user-creation endpoint. Returns null if valid,
 *  or an error message string. */
export function validatePasswordPolicy(password: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters";
  if (!/[a-zA-Z]/.test(password)) return "Password must contain at least one letter";
  if (!/\d/.test(password)) return "Password must contain at least one digit";
  return null;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/* ---------------- sessions ---------------- */
function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/* ------------------------------------------------------------------ */
/* Cookie signing with SESSION_SECRET.                                 */
/*                                                                     */
/* The DB lookup already authenticates the token, but signing lets us  */
/* reject tampered/foreign cookies before touching PostgreSQL — cheap  */
/* protection against session-table probing.                           */
/* ------------------------------------------------------------------ */
let warnedAboutSecret = false;

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;

  /* Hard requirement in production: an unset secret there means cookies are
     signed with a value an attacker could guess. */
  if (process.env.APP_MODE === "production" && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET (min 16 chars) is required when APP_MODE=production");
  }

  /* Dev/demo: derive a stable per-installation secret instead of failing the
     whole login flow. Deterministic so sessions survive a restart. */
  if (!warnedAboutSecret) {
    console.warn(
      "[auth] SESSION_SECRET is unset — using a derived development secret. Set it before any real deployment.",
    );
    warnedAboutSecret = true;
  }
  return createHash("sha256")
    .update(`aos-dev-session::${process.env.DATABASE_URL ?? "no-db"}`)
    .digest("hex");
}

function signToken(token: string): string {
  return createHmac("sha256", sessionSecret()).update(token).digest("base64url").slice(0, 32);
}

/** cookie value = `<token>.<hmac>` */
function packToken(token: string): string {
  return `${token}.${signToken(token)}`;
}

function unpackToken(cookieValue: string): string | null {
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0) return null;
  const token = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  let expected: string;
  try {
    expected = signToken(token);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return token;
}

export async function createSession(username: string, role: Role): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    username,
    role,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return packToken(token);
}

export async function destroySession(cookieValue: string): Promise<void> {
  const token = unpackToken(cookieValue) ?? cookieValue;
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/* ---------------- actor resolution ---------------- */
export async function getActor(req: Request): Promise<Actor | null> {
  /* --------------------------------------------------------------
   * Service-to-service. Each service has its OWN token and the role
   * is derived from which token matched — never from a client-supplied
   * `x-service-name` header (that would let any token holder escalate).
   * -------------------------------------------------------------- */
  const serviceToken = req.headers.get("x-service-token");
  if (serviceToken) {
    const tokenRoles: Array<[string | undefined, Role, string]> = [
      [process.env.AUDITOR_SERVICE_TOKEN, "auditor-service", "auditor-service"],
      [process.env.WORKER_SERVICE_TOKEN, "worker-service", "worker-service"],
      // legacy single shared token — kept for local dev, lowest privilege
      [process.env.API_INTERNAL_TOKEN, "worker-service", "internal-service"],
    ];
    for (const [expected, role, id] of tokenRoles) {
      if (expected && expected.length >= 16 && safeEqual(serviceToken, expected)) {
        return { type: "service", id, displayName: id, role, permissions: ROLE_PERMISSIONS[role] };
      }
    }
    return null;
  }

  const cookieValue = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!cookieValue) return null;

  /* reject tampered cookies before hitting the database */
  const token = unpackToken(cookieValue);
  if (!token) return null;

  const rows = await db
    .select({
      username: sessions.username,
      role: sessions.role,
      displayName: users.displayName,
      userRole: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.username, sessions.username))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!rows.length) return null;
  const role = rows[0].userRole as Role;
  return {
    type: "user",
    id: rows[0].username,
    displayName: rows[0].displayName,
    role,
    permissions: ROLE_PERMISSIONS[role] ?? [],
  };
}

export function hasPermission(actor: Actor | null, permission: Permission): boolean {
  return !!actor && actor.permissions.includes(permission);
}

/** Resolve the actor from the request and require a permission.
 *
 *  The Edge middleware only checks credential PRESENCE (it cannot verify DB
 *  sessions at Edge runtime). This helper does the real validation at the
 *  Node runtime: it calls `getActor` (which validates the session token or
 *  service token against the database) and checks the required permission.
 *
 *  Returns the Actor on success, or a Response (401/403) to send immediately.
 *  Usage:
 *    ```
 *    const auth = await requirePermission(req, "system:read");
 *    if (auth instanceof Response) return auth;
 *    // auth is Actor here
 *    ```
 */
export async function requirePermission(req: Request, permission: Permission): Promise<Actor | Response> {
  const actor = await getActor(req);
  if (!actor) {
    return Response.json(
      { error: "Authentication required — đăng nhập với quyền hợp lệ", code: "AUTH_REQUIRED" },
      { status: 401 },
    );
  }
  if (!hasPermission(actor, permission)) {
    return Response.json(
      { error: `Insufficient permissions — cần quyền ${permission}`, code: "FORBIDDEN" },
      { status: 403 },
    );
  }
  return actor;
}

export function getPermissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/* Parse an IPv4 address into a 32-bit unsigned integer. Returns null for
   invalid addresses. */
function parseIpv4(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    result = (result << 8) | octet;
  }
  return result >>> 0; /* unsigned */
}

/* Check if an IP is within a CIDR range (e.g. "10.0.0.0/8").
   Rejects invalid prefix lengths (>32). */
function ipInCidr(ip: string, cidr: string): boolean {
  const slashIdx = cidr.indexOf("/");
  const cidrIp = slashIdx >= 0 ? cidr.slice(0, slashIdx) : cidr;
  const prefixLen = slashIdx >= 0 ? Number.parseInt(cidr.slice(slashIdx + 1), 10) : 32;
  if (prefixLen < 0 || prefixLen > 32) return false; /* reject /33 etc */
  const ipInt = parseIpv4(ip);
  const cidrInt = parseIpv4(cidrIp);
  if (ipInt === null || cidrInt === null) return false;
  if (prefixLen === 0) return true;
  const mask = prefixLen >= 32 ? 0xffffffff : (0xffffffff << (32 - prefixLen)) >>> 0;
  return (ipInt & mask) === (cidrInt & mask);
}

/* Validate that a CIDR string is well-formed (e.g. "10.0.0.0/8"). */
function isValidCidr(cidr: string): boolean {
  const slashIdx = cidr.indexOf("/");
  const ip = slashIdx >= 0 ? cidr.slice(0, slashIdx) : cidr;
  const prefix = slashIdx >= 0 ? Number.parseInt(cidr.slice(slashIdx + 1), 10) : 32;
  return parseIpv4(ip) !== null && prefix >= 0 && prefix <= 32;
}

export function clientIp(req: Request): string | null {
  /* SECURITY MODEL — read carefully before changing this function.

     Next.js App Router exposes a Web API `Request` object which does NOT
     provide access to the underlying TCP socket peer address. This means
     the application CANNOT directly verify which IP connected to it.

     The security model relies on the REVERSE PROXY (nginx/Caddy) to:
       1. Set `x-forwarded-for` from the actual TCP socket remote address.
       2. OVERWRITE (not append to) any client-supplied `x-forwarded-for`
          and `x-real-ip` headers — so a direct client cannot forge them.
       3. Be the only path to the application (firewall blocks direct access).

     `TRUSTED_PROXY_CIDR` is a comma-separated list of CIDR ranges. When set,
     the application trusts `x-forwarded-for` from requests where the
     `x-real-ip` header (set by the proxy from the socket) falls within the
     configured CIDR range. This is a HEADER-BASED check, not a socket-level
     check — it relies on the proxy overwriting `x-real-ip`.

     IMPORTANT LIMITATION: If a direct client can reach the application
     (bypassing the proxy) AND can set `x-real-ip` to an IP within the
     trusted CIDR, they can forge `x-forwarded-for` to bypass rate limiting.
     Mitigation: ensure the application port is NOT exposed outside the
     proxy network (use firewall rules, Docker network isolation, or bind
     to 127.0.0.1 only).

     When TRUSTED_PROXY_CIDR is unset, NO proxy headers are trusted. All
     direct clients share a single "unknown" rate-limit bucket — safe (no
     bypass possible) but coarse-grained.

     NOTE: This in-memory rate limiter is per-instance and resets on restart.
     For multi-instance deployments, use a shared store (Redis) — see the
     `cache` profile in docker-compose.yml. */
  const trustedProxy = process.env.TRUSTED_PROXY_CIDR;
  if (!trustedProxy) {
    /* No trusted proxy configured — do not trust any client-supplied header. */
    return null;
  }

  /* Validate the CIDR configuration — if it's malformed, fail safe (trust
     nothing) rather than silently treating it as "trust everything". */
  const cidrs = trustedProxy.split(",").map((c) => c.trim()).filter(Boolean);
  if (cidrs.length === 0 || !cidrs.every(isValidCidr)) {
    console.error("[auth] TRUSTED_PROXY_CIDR is malformed — failing safe (no headers trusted).");
    return null;
  }

  /* The reverse proxy sets x-real-ip from the TCP socket. We check it
     against the trusted CIDR. This is a HEADER check, not a socket check —
     see the security model comment above for the limitation. */
  const xRealIp = req.headers.get("x-real-ip");
  if (!xRealIp) {
    /* No x-real-ip header — either no proxy, or proxy didn't set it.
       Don't trust x-forwarded-for without proxy confirmation. */
    return null;
  }

  /* Validate the x-real-ip format before checking CIDR membership. */
  const realIp = xRealIp.trim();
  if (parseIpv4(realIp) === null) {
    /* Invalid IP format — don't trust it. */
    return null;
  }

  if (!cidrs.some((cidr) => ipInCidr(realIp, cidr))) {
    /* x-real-ip not in trusted CIDR — request didn't come through our proxy. */
    return null;
  }

  /* The proxy is trusted — take the original client IP from x-forwarded-for.
     The leftmost entry is the original client (the proxy appends to the end).
     Validate the extracted IP format before returning it. */
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const clientIp = xff.split(",")[0]?.trim();
    if (clientIp && parseIpv4(clientIp) !== null) {
      return clientIp;
    }
  }

  /* No valid x-forwarded-for — use x-real-ip as the client IP (the proxy
     set it from the socket, and we validated it's from a trusted source). */
  return realIp;
}
