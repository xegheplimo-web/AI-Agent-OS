-- Dedupe: keep only the oldest pending approval per (action_type, target_id)
-- and expire the rest. Without this, an existing database with duplicate
-- pending approvals (e.g. from a pre-fix engine replay) would fail the
-- CREATE UNIQUE INDEX below with a 23505 duplicate key error.
WITH duplicates AS (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY action_type, target_id
        ORDER BY requested_at ASC
      ) AS rn
    FROM approvals
    WHERE status = 'pending'
  ) ranked
  WHERE rn > 1
)
UPDATE approvals
SET status = 'expired', decided_at = NOW(), reason = 'deduplicated by migration 0011'
WHERE id IN (SELECT id FROM duplicates);

CREATE UNIQUE INDEX "approvals_pending_unique_uidx" ON "approvals" USING btree ("action_type","target_id") WHERE status = 'pending';
