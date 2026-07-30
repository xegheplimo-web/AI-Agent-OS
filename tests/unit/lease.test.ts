import { describe, expect, it, vi, beforeEach } from "vitest";

/* Mock the DB layer so the lease fence can be unit-tested without a live
   PostgreSQL. The fence issues two kinds of queries:
     - UPDATE jobs SET heartbeat_at ... WHERE id=? AND lease_token=? RETURNING id
     - SELECT lease_token FROM jobs WHERE id=? LIMIT 1
   We control both via the mock below to simulate "lease still owned" and
   "lease lost (token cleared / row gone)" scenarios. */

const updateReturning = vi.fn();
const selectLeaseToken = vi.fn();

vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: updateReturning,
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => selectLeaseToken(),
        }),
      }),
    }),
  },
}));

vi.mock("@/db/schema", () => ({
  jobs: {
    id: "id",
    leaseToken: "lease_token",
    heartbeatAt: "heartbeat_at",
    updatedAt: "updated_at",
  },
}));

import { createLeaseFence, LeaseLostError } from "@/services/lease";

beforeEach(() => {
  updateReturning.mockReset();
  selectLeaseToken.mockReset();
  vi.useFakeTimers();
});

describe("createLeaseFence — no-op when no lease token", () => {
  it("assert never throws and leaseLost is always false (demo / inline jobs)", async () => {
    const fence = createLeaseFence("job-1", null);
    expect(fence.leaseToken).toBeNull();
    expect(fence.leaseLost()).toBe(false);
    await expect(fence.assert()).resolves.toBeUndefined();
    fence.stop();
  });

  it("assert never throws when jobId is undefined", async () => {
    const fence = createLeaseFence(undefined, "tok");
    await expect(fence.assert()).resolves.toBeUndefined();
    fence.stop();
  });
});

describe("createLeaseFence — lease loss detection", () => {
  it("assert throws LeaseLostError when the DB row no longer holds our token", async () => {
    selectLeaseToken.mockResolvedValue([{ leaseToken: "someone-elses-token" }]);
    const fence = createLeaseFence("job-1", "our-token");
    await expect(fence.assert()).rejects.toBeInstanceOf(LeaseLostError);
    fence.stop();
  });

  it("assert throws LeaseLostError when the job row is gone", async () => {
    selectLeaseToken.mockResolvedValue([]);
    const fence = createLeaseFence("job-1", "our-token");
    await expect(fence.assert()).rejects.toBeInstanceOf(LeaseLostError);
    fence.stop();
  });

  it("assert resolves when the DB row still holds our token", async () => {
    selectLeaseToken.mockResolvedValue([{ leaseToken: "our-token" }]);
    const fence = createLeaseFence("job-1", "our-token");
    await expect(fence.assert()).resolves.toBeUndefined();
    fence.stop();
  });

  it("background heartbeat sets leaseLost when UPDATE matches 0 rows", async () => {
    updateReturning.mockResolvedValue([]); // requeue cleared the token
    const fence = createLeaseFence("job-1", "our-token");
    /* fire the 15s heartbeat interval */
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fence.leaseLost()).toBe(true);
    /* subsequent assert throws without even hitting the DB select */
    selectLeaseToken.mockResolvedValue([{ leaseToken: "our-token" }]);
    await expect(fence.assert()).rejects.toBeInstanceOf(LeaseLostError);
    fence.stop();
  });

  it("background heartbeat keeps lease when UPDATE returns our row", async () => {
    updateReturning.mockResolvedValue([{ id: "job-1" }]);
    const fence = createLeaseFence("job-1", "our-token");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fence.leaseLost()).toBe(false);
    fence.stop();
  });
});

describe("LeaseLostError", () => {
  it("is an Error with name LeaseLostError", () => {
    const e = new LeaseLostError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("LeaseLostError");
    expect(e.message).toContain("LEASE_LOST");
  });
});
