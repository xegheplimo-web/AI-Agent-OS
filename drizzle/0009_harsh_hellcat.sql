DROP INDEX IF EXISTS "audits_active_uidx";--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "active_bucket" text GENERATED ALWAYS AS (CASE WHEN "status" IN ('running', 'waiting_approval') THEN 'active' ELSE NULL END) STORED NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "audits_active_uidx" ON "audits" USING btree ("active_bucket") WHERE "audits"."active_bucket" IS NOT NULL;