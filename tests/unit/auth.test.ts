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
