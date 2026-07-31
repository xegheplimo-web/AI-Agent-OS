/* Production migration runner — applies SQL files from drizzle/ in order,
 * recording each in a ledger table. This replaces `drizzle-kit migrate` which
 * has a silent-fail bug on PostgreSQL 17 (applies 0 migrations, exits 1,
 * no error message). This runner does the same thing drizzle-kit migrate
 * would do, but works reliably on PG17.
 *
 * Usage: tsx scripts/migrate.ts
 * Env:   DATABASE_URL=postgresql://...
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

async function main() {
  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();

  try {
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
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration runner failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
