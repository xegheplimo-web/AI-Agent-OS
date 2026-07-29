import "dotenv/config";
/* Harness: runs the REAL non-audit executors and verifies their output.
 *
 * Each executor (sbom.export, parity.gate, artifact.package, knowledge.reindex)
 * is invoked directly with a synthetic job row, then the artifact/report/index
 * it claims to have produced is loaded back and checked:
 *   - the artifact row exists with a non-empty sha256
 *   - the sha256 matches a re-hash of the stored content
 *   - the content parses as the expected format (JSON for SBOM/parity/manifest,
 *     base64-decodable TAR for the bundle, a settings row for the index)
 *
 * Exit 0 only if every executor passed. Requires a reachable PostgreSQL
 * (DATABASE_URL) — same precondition as verify-real-engine.ts. */
process.env.APP_MODE = "production";

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
function check(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  console.log(` ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const { db, closeDb } = await import("../src/db");
  const { audits, artifacts, parityReports, settings, jobs } = await import("../src/db/schema");
  const { eq, desc } = await import("drizzle-orm");
  const { createHash } = await import("node:crypto");
  const { runExecutor } = await import("../src/services/executors");

  /* Create a real audit so artifact.package has something to bundle and
     parity.gate has an auditId to attach its report to. */
  const [audit] = await db.insert(audits).values({
    name: `AUD-EXEC-${Date.now().toString().slice(-6)}`,
    triggerType: "ci",
    status: "running",
    stages: [],
    environment: "local",
    requestedBy: "verify-executors",
    startedAt: new Date(),
  }).returning();

  /* Seed at least one artifact for the audit so artifact.package has input.
     Reuse the auditor engine to produce real artifacts, then run executors. */
  const { runRealAudit } = await import("../src/services/auditor/engine");
  await runRealAudit(audit.id);
  const seeded = await db.select().from(artifacts).where(eq(artifacts.auditId, audit.id));
  check("seed audit produced artifacts for executors", seeded.length > 0, `${seeded.length} artifacts`);

  const jobRow = (type: string, auditId: string | null) => ({
    id: crypto.randomUUID(),
    type: type as typeof jobs.$inferSelect.type,
    status: "running" as const,
    target: `verify:${type}`,
    auditId: auditId as string | null,
    progress: 0,
    attempt: 1,
    maxAttempts: 3,
    worker: "verify-executors",
    lockedBy: "verify-executors",
    heartbeatAt: new Date(),
    startedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  /* ---------- 1. sbom.export ---------- */
  try {
    await runExecutor(jobRow("sbom.export", audit.id) as never);
    const sbom = await db.select().from(artifacts).where(eq(artifacts.path, "/audit/exports/sbom.cyclonedx.json")).orderBy(desc(artifacts.updatedAt)).limit(1);
    const ok = sbom.length > 0 && sbom[0].sha256 !== "" && createHash("sha256").update(sbom[0].content).digest("hex") === sbom[0].sha256;
    check("sbom.export produced a CycloneDX artifact with valid sha256", ok, sbom[0] ? `${sbom[0].sizeBytes}B` : "no row");
    if (sbom[0]) {
      try {
        const parsed = JSON.parse(sbom[0].content);
        check("sbom content is valid CycloneDX JSON", parsed.bomFormat === "CycloneDX" && Array.isArray(parsed.components), `${parsed.components?.length ?? 0} components`);
      } catch {
        check("sbom content is valid CycloneDX JSON", false, "parse error");
      }
    }
  } catch (e) {
    check("sbom.export produced a CycloneDX artifact with valid sha256", false, (e as Error).message);
  }

  /* ---------- 2. parity.gate ---------- */
  try {
    await runExecutor(jobRow("parity.gate", audit.id) as never);
    const [report] = await db.select().from(parityReports).where(eq(parityReports.auditId, audit.id)).orderBy(desc(parityReports.createdAt)).limit(1);
    check("parity.gate persisted a parity report for the audit", !!report, report ? `${report.score}/${report.overallStatus}` : "no row");
    if (report) {
      const p95 = (report.checks as Array<{ key: string; status: string; currentValue?: string }>).find((c) => c.key === "p95_latency");
      check("parity.gate reports p95 as pending when no telemetry (no false-green)", p95?.status === "pending", `status=${p95?.status}`);
    }
  } catch (e) {
    check("parity.gate persisted a parity report for the audit", false, (e as Error).message);
  }

  /* ---------- 3. artifact.package ---------- */
  try {
    await runExecutor(jobRow("artifact.package", audit.id) as never);
    const bundle = await db.select().from(artifacts).where(eq(artifacts.path, "/audit/exports/bundle.tar")).orderBy(desc(artifacts.updatedAt)).limit(1);
    const checksumRow = await db.select().from(artifacts).where(eq(artifacts.path, "/audit/exports/bundle.tar.sha256")).limit(1);
    const ok = bundle.length > 0 && checksumRow.length > 0;
    check("artifact.package produced a bundle + checksum artifact", ok, ok ? `${bundle[0].sizeBytes}B` : "missing rows");
    if (ok) {
      const decoded = Buffer.from(bundle[0].content, "base64");
      check("bundle content is base64-decodable TAR (ustar magic)", decoded.length > 512 && decoded.slice(257, 263).toString("ascii") === "ustar", `${decoded.length}B decoded`);
      const reChecksum = createHash("sha256").update(decoded.toString("latin1")).digest("hex");
      const declared = (bundle[0].metadata as { checksum?: string })?.checksum ?? "";
      check("bundle checksum matches the declared sha256", reChecksum === declared, reChecksum.slice(0, 12));
    }
  } catch (e) {
    check("artifact.package produced a bundle + checksum artifact", false, (e as Error).message);
  }

  /* ---------- 4. knowledge.reindex ---------- */
  try {
    await runExecutor(jobRow("knowledge.reindex", null) as never);
    const idx = await db.select().from(settings).where(eq(settings.key, "knowledge.invertedIndex")).limit(1);
    check("knowledge.reindex stored an inverted index in settings", idx.length > 0, idx[0] ? `${(idx[0].value as { termCount?: number }).termCount ?? 0} terms` : "no row");
    if (idx[0]) {
      const val = idx[0].value as { docCount?: number; postings?: Record<string, unknown[]> };
      check("inverted index has postings (non-empty)", (val.postings && Object.keys(val.postings).length > 0) ?? false, `${val.docCount ?? 0} docs`);
    }
  } catch (e) {
    check("knowledge.reindex stored an inverted index in settings", false, (e as Error).message);
  }

  await closeDb();
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} executor checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
