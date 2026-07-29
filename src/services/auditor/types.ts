import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Auditor contract. Every scanner returns this exact envelope so the  */
/* normalization stage never has to parse loose text.                  */
/* Mirrors the Pydantic `ScanResult` model of the Python toolkit.      */
/* ------------------------------------------------------------------ */

export const scanStatusSchema = z.enum(["success", "partial", "failed"]);

export const scanResultSchema = z.object({
  scanner: z.string(),
  status: scanStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string(),
  durationMs: z.number(),
  artifacts: z.array(z.string()),
  warnings: z.array(z.string()),
  error: z.string().nullable().default(null),
  data: z.record(z.string(), z.unknown()),
});
export type ScanResult = z.infer<typeof scanResultSchema>;

export const rawFindingSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  category: z.enum(["security", "config", "schema", "dependency", "infra", "ui"]),
  component: z.string(),
  title: z.string(),
  description: z.string(),
  evidence: z.string(),
});
export type RawFinding = z.infer<typeof rawFindingSchema>;

export interface NormalizedInventory {
  host: Record<string, unknown>;
  repo: Record<string, unknown>;
  services: Array<Record<string, unknown>>;
  dependencies: Array<{ name: string; version: string; license: string; type: string }>;
  schema: {
    tables: Array<{ table: string; columns: number; rows: number | null }>;
    indexes: Array<{ table: string; index: string; definition: string }>;
    missingIndexes: Array<{ table: string; column: string }>;
  };
  env: { declared: string[]; present: string[]; missing: string[]; undeclared: string[] };
  findings: RawFinding[];
}

export function startScan(scanner: string) {
  const t0 = Date.now();
  return {
    ok(data: Record<string, unknown>, artifacts: string[], warnings: string[] = []): ScanResult {
      return {
        scanner,
        status: warnings.length ? "partial" : "success",
        startedAt: new Date(t0).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        artifacts,
        warnings,
        error: null,
        data,
      };
    },
    fail(error: unknown): ScanResult {
      return {
        scanner,
        status: "failed",
        startedAt: new Date(t0).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        artifacts: [],
        warnings: [],
        error: error instanceof Error ? error.message : String(error),
        data: {},
      };
    },
  };
}
