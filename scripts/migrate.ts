/* Production migration runner — applies SQL files from drizzle/ in order,
 * recording each in a ledger table. This replaces `drizzle-kit migrate` which
 * has a silent-fail bug on PostgreSQL 17 (applies 0 migrations, exits 1,
 * no error message). This runner does the same thing drizzle-kit migrate
 * would do, but works reliably on PG17.
 *
 * Usage: tsx scripts/migrate.ts
 * Env:   DATABASE_URL=postgresql://...
 *
 * Features:
 *   - Advisory lock prevents concurrent migrations from two deployments.
 *   - Baseline adoption: if the ledger is empty but tables already exist
 *     (from a previous `db:push`), the runner marks all existing migrations
 *     as applied without re-running them, then applies only new ones.
 *   - Each migration runs in a transaction with ledger recording.
 *   - SHA-256 hash of SQL content for dedup.
 *   - Idempotent: running twice is safe (second run is a no-op).
 *
 * The ledger table (drizzle.__drizzle_migrations) matches drizzle-kit's
 * schema so `drizzle-kit migrate` can be used later once the bug is fixed. */
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required for migrations.");
  process.exit(1);
}

const MIGRATIONS_DIR = path.resolve(process.cwd(), "drizzle");

/* Advisory lock key — arbitrary fixed bigint. Prevents two concurrent
   migration runners from applying DDL in parallel. */
const MIGRATION_LOCK_KEY = 7271800; /* "ai-agent-os" on a phone keypad */

async function main() {
  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();

  try {
    /* Acquire a PostgreSQL advisory lock for the duration of the migration.
       pg_try_advisory_lock returns true immediately if the lock is available,
       false if another runner holds it. This prevents two deployments from
       running migrations concurrently (which could cause duplicate DDL or
       ledger corruption). The lock is session-scoped — it's automatically
       released when the client disconnects. */
    const { rows: lockResult } = await client.query(
      `SELECT pg_try_advisory_lock($1) AS acquired`,
      [MIGRATION_LOCK_KEY],
    );
    if (!lockResult[0]?.acquired) {
      console.error("Another migration runner holds the advisory lock — aborting.");
      process.exit(1);
    }

    /* Create the drizzle schema + ledger table if they don't exist.
       This matches drizzle-kit's __drizzle_migrations schema exactly:
       id (serial PK), hash (text), created_at (bigint). */
    await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at BIGINT NOT NULL
      )
    `);

    /* Get already-applied migration hashes. */
    const { rows: applied } = await client.query(
      `SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`,
    );
    const appliedHashes = new Set(applied.map((r) => r.hash));

    /* Read all .sql files from drizzle/ in lexical (chronological) order. */
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.error("No .sql migration files found in drizzle/ — run 'npm run db:generate' first.");
      process.exit(1);
    }

    /* Baseline adoption: if the ledger is empty (no migrations recorded)
       but the database already has tables (from a previous `db:push`),
       we can't just run all migrations from scratch — CREATE TABLE would
       fail because the tables already exist. Instead, we check if a core
       table (audits) exists. If it does, we mark all existing migrations
       as applied (baseline) and only apply new ones going forward.

       This is the standard "baseline" pattern used by Flyway, Liquibase,
       and other migration tools. */
    if (appliedHashes.size === 0) {
      const { rows: tableCheck } = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM pg_tables
           WHERE schemaname = 'public' AND tablename = 'audits'
         ) AS exists`,
      );
      if (tableCheck[0]?.exists) {
        console.log("  ℹ Database has tables but no migration ledger — adopting baseline.");
        console.log("    Marking all existing migrations as applied (they were created by db:push).");
        for (const file of files) {
          const filePath = path.join(MIGRATIONS_DIR, file);
          const sql = await readFile(filePath, "utf-8");
          const hash = createHash("sha256").update(sql).digest("hex");
          await client.query(
            `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
            [hash, Date.now()],
          );
          appliedHashes.add(hash);
          console.log(`  ✓ ${file} (baseline — marked as applied)`);
        }
        console.log(`  ℹ Baseline adoption complete. Future migrations will be applied normally.`);
      }
    }

    let appliedCount = 0;
    for (const file of files) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = await readFile(filePath, "utf-8");
      const hash = createHash("sha256").update(sql).digest("hex");

      if (appliedHashes.has(hash)) {
        console.log(`  ✓ ${file} (already applied)`);
        continue;
      }

      /* Apply the migration in a transaction. If it fails, abort — the
         ledger stays consistent (only successful migrations are recorded). */
      console.log(`  → applying ${file} ...`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
          [hash, Date.now()],
        );
        await client.query("COMMIT");
        console.log(`  ✓ ${file} applied`);
        appliedCount++;
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`  ✗ ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    }

    console.log(`\nMigrations complete: ${appliedCount} applied, ${files.length - appliedCount} already up to date.`);
  } finally {
    /* Release the advisory lock before disconnecting. */
    try {
      await client.query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_LOCK_KEY]);
    } catch { /* connection may already be broken */ }
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration runner failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
