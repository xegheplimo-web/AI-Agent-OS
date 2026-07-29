import "dotenv/config";

// Ensure DB-dependent modules can initialise during unit tests.
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
process.env.API_INTERNAL_TOKEN ??= "test-internal-token";
