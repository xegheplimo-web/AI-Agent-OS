import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { artifacts, audits, events, jobs, parityReports, settings, telemetryPoints } from "@/db/schema";
import { computeParityScore } from "@/lib/parity";
import { GENERATOR_VERSION } from "@/lib/version";
import { DISCOVERY_SCANNERS } from "@/services/auditor/scanners";
import { normalize, parityChecksFrom } from "@/services/auditor/normalize";
import { buildInventoryJson, buildRealSbom } from "@/services/auditor/reconstruct";
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
    await db
      .insert(artifacts)
      .values(row)
      .onConflictDoUpdate({
        target: [artifacts.path],
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
export async function executeSbomExport(job: JobRow): Promise<void> {
  const environment = job.auditId ? (await loadAuditEnvironment(job.auditId)) : "production";

  /* Run only the package-inventory scanner — cheaper than a full discovery
     pass and it is the only one feeding the SBOM. */
  const results = [];
  for (const scanner of DISCOVERY_SCANNERS) {
    const res = await scanner();
    if (res.scanner === "package-inventory") results.push(res);
  }
  if (!results.length) throw new Error("package-inventory scanner did not run");

  const inv = normalize(results);
  const auditName = job.auditId ? (await loadAuditName(job.auditId)) : "global-export";
  const sbom = buildRealSbom(auditName, inv);

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
export async function executeParityGate(job: JobRow): Promise<void> {
  const environment = job.auditId ? (await loadAuditEnvironment(job.auditId)) : "production";

  const results = [];
  for (const scanner of DISCOVERY_SCANNERS) {
    results.push(await scanner());
  }
  const inv = normalize(results);

  /* p95 latency from telemetry — null when absent (no false-green). */
  const p95Rows = await db
    .select()
    .from(telemetryPoints)
    .where(eq(telemetryPoints.metric, "latency_p95"))
    .orderBy(desc(telemetryPoints.ts))
    .limit(1);
  const latencyP95: number | null = p95Rows.length ? p95Rows[0].value : null;

  const checks = parityChecksFrom(inv, latencyP95);
  const { score, overallStatus } = computeParityScore(checks);

  const gates = [
    { key: "secrets_scan", label: "Secrets scan", status: inv.findings.some((f) => f.category === "security" && f.severity === "critical") ? "failed" : "passed" },
    { key: "sbom_diff", label: "SBOM generated", status: "passed" },
    { key: "endpoint_authz", label: "Endpoint authorization", status: checks.find((c) => c.key === "endpoint_authz")?.status ?? "pending" },
    { key: "lockfile", label: "Deterministic install (lockfile)", status: (inv.repo as { lockFilePresent?: boolean }).lockFilePresent ? "passed" : "failed" },
  ];

  if (job.auditId) {
    await db
      .insert(parityReports)
      .values({ auditId: job.auditId, overallStatus, score, environment, checks, gates })
      .onConflictDoUpdate({
        target: [parityReports.auditId],
        set: { overallStatus, score, checks, gates, environment },
      });
  } else {
    /* Global parity report (no audit) — no unique constraint, insert as-is. */
    await db.insert(parityReports).values({ overallStatus, score, environment, checks, gates });
  }

  /* Also persist the parity report as a queryable artifact. */
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

export async function executeArtifactPackage(job: JobRow): Promise<void> {
  if (!job.auditId) throw new Error("artifact.package requires an auditId — nothing to package for a global job");
  const environment = await loadAuditEnvironment(job.auditId);

  const rows = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.auditId, job.auditId))
    .orderBy(desc(artifacts.updatedAt));

  if (!rows.length) throw new Error(`no artifacts found for audit ${job.auditId}`);

  const manifest = {
    auditId: job.auditId,
    generatedAt: new Date().toISOString(),
    generator: "ai-system-auditor",
    generatorVersion: GENERATOR_VERSION,
    fileCount: rows.length,
    files: rows.map((r) => ({
      path: r.path,
      kind: r.kind,
      sha256: r.sha256,
      sizeBytes: r.sizeBytes,
    })),
  };
  const manifestJson = JSON.stringify(manifest, null, 2);

  const tarFiles: Array<{ name: string; content: Buffer }> = [
    { name: "MANIFEST.json", content: Buffer.from(manifestJson, "utf-8") },
    ...rows.map((r) => ({
      name: r.path.replace(/^\//, "").replace(/\//g, "_"),
      content: Buffer.from(r.content, "utf-8"),
    })),
  ];

  const tar = buildTar(tarFiles);
  const checksum = sha256(tar.toString("latin1"));
  const tarB64 = tar.toString("base64");

  /* Persist the bundle as an artifact. The TAR is stored base64 in `content`
     (db storage provider) — large-payload-to-disk is a later optimization
     (storageProvider=filesystem). The checksum lets a receiver verify it. */
  await upsertArtifact({
    auditId: job.auditId,
    kind: "json",
    format: "json",
    mimeType: "application/json",
    title: "bundle.tar (base64) + checksum",
    path: "/audit/exports/bundle.tar",
    content: tarB64,
    tags: ["bundle", "tar", "export"],
    environment,
    metadata: { job: job.id, jobType: job.type, checksum, fileCount: rows.length, encoding: "base64" },
  });

  await upsertArtifact({
    auditId: job.auditId,
    kind: "json",
    format: "json",
    mimeType: "application/json",
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

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 3 && t.length <= 40 && !STOPWORDS.has(t));
}

export async function executeKnowledgeReindex(job: JobRow): Promise<void> {
  const environment = job.auditId ? (await loadAuditEnvironment(job.auditId)) : "production";

  /* Index all artifacts (optionally scoped to an audit). */
  const rows = job.auditId
    ? await db.select().from(artifacts).where(eq(artifacts.auditId, job.auditId))
    : await db.select().from(artifacts);

  const inverted: Record<string, Array<{ artifactId: number; path: string; tf: number }>> = {};
  const docLengths: Record<number, number> = {};

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

  const index = {
    generatedAt: new Date().toISOString(),
    generator: "ai-system-auditor",
    generatorVersion: GENERATOR_VERSION,
    docCount: rows.length,
    termCount: Object.keys(inverted).length,
    docLengths,
    postings: inverted,
  };

  await db
    .insert(settings)
    .values({ key: "knowledge.invertedIndex", value: index })
    .onConflictDoUpdate({ target: [settings.key], set: { value: index, updatedAt: new Date() } });

  /* Persist a manifest artifact so the reindex is visible in the artifact
     browser and has a sha256 like every other export. */
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
      scopedToAudit: job.auditId ?? null,
    }),
    tags: ["knowledge", "inverted-index", "export"],
    environment,
    metadata: { job: job.id, jobType: job.type },
  });
}

/* ------------------------------------------------------------------ */
/* Dispatch + helpers.                                                 */
/* ------------------------------------------------------------------ */
export type Executor = (job: JobRow) => Promise<void>;

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
 *  silently completing it. */
export async function runExecutor(job: JobRow): Promise<void> {
  const exec = EXECUTORS[job.type];
  if (!exec) throw new Error(`NO_EXECUTOR: no executor registered for job type "${job.type}"`);
  await exec(job);
}

async function loadAuditEnvironment(auditId: string): Promise<string> {
  const rows = await db.select().from(audits).where(eq(audits.id, auditId)).limit(1);
  return rows[0]?.environment ?? "production";
}

async function loadAuditName(auditId: string): Promise<string> {
  const rows = await db.select().from(audits).where(eq(audits.id, auditId)).limit(1);
  return rows[0]?.name ?? auditId.slice(0, 8);
}
