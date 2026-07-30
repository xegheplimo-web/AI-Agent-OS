ALTER TABLE "artifacts" ALTER COLUMN "generator_version" SET DEFAULT '0.5.0';--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "lease_token" uuid;