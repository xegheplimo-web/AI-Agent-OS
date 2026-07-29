import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Shared contracts — single source of truth for API payloads.         */
/* Parsed (not cast) at the API boundary before serialization.         */
/* ------------------------------------------------------------------ */

export const environmentSchema = z.enum(["local", "development", "staging", "production"]);
export type Environment = z.infer<typeof environmentSchema>;

export const componentStatusSchema = z.enum(["healthy", "degraded", "offline", "readonly"]);

export const auditStatusSchema = z.enum([
  "queued",
  "waiting_approval",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const auditStageStatusSchema = z.enum(["pending", "active", "done", "failed"]);

export const auditStageSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: auditStageStatusSchema,
  startedAt: z.string().optional(),
  durationMs: z.number().optional(),
  artifacts: z.array(z.string()),
  detail: z.string().optional(),
});
export type AuditStageDTO = z.infer<typeof auditStageSchema>;
export type AuditStageStatus = z.infer<typeof auditStageStatusSchema>;

export const findingsCountSchema = z.object({
  critical: z.number(),
  high: z.number(),
  medium: z.number(),
  low: z.number(),
  info: z.number(),
});

export const auditDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  triggerType: z.string(),
  status: auditStatusSchema,
  score: z.number().nullable(),
  stages: z.array(auditStageSchema),
  artifactNames: z.array(z.string()),
  findingsCount: findingsCountSchema.nullable(),
  environment: z.string(),
  scope: z.array(z.string()).default([]),
  requestedBy: z.string().default("system"),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
});
export type AuditDTO = z.infer<typeof auditDtoSchema>;

/* ---- run audit request ---- */
export const runAuditRequestSchema = z.object({
  environment: environmentSchema.default("production"),
  scope: z.array(z.string().min(1)).max(20).default([]),
  idempotencyKey: z.string().min(8).max(96).optional(),
});
export type RunAuditRequest = z.infer<typeof runAuditRequestSchema>;

export const runAuditResponseSchema = z.discriminatedUnion("approvalRequired", [
  z.object({
    approvalRequired: z.literal(true),
    approvalId: z.string().uuid(),
    message: z.string(),
  }),
  z.object({
    approvalRequired: z.literal(false),
    audit: auditDtoSchema,
    replayed: z.boolean().default(false),
  }),
]);

/* ---- findings ---- */
export const findingSeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export const findingStatusSchema = z.enum(["open", "acknowledged", "resolved"]);

export const findingDtoSchema = z.object({
  id: z.number(),
  auditId: z.string().uuid().nullable(),
  severity: findingSeveritySchema,
  category: z.string(),
  component: z.string(),
  title: z.string(),
  description: z.string(),
  evidence: z.string(),
  status: findingStatusSchema,
  createdAt: z.string(),
});
export type FindingDTO = z.infer<typeof findingDtoSchema>;

export const patchFindingSchema = z.object({
  id: z.number(),
  status: findingStatusSchema,
});

/* ---- parity ---- */
export const parityCheckSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(["passed", "failed", "warning", "pending"]),
  baselineValue: z.string().optional(),
  currentValue: z.string().optional(),
  difference: z.string().optional(),
});
export type ParityCheckDTO = z.infer<typeof parityCheckSchema>;

export const parityReportDtoSchema = z.object({
  id: z.string().uuid(),
  overallStatus: z.enum(["passed", "warning", "failed"]),
  score: z.number(),
  environment: z.string().default("production"),
  checks: z.array(parityCheckSchema),
  gates: z.array(z.object({ key: z.string(), label: z.string(), status: z.string() })),
  createdAt: z.string(),
  history: z.array(
    z.object({ id: z.string(), score: z.number(), overallStatus: z.string(), createdAt: z.string() }),
  ),
  baselineDiff: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        before: z.string(),
        after: z.string(),
      }),
    )
    .default([]),
});
export type ParityReportDTO = z.infer<typeof parityReportDtoSchema>;

/* ---- jobs ---- */
export const jobDtoSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled", "timed_out"]),
  target: z.string(),
  progress: z.number(),
  attempt: z.number().default(0),
  maxAttempts: z.number().default(3),
  worker: z.string().nullable(),
  errorMessage: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type JobDTO = z.infer<typeof jobDtoSchema>;

export const createJobSchema = z.object({
  type: z.enum(["sbom.export", "parity.gate", "artifact.package", "knowledge.reindex"]),
  target: z.string().min(1).max(200),
});

/* ---- events ---- */
export const eventDtoSchema = z.object({
  id: z.number(),
  type: z.string(),
  severity: z.enum(["info", "warning", "error", "success"]),
  source: z.string(),
  message: z.string(),
  createdAt: z.string(),
});
export type EventDTO = z.infer<typeof eventDtoSchema>;

/* ---- approvals ---- */
export const approvalDtoSchema = z.object({
  id: z.string().uuid(),
  actionType: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  title: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  environment: z.string(),
  requestedBy: z.string(),
  requestedAt: z.string(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  reason: z.string().nullable(),
});
export type ApprovalDTO = z.infer<typeof approvalDtoSchema>;

export const decideApprovalSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().max(500).optional(),
});

/* ---- audit log ---- */
export const auditLogDtoSchema = z.object({
  id: z.string().uuid(),
  actorType: z.string(),
  actorId: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  result: z.string(),
  ipAddress: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditLogDTO = z.infer<typeof auditLogDtoSchema>;

/* ---- search ---- */
export const searchResultSchema = z.object({
  group: z.enum(["component", "audit", "finding", "artifact", "job"]),
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  href: z.string(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

/* ---- event envelope (SSE / future bus) ---- */
export const eventEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  correlationId: z.string().optional(),
  timestamp: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
