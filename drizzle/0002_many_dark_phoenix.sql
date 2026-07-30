/* audits_active_uidx was added here originally with an invalid (1) key.
   It is created correctly (with the active_bucket generated column) in
   migration 0009. This file is intentionally empty so the migration
   sequence applies cleanly — the index is deferred to 0009. */