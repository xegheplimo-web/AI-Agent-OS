import { describe, expect, it } from "vitest";
import { getPermissionsForRole, hashPassword, verifyPassword } from "@/lib/auth";

describe("password hashing (scrypt)", () => {
  it("round-trips a password", () => {
    const stored = hashPassword("AgentOS#admin");
    expect(verifyPassword("AgentOS#admin", stored)).toBe(true);
  });

  it("rejects wrong passwords", () => {
    const stored = hashPassword("AgentOS#admin");
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("produces unique salts", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("rejects malformed stored hashes safely", () => {
    expect(verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

describe("role permissions", () => {
  it("viewer is read-only", () => {
    expect(getPermissionsForRole("viewer")).toEqual(["system:read"]);
  });

  it("operator can run audits and update findings", () => {
    const perms = getPermissionsForRole("operator");
    expect(perms).toContain("audit:run");
    expect(perms).toContain("finding:update");
    expect(perms).not.toContain("approval:approve");
  });

  it("administrator is a superset of operator", () => {
    const ops = getPermissionsForRole("operator");
    const admin = getPermissionsForRole("administrator");
    for (const p of ops) expect(admin).toContain(p);
    expect(admin).toContain("approval:approve");
    expect(admin).toContain("settings:update");
  });

  it("worker-service can only claim jobs and write artifacts", () => {
    const perms = getPermissionsForRole("worker-service");
    expect(perms).toContain("job:claim");
    expect(perms).not.toContain("audit:run");
  });
});

describe("session cookie signing (SESSION_SECRET)", () => {
  it("rejects a tampered cookie without touching the database", async () => {
    const { getActor } = await import("@/lib/auth");
    const req = new Request("http://x", {
      headers: { cookie: "aos_session=deadbeef.invalidsignature" },
    });
    expect(await getActor(req)).toBeNull();
  });

  it("rejects an unsigned raw token", async () => {
    const { getActor } = await import("@/lib/auth");
    const req = new Request("http://x", { headers: { cookie: "aos_session=rawtokenwithoutsignature" } });
    expect(await getActor(req)).toBeNull();
  });

  it("derives a role from the matching service token, not from a client header", async () => {
    const { getActor } = await import("@/lib/auth");
    process.env.WORKER_SERVICE_TOKEN = "worker-token-abcdefghijklmnop";
    const req = new Request("http://x", {
      headers: {
        "x-service-token": "worker-token-abcdefghijklmnop",
        "x-service-name": "administrator", // spoof attempt
      },
    });
    const actor = await getActor(req);
    expect(actor?.role).toBe("worker-service");
    expect(actor?.permissions).not.toContain("approval:approve");
  });
});

describe("requirePermission (handler-level auth)", () => {
  it("returns 401 for a request with no credentials", async () => {
    const { requirePermission } = await import("@/lib/auth");
    const req = new Request("http://x");
    const result = await requirePermission(req, "system:read");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("returns 401 for a request with a fake cookie (presence-only bypass)", async () => {
    /* This is the core regression: the Edge middleware checks only that a
       cookie EXISTS, not that it's valid. A fake cookie like
       "aos_session=fake-token" passes the middleware but requirePermission
       calls getActor, which validates the signature and DB session. */
    const { requirePermission } = await import("@/lib/auth");
    const req = new Request("http://x", {
      headers: { cookie: "aos_session=fake-token-that-passes-middleware" },
    });
    const result = await requirePermission(req, "system:read");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("returns 401 for a request with a fake service token", async () => {
    const { requirePermission } = await import("@/lib/auth");
    const req = new Request("http://x", {
      headers: { "x-service-token": "not-a-real-token-1234567890" },
    });
    const result = await requirePermission(req, "system:read");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("returns 403 when the actor lacks the required permission", async () => {
    const { requirePermission } = await import("@/lib/auth");
    /* worker-service has system:read but NOT approval:approve */
    process.env.WORKER_SERVICE_TOKEN = "worker-token-abcdefghijklmnop";
    const req = new Request("http://x", {
      headers: { "x-service-token": "worker-token-abcdefghijklmnop" },
    });
    const result = await requirePermission(req, "approval:approve");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it("returns the Actor when the actor has the required permission", async () => {
    const { requirePermission } = await import("@/lib/auth");
    process.env.WORKER_SERVICE_TOKEN = "worker-token-abcdefghijklmnop";
    const req = new Request("http://x", {
      headers: { "x-service-token": "worker-token-abcdefghijklmnop" },
    });
    const result = await requirePermission(req, "system:read");
    expect(result).not.toBeInstanceOf(Response);
    expect((result as { id: string }).id).toBe("worker-service");
  });
});
