import { describe, expect, it } from "vitest";
import {
  auditDtoSchema,
  decideApprovalSchema,
  eventEnvelopeSchema,
  runAuditRequestSchema,
} from "@/lib/contracts";

describe("runAuditRequestSchema", () => {
  it("applies defaults", () => {
    const parsed = runAuditRequestSchema.parse({});
    expect(parsed.environment).toBe("production");
    expect(parsed.scope).toEqual([]);
  });

  it("rejects unknown environment", () => {
    expect(runAuditRequestSchema.safeParse({ environment: "moon" }).success).toBe(false);
  });

  it("rejects short idempotency keys", () => {
    expect(runAuditRequestSchema.safeParse({ idempotencyKey: "abc" }).success).toBe(false);
  });
});

describe("auditDtoSchema", () => {
  it("accepts a valid audit DTO including waiting_approval", () => {
    const parsed = auditDtoSchema.parse({
      id: "11111111-2222-4333-8444-555555555555",
      name: "AUD-20260730-001",
      triggerType: "manual",
      status: "waiting_approval",
      score: null,
      stages: [
        { key: "discovery", label: "Discovery", status: "pending", artifacts: [], detail: "x" },
      ],
      artifactNames: [],
      findingsCount: null,
      environment: "production",
      scope: [],
      requestedBy: "operator.han",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: null,
    });
    expect(parsed.status).toBe("waiting_approval");
  });

  it("rejects invalid status at runtime (prevents silent casts)", () => {
    const bad = auditDtoSchema.safeParse({
      id: "11111111-2222-4333-8444-555555555555",
      name: "x",
      triggerType: "manual",
      status: "exploded",
      score: null,
      stages: [],
      artifactNames: [],
      findingsCount: null,
      environment: "production",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: null,
    });
    expect(bad.success).toBe(false);
  });
});

describe("decideApprovalSchema", () => {
  it("requires a valid decision", () => {
    expect(decideApprovalSchema.safeParse({ decision: "maybe" }).success).toBe(false);
    expect(decideApprovalSchema.safeParse({ decision: "approved" }).success).toBe(true);
  });
});

describe("eventEnvelopeSchema", () => {
  it("accepts SSE/bus envelopes", () => {
    const env = eventEnvelopeSchema.parse({
      id: "evt_1",
      type: "audit.stage.progress",
      correlationId: "aud_1",
      timestamp: new Date().toISOString(),
      payload: { stage: "discovery", progress: 64 },
    });
    expect(env.payload.progress).toBe(64);
  });
});
