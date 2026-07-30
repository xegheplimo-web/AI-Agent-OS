import {
  pgTable,
  text,
  integer,
  real,
  timestamp,
  jsonb,
  serial,
  uuid,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { GENERATOR_VERSION } from "@/lib/version";

/* Indexes below were added in response to a real auditor finding:
   "19 cột hot path chưa có index" (database-inventory scanner, pg_indexes).
   Every one of them backs a query the dashboard runs on its polling loop. */

/* ------------------------------------------------------------------ */
/* System components: Hermes, OpenClaw, OpenCode, Gateway, Worker ...  */
/* ------------------------------------------------------------------ */
export const components = pgTable("components", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  group: text("group").notNull().default("runtime"), // runtime | agent | infra | audit
  status: text("status").notNull().default("healthy"), // healthy | degraded | offline | readonly
  latencyMs: real("latency_ms"),
  uptimePct: real("uptime_pct").default(99.9),
  version: text("version").default("0.1.0"),
  environment: text("environment").notNull().default("production"),
  position: jsonb("position").$type<{ x: number; y: number }>(),
  metrics: jsonb("metrics")
    .$type<Record<string, string | number>>()
    .default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("components_status_idx").on(t.status)]);

/* ------------------------------------------------------------------ */
/* Audit runs: 3-stage pipeline (Discovery / Normalization / Recon.)   */
/* ------------------------------------------------------------------ */
export const audits = pgTable("audits", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  triggerType: text("trigger_type").notNull().default("manual"), // manual | scheduled | ci
  status: text("status").notNull().default("running"),
  // queued | waiting_approval | running | completed | failed | cancelled
  score: integer("score"),
  stages: jsonb("stages")
    .$type<
      Array<{
        key: string;
        label: string;
        status: "pending" | "active" | "done" | "failed";
        startedAt?: string;
        durationMs?: number;
        artifacts: string[];
        detail?: string;
      }>
    >()
    .notNull()
    .default([]),
  artifactNames: jsonb("artifact_names").$type<string[]>().default([]),
  findingsCount: jsonb("findings_count")
    .$type<{ critical: number; high: number; medium: number; low: number; info: number }>(),
  environment: text("environment").notNull().default("production"),
  scope: jsonb("scope").$type<string[]>().default([]),
  requestedBy: text("requested_by").notNull().default("system"),
  idempotencyKey: text("idempotency_key"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /* Generated column: 'active' when status is running/waiting_approval,
     NULL otherwise. Backs the audits_active_uidx partial unique index so
     only one audit may be active at a time. Stored (not virtual) so the
     index can use it without recomputing the expression. Nullable because
     non-active audits (completed/failed/cancelled) yield NULL — the partial
     unique index only covers rows WHERE active_bucket IS NOT NULL. */
  activeBucket: text("active_bucket").generatedAlwaysAs(
    sql`CASE WHEN "status" IN ('running', 'waiting_approval') THEN 'active' ELSE NULL END`,
  ),
}, (t) => [
  index("audits_status_idx").on(t.status),
  index("audits_started_at_idx").on(t.startedAt),
  index("audits_environment_idx").on(t.environment),
  /* UNIQUE partial index: only enforces uniqueness when idempotency_key IS
     NOT NULL. Postgres treats NULLs as distinct in a plain unique index, so
     without the WHERE clause, multiple NULL-keyed audits would coexist — but
     the real risk is the opposite: a plain unique index on a nullable column
     can silently allow duplicates in some edge cases with concurrent inserts.
     The partial index makes the intent explicit and the constraint airtight. */
  uniqueIndex("audits_idempotency_uidx").on(t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
  /* UNIQUE partial index: at most ONE audit may be in an active state
     (running OR waiting_approval) at any time. Uses the `status` column
     directly as the index key with a partial WHERE clause. Since both
     'running' and 'waiting_approval' are distinct values, a plain unique
     index on `status` would allow one 'running' AND one 'waiting_approval'
     to coexist. To collapse both into a single bucket, we add a generated
     column `active_bucket` that is 'active' for both active states and
     NULL otherwise, then unique-index it WHERE NOT NULL. A second
     concurrent insert of any active audit fails with a unique violation,
     closing the SELECT-then-INSERT race in startAudit. */
  uniqueIndex("audits_active_uidx").on(t.activeBucket).where(sql`${t.activeBucket} IS NOT NULL`),
]);

/* ------------------------------------------------------------------ */
/* Findings                                                            */
/* ------------------------------------------------------------------ */
export const findings = pgTable("findings", {
  id: serial("id").primaryKey(),
  auditId: uuid("audit_id").references(() => audits.id, { onDelete: "cascade" }),
  severity: text("severity").notNull().default("info"), // critical | high | medium | low | info
  category: text("category").notNull().default("config"), // security | config | schema | dependency | infra | ui
  component: text("component").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  evidence: text("evidence").notNull().default(""),
  status: text("status").notNull().default("open"), // open | acknowledged | resolved
  /** stable hash of (component,category,title) — dedupe key for re-runs */
  fingerprint: text("fingerprint").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("findings_audit_id_idx").on(t.auditId),
  index("findings_severity_idx").on(t.severity),
  index("findings_status_idx").on(t.status),
  index("findings_component_idx").on(t.component),
  index("findings_created_at_idx").on(t.createdAt),
  /* Makes a re-run after a crash idempotent: the same finding for the same
     audit is upserted instead of duplicated. */
  uniqueIndex("findings_audit_fingerprint_uidx").on(t.auditId, t.fingerprint),
]);

/* ------------------------------------------------------------------ */
/* Functional parity reports                                           */
/* ------------------------------------------------------------------ */
export const parityReports = pgTable("parity_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** The audit this report was produced by. Previously NULL for every row, so
   *  a retried audit inserted a second report and the "latest parity" query
   *  could return either one. Now required for auditor-generated reports and
   *  protected by a partial unique index so a re-run upserts instead of
   *  duplicating. */
  auditId: uuid("audit_id").references(() => audits.id, { onDelete: "cascade" }),
  overallStatus: text("overall_status").notNull().default("passed"), // passed | warning | failed
  score: integer("score").notNull().default(100),
  environment: text("environment").notNull().default("production"),
  checks: jsonb("checks")
    .$type<
      Array<{
        key: string;
        label: string;
        status: "passed" | "failed" | "warning" | "pending";
        baselineValue?: string;
        currentValue?: string;
        difference?: string;
      }>
    >()
    .notNull()
    .default([]),
  gates: jsonb("gates")
    .$type<Array<{ key: string; label: string; status: string }>>()
    .default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("parity_created_at_idx").on(t.createdAt),
  index("parity_audit_id_idx").on(t.auditId),
  /* At most one parity report per audit: a retried run upserts instead of
     creating a second row that drifts the "latest parity" result. Only
     enforced when audit_id IS NOT NULL (global/manual reports stay allowed). */
  uniqueIndex("parity_audit_uidx").on(t.auditId).where(sql`${t.auditId} IS NOT NULL`),
]);

/* ------------------------------------------------------------------ */
/* Telemetry time series                                               */
/* ------------------------------------------------------------------ */
export const telemetryPoints = pgTable("telemetry_points", {
  id: serial("id").primaryKey(),
  metric: text("metric").notNull(), // latency_p95 | latency_p50 | throughput | error_rate | queue_depth
  value: real("value").notNull(),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
  /* Provenance: how this data point was collected.
     - "synthetic": demo random-walk sampler (never in production)
     - "otlp": real OTLP collector ingestion (not yet implemented — placeholder)
     - "manual": seed data or manual insert
     Without this column, the summary API inferred "otlp" from "has data +
     production mode", which falsely labeled seed/demo data as live OTLP. */
  source: text("source").notNull().default("manual"),
}, (t) => [
  index("telemetry_metric_ts_idx").on(t.metric, t.ts),
  index("telemetry_ts_idx").on(t.ts),
]);

/* ------------------------------------------------------------------ */
/* Live event feed                                                     */
/* ------------------------------------------------------------------ */
export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // system.health | audit.* | parity.* | deploy.* | finding.*
  severity: text("severity").notNull().default("info"), // info | warning | error | success
  source: text("source").notNull().default("gateway"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("events_created_at_idx").on(t.createdAt),
  index("events_source_idx").on(t.source),
  index("events_severity_idx").on(t.severity),
]);

/* ------------------------------------------------------------------ */
/* Jobs queue — DB-backed, claimable by external workers               */
/* ------------------------------------------------------------------ */
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(), // audit.run | sbom.export | parity.gate | artifact.package | knowledge.reindex
  status: text("status").notNull().default("queued"),
  // queued | running | completed | failed | cancelled | timed_out
  /** audit.run jobs carry the audit they own, so a worker only ever runs the
   *  audit belonging to the job it successfully claimed. */
  auditId: uuid("audit_id").references(() => audits.id, { onDelete: "cascade" }),
  target: text("target").notNull().default("system"),
  progress: integer("progress").notNull().default(0),
  attempt: integer("attempt").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  worker: text("worker"),
  lockedBy: text("locked_by"),
  /** Fencing token set on claim. Every state transition (heartbeat, finalize,
   *  progress) must include `WHERE lease_token = $token` — if a stale
   *  supervisor requeued the job (clearing lease_token), the update matches 0
   *  rows and the worker knows it lost ownership. Without this, a worker that
   *  crashed and was requeued could still finalize a job another worker has
   *  already claimed and is executing. */
  leaseToken: uuid("lease_token"),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  /* backs the worker's FOR UPDATE SKIP LOCKED claim query */
  index("jobs_status_created_idx").on(t.status, t.createdAt),
  index("jobs_created_at_idx").on(t.createdAt),
  index("jobs_heartbeat_idx").on(t.heartbeatAt),
  index("jobs_audit_id_idx").on(t.auditId),
  /* UNIQUE partial index: at most one audit.run job per audit. Prevents a
     race between startAudit and decideApproval from spawning two jobs for
     the same audit. Only applies to active (non-terminal) jobs so completed/
     failed/timed_out rows don't block legitimate re-runs. */
  uniqueIndex("jobs_audit_run_active_uidx")
    .on(t.auditId)
    .where(sql`${t.type} = 'audit.run' AND ${t.status} IN ('queued', 'running')`),
]);

/* ------------------------------------------------------------------ */
/* Knowledge artifacts: README, SBOM, runbook, mermaid, reports        */
/* Metadata lives here; large payloads should move to object storage.  */
/* ------------------------------------------------------------------ */
export const artifacts = pgTable("artifacts", {
  id: serial("id").primaryKey(),
  auditId: uuid("audit_id").references(() => audits.id, { onDelete: "set null" }),
  kind: text("kind").notNull().default("markdown"), // markdown | json | mermaid | runbook | sbom
  format: text("format").notNull().default("text"), // md | json | mmd | txt
  title: text("title").notNull(),
  path: text("path").notNull(),
  storageProvider: text("storage_provider").notNull().default("db"), // db | filesystem | s3
  storageKey: text("storage_key").notNull().default(""),
  mimeType: text("mime_type").notNull().default("text/plain"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  sizeKb: real("size_kb").default(0),
  sha256: text("sha256").notNull().default(""),
  schemaVersion: text("schema_version").notNull().default("1.0"),
  generator: text("generator").notNull().default("ai-system-auditor"),
  generatorVersion: text("generator_version").notNull().default(GENERATOR_VERSION),
  environment: text("environment").notNull().default("production"),
  content: text("content").notNull().default(""),
  tags: jsonb("tags").$type<string[]>().default([]),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("artifacts_audit_id_idx").on(t.auditId),
  index("artifacts_updated_at_idx").on(t.updatedAt),
  index("artifacts_kind_idx").on(t.kind),
  /* Resume-safe: re-running a stage overwrites the artifact in place. */
  uniqueIndex("artifacts_audit_path_uidx").on(t.auditId, t.path),
  /* Global artifacts (audit_id IS NULL) — Postgres treats NULLs as distinct
     in a plain unique index, so without this a retry of a global export (e.g.
     /audit/exports/sbom.cyclonedx.json) would insert a duplicate row. The
     partial index closes that gap for the NULL-audit case. */
  uniqueIndex("artifacts_global_path_uidx").on(t.path).where(sql`${t.auditId} IS NULL`),
]);

/* ------------------------------------------------------------------ */
/* Settings (production rules, workspace prefs) - simple key/value     */
/* ------------------------------------------------------------------ */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Users & sessions (minimal built-in auth)                            */
/* ------------------------------------------------------------------ */
export const users = pgTable("users", {
  username: text("username").primaryKey(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("viewer"), // viewer | operator | administrator | auditor-service | worker-service
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("users_created_at_idx").on(t.createdAt)]);

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  username: text("username")
    .notNull()
    .references(() => users.username, { onDelete: "cascade" }),
  role: text("role").notNull().default("viewer"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  index("sessions_expires_at_idx").on(t.expiresAt),
  index("sessions_username_idx").on(t.username),
  index("sessions_created_at_idx").on(t.createdAt),
]);

/* ------------------------------------------------------------------ */
/* Approvals — human-in-the-loop gate                                  */
/* ------------------------------------------------------------------ */
export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  actionType: text("action_type").notNull(), // audit.run | artifact.package | config.change
  targetType: text("target_type").notNull().default("system"),
  targetId: text("target_id").notNull().default(""),
  title: text("title").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  environment: text("environment").notNull().default("production"),
  requestedBy: text("requested_by").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  reason: text("reason"),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
}, (t) => [
  index("approvals_status_idx").on(t.status),
  index("approvals_requested_at_idx").on(t.requestedAt),
]);

/* ------------------------------------------------------------------ */
/* Audit log — immutable trail of every state-changing action          */
/* ------------------------------------------------------------------ */
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorType: text("actor_type").notNull().default("user"), // user | service | system
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  requestId: text("request_id"),
  result: text("result").notNull().default("success"), // success | denied | error
  ipAddress: text("ip_address"),
  detail: jsonb("detail").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("audit_logs_created_at_idx").on(t.createdAt),
  index("audit_logs_actor_idx").on(t.actorId),
  index("audit_logs_resource_idx").on(t.resourceType, t.resourceId),
]);

export type ComponentRow = typeof components.$inferSelect;
export type AuditRow = typeof audits.$inferSelect;
export type FindingRow = typeof findings.$inferSelect;
export type ParityReportRow = typeof parityReports.$inferSelect;
export type TelemetryPointRow = typeof telemetryPoints.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
