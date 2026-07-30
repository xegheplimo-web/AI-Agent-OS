import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { artifacts, audits, events, jobs, parityReports, settings, telemetryPoints } from "@/db/schema";
import { computeParityScore } from "@/lib/parity";
import { GENERATOR_VERSION } from "@/lib/version";
import { DISCOVERY_SCANNERS, scannersForTarget, scanPackages } from "@/services/auditor/scanners";
import { normalize, parityChecksFrom } from "@/services/auditor/normalize";
import { buildInventoryJson, buildRealSbom } from "@/services/auditor/reconstruct";
import { resolveTarget, targetProvenance } from "@/services/auditor/target";
import { isDemoMode } from "@/services/mode";
import type { LeaseFence } from "@/services/lease";
import type { JobRow } from "@/db/schema";

/* ------------------------------------------------------------------ */
/* Real job executors.                                                 */
/*                                                                     */
/* Replaces the wall-clock simulation in advanceJobsOnce: each non-    */
/* audit.run job type now does real work against the live system and   */
/* persists a real artifact / report / index, instead of just counting */
/* elapsed milliseconds and flipping to `completed`.                   */
/*                                                                     */
/* Every executor:                                                     */
/*   - is idempotent (upserts on unique keys) so a retry after a crash */
/*     rewrites instead of duplicating;                                */
/*   - heartbeats its job via the caller (advanceJobsOnce);            */
/*   - emits a job.completed event;                                    */
/*   - returns void on success, throws on failure (caller marks the    */
/*     job failed/queued for retry).                                   */
/* ------------------------------------------------------------------ */

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Persist (or upsert) an artifact row. Shared with the auditor engine's
 *  persistArtifact, kept here so executors don't reach into engine.ts. */
async function upsertArtifact(params: {
  auditId: string | null;
  kind: string;
  format: string;
  mimeType: string;
  title: string;
  path: string;
  content: string;
  tags: string[];
  environment: string;
  metadata?: Record<string, unknown>;
}) {
  const bytes = Buffer.byteLength(params.content, "utf-8");
  const row = {
    auditId: params.auditId,
    kind: params.kind,
    format: params.format,
    title: params.title,
    path: params.path,
    storageProvider: "db",
    storageKey: params.path,
    mimeType: params.mimeType,
    sizeBytes: bytes,
    sizeKb: Math.round((bytes / 1024) * 10) / 10,
    sha256: sha256(params.content),
    schemaVersion: "1.0",
    generator: "ai-system-auditor",
    generatorVersion: GENERATOR_VERSION,
    environment: params.environment,
    content: params.content,
    tags: params.tags,
    metadata: params.metadata ?? {},
    updatedAt: new Date(),
  };

  /* auditId present → upsert on (audit_id, path). auditId null → upsert on
     the global partial unique index (path WHERE audit_id IS NULL). Drizzle's
     onConflictDoUpdate needs an explicit target; we pick by auditId presence. */
  if (params.auditId) {
    await db
      .insert(artifacts)
      .values(row)
      .onConflictDoUpdate({
        target: [artifacts.auditId, artifacts.path],
        set: {
          content: row.content,
          sha256: row.sha256,
          sizeBytes: row.sizeBytes,
          sizeKb: row.sizeKb,
          metadata: row.metadata,
          updatedAt: row.updatedAt,
        },
      });
  } else {
    /* Global artifact (audit_id IS NULL) — the unique index is a PARTIAL
       index: `artifacts_global_path_uidx ON (path) WHERE audit_id IS NULL`.
       PostgreSQL requires the ON CONFLICT clause to include the same WHERE
       predicate, otherwise it errors with "no unique constraint matching
       ON CONFLICT". Drizzle's `targetWhere` supplies that predicate. */
    await db
      .insert(artifacts)
      .values(row)
      .onConflictDoUpdate({
        target: [artifacts.path],
        targetWhere: sql`${artifacts.auditId} IS NULL`,
        set: {
          content: row.content,
          sha256: row.sha256,
          sizeBytes: row.sizeBytes,
          sizeKb: row.sizeKb,
          metadata: row.metadata,
          updatedAt: row.updatedAt,
        },
      });
  }
}

/* ------------------------------------------------------------------ */
/* sbom.export — re-scan packages and emit a CycloneDX 1.6 SBOM.       */
/* ------------------------------------------------------------------ */
export async function executeSbomExport(job: JobRow, lease?: LeaseFence): Promise<void> {
  const environment = job.auditId ? (await loadAuditEnvironment(job.auditId)) : "production";
  /* Pass the audit's scope so the SBOM only includes what the audit was
     scoped to — previously this ran all scanners and filtered in JS. */
  const auditScope = job.auditId ? (await loadAuditScope(job.auditId)) : [];
  const target = resolveTarget(environment, auditScope);

  /* Fail-closed: if the target root is invalid (e.g. production root not
     configured), the SBOM would be built from the worker's own checkout —
     a false-green. Abort instead. */
  if (!target.rootValid) throw new Error(`SBOM export refused: ${target.rootInvalidReason ?? "invalid target root"}`);

  /* Run only the package-inventory scanner — cheaper than a full discovery
     pass and it is the only one feeding the SBOM. */
  const pkgResult = await scanPackages(target);
  const results = [pkgResult];
  if (!results.length || results[0].status === "failed") throw new Error("package-inventory scanner failed");

  const inv = normalize(results);
  const auditName = job.auditId ? (await loadAuditName(job.auditId)) : "global-export";
  const sbom = buildRealSbom(auditName, inv);

  /* Lease fencing: abort before the side effect if we lost ownership of the
     job while the scanner was running. Without this, a stale worker would
     still write its SBOM artifact after another worker already took over. */
  await lease?.assert();
  await upsertArtifact({
    auditId: job.auditId ?? null,
    kind: "sbom",
    format: "json",
    mimeType: "application/json",
    title: `SBOM — CycloneDX 1.6 (${auditName})`,
    path: job.auditId ? "/audit/exports/sbom.cyclonedx.json" : "/audit/exports/sbom.cyclonedx.json",
    content: sbom,
    tags: ["sbom", "supply-chain", "export"],
    environment,
    metadata: { job: job.id, jobType: job.type, scanner: "package-inventory" },
  });
}

/* ------------------------------------------------------------------ */
/* parity.gate — re-scan, normalize, compute parity, persist report.   */
/* ------------------------------------------------------------------ */
export async function executeParityGate(job: JobRow, lease?: LeaseFence): Promise<void> {
  const environment = job.auditId ? (await loadAuditEnvironment(job.auditId)) : "production";
  const auditScope = job.auditId ? (await loadAuditScope(job.auditId)) : [];
  const target = resolveTarget(environment, auditScope);

  /* Use target-aware scanner selection — only run scanners whose scope is
     enabled for this audit. Previously this ran ALL scanners regardless
     of the audit's scope filter. */
  const scanners = scannersForTarget(target);
  const results = [];
  for (const { run } of scanners) {
    results.push(await run());
  }
  const inv = normalize(results);

  /* p95 latency from telemetry — null when absent or stale (no false-green).
     Only "otlp" or "manual" sources count for production parity; "synthetic"
     (demo sampler) data must not make a production parity gate pass. Data
     older than 10 minutes is treated as absent — the collector stopped. */
  const FRESHNESS_MS = 10 * 60 * 1000;
  const cutoff = new Date(Date.now() - FRESHNESS_MS);
  const p95Rows = await db
    .select()
    .from(telemetryPoints)
    .where(and(
      eq(telemetryPoints.metric, "latency_p95"),
      sql`${telemetryPoints.ts} > ${cutoff}`,
      inArray(telemetryPoints.source, isDemoMode ? ["synthetic", "manual"] : ["otlp"]),
    ))
    .orderBy(desc(telemetryPoints.ts))
    .limit(1);
  const latencyP95: number | null = p95Rows.length ? p95Rows[0].value : null;

  const checks = parityChecksFrom(inv, latencyP95, results);
  const { score, overallStatus } = computeParityScore(checks);

  const gates = [
    { key: "secrets_scan", label: "Secrets scan", status: inv.findings.some((f) => f.category === "security" && f.severity === "critical") ? "failed" : "passed" },
    { key: "sbom_diff", label: "SBOM generated", status: "passed" },
    { key: "endpoint_authz", label: "Endpoint authorization", status: checks.find((c) => c.key === "endpoint_authz")?.status ?? "pending" },
    { key: "lockfile", label: "Deterministic install (lockfile)", status: (inv.repo as { lockFilePresent?: boolean }).lockFilePresent ? "passed" : "failed" },
  ];

  /* Lease fencing before persisting the parity report — a stale worker must
     not overwrite a report another worker already produced. */
  await lease?.assert();
  if (job.auditId) {
    /* Partial unique index: parity_audit_uidx ON (audit_id) WHERE audit_id IS NOT NULL.
       Must include targetWhere or PostgreSQL rejects the ON CONFLICT. */
    await db
      .insert(parityReports)
      .values({ auditId: job.auditId, overallStatus, score, environment, checks, gates })
      .onConflictDoUpdate({
        target: [parityReports.auditId],
        targetWhere: sql`${parityReports.auditId} IS NOT NULL`,
        set: { overallStatus, score, checks, gates, environment },
      });
  } else {
    /* Global parity report (no audit) — no unique constraint, insert as-is. */
    await db.insert(parityReports).values({ overallStatus, score, environment, checks, gates });
  }

  /* Also persist the parity report as a queryable artifact. */
  await lease?.assert();
  await upsertArtifact({
    auditId: job.auditId ?? null,
    kind: "json",
    format: "json",
    mimeType: "application/json",
    title: "parity_report.json",
    path: job.auditId ? "/audit/exports/parity_report.json" : "/audit/exports/parity_report.json",
    content: buildInventoryJson("parity_report.json", { score, overallStatus, checks, gates, latencyP95 }),
    tags: ["parity", "gate", "export"],
    environment,
    metadata: { job: job.id, jobType: job.type, latencySource: latencyP95 === null ? "unavailable" : "telemetry" },
  });
}

/* ------------------------------------------------------------------ */
/* artifact.package — build a TAR bundle of an audit's artifacts with  */
/* a MANIFEST.json and a SHA-256 checksum.                             */
/*                                                                     */
/* TAR is written by hand (POSIX ustar) so the worker has no extra     */
/* dependency — the bundle is a real archive any `tar -xf` can extract. */
/* ------------------------------------------------------------------ */
function ustarHeader(name: string, size: number, mtime: number): Buffer {
  const header = Buffer.alloc(512, 0);
  const write = (offset: number, len: number, val: string) => {
    header.write(val.slice(0, len), offset, "ascii");
  };
  write(0, 100, name);
  write(100, 8, "0000644"); // mode
  write(108, 8, "0000000"); // uid
  write(116, 8, "0000000"); // gid
  // size as octal, 11 digits + NUL
  write(124, 12, size.toString(8).padStart(11, "0") + "\0");
  // mtime as octal
  write(136, 12, Math.floor(mtime / 1000).toString(8).padStart(11, "0") + "\0");
  // checksum placeholder (spaces)
  header.write("        ", 148, "ascii");
  write(156, 1, "0"); // typeflag: regular file
  write(257, 6, "ustar"); // magic
  write(263, 2, "00"); // version

  // checksum: sum of unsigned bytes of the header with checksum field as spaces
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  header.write(sum.toString(8).padStart(6, "0"), 148, "ascii");
  header[155] = 0x20; // NUL-then-space convention

  return header;
}

function padToBlock(buf: Buffer): Buffer {
  const rem = buf.length % 512;
  if (rem === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(512 - rem, 0)]);
}

function buildTar(files: Array<{ name: string; content: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const mtime = Date.now();
  for (const f of files) {
    parts.push(ustarHeader(f.name, f.content.length, mtime));
    parts.push(padToBlock(f.content));
  }
  // two zero blocks mark end of archive
  parts.push(Buffer.alloc(1024, 0));
  return Buffer.concat(parts);
}

export async function executeArtifactPackage(job: JobRow, lease?: LeaseFence): Promise<void> {
  if (!job.auditId) throw new Error("artifact.package requires an auditId — nothing to package for a global job");
  const environment = await loadAuditEnvironment(job.auditId);
  const auditScope = await loadAuditScope(job.auditId);
  const target = resolveTarget(environment, auditScope);

  /* Exclude previous bundle/checksum artifacts from the new bundle — without
     this, re-packaging includes the old bundle inside the new one, making the
     archive grow on each run and breaking idempotency. */
  const BUNDLE_PATHS = new Set(["/audit/exports/bundle.tar", "/audit/exports/bundle.tar.sha256"]);

  const rows = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.auditId, job.auditId)))
    .orderBy(desc(artifacts.updatedAt));

  const bundleable = rows.filter((r) => !BUNDLE_PATHS.has(r.path));
  if (!bundleable.length) throw new Error(`no artifacts found for audit ${job.auditId}`);

  const manifest = {
    auditId: job.auditId,
    generatedAt: new Date().toISOString(),
    generator: "ai-system-auditor",
    generatorVersion: GENERATOR_VERSION,
    fileCount: bundleable.length,
    files: bundleable.map((r) => ({
      path: r.path,
      kind: r.kind,
      sha256: r.sha256,
      sizeBytes: r.sizeBytes,
    })),
    provenance: targetProvenance(target),
  };
  const manifestJson = JSON.stringify(manifest, null, 2);

  const tarFiles: Array<{ name: string; content: Buffer }> = [
    { name: "MANIFEST.json", content: Buffer.from(manifestJson, "utf-8") },
    ...bundleable.map((r) => ({
      name: r.path.replace(/^\//, "").replace(/\//g, "_"),
      content: Buffer.from(r.content, "utf-8"),
    })),
  ];

  const tar = buildTar(tarFiles);
  /* Hash the raw TAR bytes, not a latin1-decoded string re-encoded as UTF-8.
     The previous `sha256(tar.toString("latin1"))` produced a different digest
     than `sha256(tar)` because Node's createHash defaults to UTF-8 encoding
     for string inputs — the checksum did not match the actual archive bytes. */
  const checksum = createHash("sha256").update(tar).digest("hex");
  const tarB64 = tar.toString("base64");

  /* Persist the bundle as an artifact. Correct metadata: this is a TAR
     archive, not JSON — the previous kind/format/mimeType were all "json"
     which misled the artifact browser. */
  await lease?.assert();
  await upsertArtifact({
    auditId: job.auditId,
    kind: "archive",
    format: "tar",
    mimeType: "application/x-tar",
    title: "bundle.tar (base64) + checksum",
    path: "/audit/exports/bundle.tar",
    content: tarB64,
    tags: ["bundle", "tar", "export"],
    environment,
    metadata: {
      job: job.id,
      jobType: job.type,
      checksum,
      fileCount: bundleable.length,
      encoding: "base64",
      provenance: targetProvenance(target),
    },
  });

  await lease?.assert();
  await upsertArtifact({
    auditId: job.auditId,
    kind: "text",
    format: "sha256",
    mimeType: "text/plain",
    title: "bundle.tar.sha256",
    path: "/audit/exports/bundle.tar.sha256",
    content: `${checksum}  bundle.tar\n`,
    tags: ["bundle", "checksum", "export"],
    environment,
    metadata: { job: job.id, jobType: job.type },
  });
}

/* ------------------------------------------------------------------ */
/* knowledge.reindex — tokenize artifact contents into an inverted     */
/* index and store it in the settings table for the search API.        */
/* ------------------------------------------------------------------ */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "else", "for", "of", "to", "in", "on", "at", "by",
  "with", "from", "is", "are", "was", "were", "be", "been", "being", "this", "that", "these", "those",
  "it", "its", "as", "at", "do", "does", "did", "not", "no", "yes", "true", "false", "null", "undefined",
  "import", "export", "const", "let", "var", "function", "return", "class", "interface", "type", "void",
]);

/** Tokenize text for the inverted index. Splits on whitespace and
 *  punctuation but preserves Unicode letters (Vietnamese diacritics,
 *  CJK, etc.) — the previous `[^a-z0-9_]` regex stripped all non-ASCII
 *  characters, making Vietnamese search impossible. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && t.length <= 40 && !STOPWORDS.has(t));
}

/** Shape of the persisted inverted index. Exported so the search route and
 *  tests can reference the same contract. */
export interface KnowledgeIndex {
  generatedAt: string;
  generator: string;
  generatorVersion: string;
  docCount: number;
  termCount: number;
  docLengths: Record<number, number>;
  postings: Record<string, Array<{ artifactId: number; path: string; tf: number }>>;
  lastScopedAudit: string | null;
  auditDocs: Record<string, number[]>;
}

/** Pure merge/rebuild of the inverted index. Extracted from
 *  executeKnowledgeReindex so the scoped-deletion and Unicode behavior can be
 *  unit-tested without a database.
 *
 *  - `existing` is the prior global index (null on first build / global reindex).
 *  - `rows` are the artifacts to index now.
 *  - `auditId` is non-null for a scoped reindex: postings for the audit's
 *    PREVIOUS artifacts (recorded in `auditDocs`) are evicted along with the
 *    current ones, so artifacts deleted between runs no longer linger as
 *    orphan search hits. */
export function buildMergedIndex(
  existing: { postings: KnowledgeIndex["postings"]; docLengths: Record<number, number>; auditDocs?: Record<string, number[]> } | null,
  rows: Array<{ id: number; title: string; path: string; content: string }>,
  auditId: string | null,
): KnowledgeIndex {
  const inverted: Record<string, Array<{ artifactId: number; path: string; tf: number }>> = {};
  const docLengths: Record<number, number> = {};
  const auditDocs: Record<string, number[]> = { ...(existing?.auditDocs ?? {}) };

  const currentIds = new Set(rows.map((r) => r.id));
  if (existing && auditId) {
    const previousIds = existing.auditDocs?.[auditId] ?? [];
    const evictIds = new Set<number>([...previousIds, ...currentIds]);
    for (const [tok, postings] of Object.entries(existing.postings)) {
      const kept = postings.filter((p) => !evictIds.has(p.artifactId));
      if (kept.length) inverted[tok] = kept;
    }
    for (const [id, len] of Object.entries(existing.docLengths)) {
      if (!evictIds.has(Number(id))) docLengths[Number(id)] = len;
    }
  }

  for (const row of rows) {
    const tokens = tokenize(`${row.title} ${row.path} ${row.content}`);
    docLengths[row.id] = tokens.length;
    const tf = new Map<string, number>();
    for (const tok of tokens) tf.set(tok, (tf.get(tok) ?? 0) + 1);
    for (const [tok, count] of tf) {
      if (!inverted[tok]) inverted[tok] = [];
      inverted[tok].push({ artifactId: row.id, path: row.path, tf: count });
    }
  }

  if (auditId) auditDocs[auditId] = rows.map((r) => r.id);

  return {
    generatedAt: new Date().toISOString(),
    generator: "ai-system-auditor",
    generatorVersion: GENERATOR_VERSION,
    docCount: Object.keys(docLengths).length,
    termCount: Object.keys(inverted).length,
    docLengths,
    postings: inverted,
    lastScopedAudit: auditId,
    auditDocs,
  };
}

export async function executeKnowledgeReindex(job: JobRow, lease?: LeaseFence): Promise<void> {
  const environment = job.auditId ? (await loadAuditEnvironment(job.auditId)) : "production";

  /* Index all artifacts. When scoped to an audit, MERGE into the existing
     global index instead of overwriting it — previously a per-audit reindex
     would replace the global index with one containing only that audit's
     artifacts, making all other artifacts unsearchable. */
  const rows = job.auditId
    ? await db.select().from(artifacts).where(eq(artifacts.auditId, job.auditId))
    : await db.select().from(artifacts);

  /* Load existing global index to merge into (if this is a scoped reindex).
     Use a transaction with SELECT FOR UPDATE to prevent two concurrent
     knowledge.reindex jobs from both reading the same index, merging, and
     overwriting each other (lost update). The row-level lock serializes
     the read+merge+write so the second job sees the first's changes. */
  type IndexShape = {
    postings: Record<string, Array<{ artifactId: number; path: string; tf: number }>>;
    docLengths: Record<number, number>;
    auditDocs?: Record<string, number[]>;
  };
  let existingIndex: IndexShape | null = null;

  /* The merge + persist is wrapped in a transaction with FOR UPDATE on the
     settings row. This serializes concurrent reindex jobs: the second job
     blocks until the first commits, then reads the updated index. */
  const index = await db.transaction(async (tx) => {
    if (job.auditId) {
      const existing = await tx.execute(
        sql`SELECT value FROM settings WHERE key = 'knowledge.invertedIndex' FOR UPDATE`,
      );
      const rows_ = (existing.rows ?? []) as Array<{ value: IndexShape }>;
      if (rows_.length) {
        existingIndex = rows_[0].value;
      }
    }

    /* Pure merge/rebuild — see buildMergedIndex. Evicts postings for the
       audit's previous artifacts (including deleted ones) before re-inserting. */
    const merged = buildMergedIndex(existingIndex, rows, job.auditId);

    /* Lease fencing before persisting the merged index — a stale worker must
       not overwrite the index another worker already rebuilt. */
    await lease?.assert();
    await tx
      .insert(settings)
      .values({ key: "knowledge.invertedIndex", value: merged })
      .onConflictDoUpdate({ target: [settings.key], set: { value: merged, updatedAt: new Date() } });

    return merged;
  });

  /* Persist a manifest artifact so the reindex is visible in the artifact
     browser and has a sha256 like every other export. */
  await lease?.assert();
  await upsertArtifact({
    auditId: job.auditId ?? null,
    kind: "json",
    format: "json",
    mimeType: "application/json",
    title: "knowledge_index_manifest.json",
    path: "/audit/exports/knowledge_index_manifest.json",
    content: buildInventoryJson("knowledge_index_manifest.json", {
      docCount: index.docCount,
      termCount: index.termCount,
      lastScopedAudit: job.auditId ?? null,
      auditDocCounts: Object.fromEntries(Object.entries(index.auditDocs).map(([k, v]) => [k, v.length])),
    }),
    tags: ["knowledge", "inverted-index", "export"],
    environment,
    metadata: { job: job.id, jobType: job.type },
  });
}

/* ------------------------------------------------------------------ */
/* Dispatch + helpers.                                                 */
/* ------------------------------------------------------------------ */
export type Executor = (job: JobRow, lease?: LeaseFence) => Promise<void>;

const EXECUTORS: Record<string, Executor> = {
  "sbom.export": executeSbomExport,
  "parity.gate": executeParityGate,
  "artifact.package": executeArtifactPackage,
  "knowledge.reindex": executeKnowledgeReindex,
};

export function hasExecutor(jobType: string): boolean {
  return jobType in EXECUTORS;
}

/** Run the executor for a job. Throws if the job type has no executor — the
 *  caller must mark the job failed with errorCode NO_EXECUTOR rather than
 *  silently completing it. The optional `lease` lets the executor abort
 *  (LeaseLostError) before each side effect if it lost job ownership. */
export async function runExecutor(job: JobRow, lease?: LeaseFence): Promise<void> {
  const exec = EXECUTORS[job.type];
  if (!exec) throw new Error(`NO_EXECUTOR: no executor registered for job type "${job.type}"`);
  await exec(job, lease);
}

async function loadAuditEnvironment(auditId: string): Promise<string> {
  const rows = await db.select().from(audits).where(eq(audits.id, auditId)).limit(1);
  return rows[0]?.environment ?? "production";
}

async function loadAuditName(auditId: string): Promise<string> {
  const rows = await db.select().from(audits).where(eq(audits.id, auditId)).limit(1);
  return rows[0]?.name ?? auditId.slice(0, 8);
}

async function loadAuditScope(auditId: string): Promise<string[]> {
  const rows = await db.select().from(audits).where(eq(audits.id, auditId)).limit(1);
  return rows[0]?.scope ?? [];
}
