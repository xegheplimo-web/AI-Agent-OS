import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/* Single source of truth: the same DATABASE_URL the app, the worker, CI and
   docker compose use. Never hardcode a connection string here — that made
   `db:push` target a different database than the running application. */
const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DATABASE_URL is required for drizzle-kit. Copy .env.example to .env first.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: false,
  verbose: false,
});
