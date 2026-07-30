CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_type" text NOT NULL,
	"target_type" text DEFAULT 'system' NOT NULL,
	"target_id" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"reason" text,
	"payload" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"audit_id" uuid,
	"kind" text DEFAULT 'markdown' NOT NULL,
	"format" text DEFAULT 'text' NOT NULL,
	"title" text NOT NULL,
	"path" text NOT NULL,
	"storage_provider" text DEFAULT 'db' NOT NULL,
	"storage_key" text DEFAULT '' NOT NULL,
	"mime_type" text DEFAULT 'text/plain' NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"size_kb" real DEFAULT 0,
	"sha256" text DEFAULT '' NOT NULL,
	"schema_version" text DEFAULT '1.0' NOT NULL,
	"generator" text DEFAULT 'ai-system-auditor' NOT NULL,
	"generator_version" text DEFAULT '0.3.1' NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"request_id" text,
	"result" text DEFAULT 'success' NOT NULL,
	"ip_address" text,
	"detail" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"trigger_type" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"score" integer,
	"stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"artifact_names" jsonb DEFAULT '[]'::jsonb,
	"findings_count" jsonb,
	"environment" text DEFAULT 'production' NOT NULL,
	"scope" jsonb DEFAULT '[]'::jsonb,
	"requested_by" text DEFAULT 'system' NOT NULL,
	"idempotency_key" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "components" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"group" text DEFAULT 'runtime' NOT NULL,
	"status" text DEFAULT 'healthy' NOT NULL,
	"latency_ms" real,
	"uptime_pct" real DEFAULT 99.9,
	"version" text DEFAULT '0.1.0',
	"environment" text DEFAULT 'production' NOT NULL,
	"position" jsonb,
	"metrics" jsonb DEFAULT '{}'::jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"source" text DEFAULT 'gateway' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"audit_id" uuid,
	"severity" text DEFAULT 'info' NOT NULL,
	"category" text DEFAULT 'config' NOT NULL,
	"component" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"evidence" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"fingerprint" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"audit_id" uuid,
	"target" text DEFAULT 'system' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"worker" text,
	"locked_by" text,
	"heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parity_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid,
	"overall_status" text DEFAULT 'passed' NOT NULL,
	"score" integer DEFAULT 100 NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gates" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"metric" text NOT NULL,
	"value" real NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"username" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parity_reports" ADD CONSTRAINT "parity_reports_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_username_users_username_fk" FOREIGN KEY ("username") REFERENCES "public"."users"("username") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "approvals_requested_at_idx" ON "approvals" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "artifacts_audit_id_idx" ON "artifacts" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "artifacts_updated_at_idx" ON "artifacts" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "artifacts_kind_idx" ON "artifacts" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_audit_path_uidx" ON "artifacts" USING btree ("audit_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_global_path_uidx" ON "artifacts" USING btree ("path") WHERE "artifacts"."audit_id" IS NULL;--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audits_status_idx" ON "audits" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audits_started_at_idx" ON "audits" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "audits_environment_idx" ON "audits" USING btree ("environment");--> statement-breakpoint
CREATE UNIQUE INDEX "audits_idempotency_uidx" ON "audits" USING btree ("idempotency_key") WHERE "audits"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "components_status_idx" ON "components" USING btree ("status");--> statement-breakpoint
CREATE INDEX "events_created_at_idx" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "events_source_idx" ON "events" USING btree ("source");--> statement-breakpoint
CREATE INDEX "events_severity_idx" ON "events" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "findings_audit_id_idx" ON "findings" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "findings_severity_idx" ON "findings" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "findings_status_idx" ON "findings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "findings_component_idx" ON "findings" USING btree ("component");--> statement-breakpoint
CREATE INDEX "findings_created_at_idx" ON "findings" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "findings_audit_fingerprint_uidx" ON "findings" USING btree ("audit_id","fingerprint");--> statement-breakpoint
CREATE INDEX "jobs_status_created_idx" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "jobs_created_at_idx" ON "jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "jobs_heartbeat_idx" ON "jobs" USING btree ("heartbeat_at");--> statement-breakpoint
CREATE INDEX "jobs_audit_id_idx" ON "jobs" USING btree ("audit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_audit_run_active_uidx" ON "jobs" USING btree ("audit_id") WHERE "jobs"."type" = 'audit.run' AND "jobs"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "parity_created_at_idx" ON "parity_reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "parity_audit_id_idx" ON "parity_reports" USING btree ("audit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parity_audit_uidx" ON "parity_reports" USING btree ("audit_id") WHERE "parity_reports"."audit_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_username_idx" ON "sessions" USING btree ("username");--> statement-breakpoint
CREATE INDEX "sessions_created_at_idx" ON "sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "telemetry_metric_ts_idx" ON "telemetry_points" USING btree ("metric","ts");--> statement-breakpoint
CREATE INDEX "telemetry_ts_idx" ON "telemetry_points" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");