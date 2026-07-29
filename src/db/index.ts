import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/* ------------------------------------------------------------------ */
/* Lazy database initialisation.                                       */
/*                                                                     */
/* Importing this module must never throw: unit tests, lint tooling,   */
/* static analysis and the Tauri/desktop build all import code paths   */
/* that transitively reach here without ever touching PostgreSQL.      */
/* The connection (and the DATABASE_URL requirement) is resolved on    */
/* first real query instead.                                           */
/* ------------------------------------------------------------------ */

const globalForDb = globalThis as typeof globalThis & {
  __agentOsPool?: Pool;
  __agentOsDb?: NodePgDatabase;
};

export function getPool(): Pool {
  if (globalForDb.__agentOsPool) return globalForDb.__agentOsPool;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for database-backed operations. " +
        "Copy .env.example to .env and set it before using audit/telemetry features.",
    );
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  globalForDb.__agentOsPool = pool;
  return pool;
}

export function getDb(): NodePgDatabase {
  if (!globalForDb.__agentOsDb) {
    globalForDb.__agentOsDb = drizzle(getPool());
  }
  return globalForDb.__agentOsDb;
}

export async function closeDb(): Promise<void> {
  if (globalForDb.__agentOsPool) {
    await globalForDb.__agentOsPool.end();
    globalForDb.__agentOsPool = undefined;
    globalForDb.__agentOsDb = undefined;
  }
}

/**
 * Backwards-compatible `db` binding.
 *
 * A Proxy keeps every existing `import { db } from "@/db"` call site working
 * while deferring the actual connection until a property is accessed, i.e.
 * until a query really runs.
 */
export const db: NodePgDatabase = new Proxy({} as NodePgDatabase, {
  get(_target, prop, receiver) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
  has(_target, prop) {
    return Reflect.has(getDb() as object, prop);
  },
});

/** Lazy pool accessor kept as a shim so `pool` never connects on import. */
export const pool = {
  query: (text: string, values?: unknown[]) => getPool().query(text, values as never),
  end: () => closeDb(),
} as const;
