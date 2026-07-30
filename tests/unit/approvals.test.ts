import { describe, expect, it, vi, beforeEach } from "vitest";

/* Mock the DB so decideApproval's transaction can be driven without a live
   PostgreSQL. The transaction callback receives a `tx` object; we record the
   approval row that the first UPDATE...RETURNING yields, then capture the
   revert UPDATE and any subsequent inserts to assert the self-approval path. */

const txUpdateReturning = vi.fn();
const txUpdate = vi.fn();
const txInsert = vi.fn();
const txUpdateSet = vi.fn();
const txUpdateWhere = vi.fn();

function makeTx() {
  /* tx.update(table).set({...}).where(...).returning(...) -> txUpdateReturning */
  const update = () => ({
    set: (vals: unknown) => {
      txUpdateSet(vals);
      return {
        where: () => {
          txUpdateWhere();
          return { returning: txUpdateReturning };
        },
      };
    },
  });
  return { update, insert: () => ({ values: txInsert }) };
}

const transactionImpl = vi.fn();

vi.mock("@/db", () => ({
  db: {
    transaction: (cb: (tx: unknown) => Promise<unknown>) => transactionImpl(cb),
    select: () => {
      return {
        from: () => {
          return {
            where: () => {
              return { limit: () => Promise.resolve([]) };
            },
          };
        },
      };
    },
  },
}));

vi.mock("@/db/schema", () => ({
  approvals: { id: "id", status: "status", requestedAt: "requested_at" },
  audits: { id: "id", status: "status" },
  jobs: { id: "id" },
  events: {},
}));

vi.mock("@/lib/audit-log", () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/mode", () => ({ isDemoMode: false }));

import { decideApproval } from "@/services/audit";

beforeEach(() => {
  txUpdateReturning.mockReset();
  txInsert.mockReset();
  txUpdateSet.mockReset();
  txUpdateWhere.mockReset();
  transactionImpl.mockReset();
});

function runTransaction(cb: (tx: unknown) => Promise<unknown>) {
  return cb(makeTx());
}

describe("decideApproval — self-approval is forbidden", () => {
  it("rejects when the approver is the same person who requested the approval", async () => {
    /* First UPDATE...RETURNING yields the pending approval requested by user-1. */
    txUpdateReturning.mockResolvedValue([
      {
        id: "apv-1",
        status: "approved",
        requestedBy: "user-1",
        requestedAt: new Date().toISOString(),
        actionType: "audit.run",
        targetId: "aud-1",
        title: "T",
      },
    ]);
    transactionImpl.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => runTransaction(cb));

    const res = await decideApproval("apv-1", "approved", { id: "user-1", displayName: "Same" } as never, "ok");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/own request/i);
  });

  it("allows a different person to approve", async () => {
    txUpdateReturning.mockResolvedValue([
      {
        id: "apv-1",
        status: "approved",
        requestedBy: "user-1",
        requestedAt: new Date().toISOString(),
        actionType: "audit.run",
        targetId: "aud-1",
        title: "T",
      },
    ]);
    transactionImpl.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => runTransaction(cb));

    const res = await decideApproval("apv-1", "approved", { id: "user-2", displayName: "Other" } as never);
    expect(res.ok).toBe(true);
  });

  it("allows system-initiated requests to be approved by anyone (no human pair needed)", async () => {
    txUpdateReturning.mockResolvedValue([
      {
        id: "apv-1",
        status: "approved",
        requestedBy: "system",
        requestedAt: new Date().toISOString(),
        actionType: "artifact.package",
        targetId: "aud-1",
        title: "T",
      },
    ]);
    transactionImpl.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => runTransaction(cb));

    /* Even if actor.id were "system", system requests are exempt. */
    const res = await decideApproval("apv-1", "approved", { id: "system", displayName: "system" } as never);
    expect(res.ok).toBe(true);
  });
});
